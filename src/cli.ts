#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { parse as parseToml } from "smol-toml";

import { redactText } from "./redaction.js";

export const DEFAULT_PATH = "sidecar";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";
const PACKAGE_NAME = "@anteprojector/sidecar";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
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
};

export function main(argv = process.argv.slice(2)): number {
  try {
    const status = run(argv);
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

function run(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
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
  init <remote> [--path sidecar] [--branch main] [--inbox template]
  clone
  status
  instances
  daemon status|enable|disable|restart|run [--once] [--interval seconds]
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
  const remote = parsed.positional[0];
  if (!remote || parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init <remote> [--path sidecar] [--branch main] [--inbox template]");
  }

  const root = gitToplevel(process.cwd());
  const config: SidecarConfig = {
    remote,
    version: 1,
    path: getValue(parsed, "--path", DEFAULT_PATH),
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX),
  };
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  writeConfig(path.join(root, ".sidecar"), config);
  const gitignoreEntry = gitignoreEntryForSidecarPath(root, config.path);
  if (gitignoreEntry) {
    ensureGitignoreEntry(path.join(root, ".gitignore"), gitignoreEntry);
  }
  console.log(`wrote ${path.join(root, ".sidecar")}`);
  if (gitignoreEntry) {
    console.log(`ignored ${gitignoreEntry.replace(/\/+$/, "")}/`);
  } else {
    console.log(`sidecar path outside repo; not updating ${path.join(root, ".gitignore")}`);
  }

  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  registerCurrentInstance(root, config, { event: "init" });
  return 0;
}

function cmdClone(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar clone [--no-bootstrap-main]");

  const [root, config] = loadProject();
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

function cmdDaemon(args: string[]): number {
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
  if (action === "run") {
    return cmdDaemonRun(rest);
  }
  if (!action || action.startsWith("-")) {
    return cmdDaemonRun(args);
  }
  throw new SidecarError("usage: sidecar daemon status|enable|disable|restart|run [--once] [--interval seconds]");
}

function cmdDaemonStatus(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  const settings = readSettings();
  const service = daemonServiceStatus();
  console.log(`daemon:   ${settings.daemonEnabled ? "enabled" : "disabled"}`);
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

function cmdDaemonRun(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  const intervalSeconds = Number(getValue(parsed, "--interval", "300"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }

  logSidecarEvent("daemon-start", { intervalSeconds, once: parsed.flags.has("--once") });
  console.log(`sidecar daemon polling every ${intervalSeconds}s`);

  while (true) {
    runDaemonCycle();
    if (parsed.flags.has("--once")) return 0;
    sleep(intervalSeconds * 1000);
  }
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
  syncProject(root, config, {
    snapshot: !parsed.flags.has("--no-snapshot"),
    message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
  });
  registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
  return 0;
}

function syncProject(root: string, config: SidecarConfig, options: { snapshot: boolean; message?: string }): void {
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

export function readSettings(): SidecarSettings {
  const filePath = settingsPath();
  if (!fs.existsSync(filePath)) return { daemonEnabled: true };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return { daemonEnabled: true };
    const record = raw as Record<string, unknown>;
    return {
      daemonEnabled: typeof record.daemonEnabled === "boolean" ? record.daemonEnabled : true,
    };
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { daemonEnabled: true };
  }
}

export function writeSettings(settings: SidecarSettings): void {
  ensureStateDir();
  fs.writeFileSync(settingsPath(), `${JSON.stringify({ daemonEnabled: settings.daemonEnabled }, null, 2)}\n`, "utf8");
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
  ensureDaemonServiceInstalled();

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

export function runDaemonCycle(): number {
  const settings = readSettings();
  if (!settings.daemonEnabled) {
    logSidecarEvent("daemon-skip", { reason: "daemon-disabled" });
    return 0;
  }

  let synced = 0;
  let cloned = 0;
  for (const instance of readInstances()) {
    const status = instanceStatus(instance);
    if (status.config !== "ok") {
      logSidecarEvent("daemon-skip", {
        root: instance.root,
        reason: `config-${status.config}`,
      });
      continue;
    }
    let config: SidecarConfig;
    try {
      config = readConfig(instance.configPath);
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (status.checkout !== "present") {
      try {
        logSidecarEvent("daemon-clone-start", { root: instance.root, sidecarPath: instance.sidecarPath });
        cloneOrUpdate(instance.root, config, true);
        registerCurrentInstance(instance.root, config, { event: "daemon-clone" });
        cloned += 1;
      } catch (error) {
        logSidecarEvent("failure", {
          command: "daemon",
          root: instance.root,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    let remoteChanged = false;
    try {
      remoteChanged = hasRemoteReconcileWork(instance.sidecarPath, config);
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (status.dirty !== "yes" && !remoteChanged) continue;

    try {
      logSidecarEvent("daemon-sync-start", {
        root: instance.root,
        sidecarPath: instance.sidecarPath,
        dirty: status.dirty === "yes",
        remoteChanged,
      });
      syncProject(instance.root, config, { snapshot: true, message: "sidecar auto sync" });
      registerCurrentInstance(instance.root, config, { event: "daemon-sync", lastSyncAt: nowIso() });
      synced += 1;
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logSidecarEvent("daemon-cycle", { synced, cloned });
  return synced;
}

function hasRemoteReconcileWork(sidecarPath: string, config: SidecarConfig): boolean {
  fetch(sidecarPath, true);

  const inbox = expandInbox(config, sidecarPath);
  if (remoteRefExists(sidecarPath, inbox)) {
    if (!branchExists(sidecarPath, inbox)) return true;
    if (!isAncestor(sidecarPath, `origin/${inbox}`, inbox)) return true;
  }

  if (remoteRefExists(sidecarPath, config.branch)) {
    if (!branchExists(sidecarPath, config.branch)) return true;
    if (!isAncestor(sidecarPath, `origin/${config.branch}`, config.branch)) return true;
  }

  const mergeBase = branchExists(sidecarPath, config.branch)
    ? config.branch
    : remoteRefExists(sidecarPath, config.branch)
      ? `origin/${config.branch}`
      : "HEAD";
  return pendingInboxBranches(sidecarPath, config).some(
    (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, mergeBase),
  );
}

type DaemonServiceStatus = {
  available: boolean;
  installed: boolean;
  running: boolean;
  path?: string;
  message?: string;
};

function daemonServiceStatus(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (!fs.existsSync(plistPath)) {
    return { available: true, installed: false, running: false, path: plistPath };
  }
  const result = spawnSync("launchctl", ["print", `${launchctlDomain()}/${DAEMON_LABEL}`], {
    encoding: "utf8",
  });
  const running = result.status === 0 && /\bstate = running\b/.test(result.stdout);
  return {
    available: true,
    installed: true,
    running,
    path: plistPath,
    message: running || result.status === 0 ? undefined : launchctlMessage(result),
  };
}

function installDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: plistPath, message: "root install skipped" };
  }

  const stateDir = sidecarStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs.writeFileSync(plistPath, daemonPlist(invocation), "utf8");

  const domain = launchctlDomain();
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
  if (bootstrap.status !== 0) {
    return {
      available: true,
      installed: true,
      running: false,
      path: plistPath,
      message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed",
    };
  }
  spawnSync("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
  spawnSync("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
  return daemonServiceStatus();
}

function ensureDaemonServiceInstalled(): void {
  if (!readSettings().daemonEnabled) return;
  const service = daemonServiceStatus();
  if (!service.available) return;
  if (service.installed && !service.message && !daemonServiceNeedsInstall()) return;
  const installed = installDaemonService();
  logSidecarEvent("daemon-install", { service: installed });
}

function daemonServiceNeedsInstall(): boolean {
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath || !fs.existsSync(plistPath)) return true;
  const expectedStamp = currentExecutableStamp(currentExecutableInvocation());
  return !fs.readFileSync(plistPath, "utf8").includes(`<string>${escapeXml(expectedStamp)}</string>`);
}

function stopDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  spawnSync("launchctl", ["bootout", launchctlDomain(), plistPath], { stdio: "ignore" });
  return { available: true, installed: fs.existsSync(plistPath), running: false, path: plistPath };
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
  let executable = process.argv[1] || fileURLToPath(import.meta.url);
  try {
    executable = fs.realpathSync(executable);
  } catch {
    executable = path.resolve(executable);
  }
  return [process.execPath, executable, "daemon", "run"];
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

export function logSidecarEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    ensureStateDir();
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

function findDependencyRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function projectDependsOnSidecar(projectRoot: string): boolean {
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

export function loadProject(): [string, SidecarConfig] {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path.join(root, ".sidecar"))];
}

export function findConfigRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new SidecarError("could not find .sidecar");
    current = parent;
  }
}

export function gitToplevel(cwd: string): string {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0) throw new SidecarError("not inside a Git repository");
  return result.stdout.trim();
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

export function ensureGitignoreEntry(gitignorePath: string, sidecarPath: string): void {
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(gitignorePath, `${lines.join("\n").replace(/\s+$/g, "")}\n`, "utf8");
  }
}

export function gitignoreEntryForSidecarPath(root: string, sidecarPath: string): string | undefined {
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
