#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { parse as parseToml } from "smol-toml";

import { redactText } from "./redaction.js";

export const DEFAULT_PATH = "sidecar";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";
export const PACKAGE_NAME = "@projectors/sidecar";
const PACKAGE_SPEC = "@projectors/sidecar";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
const STATE_DIR_ENV = "SIDECAR_STATE_DIR";
const SKIP_SERVICE_ENV = "SIDECAR_SKIP_SERVICE";
const DAEMON_LABEL = "com.anteprojector.sidecar";

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

export type SidecarConfig = {
  remote: string;
  version: number;
  path: string;
  branch: string;
  inbox: string;
};

type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type GitBytesResult = {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
};

type ParsedOptions = {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
};

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

export type SidecarSettings = {
  daemonEnabled: boolean;
  autoUpdate: boolean;
  lastUpdateCheckAt?: string;
};

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const status = await run(argv);
    const command = argv[0];
    if (command && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (error instanceof SidecarError) {
      console.error(`sidecar: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.error("sidecar: stopped");
      return 130;
    }
    throw error;
  }
}

function run(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return 0;
  }

  switch (command) {
    case "init":
      return cmdInit(rest);
    case "clone":
      return cmdClone(rest);
    case "status":
      return cmdStatus(rest);
    case "instances":
      return cmdInstances(rest);
    case "tail":
      return cmdTail(rest);
    case "daemon":
      return cmdDaemon(rest);
    case "register-install":
      return cmdRegisterInstall(rest);
    case "update":
      return cmdUpdate(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "sync":
      return cmdSync(rest);
    case "merge":
      return cmdMerge(rest);
    default:
      throw new SidecarError(`unknown command ${JSON.stringify(command)}`);
  }
}

function printUsage(): void {
  console.error(`usage: sidecar <command> [options]

commands:
  init [remote] [--path sidecar] [--branch main] [--inbox template]
  clone [--if-missing]
  status
  instances
  daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]
  update
  tail [-f|--follow]
  snapshot [--push] [-m message]
  sync [--no-snapshot] [-m message]
  merge [--fork-files] [--no-push]`);
}

function cmdInit(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main"]),
    value: new Set(["--path", "--branch", "--inbox"]),
  });
  if (parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init [remote] [--path sidecar] [--branch main] [--inbox template]");
  }

  const remote = parsed.positional[0];
  const existingRoot = remote ? undefined : findConfigRootOptional(process.cwd());
  const root = existingRoot ?? gitToplevel(process.cwd());
  const configPath = path.join(root, ".sidecar");
  const config = existingRoot
    ? readConfig(configPath)
    : {
        remote: remote ?? promptRemote(),
        version: 1,
        path: getValue(parsed, "--path", DEFAULT_PATH),
        branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
        inbox: getValue(parsed, "--inbox", DEFAULT_INBOX),
      };
  if (!existingRoot) {
    validateBranch(config.branch);
    validateInboxTemplate(config.inbox);
    writeConfig(configPath, config);
  }
  const ignoreEntry = ensureSidecarIgnored(root, config.path);
  console.log(`${existingRoot ? "using" : "wrote"} ${configPath}`);
  if (ignoreEntry) {
    const name = ignoreEntry.replace(/\/+$/, "");
    console.log(`ignored ${name}/ via .gitignore`);
    if (hasZedInclusion(root, ignoreEntry)) {
      console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
    } else if (promptYesNo(`include ${name}/ in Zed file search via .zed/settings.json? [Y/n] `)) {
      if (ensureZedInclusion(root, ignoreEntry)) {
        console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
      } else {
        console.log(`could not parse .zed/settings.json; add "${name}/**" to file_scan_inclusions manually`);
      }
    }
  } else {
    console.log(`sidecar path outside repo; not updating .gitignore`);
  }
  if (removeLegacyGitHooks(root)) {
    console.log("removed legacy sidecar git hooks; syncing is manual or via the global daemon");
  }

  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  registerCurrentInstance(root, config, { event: "init" });
  addSidecarDevDependency(root);
  const globalSidecar = ensureGlobalSidecar();
  if (globalSidecar) registerInstallWithGlobalSidecar(globalSidecar, root);
  return 0;
}

function ensureGlobalSidecar(): string | undefined {
  const installHint = `install with \`npm install -g ${PACKAGE_SPEC}\``;
  const globalSidecar = findGlobalSidecarExecutable();
  if (!globalSidecar) {
    if (!process.stdin.isTTY) {
      console.log(`no global sidecar found; ${installHint} to enable daemon auto sync`);
      return undefined;
    }
    if (promptYesNo("no global sidecar found; install it now for daemon auto sync? [Y/n] ")) {
      installGlobalSidecar();
      return findGlobalSidecarExecutable();
    }
    return undefined;
  }

  const globalVersion = globalSidecarVersion(globalSidecar);
  const currentVersion = packageVersion();
  if (globalVersion && compareVersions(globalVersion, currentVersion) >= 0) return globalSidecar;
  const state = globalVersion ? `v${globalVersion}` : "an unknown version";
  if (!process.stdin.isTTY) {
    console.log(`global sidecar is ${state} (current v${currentVersion}); ${installHint.replace("install with", "update with")}`);
    return globalSidecar;
  }
  if (promptYesNo(`global sidecar is ${state} (current v${currentVersion}); update it now? [Y/n] `)) {
    installGlobalSidecar();
    return findGlobalSidecarExecutable() ?? globalSidecar;
  }
  return globalSidecar;
}

function registerInstallWithGlobalSidecar(executable: string, root: string): void {
  const result = spawnSync(executable, ["register-install"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV]: "1",
      [GLOBAL_EXEC_ENV]: "1",
    },
  });
  if (result.status !== 0) {
    throw new SidecarError(
      `global sidecar registration failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
    );
  }
}

export function findGlobalSidecarExecutable(): string | undefined {
  const names = process.platform === "win32" ? ["sidecar.cmd", "sidecar.ps1", "sidecar"] : ["sidecar"];
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (!isFilePath(candidate)) continue;
      if (isProjectLocalPath(realpathOr(candidate))) continue;
      return candidate;
    }
  }
  return undefined;
}

export function globalSidecarVersion(executable: string): string | undefined {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1" },
  });
  if (result.status !== 0) return undefined;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
}

function installGlobalSidecar(): void {
  const bun = findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun");
  const command = bun ? [bun, "add", "-g", PACKAGE_SPEC] : ["npm", "install", "-g", PACKAGE_SPEC];
  console.log(`running ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    throw new SidecarError(`global sidecar install failed; run \`${command.join(" ")}\` manually`);
  }
}

export function findExecutableOnPath(name: string): string | undefined {
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    if (isFilePath(candidate)) return candidate;
  }
  return undefined;
}

function isFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function cmdClone(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main", "--if-missing"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar clone [--if-missing] [--no-bootstrap-main]");

  const [root, config] = loadProject();
  removeLegacyGitHooks(root);
  if (parsed.flags.has("--if-missing")) {
    const sidecarPath = resolveSidecarPath(root, config);
    if (fs.existsSync(sidecarPath) && hasGitMetadata(sidecarPath)) return 0;
  }
  cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  registerCurrentInstance(root, config, { event: "clone" });
  return 0;
}

function cmdStatus(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(), value: new Set() });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar status");

  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  console.log(`main repo:    ${root}`);
  console.log(`sidecar path: ${sidecarPath}`);
  console.log(`remote:       ${config.remote}`);
  console.log(`main branch:  ${config.branch}`);
  console.log(`inbox branch: ${inbox}`);

  if (!checkoutPresent) {
    console.log("checkout:     missing");
    return 0;
  }

  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  console.log("checkout:     present");
  console.log(`branch:       ${branch || "(detached)"}`);
  console.log(`dirty:        ${dirty ? "yes" : "no"}`);

  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch)
    ? `origin/${config.branch}`
    : branchExists(sidecarPath, config.branch)
      ? config.branch
      : "HEAD";
  const pending = pendingInboxBranches(sidecarPath, config).filter(
    (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base),
  );
  if (pending.length) {
    console.log("pending inbox:");
    for (const branchName of pending) console.log(`  ${branchName}`);
  } else {
    console.log("pending inbox: none");
  }
  return 0;
}

function cmdInstances(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar instances [--json]");

  const statuses = listInstanceStatuses();
  if (parsed.flags.has("--json")) {
    console.log(`${JSON.stringify(statuses, null, 2)}`);
    return 0;
  }

  console.log(`registry: ${instancesPath()}`);
  console.log(`log:      ${sidecarLogPath()}`);
  if (!statuses.length) {
    console.log("instances: none");
    return 0;
  }

  for (const status of statuses) {
    console.log("");
    console.log(status.root);
    console.log(`  sidecar: ${status.sidecarPath}`);
    console.log(`  remote:  ${status.remote}`);
    console.log(`  branch:  ${status.currentBranch || "(unknown)"}`);
    console.log(`  config:  ${status.config}`);
    console.log(`  checkout:${status.checkout === "present" ? " present" : " missing"}`);
    console.log(`  dirty:   ${status.dirty}`);
    console.log(`  updated: ${status.updatedAt}`);
    if (status.lastSyncAt) console.log(`  synced:  ${status.lastSyncAt}`);
  }
  return 0;
}

function cmdTail(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar tail [-f|--follow]");

  const filePath = sidecarLogPath();
  if (!fs.existsSync(filePath)) {
    if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
      followLog(filePath, 0);
      return 0;
    }
    return 0;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > 0) {
    process.stdout.write(fs.readFileSync(filePath, "utf8"));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}

function cmdDaemon(args: string[]): number | Promise<number> {
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError(
      "daemon commands must run from a globally installed sidecar, not a project-local dependency",
    );
  }
  const [action, ...rest] = args;
  if (action === "status") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon status");
    return cmdDaemonStatus();
  }
  if (action === "enable") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon enable");
    return cmdDaemonEnable();
  }
  if (action === "disable") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon disable");
    return cmdDaemonDisable();
  }
  if (action === "restart") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon restart");
    return cmdDaemonRestart();
  }
  if (action === "autoupdate") {
    return cmdDaemonAutoUpdate(rest);
  }
  if (action === "run") {
    return cmdDaemonRun(rest);
  }
  if (!action || action.startsWith("-")) {
    return cmdDaemonRun(args);
  }
  throw new SidecarError(
    "usage: sidecar daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]",
  );
}

function cmdDaemonAutoUpdate(args: string[]): number {
  const [value, ...rest] = args;
  if (rest.length || (value !== "on" && value !== "off")) {
    throw new SidecarError("usage: sidecar daemon autoupdate on|off");
  }
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), autoUpdate: value === "on" });
  console.log(`autoupdate: ${value}`);
  return 0;
}

function cmdDaemonStatus(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  const settings = readSettings();
  const service = daemonServiceStatus();
  console.log(`daemon:   ${settings.daemonEnabled ? "enabled" : "disabled"}`);
  console.log(`update:   ${settings.autoUpdate ? "auto" : "manual"}`);
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path) console.log(`agent:    ${service.path}`);
  if (service.message) console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  console.log(`log:      ${sidecarLogPath()}`);
  return 0;
}

function cmdDaemonEnable(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  console.log("daemon:   enabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path) console.log(`agent:    ${service.path}`);
  if (service.message) console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}

function cmdDaemonDisable(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  console.log("daemon:   disabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path) console.log(`agent:    ${service.path}`);
  if (service.message) console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}

function cmdDaemonRestart(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  console.log("daemon:   enabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path) console.log(`agent:    ${service.path}`);
  if (service.message) console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}

async function cmdDaemonRun(args: string[]): Promise<number> {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval", "--debounce"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  const intervalSeconds = Number(getValue(parsed, "--interval", "600"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }
  const debounceSeconds = Number(getValue(parsed, "--debounce", "60"));
  if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0) {
    throw new SidecarError("--debounce must be >= 0");
  }

  const { runDaemonLoop } = await import("./daemon.js");
  return runDaemonLoop({
    once: parsed.flags.has("--once"),
    intervalSeconds,
    debounceSeconds,
  });
}

async function cmdUpdate(args: string[]): Promise<number> {
  if (args.length) throw new SidecarError("usage: sidecar update");
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("update must run from a globally installed sidecar; update local installs with your package manager");
  }

  console.log(`checking npm for ${PACKAGE_NAME} updates...`);
  const { checkAndInstallUpdate } = await import("./daemon.js");
  const result = await checkAndInstallUpdate();
  logSidecarEvent("manual-update", { ...result });

  if (result.status === "current") {
    console.log(`sidecar v${result.current} is up to date`);
    return 0;
  }
  if (result.status !== "updated") {
    throw new SidecarError(result.message ?? `update ${result.status}`);
  }

  console.log(`updated sidecar v${result.current} -> v${result.latest}`);
  const service = installDaemonService();
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.message) console.log(`detail:   ${service.message}`);
  return 0;
}

function cmdRegisterInstall(args: string[]): number {
  if (args.length) throw new SidecarError("usage: sidecar register-install");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("install registration requires a global sidecar executable");
  }

  const [root, config] = loadProject();
  registerCurrentInstance(root, config, { event: "install-register" });
  return 0;
}

function cmdSnapshot(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--push"]),
    value: new Set(["-m", "--message"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar snapshot [--push] [-m message]");

  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  const committed = snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined);
  if (committed && parsed.flags.has("--push")) {
    syncBranchBeforePush(sidecarPath, inbox);
    pushBranch(sidecarPath, inbox);
  }
  return 0;
}

function cmdSync(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot"]),
    value: new Set(["-m", "--message"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar sync [--no-snapshot] [-m message]");

  const [root, config] = loadProject();
  removeLegacyGitHooks(root);
  syncProject(root, config, {
    snapshot: !parsed.flags.has("--no-snapshot"),
    message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
  });
  registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
  return 0;
}

function syncProject(root: string, config: SidecarConfig, options: { snapshot: boolean; message?: string }): void {
  const releaseLock = acquireSyncLock(root);
  if (!releaseLock) {
    console.log("another sidecar sync is already running; skipping");
    return;
  }
  try {
    const sidecarPath = ensureSidecarCheckout(root, config);
    const inbox = expandInbox(config, sidecarPath);
    ensureCommitIdentity(sidecarPath);
    fetch(sidecarPath, true, false);
    ensureInboxBranch(sidecarPath, config, inbox);
    if (options.snapshot) {
      snapshot(sidecarPath, root, inbox, options.message);
    }
    syncBranchBeforePush(sidecarPath, inbox);
    pushBranch(sidecarPath, inbox);
    mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: true });
    refreshInboxFromMain(sidecarPath, config, inbox);
  } finally {
    releaseLock();
  }
}

function cmdMerge(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--delete-merged-inbox", "--no-push"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
  }
  if (parsed.flags.has("--delete-merged-inbox")) {
    throw new SidecarError("--delete-merged-inbox is no longer supported; merged inbox branches are kept and skipped by ancestry");
  }
  if (!parsed.flags.has("--fork-files")) {
    console.log("sidecar: conflicts will stop the merge; pass --fork-files to preserve all versions");
  }

  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  mergeInboxBranches(sidecarPath, config, {
    forkFiles: parsed.flags.has("--fork-files"),
    push: !parsed.flags.has("--no-push"),
  });
  return 0;
}

export function mergeInboxBranches(
  sidecarPath: string,
  config: SidecarConfig,
  options: { forkFiles: boolean; push: boolean },
): number {
  ensureClean(sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, false);
  ensureMainBranch(sidecarPath, config);

  const inboxBranches = pendingInboxBranches(sidecarPath, config).filter(
    (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"),
  );
  if (!inboxBranches.length) {
    console.log("no inbox branches to merge");
    return 0;
  }

  const merged: string[] = [];
  for (const remoteBranch of inboxBranches) {
    console.log(`merging ${remoteBranch}`);
    const result = git(
      sidecarPath,
      ["merge", "--no-ff", "-m", `Merge ${remoteBranch}`, remoteBranch],
      { check: false },
    );
    if (result.status === 0) {
      merged.push(remoteBranch);
      continue;
    }

    if (!hasUnmergedPaths(sidecarPath)) {
      throw new SidecarError(result.stderr.trim() || `merge failed for ${remoteBranch}`);
    }

    if (!options.forkFiles) {
      git(sidecarPath, ["merge", "--abort"], { check: false });
      throw new SidecarError(`merge conflict in ${remoteBranch}; rerun with --fork-files`);
    }

    forkConflicts(sidecarPath, remoteBranch);
    git(sidecarPath, ["commit", "-m", `Merge ${remoteBranch} with forked conflict files`]);
    merged.push(remoteBranch);
  }

  if (options.push) {
    pushBranch(sidecarPath, config.branch);
  }

  console.log(`merged ${merged.length} inbox branch(es)`);
  return merged.length;
}

export function cloneOrUpdate(root: string, config: SidecarConfig, bootstrapMain: boolean): void {
  const sidecarPath = resolveSidecarPath(root, config);
  if (fs.existsSync(sidecarPath) && !hasGitMetadata(sidecarPath)) {
    if (fs.readdirSync(sidecarPath).length) {
      throw new SidecarError(`${sidecarPath} exists and is not an empty Git repo`);
    }
    fs.rmdirSync(sidecarPath);
  }

  if (!fs.existsSync(sidecarPath)) {
    gitRaw(["clone", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }

  ensureCommitIdentity(sidecarPath);
  if (bootstrapMain) bootstrapMainBranch(sidecarPath, config);

  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${sidecarPath}`);
}

export function bootstrapMainBranch(repo: string, config: SidecarConfig): void {
  if (remoteRefExists(repo, config.branch)) return;

  if (hasAnyCommit(repo)) {
    const current = git(repo, ["branch", "--show-current"]).stdout.trim();
    if (current !== config.branch) {
      if (branchExists(repo, config.branch)) {
        git(repo, ["switch", config.branch]);
      } else {
        git(repo, ["switch", "-c", config.branch]);
      }
    }
    pushBranch(repo, config.branch);
    return;
  }

  git(repo, ["switch", "--orphan", config.branch]);
  fs.writeFileSync(
    path.join(repo, "README.md"),
    "# Sidecar\n\nCanonical sidecar state for this repository.\n",
    "utf8",
  );
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "Initialize sidecar"]);
  pushBranch(repo, config.branch);
}

export function ensureMainBranch(repo: string, config: SidecarConfig): void {
  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", config.branch]);
  } else if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", config.branch, "--track", `origin/${config.branch}`]);
  } else if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", config.branch]);
  } else {
    bootstrapMainBranch(repo, config);
    return;
  }

  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["merge", "--ff-only", `origin/${config.branch}`]);
  }
}

export function ensureInboxBranch(repo: string, config: SidecarConfig, inbox: string): void {
  const current = git(repo, ["branch", "--show-current"]).stdout.trim();
  if (current === inbox) return;

  if (branchExists(repo, inbox)) {
    git(repo, ["switch", inbox]);
    return;
  }

  if (remoteRefExists(repo, inbox)) {
    git(repo, ["switch", "-c", inbox, "--track", `origin/${inbox}`]);
    return;
  }

  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, `origin/${config.branch}`]);
    return;
  }

  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, config.branch]);
    return;
  }

  if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
    return;
  }

  bootstrapMainBranch(repo, config);
  git(repo, ["switch", "-c", inbox, config.branch]);
}

export function snapshot(repo: string, mainRoot: string, inbox: string, message = "sidecar snapshot"): boolean {
  scrubSidecarTree(repo);
  git(repo, ["add", "-A"]);
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    console.log("no sidecar changes to snapshot");
    return false;
  }

  const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
  const mainHeadText = mainHead.status === 0 ? mainHead.stdout.trim() : "unborn";
  const source = `${currentUser()}@${currentHost()}`;
  const body = [
    message,
    "",
    `source: ${source}`,
    `main-head: ${mainHeadText}`,
    `inbox: ${inbox}`,
  ];
  git(repo, ["commit", "-m", body.join("\n")]);
  console.log(`committed sidecar snapshot to ${inbox}`);
  return true;
}

export function scrubSidecarTree(root: string): number {
  let changed = 0;
  for (const filePath of walkFiles(root)) {
    const relative = path.relative(root, filePath).split(path.sep);
    if (relative.includes(".git")) continue;

    let data: Buffer;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (data.includes(0)) continue;

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      continue;
    }

    const redacted = redactText(text);
    if (redacted !== text) {
      fs.writeFileSync(filePath, redacted, "utf8");
      changed += 1;
    }
  }

  if (changed) {
    console.log(`redacted sensitive text in ${changed} sidecar file(s)`);
  }
  return changed;
}

export function syncBranchBeforePush(repo: string, branch: string): void {
  fetch(repo, true, false);
  if (!remoteRefExists(repo, branch)) return;

  const remoteBranch = `origin/${branch}`;
  if (isAncestor(repo, remoteBranch, "HEAD")) return;

  if (isDirty(repo)) {
    throw new SidecarError(
      `${remoteBranch} has commits not in local ${branch}, and the sidecar checkout has uncommitted changes`,
    );
  }

  if (isAncestor(repo, "HEAD", remoteBranch)) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }

  const result = git(repo, ["rebase", remoteBranch], { check: false });
  if (result.status !== 0) {
    git(repo, ["rebase", "--abort"], { check: false });
    throw new SidecarError(result.stderr.trim() || `could not rebase ${branch} onto ${remoteBranch}`);
  }
}

function refreshInboxFromMain(repo: string, config: SidecarConfig, inbox: string): void {
  if (!branchExists(repo, inbox) || !branchExists(repo, config.branch)) return;
  ensureClean(repo);
  git(repo, ["switch", inbox]);
  const result = git(repo, ["merge", "--ff-only", config.branch], { check: false });
  if (result.status !== 0) {
    throw new SidecarError(result.stderr.trim() || `could not fast-forward ${inbox} to ${config.branch}`);
  }
}

export function pushBranch(repo: string, branch: string): void {
  git(repo, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  console.log(`pushed ${branch}`);
}

export function forkConflicts(repo: string, remoteBranch: string): void {
  const conflicts = unmergedPaths(repo);
  if (!Object.keys(conflicts).length) {
    throw new SidecarError("merge reported conflicts, but no unmerged paths were found");
  }

  const timestamp = utcTimestamp();
  const branch = remoteBranchName(remoteBranch) || remoteBranch;
  const branchLabel = slug(branch);
  const manifestLabel = fileLabel(branch);
  const manifest: ConflictManifest = {
    timestamp,
    resolved_by: "fork-files",
    source_branch: branch,
    paths: [],
  };

  for (const [conflictPath, stages] of Object.entries(conflicts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const versions: ConflictVersion[] = [];
    for (const [stage, label] of [
      [2, "main"],
      [3, branchLabel],
    ] as const) {
      const blob = showStage(repo, stage, conflictPath);
      if (!blob) continue;
      const oid = stages[stage] ?? "";
      const outPath = forkPath(conflictPath, label, oid);
      const fullOut = path.join(repo, outPath);
      fs.mkdirSync(path.dirname(fullOut), { recursive: true });
      fs.writeFileSync(fullOut, blob);
      versions.push({
        stage,
        label,
        oid,
        path: outPath,
        sha256: crypto.createHash("sha256").update(blob).digest("hex"),
      });
    }

    git(repo, ["rm", "-f", "--ignore-unmatch", "--", conflictPath], { check: false });
    const original = path.join(repo, conflictPath);
    if (fs.existsSync(original) && fs.statSync(original).isFile()) fs.unlinkSync(original);

    manifest.paths.push({ path: conflictPath, versions });
  }

  const manifestDir = path.join(repo, ".sidecar-conflicts");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${timestamp}-${manifestLabel}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  git(repo, ["add", "-A"]);
  if (hasUnmergedPaths(repo)) {
    throw new SidecarError("fork-files did not clear all unmerged paths");
  }
}

type ConflictManifest = {
  timestamp: string;
  resolved_by: "fork-files";
  source_branch: string;
  paths: Array<{ path: string; versions: ConflictVersion[] }>;
};

type ConflictVersion = {
  stage: number;
  label: string;
  oid: string;
  path: string;
  sha256: string;
};

export function forkPath(conflictPath: string, label: string, oid: string): string {
  const parsed = path.parse(conflictPath);
  const shortOid = oid ? oid.slice(0, 7) : "missing";
  const safeLabel = fileLabel(label);
  const forkName = parsed.ext
    ? `${parsed.name}.conflict.${safeLabel}.${shortOid}${parsed.ext}`
    : `${parsed.name}.conflict.${safeLabel}.${shortOid}`;
  return path.join(parsed.dir, forkName);
}

export function fileLabel(value: string): string {
  return slug(value).replaceAll("/", "-");
}

export function unmergedPaths(repo: string): Record<string, Record<number, string>> {
  const result = gitBytes(repo, ["ls-files", "-u", "-z"]);
  const paths: Record<string, Record<number, string>> = {};
  for (const record of result.stdout.toString("binary").split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\t");
    const meta = record.slice(0, separator);
    const rawPath = record.slice(separator + 1);
    const parts = meta.split(/\s+/);
    const oid = parts[1] ?? "";
    const stage = Number(parts[2]);
    paths[rawPath] ??= {};
    paths[rawPath][stage] = oid;
  }
  return paths;
}

export function hasUnmergedPaths(repo: string): boolean {
  return Object.keys(unmergedPaths(repo)).length > 0;
}

export function showStage(repo: string, stage: number, conflictPath: string): Buffer | undefined {
  const result = gitBytes(repo, ["show", `:${stage}:${conflictPath}`], { check: false });
  return result.status === 0 ? result.stdout : undefined;
}

export function pendingInboxBranches(repo: string, config: SidecarConfig): string[] {
  const match = inboxBranchMatcher(config);
  const refs = git(repo, ["branch", "-r", "--format=%(refname:short)"]).stdout.split(/\r?\n/);
  return refs
    .map((ref) => ref.trim())
    .filter((ref) => ref !== "origin/HEAD" && match(ref))
    .sort();
}

export function inboxPrefix(config: SidecarConfig): string {
  return inboxBranchPrefix(config.inbox);
}

export function remoteBranchName(remoteBranch: string): string {
  return remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
}

export function expandInbox(config: SidecarConfig, repo?: string): string {
  validateInboxTemplate(config.inbox);
  const values: Record<string, string> = {
    user: slug(currentUser()),
    host: slug(currentHost()),
    random: repo ? checkoutRandom(repo) : "pending",
  };
  const inbox = config.inbox
    .replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) => {
      const value = values[key];
      if (value === undefined) throw new SidecarError(`unknown inbox template variable {${key}}`);
      return value;
    })
    .replace(/^\/+|\/+$/g, "");
  validateBranch(inbox);
  return inbox;
}

export function checkoutRandom(repo: string): string {
  const gitDirectory = gitDir(repo);
  const idPath = path.join(gitDirectory, "sidecar-id");
  if (fs.existsSync(idPath)) {
    const existing = slug(fs.readFileSync(idPath, "utf8"));
    if (existing) return existing;
  }

  const id = crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(idPath, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  return id;
}

export function validateBranch(branch: string): void {
  const result = gitRaw(["check-ref-format", "--branch", branch], { check: false });
  if (result.status !== 0) throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
}

export function validateInboxTemplate(template: string): void {
  const prefix = inboxBranchPrefix(template);
  if (template.includes("{") && !prefix.endsWith("/")) {
    throw new SidecarError("inbox template must place variables under a static branch namespace, like sidecar-inbox/{user}/{random}");
  }
}

export function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[./]+|[./]+$/g, "");
  return slugged || "unknown";
}

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

export function daemonLaunchAgentPath(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  return path.join(os.homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}

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
  fs.writeFileSync(settingsPath(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
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

export function writeInstances(instances: SidecarInstance[]): void {
  ensureStateDir();
  fs.writeFileSync(instancesPath(), `${JSON.stringify(instances, null, 2)}\n`, "utf8");
}

export function registerCurrentInstance(
  root: string,
  config: SidecarConfig,
  options: { event: string; lastSyncAt?: string },
): void {
  if (!shouldUseGlobalRegistry()) return;

  const sidecarPath = resolveSidecarPath(root, config);
  const existing = readInstances();
  const previous = existing.find((instance) => instance.root === root);
  const timestamp = nowIso();
  const instance: SidecarInstance = {
    root,
    configPath: path.join(root, ".sidecar"),
    sidecarPath,
    remote: config.remote,
    branch: config.branch,
    inbox: hasGitMetadata(sidecarPath) ? expandInbox(config, sidecarPath) : expandInbox(config),
    registeredAt: previous?.registeredAt ?? timestamp,
    updatedAt: timestamp,
    lastSyncAt: options.lastSyncAt ?? previous?.lastSyncAt,
  };

  const next = [instance, ...existing.filter((entry) => entry.root !== root)].sort((left, right) =>
    left.root.localeCompare(right.root),
  );
  writeInstances(next);
  logSidecarEvent(options.event, {
    root: instance.root,
    sidecarPath: instance.sidecarPath,
    remote: instance.remote,
    inbox: instance.inbox,
  });
}

export function listInstanceStatuses(): InstanceStatus[] {
  return readInstances().map((instance) => instanceStatus(instance));
}

type DaemonServiceStatus = {
  available: boolean;
  installed: boolean;
  running: boolean;
  path?: string;
  message?: string;
};

export function daemonServicePath(): string | undefined {
  if (process.platform === "darwin") return daemonLaunchAgentPath();
  if (process.platform === "linux") {
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configDir, "systemd", "user", `${DAEMON_LABEL}.service`);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "sidecar-daemon.vbs");
  }
  return undefined;
}

export function daemonPidPath(): string {
  return path.join(sidecarStateDir(), "daemon.pid");
}

export function isDaemonRunning(): boolean {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(daemonPidPath(), "utf8").trim());
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function daemonServiceFileContents(invocation: string[]): string {
  if (process.platform === "darwin") return daemonPlist(invocation);
  if (process.platform === "linux") return daemonSystemdUnit(invocation);
  return daemonWindowsStartupScript(invocation);
}

function daemonServiceStatus(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  const message =
    process.platform === "linux" && !findExecutableOnPath("systemctl")
      ? "systemd unavailable; run `sidecar daemon run` manually"
      : undefined;
  return {
    available: true,
    installed: fs.existsSync(servicePath),
    running: isDaemonRunning(),
    path: servicePath,
    message,
  };
}

function installDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: servicePath, message: "root install skipped" };
  }

  fs.mkdirSync(sidecarStateDir(), { recursive: true });
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs.writeFileSync(servicePath, daemonServiceFileContents(invocation), "utf8");

  if (process.platform === "darwin") {
    const domain = launchctlDomain();
    spawnSync("launchctl", ["bootout", domain, servicePath], { stdio: "ignore" });
    const bootstrap = spawnSync("launchctl", ["bootstrap", domain, servicePath], { encoding: "utf8" });
    if (bootstrap.status !== 0) {
      return {
        available: true,
        installed: true,
        running: false,
        path: servicePath,
        message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed",
      };
    }
    spawnSync("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    spawnSync("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    return daemonServiceStatus();
  }

  if (process.platform === "linux") {
    if (!findExecutableOnPath("systemctl")) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: "systemd unavailable; run `sidecar daemon run` manually",
      };
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const enable = spawnSync("systemctl", ["--user", "enable", "--now", `${DAEMON_LABEL}.service`], {
      encoding: "utf8",
    });
    spawnSync("systemctl", ["--user", "restart", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
    if (enable.status !== 0) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: enable.stderr.trim() || enable.stdout.trim() || "systemctl enable failed",
      };
    }
    return daemonServiceStatus();
  }

  // Windows: a Startup-folder script needs no elevation, unlike schtasks ONLOGON.
  stopDaemonProcess();
  startDetachedDaemon(invocation);
  return daemonServiceStatus();
}

function stopDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", launchctlDomain(), servicePath], { stdio: "ignore" });
  } else if (process.platform === "linux" && findExecutableOnPath("systemctl")) {
    spawnSync("systemctl", ["--user", "disable", "--now", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
  } else if (process.platform === "win32" && fs.existsSync(servicePath)) {
    fs.rmSync(servicePath, { force: true });
  }
  stopDaemonProcess();
  return { available: true, installed: fs.existsSync(servicePath), running: false, path: servicePath };
}

function stopDaemonProcess(): void {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(daemonPidPath(), "utf8").trim());
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

export function startDetachedDaemon(invocation: string[] = currentExecutableInvocation()): void {
  const child = spawn(invocation[0], invocation.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1" },
  });
  child.unref();
}

// The daemon calls this each cycle so a deleted service definition comes back
// on its own; activation is left to the next enable/restart or login.
export function ensureDaemonServiceFile(): void {
  if (process.env[SKIP_SERVICE_ENV] === "1") return;
  const servicePath = daemonServicePath();
  if (!servicePath || fs.existsSync(servicePath)) return;
  try {
    fs.mkdirSync(path.dirname(servicePath), { recursive: true });
    fs.writeFileSync(servicePath, daemonServiceFileContents(currentExecutableInvocation()), "utf8");
    logSidecarEvent("daemon-service-heal", { path: servicePath });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not restore service file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function daemonServiceLabel(service: DaemonServiceStatus): string {
  if (!service.available) return "unavailable";
  if (!service.installed) return "uninstalled";
  return service.running ? "running" : "stopped";
}

function launchctlMessage(result: ReturnType<typeof spawnSync>): string | undefined {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stderr || stdout || undefined;
}

function launchctlDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  return `gui/${uid}`;
}

function currentExecutableInvocation(): string[] {
  return [process.execPath, currentExecutablePath(), "daemon", "run"];
}

function currentExecutablePath(): string {
  return realpathOr(process.argv[1] || fileURLToPath(import.meta.url));
}

function currentExecutableStamp(programArguments: string[]): string {
  const executable = programArguments[1];
  if (!executable) return "unknown";
  try {
    const stat = fs.statSync(executable);
    return `${executable}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return executable;
  }
}

function daemonPlist(programArguments: string[]): string {
  return plist({
    Label: DAEMON_LABEL,
    ProgramArguments: programArguments,
    RunAtLoad: true,
    KeepAlive: true,
    StandardOutPath: path.join(sidecarStateDir(), "daemon.out.log"),
    StandardErrorPath: path.join(sidecarStateDir(), "daemon.err.log"),
    EnvironmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      SIDECAR_DAEMON_EXECUTABLE: currentExecutableStamp(programArguments),
    },
  });
}

function daemonSystemdUnit(programArguments: string[]): string {
  const execStart = programArguments.map((part) => `"${part.replaceAll('"', '\\"')}"`).join(" ");
  return [
    "[Unit]",
    "Description=sidecar background sync daemon",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=always",
    "RestartSec=10",
    `Environment="PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}"`,
    `Environment="SIDECAR_DAEMON_EXECUTABLE=${currentExecutableStamp(programArguments)}"`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function daemonWindowsStartupScript(programArguments: string[]): string {
  // VBScript doubles quotes to escape them; window style 0 keeps it hidden.
  const command = programArguments.map((part) => `""${part}""`).join(" ");
  return `CreateObject("WScript.Shell").Run "${command}", 0, False\r\n`;
}

function plist(value: Record<string, unknown>): string {
  const body = Object.entries(value)
    .map(([key, item]) => `  <key>${escapeXml(key)}</key>\n${plistValue(item, 2)}`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}

function plistValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (typeof value === "string") return `${pad}<string>${escapeXml(value)}</string>\n`;
  if (typeof value === "boolean") return `${pad}<${value ? "true" : "false"}/>\n`;
  if (Array.isArray(value)) {
    return `${pad}<array>\n${value.map((item) => plistValue(item, indent + 2)).join("")}${pad}</array>\n`;
  }
  if (value && typeof value === "object") {
    return `${pad}<dict>\n${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${" ".repeat(indent + 2)}<key>${escapeXml(key)}</key>\n${plistValue(item, indent + 2)}`)
      .join("")}${pad}</dict>\n`;
  }
  return `${pad}<string></string>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

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
      ...fields,
    };
    fs.appendFileSync(sidecarLogPath(), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Logging must never make the primary sidecar command fail.
  }
}

function followLog(filePath: string, startOffset: number): never {
  let offset = startOffset;
  while (true) {
    sleep(1000);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      offset = 0;
      continue;
    }

    if (stat.size < offset) offset = 0;
    if (stat.size <= offset) continue;

    const fd = fs.openSync(filePath, "r");
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
        offset += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function ensureStateDir(): void {
  fs.mkdirSync(sidecarStateDir(), { recursive: true });
}

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

function shouldUseGlobalRegistry(): boolean {
  return process.env[GLOBAL_EXEC_ENV] === "1" || !findDependencyRoot(process.cwd());
}

function isProjectLocalPath(executable: string): boolean {
  const depRoot = findDependencyRoot(path.dirname(executable));
  if (!depRoot) return false;
  if (realpathOr(depRoot) === realpathOr(bunGlobalRoot())) return false;
  return isInsidePath(executable, path.join(depRoot, "node_modules"));
}

export function bunGlobalRoot(): string {
  return path.join(process.env.BUN_INSTALL || path.join(os.homedir(), ".bun"), "install", "global");
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

export function packageVersion(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string; version?: string };
        if (manifest.name === PACKAGE_NAME && manifest.version) return manifest.version;
      } catch {
        // keep walking; an unrelated or unreadable manifest is not ours
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return "0.0.0";
    current = parent;
  }
}

function findDependencyRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function projectDependsOnSidecar(projectRoot: string): boolean {
  const manifestPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return Boolean(
      manifest.dependencies?.[PACKAGE_NAME] ||
        manifest.devDependencies?.[PACKAGE_NAME] ||
        manifest.optionalDependencies?.[PACKAGE_NAME] ||
        manifest.peerDependencies?.[PACKAGE_NAME],
    );
  } catch {
    return false;
  }
}

function promptRemote(): string {
  if (!process.stdin.isTTY) {
    throw new SidecarError("remote URL is required when no .sidecar config exists");
  }

  const remote = promptLine("sidecar remote URL: ");
  if (!remote) throw new SidecarError("remote URL is required");
  return remote;
}

function promptYesNo(question: string): boolean {
  if (!process.stdin.isTTY) return true;
  const answer = promptLine(question).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

function promptLine(prompt: string): string {
  fs.writeSync(1, prompt);
  // Node keeps a TTY stdin non-blocking, so reads on fd 0 hit EAGAIN while idle.
  const fd = fs.openSync("/dev/tty", "r");
  try {
    const chunks: string[] = [];
    const buffer = Buffer.alloc(1);
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, 1, null);
      if (bytesRead === 0) break;
      const char = buffer.toString("utf8", 0, bytesRead);
      if (char === "\n" || char === "\r") break;
      chunks.push(char);
    }
    return chunks.join("").trim();
  } finally {
    fs.closeSync(fd);
  }
}

function addSidecarDevDependency(root: string): void {
  const manifestPath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath)) return;
  try {
    // Running init inside the sidecar package repo itself must not add a
    // self-dependency that would shadow the dev build via local delegation.
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string };
    if (existing?.name === PACKAGE_NAME) return;
  } catch {
    // Unreadable manifests fail with a clear error just below.
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SidecarError(`${manifestPath} must contain a JSON object`);
    }
    manifest = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SidecarError) throw error;
    throw new SidecarError(`could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const spec =
    dependencySpec(manifest.devDependencies) ??
    dependencySpec(manifest.dependencies) ??
    dependencySpec(manifest.optionalDependencies) ??
    dependencySpec(manifest.peerDependencies) ??
    `^${packageVersion()}`;

  manifest.devDependencies = {
    ...objectValue(manifest.devDependencies),
    [PACKAGE_NAME]: spec,
  };
  removeDependency(manifest.dependencies);
  removeDependency(manifest.optionalDependencies);
  removeDependency(manifest.peerDependencies);

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`added devDependency ${PACKAGE_NAME}`);
}

function dependencySpec(value: unknown): string | undefined {
  const dependencies = objectValue(value);
  const spec = dependencies[PACKAGE_NAME];
  return typeof spec === "string" && spec ? spec : undefined;
}

function removeDependency(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    delete (value as Record<string, unknown>)[PACKAGE_NAME];
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function loadProject(): [string, SidecarConfig] {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path.join(root, ".sidecar"))];
}

export function findConfigRoot(start: string): string {
  const root = findConfigRootOptional(start);
  if (root) return root;
  throw new SidecarError("could not find .sidecar");
}

function findConfigRootOptional(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function gitToplevel(cwd: string): string {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0) throw new SidecarError("not inside a Git repository");
  return result.stdout.trim();
}

export function gitCommonDir(root: string): string {
  const result = gitRaw(["-C", root, "rev-parse", "--git-common-dir"], { check: false });
  if (result.status !== 0) throw new SidecarError("not inside a Git repository");
  return path.resolve(root, result.stdout.trim());
}

export function requireSidecarCheckout(root: string, config: SidecarConfig): string {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    throw new SidecarError(`missing sidecar checkout at ${sidecarPath}; run \`sidecar clone\``);
  }
  return sidecarPath;
}

export function ensureSidecarCheckout(root: string, config: SidecarConfig): string {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    cloneOrUpdate(root, config, true);
  }
  return requireSidecarCheckout(root, config);
}

export function writeConfig(configPath: string, config: SidecarConfig): void {
  const text = [
    `version = ${config.version}`,
    `remote = ${JSON.stringify(config.remote)}`,
    `path = ${JSON.stringify(config.path)}`,
    `branch = ${JSON.stringify(config.branch)}`,
    `inbox = ${JSON.stringify(config.inbox)}`,
    "",
  ].join("\n");
  fs.writeFileSync(configPath, text, "utf8");
}

export function readConfig(configPath: string): SidecarConfig {
  let values: Record<string, unknown>;
  try {
    const parsed = parseToml(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SidecarError(`${configPath} must contain a TOML table`);
    }
    values = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SidecarError) throw error;
    throw new SidecarError(`${configPath} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const remote = optionalStringConfigValue(configPath, values, "remote");
  if (!remote) throw new SidecarError(`${configPath} is missing remote`);

  const config = {
    remote,
    version: numberConfigValue(configPath, values, "version", 1),
    path: stringConfigValue(configPath, values, "path", DEFAULT_PATH),
    branch: stringConfigValue(configPath, values, "branch", DEFAULT_BRANCH),
    inbox: stringConfigValue(configPath, values, "inbox", DEFAULT_INBOX),
  };
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  return config;
}

// Earlier sidecar versions installed background-sync git hooks in local
// installs. Local sidecar is now manual-sync only, so every command that
// touches a project removes any hooks a previous version left behind.
const LEGACY_HOOK_NAMES = ["post-commit", "pre-push"] as const;
const LEGACY_HOOK_HELPER = "sidecar-sync-hook";
const LEGACY_HOOK_MARKER = "sidecar-sync";
const LEGACY_SYNC_STAMP_FILE = "sidecar-last-sync";

export function removeLegacyGitHooks(root: string): boolean {
  let removed = false;
  try {
    const commonDir = gitCommonDir(root);
    const hooksDir = path.join(commonDir, "hooks");
    for (const name of LEGACY_HOOK_NAMES) {
      const hookPath = path.join(hooksDir, name);
      if (!fs.existsSync(hookPath)) continue;
      const lines = fs.readFileSync(hookPath, "utf8").split("\n");
      const kept = lines.filter((line) => !line.includes(LEGACY_HOOK_MARKER));
      if (kept.length === lines.length) continue;
      if (kept.every((line) => !line.trim() || line.trim() === "#!/bin/sh")) {
        fs.rmSync(hookPath);
      } else {
        fs.writeFileSync(hookPath, `${kept.join("\n").replace(/\n*$/, "\n")}`, "utf8");
      }
      removed = true;
    }
    const helperPath = path.join(hooksDir, LEGACY_HOOK_HELPER);
    if (fs.existsSync(helperPath)) {
      fs.rmSync(helperPath);
      removed = true;
    }
    fs.rmSync(path.join(commonDir, LEGACY_SYNC_STAMP_FILE), { force: true });
  } catch {
    // Cleanup is best-effort; never block the command that triggered it.
  }
  if (removed) logSidecarEvent("legacy-hooks-removed", { root });
  return removed;
}

export function acquireSyncLock(root: string): (() => void) | undefined {
  const lockDir = path.join(gitCommonDir(root), "sidecar-sync-lock");
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

export function ensureSidecarIgnored(root: string, sidecarPath: string): string | undefined {
  const entry = ignoreEntryForSidecarPath(root, sidecarPath);
  if (!entry) return undefined;
  ensureIgnoreEntry(path.join(root, ".gitignore"), entry);
  // Interim sidecar versions wrote the entry to .git/info/exclude instead.
  removeIgnoreEntry(path.join(gitCommonDir(root), "info", "exclude"), entry);
  return entry;
}

export function ensureIgnoreEntry(ignorePath: string, sidecarPath: string): void {
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(ignorePath, `${lines.join("\n").replace(/\s+$/g, "")}\n`, "utf8");
  }
}

export function removeIgnoreEntry(ignorePath: string, sidecarPath: string): void {
  if (!fs.existsSync(ignorePath)) return;
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs.readFileSync(ignorePath, "utf8").split(/\r?\n/);
  const kept = lines.filter((line) => line !== entry);
  if (kept.length === lines.length) return;
  if (kept.every((line) => !line.trim())) {
    fs.rmSync(ignorePath);
  } else {
    fs.writeFileSync(ignorePath, `${kept.join("\n").replace(/\s+$/g, "")}\n`, "utf8");
  }
}

export function hasZedInclusion(root: string, sidecarPath: string): boolean {
  const settingsPath = path.join(root, ".zed", "settings.json");
  if (!fs.existsSync(settingsPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const inclusions = (parsed as Record<string, unknown>).file_scan_inclusions;
    return Array.isArray(inclusions) && inclusions.includes(zedInclusionGlob(sidecarPath));
  } catch {
    return false;
  }
}

function zedInclusionGlob(sidecarPath: string): string {
  return `${sidecarPath.replace(/^\/+|\/+$/g, "")}/**`;
}

export function ensureZedInclusion(root: string, sidecarPath: string): boolean {
  const glob = zedInclusionGlob(sidecarPath);
  const settingsPath = path.join(root, ".zed", "settings.json");
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      // Zed settings allow JSONC; bail rather than clobber comments we cannot round-trip.
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      settings = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  // Setting file_scan_inclusions replaces Zed's default [".env*"], so carry it over.
  const inclusions = Array.isArray(settings.file_scan_inclusions) ? settings.file_scan_inclusions : [".env*"];
  if (!inclusions.includes(glob)) {
    inclusions.push(glob);
    settings.file_scan_inclusions = inclusions;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
  return true;
}

export function ignoreEntryForSidecarPath(root: string, sidecarPath: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  const resolvedSidecarPath = path.resolve(root, sidecarPath);
  const relative = path.relative(resolvedRoot, resolvedSidecarPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative;
}

export function ensureClean(repo: string): void {
  if (isDirty(repo)) throw new SidecarError("sidecar checkout has uncommitted changes");
}

export function ensureCommitIdentity(repo: string): void {
  if (git(repo, ["config", "user.name"], { check: false }).status !== 0) {
    git(repo, ["config", "user.name", currentUser()]);
  }
  if (git(repo, ["config", "user.email"], { check: false }).status !== 0) {
    git(repo, ["config", "user.email", `${slug(currentUser())}@${slug(currentHost())}.local`]);
  }
}

export function currentUser(): string {
  return process.env.USER || os.userInfo().username || "unknown";
}

export function currentHost(): string {
  return os.hostname().split(".", 1)[0] || "unknown";
}

export function fetch(repo: string, quiet: boolean, check = true): void {
  const args = ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"];
  if (quiet) args.splice(1, 0, "--quiet");
  git(repo, args, { check });
}

export function hasAnyCommit(repo: string): boolean {
  return git(repo, ["rev-parse", "--verify", "HEAD"], { check: false }).status === 0;
}

export function branchExists(repo: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { check: false }).status === 0;
}

export function remoteRefExists(repo: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], {
    check: false,
  }).status === 0;
}

export function isAncestor(repo: string, maybeAncestor: string, descendant: string): boolean {
  return git(repo, ["merge-base", "--is-ancestor", maybeAncestor, descendant], { check: false }).status === 0;
}

export function git(repo: string, args: string[], options: { check?: boolean } = {}): GitResult {
  return gitRaw(["-C", repo, ...args], options);
}

export function gitBytes(
  repo: string,
  args: string[],
  options: { check?: boolean } = {},
): GitBytesResult {
  const check = options.check ?? true;
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
  });
  const status = result.status ?? 1;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  if (check && status !== 0) {
    throw new SidecarError(stderr.toString("utf8").trim() || stdout.toString("utf8").trim());
  }
  return { status, stdout, stderr };
}

export function gitRaw(args: string[], options: { check?: boolean } = {}): GitResult {
  const check = options.check ?? true;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (check && status !== 0) {
    throw new SidecarError(stderr.trim() || stdout.trim());
  }
  return { status, stdout, stderr };
}

function parseOptions(
  args: string[],
  spec: { boolean: Set<string>; value: Set<string> },
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const [name, inlineValue] = equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
    if (spec.value.has(name)) {
      const value = inlineValue ?? args[++index];
      if (value === undefined) throw new SidecarError(`${name} requires a value`);
      values.set(name, value);
      continue;
    }
    if (inlineValue !== undefined) throw new SidecarError(`${name} does not take a value`);
    if (spec.boolean.has(name)) {
      flags.add(name);
      continue;
    }
    throw new SidecarError(`unknown option ${name}`);
  }

  return { flags, values, positional };
}

function getValue(parsed: ParsedOptions, name: string, fallback: string): string {
  return parsed.values.get(name) ?? fallback;
}

function resolveSidecarPath(root: string, config: SidecarConfig): string {
  return path.resolve(root, config.path);
}

function hasGitMetadata(repo: string): boolean {
  return fs.existsSync(path.join(repo, ".git"));
}

function isDirty(repo: string): boolean {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
}

function gitDir(repo: string): string {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path.isAbsolute(result) ? result : path.resolve(repo, result);
}

function* walkEntries(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    yield entryPath;
    if (entry.isDirectory() && !entry.isSymbolicLink()) yield* walkEntries(entryPath);
  }
}

function* walkFiles(root: string): Generator<string> {
  for (const entryPath of walkEntries(root)) {
    try {
      const stat = fs.lstatSync(entryPath);
      if (!stat.isSymbolicLink() && stat.isFile()) yield entryPath;
    } catch {
      continue;
    }
  }
}

function stringConfigValue(
  configPath: string,
  values: Record<string, unknown>,
  key: string,
  fallback: string | undefined,
): string {
  const value = values[key] ?? fallback;
  if (typeof value !== "string") throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}

function optionalStringConfigValue(
  configPath: string,
  values: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}

function numberConfigValue(
  configPath: string,
  values: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = values[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SidecarError(`${configPath} ${key} must be an integer`);
  }
  return value;
}

function inboxBranchMatcher(config: SidecarConfig): (remoteBranch: string) => boolean {
  const prefix = `origin/${inboxBranchPrefix(config.inbox)}`;
  if (prefix.endsWith("/")) return (remoteBranch) => remoteBranch.startsWith(prefix);
  return (remoteBranch) => remoteBranch === prefix;
}

function inboxBranchPrefix(template: string): string {
  const variableIndex = template.indexOf("{");
  if (variableIndex === -1) return template.replace(/^\/+|\/+$/g, "");

  const staticPrefix = template.slice(0, variableIndex).replace(/^\/+/, "");
  const slashIndex = staticPrefix.lastIndexOf("/");
  return slashIndex === -1 ? staticPrefix : staticPrefix.slice(0, slashIndex + 1);
}

function utcTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
