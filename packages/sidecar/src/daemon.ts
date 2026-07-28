import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_NAME,
  LOCAL_SYNC_ENV,
  familyPrimaryRoot,
  SOFT_SYNC_ENV,
  bunGlobalRoot,
  compareVersions,
  daemonPidPath,
  ensureDaemonServiceFile,
  findExecutableOnPath,
  findGlobalSidecarExecutable,
  globalSidecarVersion,
  logSidecarEvent,
  packageVersion,
  pidIsSidecarDaemon,
  projectDependsOnSidecar,
  readInstances,
  readSettings,
  sidecarStateDir,
  startDetachedDaemon,
  writeInstances,
  writeSettings,
} from "./cli.js";
import type { SidecarInstance } from "./cli.js";

const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
const SKIP_UPDATE_ENV = "SIDECAR_SKIP_UPDATE";

export const WATCH_LIMIT = 100;
const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_AFTER_MISSES = 3;
// How long changes collapse before the next settle. Short: settling is local
// and cheap, so this is the floor on how fast one working copy's edit reaches
// its siblings. It doubles as the window a burst of non-user writes — a sync's
// own echo, a sibling's settle — coalesces into before the checkout is asked
// once more whether anything real landed in the middle of it.
const SETTLE_WINDOW_MS = 5000;
const MAX_BACKOFF_CYCLES = 6;

export type DaemonOptions = {
  once: boolean;
  intervalSeconds: number;
  debounceSeconds: number;
};

type ChokidarModule = typeof import("chokidar");

type Watcher = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close(): Promise<void>;
};

type DaemonState = {
  options: DaemonOptions;
  syncing: Set<string>;
  syncingFamilies: Set<string>;
  lastRemoteSyncAt: Map<string, number>;
  remoteTimers: Map<string, NodeJS.Timeout>;
  pendingTimers: Map<string, NodeJS.Timeout>;
  trailingPending: Set<string>;
  failures: Map<string, number>;
  skipUntilCycle: Map<string, number>;
  misses: Map<string, number>;
  watchers: Map<string, Watcher>;
  cycleCount: number;
  lastWatchCount: number;
  refreshing: boolean;
  registryTimer?: NodeJS.Timeout;
  staleNotified: boolean;
};

export async function runDaemonLoop(options: DaemonOptions): Promise<number> {
  const state: DaemonState = {
    options,
    syncing: new Set(),
    syncingFamilies: new Set(),
    lastRemoteSyncAt: new Map(),
    remoteTimers: new Map(),
    pendingTimers: new Map(),
    trailingPending: new Set(),
    failures: new Map(),
    skipUntilCycle: new Map(),
    misses: new Map(),
    watchers: new Map(),
    cycleCount: 0,
    lastWatchCount: -1,
    refreshing: false,
    staleNotified: false,
  };

  console.log(`sidecar daemon polling every ${options.intervalSeconds}s`);
  logSidecarEvent("daemon-start", {
    intervalSeconds: options.intervalSeconds,
    debounceSeconds: options.debounceSeconds,
    once: options.once,
    pid: process.pid,
  });

  if (options.once) {
    await runCycle(state);
    return 0;
  }

  await acquireDaemonPid();
  installShutdownHandlers();
  await watchRegistry(state);
  const bootVersion = packageVersion();

  while (true) {
    maybeAdoptNewerInstall(state, bootVersion);
    await runCycle(state);
    ensureDaemonServiceFile();
    await refreshWatchers(state);
    await maybeAutoUpdate();
    await delay(options.intervalSeconds * 1000);
  }
}

// A daemon can keep running old code long after the global install changed:
// an in-place `npm install -g` swaps the files under us, and a rename or
// package-manager switch leaves the service pointing at an abandoned copy.
// Detect both each cycle and hand over to the current install.
function maybeAdoptNewerInstall(state: DaemonState, bootVersion: string): void {
  const diskVersion = packageVersion();
  if (diskVersion !== bootVersion) {
    logSidecarEvent("daemon-stale", { running: bootVersion, installed: diskVersion, reason: "in-place-update" });
    restartAfterUpdate();
    return;
  }

  const onPath = findGlobalSidecarExecutable();
  if (!onPath) return;
  if (realpathOr(onPath) === realpathOr(currentCliPath())) return;
  const pathVersion = globalSidecarVersion(onPath);
  // Same version at a different path is indistinguishable from a bin shim
  // (Windows .cmd) pointing back at us, so only differing versions count.
  if (!pathVersion || pathVersion === diskVersion) return;

  if (process.stdout.isTTY) {
    if (!state.staleNotified) {
      state.staleNotified = true;
      console.log(`sidecar v${pathVersion} is installed at ${onPath}; run \`sidecar daemon restart\` to switch to it`);
    }
    return;
  }

  logSidecarEvent("daemon-stale", {
    running: diskVersion,
    installed: pathVersion,
    executable: onPath,
    reason: "new-install",
  });
  // The current install rewrites the service to point at itself and boots
  // this daemon out; if that fails we simply try again next cycle.
  const child = spawn(onPath, ["daemon", "restart"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1" },
  });
  child.unref();
}

async function runCycle(state: DaemonState): Promise<void> {
  const settings = readSettings();
  if (!settings.daemonEnabled) {
    logSidecarEvent("daemon-skip", { reason: "daemon-disabled" });
    return;
  }

  state.cycleCount += 1;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const instance of readInstances()) {
    if (!fs.existsSync(instance.configPath)) {
      const misses = (state.misses.get(instance.root) ?? 0) + 1;
      state.misses.set(instance.root, misses);
      if (misses >= PRUNE_AFTER_MISSES) {
        pruneInstance(instance.root);
        state.misses.delete(instance.root);
      } else {
        logSidecarEvent("daemon-skip", { root: instance.root, reason: "config-missing", misses });
      }
      skipped += 1;
      continue;
    }
    state.misses.delete(instance.root);
    if (state.cycleCount < (state.skipUntilCycle.get(instance.root) ?? 0)) {
      skipped += 1;
      continue;
    }
    if (await syncInstance(state, instance.root, "cycle")) {
      synced += 1;
    } else {
      failed += 1;
    }
  }
  logSidecarEvent("daemon-cycle", { synced, failed, skipped });
}

function pruneInstance(root: string): void {
  writeInstances(readInstances().filter((instance) => instance.root !== root));
  logSidecarEvent("daemon-prune", { root, reason: "config-missing" });
}

// Repos with a project-local sidecar install sync with their own pinned
// version; the global daemon only schedules the work.
async function syncInstance(
  state: DaemonState,
  root: string,
  trigger: string,
  options: { localOnly?: boolean } = {},
): Promise<boolean> {
  if (state.syncing.has(root)) return false;
  // Working copies of one repo share a sidecar clone and therefore one sync
  // lock. Two syncing at once means the loser — soft, because the daemon issued
  // it — quietly does nothing and reports success, stranding whatever it was
  // about to capture until the next poll. Serialize the family here instead,
  // where the work can simply be asked for again.
  const family = realpathOr(familyPrimaryRoot(root) ?? root);
  if (state.syncingFamilies.has(family)) {
    logSidecarEvent("daemon-defer", { root, trigger, reason: "family-busy" });
    state.trailingPending.add(root);
    if (!state.pendingTimers.has(root)) openTrailingWindow(state, root, SETTLE_WINDOW_MS);
    // A deferred remote sync has to be rebooked here: the trailing window only
    // re-syncs a dirty checkout, and a clean one can still owe the remote a
    // push — which would otherwise wait for the interval poll.
    if (!options.localOnly) armRemoteSync(state, root);
    return false;
  }
  state.syncing.add(root);
  state.syncingFamilies.add(family);
  // Stamped on the attempt, not the outcome: a remote that is failing must not
  // be retried at the settle cadence.
  if (!options.localOnly) {
    state.lastRemoteSyncAt.set(root, Date.now());
    clearTimeout(state.remoteTimers.get(root));
    state.remoteTimers.delete(root);
  }
  let succeeded = false;
  try {
    const localCli = localSidecarCliPath(root);
    const cli = localCli ?? currentCliPath();
    logSidecarEvent("daemon-sync-start", { root, trigger, local: Boolean(localCli), localOnly: Boolean(options.localOnly) });
    const result = await runChild(process.execPath, [cli, "sync"], {
      cwd: root,
      // Daemon syncs are soft: one that finds a manual sync mid-flight can
      // no-op without it counting as a failure — the next trigger retries.
      env: {
        ...process.env,
        [SKIP_LOCAL_EXEC_ENV]: "1",
        [GLOBAL_EXEC_ENV]: "1",
        [SOFT_SYNC_ENV]: "1",
        ...(options.localOnly ? { [LOCAL_SYNC_ENV]: "1" } : {}),
      },
      timeoutMs: SYNC_TIMEOUT_MS,
    });
    if (result.status === 0) {
      state.failures.delete(root);
      state.skipUntilCycle.delete(root);
      logSidecarEvent("daemon-sync", { root, trigger, local: Boolean(localCli) });
      succeeded = true;
    } else {
      const failures = (state.failures.get(root) ?? 0) + 1;
      state.failures.set(root, failures);
      state.skipUntilCycle.set(root, state.cycleCount + Math.min(2 ** (failures - 1), MAX_BACKOFF_CYCLES));
      logSidecarEvent("failure", {
        command: "daemon",
        root,
        trigger,
        message: result.timedOut ? "sync timed out" : result.output.trim().slice(-500) || `sync exited ${result.status}`,
      });
    }
  } finally {
    state.syncing.delete(root);
    state.syncingFamilies.delete(family);
    if (options.localOnly) armRemoteSync(state, root);
  }
  if (succeeded) await followUpTrailingSync(state, root);
  else state.trailingPending.delete(root);
  return succeeded;
}

// Watch events that arrived during a sync are either edits the sync missed or
// the echo of its own writes. A dirty checkout disambiguates: echo is always
// committed state, a missed save is not. Skipping the clean case is what stops
// every watch sync from scheduling another one forever — and, now that a sync
// fast-forwards its sibling worktrees, what stops one checkout's settle from
// waking every other checkout on the machine.
async function followUpTrailingSync(state: DaemonState, root: string): Promise<void> {
  if (!state.trailingPending.delete(root)) return;
  await syncIfDirty(state, root, "watch-followup");
}

// Local unless the remote is due, like every other watch-driven sync: an edit
// arriving mid-sync is no more urgent for the remote than one arriving after.
async function syncIfDirty(state: DaemonState, root: string, trigger: string): Promise<void> {
  if (!(await checkoutIsDirty(root))) return;
  void syncInstance(state, root, trigger, { localOnly: !remoteIsDue(state, root) });
}

async function checkoutIsDirty(root: string): Promise<boolean> {
  const sidecarPath = readInstances().find((instance) => instance.root === root)?.sidecarPath;
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return false;
  const result = await runChild("git", ["-C", sidecarPath, "status", "--porcelain"], { timeoutMs: 30_000 });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function localSidecarCliPath(root: string): string | undefined {
  if (!projectDependsOnSidecar(root)) return undefined;
  const candidate = path.join(root, "node_modules", PACKAGE_NAME, "dist", "cli.js");
  if (!isFile(candidate)) return undefined;
  try {
    if (fs.realpathSync(candidate) === fs.realpathSync(currentCliPath())) return undefined;
  } catch {
    // Unresolvable paths cannot be the same file.
  }
  return candidate;
}

function currentCliPath(): string {
  return process.argv[1] || fileURLToPath(import.meta.url);
}

export function selectWatchTargets(instances: SidecarInstance[], limit = WATCH_LIMIT): SidecarInstance[] {
  return [...instances]
    .filter((instance) => fs.existsSync(instance.configPath) && fs.existsSync(instance.sidecarPath))
    .sort((left, right) => instanceRecency(right) - instanceRecency(left))
    .slice(0, limit);
}

function instanceRecency(instance: SidecarInstance): number {
  const time = Date.parse(instance.lastSyncAt ?? instance.updatedAt ?? instance.registeredAt);
  return Number.isFinite(time) ? time : 0;
}

let chokidarModule: ChokidarModule | null | undefined;

async function loadChokidar(): Promise<ChokidarModule | null> {
  if (chokidarModule !== undefined) return chokidarModule;
  try {
    chokidarModule = await import("chokidar");
  } catch (error) {
    chokidarModule = null;
    logSidecarEvent("daemon-watch-unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    console.log("file watching unavailable; relying on interval sync");
  }
  return chokidarModule;
}

async function refreshWatchers(state: DaemonState): Promise<void> {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const chokidar = await loadChokidar();
    if (!chokidar) return;

    const targets = new Map(selectWatchTargets(readInstances()).map((instance) => [instance.root, instance.sidecarPath]));
    for (const [root, watcher] of [...state.watchers]) {
      if (targets.has(root)) continue;
      state.watchers.delete(root);
      await watcher.close().catch(() => undefined);
    }
    for (const [root, sidecarPath] of targets) {
      if (state.watchers.has(root)) continue;
      try {
        const watcher = chokidar.watch(sidecarPath, {
          ignored: watchIgnoreMatcher(sidecarPath),
          ignoreInitial: true,
          persistent: true,
        }) as unknown as Watcher;
        watcher.on("all", () => scheduleWatchSync(state, root));
        watcher.on("error", (error) => {
          logSidecarEvent("failure", {
            command: "daemon",
            root,
            message: `watcher error: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
        state.watchers.set(root, watcher);
      } catch (error) {
        logSidecarEvent("failure", {
          command: "daemon",
          root,
          message: `could not watch ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (state.watchers.size !== state.lastWatchCount) {
      state.lastWatchCount = state.watchers.size;
      logSidecarEvent("daemon-watch", { watching: state.watchers.size });
    }
  } finally {
    state.refreshing = false;
  }
}

// Leading + trailing debounce: the first change syncs immediately and opens a
// quiet window; changes during the window collapse into one trailing sync at
// its close, after which the next change leads again.
function scheduleWatchSync(state: DaemonState, root: string): void {
  if (state.syncing.has(root)) {
    // A save landing mid-sync must not wait for the next interval; mark it
    // pending and let the sync's completion decide whether it was real work
    // or just our own write echo.
    state.trailingPending.add(root);
    return;
  }
  if (state.pendingTimers.has(root)) {
    state.trailingPending.add(root);
    return;
  }
  void beginWatchSync(state, root);
}

/**
 * The leading edge, where a dirty checkout answers both questions at once.
 *
 * Dirty means edits no sync has captured: sync now, and open a settle window
 * behind it to collapse the burst still arriving. Clean means these writes were
 * not the user's — this checkout's own sync echo, or a sibling settling it out
 * of the shared object store — so there is nothing to capture and no sync to
 * run. Syncing anyway is how one checkout's settle woke every other checkout on
 * the machine, each paying a full round trip to discover it had no work.
 *
 * This replaces a timing guard that dropped any change arriving within a few
 * seconds of a sync. Dropping was the wrong verdict twice over: it stranded a
 * real edit until the next interval, a whole poll period away, and it still let
 * echo through whenever the writes landed late. Asking the checkout is exact.
 *
 * The clean case still opens a short window, so the rest of that write burst
 * coalesces into one re-check rather than a git call apiece — and that re-check
 * catches a real edit that landed mid-burst. Short rather than the full
 * debounce because its job is to ask again, not to wait out a burst: borrowing
 * the 60s debounce here would strand an edit made moments after a settle.
 */
async function beginWatchSync(state: DaemonState, root: string): Promise<void> {
  if (state.syncing.has(root) || state.pendingTimers.has(root)) return;
  const dirty = await checkoutIsDirty(root);
  // The await is a scheduling gap; another event may have led in the meantime.
  if (state.syncing.has(root) || state.pendingTimers.has(root)) return;

  openTrailingWindow(state, root, SETTLE_WINDOW_MS);
  if (dirty) void syncInstance(state, root, "watch", { localOnly: !remoteIsDue(state, root) });
  else state.trailingPending.add(root);
}

/**
 * Books the round trip a local-only sync deferred.
 *
 * Settling leaves work owed to the remote, and once the editing stops there is
 * no further watch event to carry it — without this it would wait for the
 * interval poll, ten minutes away by default, where before it went within the
 * debounce. The delay is the remainder of that debounce, so the cadence is the
 * one `--debounce` asked for however the syncs were triggered.
 */
function armRemoteSync(state: DaemonState, root: string): void {
  if (state.remoteTimers.has(root)) return;
  const elapsed = Date.now() - (state.lastRemoteSyncAt.get(root) ?? 0);
  const timer = setTimeout(
    () => {
      state.remoteTimers.delete(root);
      void syncInstance(state, root, "remote-due");
    },
    // The floor keeps an overdue sync rebooked against a busy family from
    // retrying in a hot loop instead of at the settle cadence.
    Math.max(SETTLE_WINDOW_MS, state.options.debounceSeconds * 1000 - elapsed),
  );
  state.remoteTimers.set(root, timer);
}

/**
 * Whether this root has gone long enough without reaching the remote to be
 * worth the trip.
 *
 * Settling this machine and syncing with the other machines happen at
 * deliberately different rates. Settling is a local fast-forward out of an
 * object store the sibling worktrees already share, so it can run as often as
 * edits land; the round trip cannot, and `--debounce` is what governs it. One
 * window for both meant the second edit in a burst waited out the full debounce
 * before any sibling saw it — a minute, by default, to move a file between two
 * directories on the same disk.
 */
function remoteIsDue(state: DaemonState, root: string): boolean {
  const last = state.lastRemoteSyncAt.get(root) ?? 0;
  return Date.now() - last >= state.options.debounceSeconds * 1000;
}

function openTrailingWindow(state: DaemonState, root: string, delayMs: number): void {
  logSidecarEvent("daemon-watch-debounce", { root, windowSeconds: Math.round(delayMs / 1000) });
  const timer = setTimeout(() => {
    state.pendingTimers.delete(root);
    if (!state.trailingPending.delete(root)) return;
    if (state.syncing.has(root)) {
      // The running sync's completion handler owns the follow-up.
      state.trailingPending.add(root);
      return;
    }
    void syncIfDirty(state, root, "watch-trailing");
  }, delayMs);
  state.pendingTimers.set(root, timer);
}

// Local installs register repos while the daemon is running; pick those up
// without waiting for the next full cycle.
async function watchRegistry(state: DaemonState): Promise<void> {
  const chokidar = await loadChokidar();
  if (!chokidar) return;
  try {
    const watcher = chokidar.watch(sidecarStateDir(), { ignoreInitial: true, depth: 0 }) as unknown as Watcher;
    watcher.on("all", (...args) => {
      const filePath = typeof args[1] === "string" ? args[1] : "";
      if (path.basename(filePath) !== "instances.json") return;
      if (state.registryTimer) return;
      state.registryTimer = setTimeout(() => {
        state.registryTimer = undefined;
        void refreshWatchers(state);
      }, 5000);
    });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not watch registry: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function compileGitignoreMatcher(lines: string[]): (relativePath: string) => boolean {
  const rules: RegExp[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "").trim();
    // Negations are rare in sidecar checkouts; skipping them only means we
    // watch a little more than strictly necessary.
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    let pattern = line.replace(/\/+$/, "");
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    pattern = pattern.replace(/^\/+/, "");
    // "**" path segments match zero or more directories; other wildcards
    // never cross a slash, mirroring gitignore semantics.
    const body = pattern
      .split("/")
      .map((segment) =>
        segment === "**"
          ? "\u0000"
          : segment
              .split("*")
              .map((piece) => piece.split("?").map(escapeRegex).join("[^/]"))
              .join("[^/]*"),
      )
      .join("/")
      .replaceAll("\u0000/", "(?:.*/)?")
      .replaceAll("/\u0000", "(?:/.*)?")
      .replaceAll("\u0000", ".*");
    rules.push(new RegExp(`${anchored ? "^" : "(^|.*/)"}${body}(/.*)?$`));
  }
  return (relativePath: string) => {
    const normalized = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return false;
    return rules.some((rule) => rule.test(normalized));
  };
}

function watchIgnoreMatcher(sidecarPath: string): (candidate: string) => boolean {
  let gitignore: ((relativePath: string) => boolean) | undefined;
  try {
    const ignoreFile = path.join(sidecarPath, ".gitignore");
    if (fs.existsSync(ignoreFile)) {
      gitignore = compileGitignoreMatcher(fs.readFileSync(ignoreFile, "utf8").split("\n"));
    }
  } catch {
    // An unreadable .gitignore just means we watch everything.
  }
  const root = path.resolve(sidecarPath);
  return (candidate: string) => {
    const relative = path.relative(root, candidate);
    if (!relative) return false;
    const normalized = relative.split(path.sep).join("/");
    if (normalized.startsWith("..")) return true;
    if (normalized === ".git" || normalized.startsWith(".git/")) return true;
    return gitignore ? gitignore(normalized) : false;
  };
}

export type UpdateResult = {
  status: "updated" | "current" | "skipped" | "failed";
  current: string;
  latest?: string;
  message?: string;
};

// Shared by the daemon's daily check and the manual `sidecar update` command.
export async function checkAndInstallUpdate(): Promise<UpdateResult> {
  const current = packageVersion();
  const npm = findExecutableOnPath(process.platform === "win32" ? "npm.cmd" : "npm");
  if (!npm) return { status: "skipped", current, message: "npm not found on PATH" };

  const view = await runChild(npm, ["view", PACKAGE_NAME, "version"], { timeoutMs: 60_000 });
  const latest = view.stdout.trim();
  if (view.status !== 0 || !/^\d+\.\d+\.\d+$/.test(latest)) {
    return {
      status: "failed",
      current,
      message: `version check failed: ${(latest || view.output.trim()).slice(-200)}`,
    };
  }
  if (compareVersions(latest, current) <= 0) {
    return { status: "current", current, latest };
  }

  // The recorded install source wins; the bun-directory heuristic is the
  // fallback for installs that predate recording. "curl" installs via npm
  // under the hood, so it takes the npm path.
  const source = readSettings().installSource;
  const usesBun = source ? source === "bun" : isInsidePath(realpathOr(currentCliPath()), realpathOr(bunGlobalRoot()));
  const bun = usesBun ? findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun") : undefined;
  const installer = bun ?? npm;
  const args = bun
    ? ["add", "-g", `${PACKAGE_NAME}@${latest}`]
    : ["install", "-g", `${PACKAGE_NAME}@${latest}`];
  const install = await runChild(installer, args, { timeoutMs: 5 * 60_000 });
  if (install.status !== 0) {
    return {
      status: "failed",
      current,
      latest,
      message: `install of ${latest} failed: ${install.output.trim().slice(-500)}`,
    };
  }
  return { status: "updated", current, latest };
}

async function maybeAutoUpdate(): Promise<void> {
  if (process.env[SKIP_UPDATE_ENV] === "1") return;
  const settings = readSettings();
  if (!settings.autoUpdate) return;
  const last = settings.lastUpdateCheckAt ? Date.parse(settings.lastUpdateCheckAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return;
  // Stamp before checking so a failing registry cannot cause a retry storm.
  writeSettings({ ...settings, lastUpdateCheckAt: new Date().toISOString() });

  const result = await checkAndInstallUpdate();
  if (result.status === "updated") {
    logSidecarEvent("daemon-update", { from: result.current, to: result.latest });
    ensureDaemonServiceFile();
    restartAfterUpdate();
    return;
  }
  if (result.status === "current") {
    logSidecarEvent("daemon-update-check", { current: result.current, latest: result.latest });
    return;
  }
  logSidecarEvent("daemon-update-skip", { reason: result.status, message: result.message });
}

function restartAfterUpdate(): void {
  if (process.stdout.isTTY) {
    console.log("sidecar updated; restart this daemon to pick up the new version");
    return;
  }
  removeOwnPidFile();
  // launchd/systemd restart the exited daemon; Windows has no supervisor, so
  // hand off to a detached replacement before exiting.
  if (process.platform === "win32") startDetachedDaemon();
  process.exit(0);
}

async function acquireDaemonPid(): Promise<void> {
  const pidPath = daemonPidPath();
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  while (true) {
    // Exclusive create is the lock: two daemons starting together race the
    // old read-then-write here, and both used to win.
    try {
      fs.writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readPid(pidPath);
    if (holder === process.pid) return;
    if (holder && pidIsSidecarDaemon(holder)) {
      logSidecarEvent("daemon-wait", { holder });
      await delay(30_000);
      continue;
    }
    // Stale pid file (crash, reboot, or the pid reused by another process):
    // heal it and take over.
    logSidecarEvent("daemon-pid-heal", { holder: holder ?? null });
    fs.rmSync(pidPath, { force: true });
  }
}

function installShutdownHandlers(): void {
  const shutdown = () => {
    removeOwnPidFile();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", removeOwnPidFile);
}

function removeOwnPidFile(): void {
  try {
    if (readPid(daemonPidPath()) === process.pid) fs.rmSync(daemonPidPath(), { force: true });
  } catch {
    // Losing the pid file race is harmless.
  }
}

function readPid(pidPath: string): number | undefined {
  try {
    const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

type ChildResult = { status: number; output: string; stdout: string; timedOut: boolean };

function runChild(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let stdout = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-8192);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-8192);
      append(chunk);
    });
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: output || String(error), stdout, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, output, stdout, timedOut });
    });
  });
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function realpathOr(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isInsidePath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
