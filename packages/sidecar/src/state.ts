// Machine-local state under the sidecar state dir: settings, the instance
// registry, the event log, and the per-family sync lock. Nothing here ever
// leaves this machine; everything shared travels through the git remote.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SidecarError, nowIso, realpathOr, slug } from "./util.js";
import { familyPrimaryRoot, git, hasGitMetadata } from "./git.js";
import { INSTALL_SOURCES, type InstallSource, shouldUseGlobalRegistry } from "./install.js";
import { DEFAULT_PEER, type SidecarConfig, expandInbox, peerConfigPath, peerNameOf, readConfig, resolveSidecarPath } from "./config.js";
import { redactText } from "./redaction.js";

const STATE_DIR_ENV = "SIDECAR_STATE_DIR";

export function sidecarStateDir(): string {
  if (process.env[STATE_DIR_ENV]) return path.resolve(process.env[STATE_DIR_ENV]);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "sidecar");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sidecar");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "sidecar");
}

export function instancesPath(): string {
  return path.join(sidecarStateDir(), "instances.json");
}

export function sidecarLogPath(): string {
  return path.join(sidecarStateDir(), "sidecar.log");
}

export function settingsPath(): string {
  return path.join(sidecarStateDir(), "settings.json");
}

function ensureStateDir(): void {
  fs.mkdirSync(sidecarStateDir(), { recursive: true });
}

export type SidecarSettings = {
  daemonEnabled: boolean;
  autoUpdate: boolean;
  lastUpdateCheckAt?: string;
  installSource?: InstallSource;
};

const DEFAULT_SETTINGS: SidecarSettings = { daemonEnabled: true, autoUpdate: true };

export function readSettings(): SidecarSettings {
  const filePath = settingsPath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    const record = raw as Record<string, unknown>;
    return {
      daemonEnabled: typeof record.daemonEnabled === "boolean" ? record.daemonEnabled : true,
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
      lastUpdateCheckAt: typeof record.lastUpdateCheckAt === "string" ? record.lastUpdateCheckAt : undefined,
      installSource: INSTALL_SOURCES.has(record.installSource as InstallSource)
        ? (record.installSource as InstallSource)
        : undefined,
    };
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: SidecarSettings): void {
  ensureStateDir();
  const record: Record<string, unknown> = {
    daemonEnabled: settings.daemonEnabled,
    autoUpdate: settings.autoUpdate,
  };
  if (settings.lastUpdateCheckAt) record.lastUpdateCheckAt = settings.lastUpdateCheckAt;
  if (settings.installSource) record.installSource = settings.installSource;
  fs.writeFileSync(settingsPath(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * One registered peer. `configPath` is the identity: a repo with several peers
 * has one entry per peer, all sharing a root, and the peer's name is the
 * config file's — `peerNameOf(path.basename(configPath))`.
 */
export type SidecarInstance = {
  root: string;
  configPath: string;
  sidecarPath: string;
  remote: string;
  branch: string;
  inbox: string;
  registeredAt: string;
  updatedAt: string;
  lastSyncAt?: string;
};

type InstanceStatus = SidecarInstance & {
  config: "ok" | "missing" | "invalid";
  checkout: "present" | "missing";
  dirty: "yes" | "no" | "unknown";
  currentBranch: string;
};

function isSidecarInstance(value: unknown): value is SidecarInstance {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.root === "string" &&
    typeof record.configPath === "string" &&
    typeof record.sidecarPath === "string" &&
    typeof record.remote === "string" &&
    typeof record.branch === "string" &&
    typeof record.inbox === "string" &&
    typeof record.registeredAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function readInstances(): SidecarInstance[] {
  const filePath = instancesPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isSidecarInstance);
  } catch (error) {
    logSidecarEvent("failure", {
      command: "instances",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  }
}

// Registry writes are transactions: atomic replacement alone protects readers,
// but would still let two processes overwrite each other's registrations.
function updateInstances(update: (instances: SidecarInstance[]) => SidecarInstance[]): void {
  const release = acquireRegistryLock();
  try {
    const instances = readInstances();
    const next = update(instances);
    if (next === instances) return;
    const temporary = `${instancesPath()}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, instancesPath());
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } finally {
    release();
  }
}

function acquireRegistryLock(): () => void {
  ensureStateDir();
  const lockDir = path.join(sidecarStateDir(), "instances.lock");
  const prepared = fs.mkdtempSync(path.join(sidecarStateDir(), ".instances-lock-"));
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 10_000;
  let acquired = false;
  try {
    // Publish a nonempty directory atomically. There is no acquisition window
    // with a missing owner, and rename cannot replace another nonempty lock.
    fs.writeFileSync(path.join(prepared, owner), "", "utf8");
    while (true) {
      try {
        fs.renameSync(prepared, lockDir);
        acquired = true;
        return () => removeRegistryLockOwner(lockDir, owner);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM" && code !== "EACCES") throw error;
      }
      reapRegistryLock(lockDir);
      if (Date.now() >= deadline) {
        throw new SidecarError(`timed out waiting for the instance registry lock: ${lockDir}`);
      }
      Atomics.wait(sleeper, 0, 0, 10);
    }
  } finally {
    if (!acquired) fs.rmSync(prepared, { recursive: true, force: true });
  }
}

function removeRegistryLockOwner(lockDir: string, owner: string): void {
  // Remove only the observed owner's unique entry, never a replacement lock.
  // Concurrent reapers can race with acquisition safely: rmdir refuses a new
  // holder's nonempty directory, unlike recursive removal.
  try {
    fs.unlinkSync(path.join(lockDir, owner));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  removeEmptyRegistryLock(lockDir);
}

function removeEmptyRegistryLock(lockDir: string): void {
  try {
    fs.rmdirSync(lockDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
}

function reapRegistryLock(lockDir: string): void {
  let owners: string[];
  try {
    owners = fs.readdirSync(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (owners.length === 0) removeEmptyRegistryLock(lockDir);
  for (const owner of owners) {
    const pid = Number(owner.split("-", 1)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") removeRegistryLockOwner(lockDir, owner);
    }
  }
}

/** The peer an instance belongs to. Entries written before peers existed are all the default. */
export function instancePeer(instance: Pick<SidecarInstance, "configPath">): string {
  return peerNameOf(path.basename(instance.configPath)) ?? DEFAULT_PEER;
}

function sameConfigPath(left: string, right: string): boolean {
  return (
    path.basename(left) === path.basename(right) &&
    realpathOr(path.dirname(left)) === realpathOr(path.dirname(right))
  );
}

export function unregisterInstance(configPath: string): void {
  updateInstances((instances) => {
    const remaining = instances.filter((instance) => !sameConfigPath(instance.configPath, configPath));
    return remaining.length === instances.length ? instances : remaining;
  });
}

export function registerCurrentInstance(
  root: string,
  config: SidecarConfig,
  options: { event: string; lastSyncAt?: string },
): void {
  if (!shouldUseGlobalRegistry()) return;

  const sidecarPath = resolveSidecarPath(root, config);
  const configPath = peerConfigPath(root, config.peer);
  const inbox = hasGitMetadata(sidecarPath) ? expandInbox(config, sidecarPath) : expandInbox(config);
  updateInstances((existing) => {
    const previous = existing.find((instance) => sameConfigPath(instance.configPath, configPath));
    const timestamp = nowIso();
    const instance: SidecarInstance = {
      root,
      configPath,
      sidecarPath,
      remote: config.remote,
      branch: config.branch,
      inbox,
      registeredAt: previous?.registeredAt ?? timestamp,
      updatedAt: timestamp,
      lastSyncAt: options.lastSyncAt ?? previous?.lastSyncAt,
    };
    return [instance, ...existing.filter((entry) => !sameConfigPath(entry.configPath, configPath))].sort(
      (left, right) => left.root.localeCompare(right.root) || left.configPath.localeCompare(right.configPath),
    );
  });
  logSidecarEvent(options.event, {
    root,
    ...(config.peer === DEFAULT_PEER ? {} : { peer: config.peer }),
    sidecarPath,
    remote: config.remote,
    inbox,
  });
}

export function listInstanceStatuses(): InstanceStatus[] {
  return readInstances().map((instance) => instanceStatus(instance));
}

function instanceStatus(instance: SidecarInstance): InstanceStatus {
  let config: InstanceStatus["config"] = "ok";
  if (!fs.existsSync(instance.configPath)) {
    config = "missing";
  } else {
    try {
      readConfig(instance.configPath);
    } catch {
      config = "invalid";
    }
  }

  const checkout = hasGitMetadata(instance.sidecarPath) ? "present" : "missing";
  let dirty: InstanceStatus["dirty"] = "unknown";
  let currentBranch = "";
  if (checkout === "present") {
    const branch = git(instance.sidecarPath, ["branch", "--show-current"], { check: false });
    if (branch.status === 0) currentBranch = branch.stdout.trim();
    const status = git(instance.sidecarPath, ["status", "--porcelain"], { check: false });
    if (status.status === 0) dirty = status.stdout.trim() ? "yes" : "no";
  }

  return {
    ...instance,
    config,
    checkout,
    dirty,
    currentBranch,
  };
}

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

// Logged fields can carry secrets from the outside world — git error output
// quotes remote URLs, which may embed access tokens. Redacting the values
// (rather than the serialized record) keeps replacements from ever spanning
// JSON structure.
function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactLogValue(entry)]));
  }
  return value;
}

export function logSidecarEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    ensureStateDir();
    const logPath = sidecarLogPath();
    try {
      if (fs.statSync(logPath).size > LOG_ROTATE_BYTES) {
        fs.renameSync(logPath, `${logPath}.1`);
      }
    } catch {
      // Missing log file: nothing to rotate.
    }
    const record = {
      timestamp: nowIso(),
      event,
      ...(redactLogValue(fields) as Record<string, unknown>),
    };
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Logging must never make the primary sidecar command fail.
  }
}

/**
 * Where a repo's sync lock lives.
 *
 * Not the repo's own git dir, which is where this used to sit: a jj workspace
 * has no `.git` at all, so locating the lock through git made every sync in one
 * fail before it started. Not the sidecar checkout's git dir either — the lock
 * is taken before `ensureSidecarCheckout` clones it, so on a fresh checkout
 * there is nothing to lock inside yet. The state dir is the one location that
 * exists for every repo at every point in a sync.
 *
 * Keyed by family rather than by root: working copies sharing a clone cannot
 * merge at the same time, because the merge worktree switches to the main
 * branch and git allows one worktree to hold a branch. The key is a hash of the
 * realpath because two spellings of one path (a symlink, /tmp vs /private/tmp)
 * have to land on the same lock, and a repo path is not a legal directory name.
 *
 * And by peer: peers have separate clones, so nothing one syncs can collide
 * with what another is merging. Sharing a lock would only make one peer's
 * round trip silently drop the other's soft sync.
 */
export function syncLockDir(root: string, peer: string): string {
  const family = familyPrimaryRoot(root) ?? root;
  const key = crypto.createHash("sha256").update(`${realpathOr(family)}\0${peer}`).digest("hex").slice(0, 16);
  const label = peer === DEFAULT_PEER ? slug(path.basename(family)) : `${slug(path.basename(family))}-${peer}`;
  return path.join(sidecarStateDir(), "locks", `${label}-${key}`);
}

export function acquireSyncLock(root: string, peer: string): (() => void) | undefined {
  const lockDir = syncLockDir(root, peer);
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid), "utf8");
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!syncLockIsStale(lockDir)) return undefined;
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return undefined;
}

// Syncs and snapshots serialize against each other rather than silently
// skipping: a concurrent holder (usually the daemon) is a hard error, so the
// command either did its work or clearly told you it didn't. In particular it
// never stamps lastSyncAt without syncing.
export function acquireSyncLockOrThrow(root: string, peer: string): () => void {
  const release = acquireSyncLock(root, peer);
  if (release) return release;
  throw new SidecarError("another sidecar sync is already running; try again once it finishes");
}

// The one place that decides what a busy lock means: "throw" for commands the
// user demanded, "skip" for soft requests that can no-op because their trigger
// will fire again. Returns whether the work ran.
export function withSyncLock(root: string, peer: string, onBusy: "throw" | "skip", fn: () => void): boolean {
  const releaseLock = onBusy === "skip" ? acquireSyncLock(root, peer) : acquireSyncLockOrThrow(root, peer);
  if (!releaseLock) {
    console.log("another sidecar sync is already running; skipping this soft sync");
    return false;
  }
  try {
    fn();
    return true;
  } finally {
    releaseLock();
  }
}

function syncLockIsStale(lockDir: string): boolean {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(path.join(lockDir, "pid"), "utf8").trim());
  } catch {
    // No pid yet: the holder may be mid-acquire, so only steal an old lock.
    try {
      return Date.now() - fs.statSync(lockDir).mtimeMs > 10 * 60 * 1000;
    } catch {
      return true;
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "EPERM";
  }
}
