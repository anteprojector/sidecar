import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_NAME,
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
// Syncing rewrites files in the checkout; ignore our own watcher echo.
const SYNC_ECHO_GRACE_MS = 5000;
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
  lastSyncEndAt: Map<string, number>;
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
    lastSyncEndAt: new Map(),
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
async function syncInstance(state: DaemonState, root: string, trigger: string): Promise<boolean> {
  if (state.syncing.has(root)) return false;
  state.syncing.add(root);
  let succeeded = false;
  try {
    const localCli = localSidecarCliPath(root);
    const cli = localCli ?? currentCliPath();
    logSidecarEvent("daemon-sync-start", { root, trigger, local: Boolean(localCli) });
    const result = await runChild(process.execPath, [cli, "sync"], {
      cwd: root,
      // Daemon syncs are soft: one that finds a manual sync mid-flight can
      // no-op without it counting as a failure — the next trigger retries.
      env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1", [SOFT_SYNC_ENV]: "1" },
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
    state.lastSyncEndAt.set(root, Date.now());
  }
  if (succeeded) await followUpTrailingSync(state, root);
  else state.trailingPending.delete(root);
  return succeeded;
}

// Watch events that arrived during a sync are either edits the sync missed or
// the echo of its own writes. A dirty checkout disambiguates: echo is always
// committed state, a missed save is not. Skipping the clean case is what stops
// every watch sync from scheduling another one forever.
async function followUpTrailingSync(state: DaemonState, root: string): Promise<void> {
  if (!state.trailingPending.delete(root)) return;
  if (await checkoutIsDirty(root)) {
    void syncInstance(state, root, "watch-followup");
  }
}

async function checkoutIsDirty(root: string): Promise<boolean> {
  const sidecarPath = readInstances().find((instance) => instance.root === root)?.sidecarPath;
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return false;
  const result = await runChild("git", ["-C", sidecarPath, "status", "--porcelain"], { timeoutMs: 30_000 });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function localSidecarCliPath(root: string): string | undefined {
  if (!projectDependsOnSidecar(root)) return undefined;
  const candidate = path.join(root, "node_modules", "@projectors", "sidecar", "dist", "cli.js");
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
  if (Date.now() - (state.lastSyncEndAt.get(root) ?? 0) < SYNC_ECHO_GRACE_MS) return;
  if (state.pendingTimers.has(root)) {
    state.trailingPending.add(root);
    return;
  }
  logSidecarEvent("daemon-watch-debounce", { root, windowSeconds: state.options.debounceSeconds });
  const timer = setTimeout(() => {
    state.pendingTimers.delete(root);
    if (state.trailingPending.delete(root)) {
      if (state.syncing.has(root)) {
        // The running sync's completion handler owns the follow-up.
        state.trailingPending.add(root);
      } else {
        void syncInstance(state, root, "watch-trailing");
      }
    }
  }, state.options.debounceSeconds * 1000);
  state.pendingTimers.set(root, timer);
  void syncInstance(state, root, "watch");
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
