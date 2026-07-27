#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

import { type Role, colorLevel, paint, stripColor } from "./color.js";
import {
  HEALTH_BRANCH_PREFIX,
  HEALTH_FILE,
  type HealthIdentity,
  type HealthOutcome,
  type HealthRecord,
  type HealthState,
  classifyHealthState,
  healthBranch,
  inboxPrefixCollidesWithHealth,
  isHealthBranch,
  nextHealthRecord,
  parseHealthRecord,
  serializeHealthRecord,
  shouldPublishHealth,
  summarizeHealthStates,
} from "./health.js";
import {
  DEFAULT_REDACTION_MODE,
  NO_REDACT_PRAGMA,
  REDACTION_MODES,
  type RedactionMode,
  countRedactionPlaceholders,
  hasNoRedactPragma,
  redactText,
} from "./redaction.js";

export const DEFAULT_PATH = "sidecar";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";
export const PACKAGE_NAME = "sidecarsync";
const PACKAGE_SPEC = "sidecarsync";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
const STATE_DIR_ENV = "SIDECAR_STATE_DIR";
// An env var rather than a flag so the daemon can request soft syncs from
// older pinned project-local CLIs, which ignore it instead of rejecting an
// unknown option.
export const SOFT_SYNC_ENV = "SIDECAR_SYNC_SOFT";
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
  redaction: RedactionMode;
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

export type InstallSource = "npm" | "bun" | "curl";

export type SidecarSettings = {
  daemonEnabled: boolean;
  autoUpdate: boolean;
  lastUpdateCheckAt?: string;
  installSource?: InstallSource;
};

const INSTALL_SOURCES = new Set<InstallSource>(["npm", "bun", "curl"]);

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const status = await run(argv);
    const command = argv[0];
    // The redact clean filter runs once per staged file; logging it would
    // write one event per file on every snapshot.
    if (command && command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (error instanceof SidecarError) {
      console.error(`${paint("bad", "sidecar:", colorLevel(process.stderr))} ${error.message}`);
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
  if (!command) {
    // No command is an error, so usage goes to stderr and the exit is nonzero.
    printUsage("stderr");
    return 1;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printUsage("stdout");
    return 0;
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
    case "deinit":
      return cmdDeinit(rest);
    case "status":
      return cmdStatus(rest);
    case "health":
      return cmdHealth(rest);
    case "instances":
      return cmdInstances(rest);
    case "tail":
      return cmdTail(rest);
    case "daemon":
      return cmdDaemon(rest);
    case "register-install":
      return cmdRegisterInstall(rest);
    case "set-install-source":
      return cmdSetInstallSource(rest);
    case "update":
      return cmdUpdate(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "sync":
      return cmdSync(rest);
    case "merge":
      return cmdMerge(rest);
    case "redact":
      return cmdRedact(rest);
    case "redactions":
      return cmdRedactions(rest);
    default: {
      const suggestion = closestCommand(command);
      throw new SidecarError(
        `unknown command ${JSON.stringify(command)}${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`,
      );
    }
  }
}

const KNOWN_COMMANDS = [
  "init",
  "clone",
  "deinit",
  "status",
  "health",
  "instances",
  "tail",
  "daemon",
  "register-install",
  "set-install-source",
  "update",
  "snapshot",
  "sync",
  "merge",
  "redact",
  "redactions",
  "version",
  "help",
] as const;

export function closestCommand(input: string): string | undefined {
  let best: { command: string; distance: number } | undefined;
  for (const command of KNOWN_COMMANDS) {
    const distance = editDistance(input.toLowerCase(), command);
    if (!best || distance < best.distance) best = { command, distance };
  }
  // Only suggest near-misses; "frobnicate" should not turn into "instances".
  return best && best.distance <= 2 ? best.command : undefined;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function printUsage(target: "stdout" | "stderr"): void {
  const write = target === "stdout" ? console.log : console.error;
  const level = colorLevel(target === "stdout" ? process.stdout : process.stderr);
  const header = (text: string): string => paint("label", text, level);
  write(`usage: sidecar <command> [options]

${header("common:")}
  init [remote] [--path sidecar|.] [--branch main] [--inbox template] [--redaction none|secrets|secrets+pii] [--local-install]
                           --path . makes this repo itself the sidecar (standalone)
                           --local-install adds the devDependency so fresh clones self-register
  status [--json]
  health [--json] [--no-fetch]
                           how every machine sharing this sidecar is syncing
  redactions               preview what redaction rewrites before content is pushed

${header("sync & daemon:")}
  sync [--no-snapshot] [--soft] [-m message]
  daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]
  instances [--json]
  tail [-f|--follow] [-n|--lines count]
  update

${header("advanced (mostly run for you by init, git, and the daemon):")}
  clone [--if-missing]
  deinit
  snapshot [--push] [-m message]
  merge [--fork-files] [--no-push]
  redact                   git clean filter: stdin -> redacted stdout
  register-install
  set-install-source npm|bun|curl [--if-unset]`);
}

function cmdDeinit(args: string[]): number {
  if (args.length) throw new SidecarError("usage: sidecar deinit");

  const root = gitToplevelOptional(process.cwd());
  if (!root) {
    console.error("sidecar: warning: not inside a Git repository; nothing to remove");
    return 0;
  }

  const configPath = path.join(root, ".sidecar");
  // Steps deinit knows it skipped. Anything here means the repo still carries
  // sidecar traces, and the user should hear that once, plainly, at the end —
  // not have to piece it together from scattered warnings.
  const leftovers: string[] = [];
  let config: SidecarConfig | undefined;
  if (fs.existsSync(configPath)) {
    try {
      config = readConfig(configPath);
    } catch {
      leftovers.push(`could not read ${configPath}, so its checkout and ignore entries were left in place`);
    }
  } else {
    leftovers.push("no .sidecar config found; a leftover checkout or ignore entries may remain");
  }

  // Standalone has no checkout to delete, so the git-level wiring that a
  // recursive remove would have taken with it has to come out by hand.
  if (config && isStandalone(config)) {
    const leftover = releaseStandaloneCheckout(root, config);
    if (leftover) leftovers.push(leftover);
  } else if (!config) {
    // Without a config, nested and standalone are indistinguishable — and in
    // standalone the redaction filter is wired into this repo with
    // required=true, where leaving it to go stale fails every future
    // `git add`. Removing it is a no-op in a repo that never had it.
    removeRedactionFilter(root);
  }

  fs.rmSync(configPath, { force: true });
  if (config && !isStandalone(config)) {
    const checkoutPath = path.resolve(root, config.path);
    if (checkoutPath !== path.resolve(root) && checkoutPath !== path.parse(checkoutPath).root) {
      fs.rmSync(checkoutPath, { recursive: true, force: true });
    }
    const ignoreEntry = ignoreEntryForSidecarPath(root, config.path);
    if (ignoreEntry) {
      removeIgnoreEntry(path.join(root, ".gitignore"), ignoreEntry);
      removeIgnoreEntry(path.join(gitCommonDir(root), "info", "exclude"), ignoreEntry);
      removeZedInclusion(root, ignoreEntry);
    }
  }
  removeLegacyGitHooks(root);
  unregisterInstance(root);

  console.log(`removed sidecar from ${paint("repo", root)}`);
  if (leftovers.length) {
    for (const leftover of leftovers) {
      console.error(`sidecar: warning: ${leftover}`);
    }
    console.error(
      "sidecar: deinit could not fully complete; to finish removal, ask your agent to scrub any remaining traces of sidecar",
    );
  }
  return 0;
}

/**
 * Hands a standalone repo back to its owner, returning a description of any
 * step it had to skip. Removing the redaction filter is the part that
 * matters: `required = true` fails every `git add` if its command ever goes
 * stale, and deinit is the user saying they want sidecar out of this repo —
 * leaving that behind would break the repo for good.
 */
function releaseStandaloneCheckout(root: string, config: SidecarConfig): string | undefined {
  removeRedactionFilter(root);
  const current = git(root, ["branch", "--show-current"], { check: false }).stdout.trim();
  if (current === config.branch) return undefined;

  // Switching materializes committed blobs. Under redaction those are the
  // redacted versions, and the working tree is still holding the originals —
  // so that switch destroys local content. Leave the call to the user.
  if (config.redaction !== "none") {
    return `the repo is still on ${current || "a detached HEAD"}: switching to ${config.branch} would replace local files with their redacted pushed contents`;
  }
  if (git(root, ["switch", config.branch], { check: false }).status === 0) {
    console.log(`switched back to ${config.branch}`);
    return undefined;
  }
  return `could not switch to ${config.branch}; the repo is still on ${current || "a detached HEAD"}`;
}

function cmdInit(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main", "--local-install"]),
    value: new Set(["--path", "--branch", "--inbox", "--redaction"]),
  });
  if (parsed.positional.length > 1) {
    throw new SidecarError(
      "usage: sidecar init [remote] [--path sidecar] [--branch main] [--inbox template] [--redaction mode]",
    );
  }

  const remote = parsed.positional[0];
  let existingRoot = remote ? undefined : findConfigRootOptional(process.cwd());
  const root = existingRoot ?? gitToplevel(process.cwd());
  const configPath = path.join(root, ".sidecar");
  if (remote && fs.existsSync(configPath)) {
    const existing = readConfig(configPath);
    // Omitted flags fall back to the EXISTING values, not the defaults — a
    // plain re-init must not read as a request to reset settings (a non-TTY
    // re-init would fail, and a prompted "y" would silently flip redaction).
    const unchanged =
      existing.remote === remote &&
      existing.path === getValue(parsed, "--path", existing.path) &&
      existing.branch === getValue(parsed, "--branch", existing.branch) &&
      existing.inbox === getValue(parsed, "--inbox", existing.inbox) &&
      existing.redaction === getValue(parsed, "--redaction", existing.redaction);
    if (unchanged || !promptOverwriteConfig(configPath, existing.remote, remote)) {
      existingRoot = root;
    }
  }
  const config = existingRoot ? readConfig(configPath) : buildInitConfig(root, remote, parsed);
  if (!existingRoot) {
    validateRemote(config.remote);
    validateBranch(config.branch);
    validateInboxTemplate(config.inbox);
    writeConfig(configPath, config);
  }
  console.log(`${existingRoot ? "using" : "wrote"} ${paint("brand", configPath)}`);
  if (isStandalone(config)) {
    // Nothing to ignore or make searchable: the repo is the sidecar, so its
    // files are already tracked and already visible to every tool.
    console.log(`standalone: ${paint("repo", root)} is the sidecar`);
  } else {
    printCheckoutVisibility(root, config);
  }
  offerLocalInstall(root, config, parsed.flags.has("--local-install"));
  if (removeLegacyGitHooks(root)) {
    console.log("removed legacy sidecar git hooks; syncing is manual or via the global daemon");
  }

  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  registerCurrentInstance(root, config, { event: "init" });
  const globalSidecar = ensureGlobalSidecar();
  if (globalSidecar) {
    registerInstallWithGlobalSidecar(globalSidecar, root);
    ensureDaemonSetup(globalSidecar);
  }
  // Standalone init just changed the tree it syncs — .sidecar at minimum —
  // and the daemon's watcher only sees changes made after it attaches, so
  // nothing would push this until the interval tick minutes from now. Sync
  // before returning; "skip" because a daemon that beat us to the lock is
  // already doing this exact work.
  if (isStandalone(config) && !parsed.flags.has("--no-clone")) {
    const synced = withSyncLock(root, "skip", () => {
      syncProject(root, config, { snapshot: true });
    });
    if (synced) registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
  }
  return 0;
}

// Question order matters: the checkout path decides whether this is a
// standalone sidecar, and that in turn changes the default answer to both of
// the questions after it.
function buildInitConfig(root: string, remote: string | undefined, parsed: ParsedOptions): SidecarConfig {
  const rawPath = parsed.values.has("--path")
    ? getValue(parsed, "--path", DEFAULT_PATH)
    : promptSidecarPath(root);
  // `--path $PWD` and `--path foo/..` mean the same thing as `--path .`;
  // store them as "." so standalone detection — a string check on the config
  // — can't be dodged by spelling the root differently and land the repo in
  // the nested code path, pointed at itself with a second remote.
  const sidecarPath = pathIsRepoRoot(root, rawPath) ? "." : rawPath;
  const standalone = isStandalonePath(sidecarPath);
  return {
    // A standalone sidecar syncs a repo to its own remote, so origin is the
    // answer — prompting for a URL (or offering to create a second repo with
    // gh) would only invite a wrong one.
    remote: remote ?? (standalone ? standaloneRemote(root) : promptRemote(root)),
    version: 1,
    path: sidecarPath,
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX),
    redaction: parsed.values.has("--redaction")
      ? redactionModeConfigValue(getValue(parsed, "--redaction", DEFAULT_REDACTION_MODE), "--redaction")
      : promptRedactionMode(),
  };
}

function printCheckoutVisibility(root: string, config: SidecarConfig): void {
  const ignoreEntry = ensureSidecarIgnored(root, config.path);
  if (!ignoreEntry) {
    console.log(`sidecar path outside repo; not updating .gitignore`);
    return;
  }
  const name = ignoreEntry.replace(/\/+$/, "");
  console.log(`ignored ${name}/ via .gitignore`);
  if (hasZedInclusion(root, ignoreEntry)) {
    console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
  } else if (promptYesNo(`include ${name}/ in Zed file search via .zed/settings.json?`)) {
    if (ensureZedInclusion(root, ignoreEntry)) {
      console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
    } else {
      console.log(`could not parse .zed/settings.json; add "${name}/**" to file_scan_inclusions manually`);
    }
  }
}

/**
 * A fresh clone of this repo self-registers with the machine's daemon through
 * the package's postinstall — but only if the package is installed. Offer to
 * wire that up whenever the repo already has a package.json; sidecar never
 * creates one, because a repo without an install step shouldn't gain one for
 * our sake. `--local-install` says yes non-interactively.
 */
function offerLocalInstall(root: string, config: SidecarConfig, forced: boolean): void {
  const manifestPath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath)) {
    if (forced) throw new SidecarError("--local-install requires a package.json");
    return;
  }
  if (projectDependsOnSidecar(root)) return;

  let source: string;
  let manifest: Record<string, unknown>;
  try {
    source = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    manifest = parsed as Record<string, unknown>;
  } catch {
    console.error(
      `sidecar: warning: could not parse ${manifestPath}; add ${PACKAGE_NAME} to devDependencies manually so fresh clones self-register on install`,
    );
    return;
  }

  if (!forced && !promptYesNo(`add ${PACKAGE_NAME} to devDependencies so fresh clones self-register on install?`)) {
    return;
  }

  manifest.devDependencies = {
    ...(manifest.devDependencies as Record<string, string> | undefined),
    [PACKAGE_NAME]: `^${packageVersion()}`,
  };

  // The postinstall is the whole point, and bun and pnpm block lifecycle
  // scripts by default — the dependency without its trust entry would
  // register nothing while looking like it should.
  const managers = detectPackageManagers(root);
  if (managers.has("bun")) {
    manifest.trustedDependencies = withEntry(manifest.trustedDependencies, PACKAGE_NAME);
  }
  if (managers.has("pnpm")) {
    const pnpm = { ...(manifest.pnpm as Record<string, unknown> | undefined) };
    pnpm.onlyBuiltDependencies = withEntry(pnpm.onlyBuiltDependencies, PACKAGE_NAME);
    manifest.pnpm = pnpm;
  }

  const indent = /^([ \t]+)"/m.exec(source)?.[1] ?? "  ";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indent)}\n`);
  console.log(`added ${paint("brand", PACKAGE_NAME)} to devDependencies; run your package manager's install to pin it`);
  if (managers.has("bun")) {
    console.log("trusted its postinstall via trustedDependencies (bun blocks lifecycle scripts by default)");
  }
  if (managers.has("pnpm")) {
    console.log("trusted its postinstall via pnpm.onlyBuiltDependencies (pnpm blocks lifecycle scripts by default)");
  }
  if (!managers.size) {
    console.error(
      `sidecar: warning: no lockfile found, so the package manager is unknown — bun and pnpm block postinstall scripts by default; if this repo uses one of them, add the trust entry manually`,
    );
  }

  // In a standalone repo everything untracked gets snapshotted and pushed,
  // so an install that materializes node_modules without an ignore entry
  // would sync the whole dependency tree.
  if (isStandalone(config) && git(root, ["check-ignore", "-q", "node_modules"], { check: false }).status !== 0) {
    console.error(
      "sidecar: warning: node_modules is not gitignored; add it before installing or the next sync will snapshot the whole dependency tree",
    );
  }
}

function withEntry(value: unknown, entry: string): string[] {
  const entries = Array.isArray(value) ? (value as string[]) : [];
  return entries.includes(entry) ? entries : [...entries, entry];
}

function detectPackageManagers(root: string): Set<string> {
  const lockfiles: Array<[string, string]> = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
  ];
  return new Set(lockfiles.filter(([file]) => fs.existsSync(path.join(root, file))).map(([, manager]) => manager));
}

// Package managers don't reliably run the postinstall that enables the daemon
// (pnpm and bun block lifecycle scripts by default), so init is the
// guaranteed path: every init makes sure the background service is set up,
// unless the user has explicitly disabled the daemon.
function ensureDaemonSetup(globalSidecar: string): void {
  if (process.env[SKIP_SERVICE_ENV] === "1") return;
  if (!readSettings().daemonEnabled) return;
  const service = daemonServiceStatus();
  if (!service.available || (service.installed && service.running)) return;

  const result = spawnSync(globalSidecar, ["daemon", "enable"], {
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV]: "1",
      [GLOBAL_EXEC_ENV]: "1",
    },
  });
  if (result.status !== 0) {
    console.log(
      `could not enable the sync daemon: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}; run \`sidecar daemon enable\` manually`,
    );
    return;
  }
  console.log("enabled the sidecar daemon for background sync");
}

function ensureGlobalSidecar(): string | undefined {
  const installHint = `install with \`npm install -g ${PACKAGE_SPEC}\``;
  const globalSidecar = findGlobalSidecarExecutable();
  if (!globalSidecar) {
    if (!process.stdin.isTTY) {
      console.log(`no global sidecar found; ${installHint} to enable daemon auto sync`);
      return undefined;
    }
    if (promptYesNo("no global sidecar found; install it now for daemon auto sync?")) {
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
  if (promptYesNo(`global sidecar is ${state} (current v${currentVersion}); update it now?`)) {
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
  writeSettings({ ...readSettings(), installSource: bun ? "bun" : "npm" });
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

// "pending inbox:" is the longest label; every value starts one space past it.
const STATUS_LABEL_WIDTH = "pending inbox:".length;

/** One `label: value` row. The label is dim so the eye lands on the values. */
function labelLine(width: number, label: string, value: string, role?: Role, indent = ""): void {
  const padded = `${label}:`.padEnd(width);
  console.log(`${indent}${paint("label", padded)} ${role ? paint(role, value) : value}`);
}

function statusLine(label: string, value: string, role?: Role): void {
  labelLine(STATUS_LABEL_WIDTH, label, value, role);
}

/** "4 minutes ago (2026-07-25 09:12)", falling back to the raw string. */
function formatTimestampPair(iso: string): string {
  const relative = formatRelativeTime(iso);
  const absolute = formatLocalTimestamp(iso);
  if (!relative || !absolute) return iso;
  return `${relative} ${paint("quiet", `(${absolute})`)}`;
}

function cmdStatus(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(["--json"]), value: new Set() });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar status [--json]");
  if (parsed.flags.has("--json")) return cmdStatusJson();

  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  if (isStandalone(config)) {
    statusLine("standalone", root, "repo");
  } else {
    statusLine("main repo", root, "repo");
    statusLine("sidecar path", sidecarPath, "brand");
  }
  statusLine("remote", config.remote, "brand");
  statusLine("main branch", config.branch);
  statusLine("inbox branch", inbox);

  if (!checkoutPresent) {
    statusLine("checkout", "missing", "bad");
    printDaemonLine();
    printLastSyncLine(root);
    return 0;
  }

  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  statusLine("checkout", "present");
  // Sidecar keeps the checkout on its inbox branch; anywhere else is either a
  // sync mid-flight or a hand-made switch, and the next sync moves it back.
  if (!branch) statusLine("branch", "(detached)", "attn");
  else if (branch === inbox) statusLine("branch", branch);
  else statusLine("branch", `${branch} — not the inbox branch; sync will switch back`, "attn");
  statusLine("dirty", dirty ? "yes" : "no", dirty ? "attn" : "quiet");
  printDaemonLine();
  printLastSyncLine(root);

  const pending = pendingStatusInboxBranches(sidecarPath, config);
  if (pending.length) {
    statusLine("pending inbox", String(pending.length), "attn");
    for (const branchName of pending) console.log(`  ${paint("brand", branchName)}`);
  } else {
    statusLine("pending inbox", "none", "quiet");
  }
  return 0;
}

function cmdStatusJson(): number {
  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  const branch = checkoutPresent ? git(sidecarPath, ["branch", "--show-current"]).stdout.trim() : undefined;
  const payload = {
    root,
    sidecarPath,
    standalone: isStandalone(config),
    remote: config.remote,
    branch: config.branch,
    inbox,
    checkout: checkoutPresent ? "present" : "missing",
    currentBranch: branch || undefined,
    dirty: checkoutPresent ? Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim()) : undefined,
    daemon: daemonHealth().text,
    lastSyncAt: readInstances().find((instance) => instance.root === root)?.lastSyncAt,
    pendingInbox: checkoutPresent ? pendingStatusInboxBranches(sidecarPath, config) : undefined,
  };
  console.log(JSON.stringify(payload, null, 2));
  return 0;
}

function pendingStatusInboxBranches(sidecarPath: string, config: SidecarConfig): string[] {
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch)
    ? `origin/${config.branch}`
    : branchExists(sidecarPath, config.branch)
      ? config.branch
      : "HEAD";
  return pendingInboxBranches(sidecarPath, config).filter(
    (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base),
  );
}

/**
 * Green when the daemon is up, red when it should be up and isn't, and dim when
 * this install can't run one at all — a project-local sidecar has no daemon to
 * report on, which is a fact about the install rather than a fault.
 */
export function daemonHealth(): { text: string; role: Role } {
  if (!shouldUseGlobalRegistry()) return { text: "no global install", role: "quiet" };

  const service = daemonServiceStatus();
  if (!service.available) return { text: service.message ?? "unavailable", role: "quiet" };
  if (service.running) return { text: "running", role: "ok" };
  if (!readSettings().daemonEnabled) return { text: "disabled", role: "attn" };
  if (!service.installed) return { text: "not installed — run `sidecar daemon enable`", role: "bad" };
  return { text: "stopped", role: "bad" };
}

function printDaemonLine(): void {
  const health = daemonHealth();
  statusLine("daemon", health.text, health.role);
}

function printLastSyncLine(root: string): void {
  const lastSyncAt = readInstances().find((instance) => instance.root === root)?.lastSyncAt;
  if (!lastSyncAt) {
    statusLine("last sync", "never", "quiet");
    return;
  }
  // Age isn't colored: a sidecar only syncs when something changed, so a quiet
  // week is normal and flagging it would train you to ignore the color.
  statusLine("last sync", formatTimestampPair(lastSyncAt));
}

/** "4 minutes ago" — floored, so it never claims more time has passed than has. */
export function formatRelativeTime(iso: string, now = Date.now()): string | undefined {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;

  // Clocks on two machines writing the same registry drift; a small negative
  // age is normal and reads better as "just now" than as a negative duration.
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";

  const scales: [seconds: number, unit: string, limit: number][] = [
    [60, "minute", 60],
    [3600, "hour", 24],
    [86400, "day", 14],
    [604800, "week", 9],
    [2592000, "month", 18],
    [31536000, "year", Number.POSITIVE_INFINITY],
  ];
  for (const [size, unit, limit] of scales) {
    const count = Math.max(1, Math.floor(seconds / size));
    if (count < limit) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "a very long time ago";
}

/** Local wall-clock time, because that's the frame you remember working in. */
export function formatLocalTimestamp(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The fleet view: what every checkout of this sidecar last said about itself.
 *
 * Kept out of `status`, which answers "how is *this* checkout" and would lose
 * that focus if it also had to fetch and summarise every other machine.
 */
function cmdHealth(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json", "--no-fetch"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar health [--json] [--no-fetch]");

  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  // A stale view is worse than a slow one — it would report a machine as fine
  // hours after it started failing. `--no-fetch` is for reading offline.
  if (!parsed.flags.has("--no-fetch")) fetch(sidecarPath, true, false);
  const entries = readFleetHealth(sidecarPath);

  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }

  console.log(`${paint("label", "remote:")} ${paint("brand", config.remote)}`);
  console.log(`${paint("label", "fleet: ")} ${summarizeHealthStates(entries.map((entry) => entry.state))}`);
  if (!entries.length) {
    console.log("");
    console.log(paint("quiet", "no checkout has reported yet; each one publishes on its next sync"));
    return 0;
  }

  const width = "checkout:".length;
  const line = (label: string, value: string, role?: Role): void => labelLine(width, label, value, role, "  ");
  for (const { record, state, self } of entries) {
    console.log("");
    console.log(`${paint("repo", record.machine)}${self ? paint("quiet", "  (this checkout)") : ""}`);
    const status = healthStatusLine(state, record);
    line("status", status.text, status.role);
    if (record.message) line("detail", record.message);
    if (record.consecutiveFailures > 1) line("failures", `${record.consecutiveFailures} in a row`, "attn");
    if (record.root) line("checkout", record.root);
    if (record.inbox) line("inbox", record.inbox);
    line("reported", formatTimestampPair(record.updatedAt));
    // Only worth a line when it isn't the reported time already — on a healthy
    // machine the two are the same and the repetition just adds noise.
    if (record.lastSuccessAt && record.lastSuccessAt !== record.updatedAt) {
      line("last ok", formatTimestampPair(record.lastSuccessAt));
    } else if (!record.lastSuccessAt) {
      line("last ok", "never", "attn");
    }
    if (record.version) line("version", record.version, "quiet");
  }
  return 0;
}

/** Red for a machine reporting its own failure, bold yellow for one gone quiet. */
function healthStatusLine(state: HealthState, record: HealthRecord): { text: string; role: Role } {
  if (state === "failed") {
    return { text: record.stage ? `failed at ${record.stage}` : "failed", role: "bad" };
  }
  if (state === "stale") {
    const age = formatRelativeTime(record.updatedAt) ?? record.updatedAt;
    return { text: `stale — last reported ${age}`, role: "attn" };
  }
  return { text: "ok", role: "ok" };
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

  console.log(`${paint("label", "registry:")} ${paint("quiet", instancesPath())}`);
  console.log(`${paint("label", "log:     ")} ${paint("quiet", sidecarLogPath())}`);
  if (!statuses.length) {
    console.log("instances: none");
    return 0;
  }

  // "checkout:" is the longest label; matches the width `status` values use.
  const width = "checkout:".length;
  const line = (label: string, value: string, role?: Role): void => labelLine(width, label, value, role, "  ");
  for (const status of statuses) {
    console.log("");
    console.log(paint("repo", status.root));
    line("sidecar", status.sidecarPath, "brand");
    line("remote", status.remote, "brand");
    line("branch", status.currentBranch || "(unknown)");
    line("config", status.config, status.config === "ok" ? undefined : "bad");
    line("checkout", status.checkout, status.checkout === "present" ? undefined : "bad");
    line("dirty", status.dirty, status.dirty === "yes" ? "attn" : "quiet");
    line("updated", formatTimestampPair(status.updatedAt));
    if (status.lastSyncAt) line("synced", formatTimestampPair(status.lastSyncAt));
  }
  return 0;
}

function cmdTail(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set(["-n", "--lines"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar tail [-f|--follow] [-n|--lines count]");
  const rawLines = getValue(parsed, "--lines", getValue(parsed, "-n", "50"));
  const lines = Number.parseInt(rawLines, 10);
  if (!Number.isFinite(lines) || lines < 1 || String(lines) !== rawLines) {
    throw new SidecarError("--lines requires a positive integer");
  }

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
    process.stdout.write(lastLines(fs.readFileSync(filePath, "utf8"), lines));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}

export function lastLines(content: string, count: number): string {
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!trimmed) return "";
  return `${trimmed.split("\n").slice(-count).join("\n")}\n`;
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

// "settings:" is the longest label; padding matches the historical layout.
const DAEMON_LABEL_WIDTH = "settings:".length;

function daemonLine(label: string, value: string, role?: Role): void {
  labelLine(DAEMON_LABEL_WIDTH, label, value, role);
}

/**
 * The `daemon`/`service`/`agent`/... block every daemon subcommand prints.
 * `stopped` is only red while the daemon is enabled: after an explicit
 * disable it is the state the user just asked for.
 */
function printDaemonBlock(service: DaemonServiceStatus, enabled: boolean): void {
  daemonLine("daemon", enabled ? "enabled" : "disabled", enabled ? "ok" : "attn");
  printServiceLines(service, enabled);
  daemonLine("settings", settingsPath(), "quiet");
}

function printServiceLines(service: DaemonServiceStatus, enabled: boolean): void {
  const role: Role = service.running
    ? "ok"
    : !service.available
      ? "quiet"
      : enabled && service.installed
        ? "bad"
        : "quiet";
  daemonLine("service", daemonServiceLabel(service), role);
  if (service.path) daemonLine("agent", service.path, "quiet");
  if (service.message) daemonLine("detail", service.message);
}

function cmdDaemonStatus(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  const settings = readSettings();
  const service = daemonServiceStatus();
  daemonLine("daemon", settings.daemonEnabled ? "enabled" : "disabled", settings.daemonEnabled ? "ok" : "attn");
  daemonLine("update", settings.autoUpdate ? "auto" : "manual");
  printServiceLines(service, settings.daemonEnabled);
  daemonLine("settings", settingsPath(), "quiet");
  daemonLine("log", sidecarLogPath(), "quiet");
  return 0;
}

function cmdDaemonEnable(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  printDaemonBlock(service, true);
  return 0;
}

function cmdDaemonDisable(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  printDaemonBlock(service, false);
  return 0;
}

function cmdDaemonRestart(): number {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  printDaemonBlock(service, true);
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
  printServiceLines(service, readSettings().daemonEnabled);
  return 0;
}

// Records how the global executable got onto this machine (npm, bun, the
// curl script, ...) so update paths can pick the matching channel instead of
// guessing from filesystem layout.
function cmdSetInstallSource(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(["--if-unset"]), value: new Set() });
  const [source, ...extra] = parsed.positional;
  if (!source || extra.length || !INSTALL_SOURCES.has(source as InstallSource)) {
    throw new SidecarError("usage: sidecar set-install-source npm|bun|curl [--if-unset]");
  }
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("set-install-source must run from a globally installed sidecar");
  }
  const settings = readSettings();
  // --if-unset lets postinstall record the default channel without an npm-run
  // autoupdate clobbering a source (like "curl") that owns the install.
  if (parsed.flags.has("--if-unset") && settings.installSource) {
    console.log(`install source: ${settings.installSource} (kept)`);
    return 0;
  }
  writeSettings({ ...settings, installSource: source as InstallSource });
  console.log(`install source: ${source}`);
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
  // Snapshotting while a daemon sync is mid-merge would commit on whatever
  // branch the merge has checked out, so take the same lock syncs use.
  withSyncLock(root, "throw", () => {
    const inbox = expandInbox(config, sidecarPath);
    ensureCommitIdentity(sidecarPath);
    ensureInboxBranch(sidecarPath, config, inbox);
    const committed = snapshot(
      sidecarPath,
      root,
      inbox,
      getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
      config.redaction,
    );
    if (committed && parsed.flags.has("--push")) {
      syncBranchBeforePush(sidecarPath, inbox);
      pushBranch(sidecarPath, inbox);
    }
  });
  return 0;
}

function cmdSync(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot", "--soft"]),
    value: new Set(["-m", "--message"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar sync [--no-snapshot] [--soft] [-m message]");

  const [root, config] = loadProject();
  removeLegacyGitHooks(root);
  // A soft sync is a request, not a demand: the daemon issues them, and one
  // that loses the lock to a running sync can no-op because the interval or
  // watcher will simply request again. A manual sync must never pretend.
  const soft = parsed.flags.has("--soft") || process.env[SOFT_SYNC_ENV] === "1";
  // Which step was in flight when a sync threw, so the heartbeat can say
  // "failed at snapshot" rather than only "failed".
  let stage = "start";
  let synced: boolean;
  try {
    synced = withSyncLock(root, soft ? "skip" : "throw", () => {
      syncProject(root, config, {
        snapshot: !parsed.flags.has("--no-snapshot"),
        message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
        onStage: (name) => {
          stage = name;
        },
      });
    });
  } catch (error) {
    reportSyncHealth(root, config, {
      status: "failed",
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  // A soft sync that lost the lock never attempted anything, so it has nothing
  // to report; the sync holding the lock will report for this checkout.
  if (synced) {
    registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
    reportSyncHealth(root, config, { status: "ok" });
  }
  return 0;
}

/** Runs inside the repo's sync lock — callers hold it via withSyncLock. */
function syncProject(
  root: string,
  config: SidecarConfig,
  options: { snapshot: boolean; message?: string; onStage?: (stage: string) => void },
): void {
  const stage = (name: string): void => options.onStage?.(name);

  stage("checkout");
  const sidecarPath = ensureSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, true, false);
  ensureInboxBranch(sidecarPath, config, inbox);
  stage("snapshot");
  if (options.snapshot) {
    snapshot(sidecarPath, root, inbox, options.message, config.redaction);
  } else {
    // Without a snapshot nothing else repairs a stale filter command, and
    // required=true would fail every git status until one runs.
    ensureRedactionFilter(sidecarPath, config.redaction);
  }
  stage("push-inbox");
  syncBranchBeforePush(sidecarPath, inbox);
  pushBranch(sidecarPath, inbox);
  stage("merge");
  mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: true });
  stage("refresh");
  refreshInboxFromMain(sidecarPath, config, inbox);
}

// ---------------------------------------------------------------------------
// Fleet health
//
// See health.ts for why this is a heartbeat on its own branch namespace rather
// than an alert file on the main branch. What lives here is the git side of it:
// a publish path that shares as little as possible with the sync path it
// reports on, so a broken clean filter or a wedged checkout can still be
// announced by the machine it broke on.
// ---------------------------------------------------------------------------

/**
 * The branch this checkout reports on — per checkout rather than per machine,
 * matching the inbox, because two clones of a project on one laptop are two
 * things that can fail independently.
 */
function healthBranchFor(sidecarPath: string): string {
  return healthBranch(slug(currentUser()), checkoutRandom(sidecarPath));
}

/**
 * Publishes what a sync attempt turned out to be.
 *
 * Never throws. A heartbeat that could fail the sync it is reporting on would
 * be worse than no heartbeat at all — the same rule `logSidecarEvent` follows,
 * and the reason the failure path can call this before rethrowing.
 */
function reportSyncHealth(root: string, config: SidecarConfig, outcome: HealthOutcome): void {
  try {
    const sidecarPath = resolveSidecarPath(root, config);
    // No checkout means no refs to publish through. The failure is real, but
    // it's in the local log and there is nowhere to say so from.
    if (!hasGitMetadata(sidecarPath)) return;

    const branch = healthBranchFor(sidecarPath);
    const previous = readHealthRecordAt(sidecarPath, `origin/${branch}`);
    const identity: HealthIdentity = {
      machine: `${currentUser()}@${currentHost()}`,
      root,
      inbox: expandInbox(config, sidecarPath),
      version: packageVersion(),
    };
    const record = nextHealthRecord(previous, identity, outcome, nowIso());
    if (!shouldPublishHealth(previous, record)) return;
    publishHealthRecord(sidecarPath, branch, record);
    logSidecarEvent("health", {
      branch,
      status: record.status,
      stage: record.stage,
      consecutiveFailures: record.consecutiveFailures,
    });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "health",
      root,
      message: `could not publish health: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Writes the heartbeat with plumbing, deliberately touching nothing the sync
 * path uses: no working tree, no index, no branch checkout, and — because
 * `hash-object --stdin` has no path to key an attribute off — no clean filter.
 * That is what lets a machine whose `git add` fails still report why.
 *
 * Each heartbeat is a fresh root commit, force-pushed. History of a liveness
 * ping has no value worth the unbounded growth, and being the branch's only
 * writer means a force push can never lose someone else's work.
 */
function publishHealthRecord(sidecarPath: string, branch: string, record: HealthRecord): void {
  const blob = git(sidecarPath, ["hash-object", "-w", "--stdin"], {
    input: serializeHealthRecord(record),
  }).stdout.trim();
  const tree = git(sidecarPath, ["mktree"], {
    input: `100644 blob ${blob}\t${HEALTH_FILE}\n`,
  }).stdout.trim();
  // Identity comes in on the command line rather than from repo config, so
  // publishing doesn't depend on a config write having succeeded first.
  const commit = git(sidecarPath, [
    "-c",
    `user.name=${currentUser()}`,
    "-c",
    `user.email=${slug(currentUser())}@${slug(currentHost())}.local`,
    "commit-tree",
    tree,
    "-m",
    `health: ${record.status} — ${record.machine}`,
  ]).stdout.trim();
  git(sidecarPath, ["push", "--force", "origin", `${commit}:refs/heads/${branch}`]);
}

/** Reads a heartbeat straight out of a ref; `git show` on a blob is unfiltered. */
function readHealthRecordAt(sidecarPath: string, ref: string): HealthRecord | undefined {
  const result = git(sidecarPath, ["show", `${ref}:${HEALTH_FILE}`], { check: false });
  if (result.status !== 0) return undefined;
  return parseHealthRecord(result.stdout);
}

type FleetHealthEntry = {
  branch: string;
  self: boolean;
  state: HealthState;
  record: HealthRecord;
};

/** Every checkout's last word about itself, worst first. */
function readFleetHealth(sidecarPath: string): FleetHealthEntry[] {
  const self = healthBranchFor(sidecarPath);
  const refs = git(sidecarPath, ["branch", "-r", "--format=%(refname:short)"])
    .stdout.split(/\r?\n/)
    .map((ref) => ref.trim())
    .filter((ref) => ref && ref !== "origin/HEAD" && isHealthBranch(ref));

  const entries: FleetHealthEntry[] = [];
  for (const ref of refs) {
    const record = readHealthRecordAt(sidecarPath, ref);
    // A health branch this version can't read is a branch, not a machine —
    // counting it would put an unexplainable row in the fleet view.
    if (!record) continue;
    const branch = remoteBranchName(ref);
    entries.push({ branch, self: branch === self, state: classifyHealthState(record), record });
  }

  // Worst first: the point of the view is the machine that needs you.
  const rank: Record<HealthState, number> = { failed: 0, stale: 1, ok: 2 };
  return entries.sort(
    (left, right) =>
      rank[left.state] - rank[right.state] ||
      left.record.machine.localeCompare(right.record.machine) ||
      left.branch.localeCompare(right.branch),
  );
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
  // Merging runs git status against the checkout; repair a stale filter
  // command first so required=true doesn't wedge it.
  ensureRedactionFilter(sidecarPath, config.redaction);
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

  // Most syncs have no merge work. Detect that from refs alone — local main
  // matching origin and every inbox branch already merged — before paying
  // for a worktree checkout.
  fetch(sidecarPath, false);
  if (mainMatchesRemote(sidecarPath, config) && !hasPendingInboxWork(sidecarPath, config)) {
    console.log("no inbox branches to merge");
    return 0;
  }

  // Merging switches branches, which rewrites working-tree files from
  // committed (redacted) blobs. The user's checkout keeps the unredacted
  // originals, so the branch dance happens in a throwaway linked worktree
  // and the checkout never leaves the inbox branch.
  // No commits means no worktree to protect (`worktree add` refuses an
  // unborn HEAD), and nothing to rewrite either.
  if (!hasAnyCommit(sidecarPath)) {
    return mergeInboxBranchesAt(sidecarPath, config, options);
  }
  // A checkout parked on the main branch would block the worktree from
  // switching to it. Sidecar owns this checkout's branch, and ensureClean
  // above proved there is no uncommitted work, so move back to the inbox
  // branch rather than merging in place and rewriting the user's files.
  if (git(sidecarPath, ["branch", "--show-current"]).stdout.trim() === config.branch) {
    ensureInboxBranch(sidecarPath, config, expandInbox(config, sidecarPath));
  }
  // A deterministic path (rather than mkdtemp) lets a new sync reclaim the
  // worktree a killed sync left behind; a stale registration would otherwise
  // block `git switch <main>` in every future merge. The sync lock prevents
  // two live syncs from colliding on it.
  const scratch = path.join(
    os.tmpdir(),
    `sidecar-merge-${crypto.createHash("sha1").update(sidecarPath).digest("hex").slice(0, 12)}`,
  );
  const worktree = path.join(scratch, "checkout");
  git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
  fs.rmSync(scratch, { recursive: true, force: true });
  git(sidecarPath, ["worktree", "prune", "--expire", "now"], { check: false });
  try {
    git(sidecarPath, ["worktree", "add", "--detach", worktree]);
    return mergeInboxBranchesAt(worktree, config, options);
  } finally {
    git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function mainMatchesRemote(repo: string, config: SidecarConfig): boolean {
  if (!branchExists(repo, config.branch) || !remoteRefExists(repo, config.branch)) return false;
  const local = git(repo, ["rev-parse", `refs/heads/${config.branch}`]).stdout.trim();
  const remote = git(repo, ["rev-parse", `refs/remotes/origin/${config.branch}`]).stdout.trim();
  return local === remote;
}

function hasPendingInboxWork(repo: string, config: SidecarConfig): boolean {
  const remoteMain = `origin/${config.branch}`;
  return pendingInboxBranches(repo, config).some((branch) => !isAncestor(repo, branch, remoteMain));
}

function mergeInboxBranchesAt(
  sidecarPath: string,
  config: SidecarConfig,
  options: { forkFiles: boolean; push: boolean },
): number {
  // Two machines can merge and push concurrently; the loser's push of the
  // main branch is rejected. Each attempt refetches, lets ensureMainBranch
  // reconcile with whatever the winner pushed, and re-merges what's still
  // pending, so a lost race heals instead of wedging every later sync.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    // The wrapper fetched just before the first attempt; refetch on retries
    // to pick up whatever the winning machine pushed.
    if (attempt > 1) fetch(sidecarPath, false);
    ensureMainBranch(sidecarPath, config);

    const inboxBranches = pendingInboxBranches(sidecarPath, config).filter(
      (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"),
    );
    if (!inboxBranches.length && attempt === 1) {
      console.log("no inbox branches to merge");
      return 0;
    }

    const merged: string[] = [];
    for (const remoteBranch of inboxBranches) {
      console.log(`merging ${paint("brand", remoteBranch)}`);
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
      const push = git(
        sidecarPath,
        ["push", "-u", "origin", `HEAD:refs/heads/${config.branch}`],
        { check: false },
      );
      if (push.status !== 0) {
        if (attempt >= maxAttempts) {
          throw new SidecarError(push.stderr.trim() || `could not push ${config.branch}`);
        }
        console.log(`push of ${config.branch} was rejected; refetching and retrying`);
        continue;
      }
      console.log(`pushed ${config.branch}`);
    }

    console.log(`merged ${merged.length} inbox branch(es)`);
    return merged.length;
  }
}

// Previews exactly what the clean filter rewrites on the next push. The
// worktree keeps originals and redaction is deterministic, so this is always
// recomputable — no redaction log to store or dedupe.
function cmdRedactions(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(), value: new Set() });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar redactions");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  if (config.redaction === "none") {
    console.log('redaction is disabled (redaction = "none" in .sidecar)');
    return 0;
  }

  // quotePath off so non-ASCII names come back verbatim; unmerged entries
  // repeat per stage, hence the Set.
  const files = [
    ...new Set(
      git(sidecarPath, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"])
        .stdout.split("\n")
        .filter(Boolean),
    ),
  ];
  let shown = 0;
  let items = 0;
  for (const relPath of files) {
    const delta = fileRedactionDelta(path.join(sidecarPath, relPath), config.redaction);
    if (!delta) continue;
    if (shown) console.log("");
    console.log(`${relPath}:`);
    printRedactionDiff(delta.text, delta.redacted);
    shown += 1;
    items += delta.items;
  }

  if (!shown) {
    console.log(`no redactions pending (mode: ${config.redaction})`);
    return 0;
  }
  console.log(
    `\n${items} redaction(s) in ${shown} file(s) will be pushed this way (mode: ${config.redaction}).`,
  );
  console.log(
    `local files are untouched; add "${NO_REDACT_PRAGMA}" to a file's first lines to push it verbatim`,
  );
  return 0;
}

function printRedactionDiff(original: string, redacted: string): void {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-redactions-"));
  try {
    const localPath = path.join(scratch, "local");
    const pushedPath = path.join(scratch, "pushed");
    fs.writeFileSync(localPath, original, "utf8");
    fs.writeFileSync(pushedPath, redacted, "utf8");
    // stdout is captured, so git sees a pipe and drops color on its own;
    // re-request it at the fidelity of the terminal we forward to.
    const color = colorLevel() > 0 ? ["--color"] : [];
    const diff = gitRaw(["diff", "--no-index", ...color, "--", localPath, pushedPath], { check: false });
    // Keep only the hunks: removed/added content lines can legitimately start
    // with "---"/"+++" inside a hunk, so filtering by prefix would drop them.
    const lines = diff.stdout.split("\n");
    const firstHunk = lines.findIndex((line) => stripColor(line).startsWith("@@"));
    const body = firstHunk === -1 ? "" : lines.slice(firstHunk).join("\n").trimEnd();
    if (body) console.log(body);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Invoked by git as the sidecar checkout's clean filter: one file's content
// on stdin, redacted content on stdout. Binary and non-UTF-8 input, and files
// carrying the no-redact pragma, pass through untouched.
function cmdRedact(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(), value: new Set(["--mode"]) });
  const mode = redactionModeConfigValue(getValue(parsed, "--mode", DEFAULT_REDACTION_MODE), "--mode");
  const output = redactBuffer(fs.readFileSync(0), mode);
  // stdout is a pipe to git, and pipe writes are async on macOS — a buffered
  // process.stdout.write can be truncated by process.exit, committing a
  // corrupted blob. Write synchronously.
  let offset = 0;
  while (offset < output.length) {
    offset += fs.writeSync(1, output, offset, output.length - offset);
  }
  return 0;
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
    gitRaw(["clone", "--", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      // A standalone sidecar syncs to "this repo's origin" by definition; the
      // URL in the committed .sidecar is just how the machine that wrote it
      // reached the same repo. A clone made over another scheme (ssh vs
      // https) is not a conflict — origin wins.
      if (!isStandalone(config)) {
        throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
      }
      console.log(
        `using origin ${paint("brand", existing.stdout.trim())} ${paint("quiet", `(.sidecar says ${config.remote})`)}`,
      );
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }

  ensureCommitIdentity(sidecarPath);
  ensureRedactionFilter(sidecarPath, config.redaction);
  if (bootstrapMain) bootstrapMainBranch(sidecarPath, config);

  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${paint("brand", sidecarPath)}`);
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
  // A standalone repo is the user's own; seeding it with a scratchpad README
  // would be putting our furniture in their house. An empty commit is enough
  // to give the branch a root.
  if (isStandalone(config)) {
    git(repo, ["commit", "--allow-empty", "-m", "Initialize sidecar"]);
    pushBranch(repo, config.branch);
    return;
  }
  fs.writeFileSync(
    path.join(repo, "README.md"),
    `# Sidecar

Scratch space for a code repository: plans, notes, and agent context.
This is a plain git repo you own — read it, edit it, clone it anywhere.
Kept in sync by [sidecar](https://github.com/anteprojector/sidecar).
`,
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

  if (!remoteRefExists(repo, config.branch)) return;
  const remoteBranch = `origin/${config.branch}`;
  if (isAncestor(repo, remoteBranch, "HEAD")) return;
  if (isAncestor(repo, "HEAD", remoteBranch)) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }
  // Diverged: another machine won a push race. Local commits beyond the
  // remote are only sidecar-generated inbox merges, so the remote side wins
  // and any still-pending inbox branches get re-merged on top of it.
  // This reset is the one destructive step in a sync, so park the discarded
  // tip under refs/sidecar-discarded/ first. It costs one ref write, never
  // leaves the machine (pushes and fetches only touch refs/heads/*), and
  // turns "gone" into "findable" if that invariant ever fails to hold.
  // The tip's own hash in the name keeps two same-second resets from
  // overwriting each other: a collision then requires the same tip, where
  // both writes record the same thing anyway.
  const tip = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const discarded = `refs/sidecar-discarded/${config.branch}/${utcTimestamp()}-${tip}`;
  git(repo, ["update-ref", discarded, "HEAD"], { check: false });
  console.log(`${config.branch} diverged from ${remoteBranch}; old tip kept at ${paint("brand", discarded)}`);
  git(repo, ["reset", "--hard", remoteBranch]);
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

  // A standalone checkout is the user's live working tree, and a dotfiles
  // repo routinely sits ahead of its origin. Fork its inbox from HEAD:
  // creating a branch in place never rewrites files, where starting from an
  // older origin/<main> rolls the tree back to the pushed state — or refuses
  // to overwrite dirty files and kills init halfway. Anything HEAD is missing
  // comes back through the first inbox merge.
  if (isStandalone(config) && hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
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

export function snapshot(
  repo: string,
  mainRoot: string,
  inbox: string,
  message = "sidecar snapshot",
  redactionMode: RedactionMode = DEFAULT_REDACTION_MODE,
): boolean {
  // A filter change (new mode, moved node/CLI) doesn't invalidate git's stat
  // cache, so already-committed files would keep their old redaction state
  // forever; renormalize forces every tracked file back through the filter.
  if (ensureRedactionFilter(repo, redactionMode) && hasAnyCommit(repo)) {
    git(repo, ["add", "--renormalize", "."]);
  }
  git(repo, ["add", "-A"]);
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    console.log("no sidecar changes to snapshot");
    return false;
  }
  const staged = git(repo, ["-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--diff-filter=d"])
    .stdout.split("\n")
    .filter(Boolean);

  const source = `${currentUser()}@${currentHost()}`;
  const body = [message, "", `source: ${source}`];
  // main-head pins a snapshot to the code it was taken against. Standalone has
  // no separate code repo — mainRoot is this repo — so the trailer would just
  // record the commit this snapshot is about to sit on.
  if (path.resolve(repo) !== path.resolve(mainRoot)) {
    const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
    body.push(`main-head: ${mainHead.status === 0 ? mainHead.stdout.trim() : "unborn"}`);
  }
  body.push(`inbox: ${inbox}`);
  git(repo, ["commit", "-m", body.join("\n")]);
  console.log(`committed sidecar snapshot to ${paint("brand", inbox)}`);
  reportRedactions(repo, staged, redactionMode);
  return true;
}

// Surfaces what the clean filter changed in this snapshot, so redaction is
// never silent: false positives are only reviewable if the user knows they
// happened.
function reportRedactions(repo: string, staged: string[], mode: RedactionMode): void {
  if (mode === "none") return;
  let files = 0;
  let items = 0;
  for (const relPath of staged) {
    const delta = fileRedactionDelta(path.join(repo, relPath), mode);
    if (!delta) continue;
    files += 1;
    items += delta.items;
  }
  if (!files) return;
  console.log(
    `redacted ${items} item(s) in ${files} file(s); review with \`sidecar redactions\`, or add "${NO_REDACT_PRAGMA}" to a file's first lines to opt it out`,
  );
  logSidecarEvent("redaction", { files, items });
}

// What redaction changes for one file, or undefined when it leaves the file
// alone (binary, pragma opt-out, or nothing matched).
function fileRedactionDelta(
  filePath: string,
  mode: RedactionMode,
): { text: string; redacted: string; items: number } | undefined {
  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    return undefined;
  }
  const text = decodeUtf8Text(data);
  if (text === undefined || hasNoRedactPragma(text)) return undefined;
  const redacted = redactText(text, mode);
  if (redacted === text) return undefined;
  const items = Math.max(
    1,
    countRedactionPlaceholders(redacted) - countRedactionPlaceholders(text),
  );
  return { text, redacted, items };
}

const REDACTION_FILTER_NAME = "sidecar-redact";

// Redaction happens in a git clean filter, so secrets never reach committed
// blobs while the working tree keeps the user's original text. `required`
// makes staging fail closed if the filter command can't run.
// Returns true when it had to (re)write any part of the wiring — the signal
// that staged content may predate the current filter and needs renormalizing.
export function ensureRedactionFilter(repo: string, mode: RedactionMode = DEFAULT_REDACTION_MODE): boolean {
  // Mode "none" keeps the filter wiring in place (so switching back needs no
  // attribute changes) but stages content untouched without a node spawn.
  const command =
    mode === "none"
      ? "cat"
      : `${filterCommandQuote(process.execPath)} ${filterCommandQuote(redactCliPath())} redact --mode=${mode}`;
  const wanted: Array<[string, string]> = [
    [`filter.${REDACTION_FILTER_NAME}.clean`, command],
    // `required` applies to both directions, so checkout needs an identity
    // smudge command to succeed.
    [`filter.${REDACTION_FILTER_NAME}.smudge`, "cat"],
    [`filter.${REDACTION_FILTER_NAME}.required`, "true"],
  ];
  // info/attributes lives in the shared git dir; the worktree-local git dir
  // differs from it inside linked worktrees (which merging uses).
  const attributesPath = path.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;

  // The command embeds absolute paths that go stale when node or the CLI
  // moves, so every caller re-checks. Verify every piece, not just the clean
  // command — a partial write (killed daemon) or a lost attributes file must
  // fail closed by repairing, never by early-exiting.
  const configured = git(repo, ["config", "--get-regexp", `^filter\\.${REDACTION_FILTER_NAME}\\.`], {
    check: false,
  });
  const current = new Map(
    configured.stdout
      .split("\n")
      .filter(Boolean)
      .map((entry) => {
        const space = entry.indexOf(" ");
        return [entry.slice(0, space), entry.slice(space + 1)] as [string, string];
      }),
  );
  const configOk = wanted.every(([key, value]) => current.get(key) === value);
  let attributes = "";
  try {
    attributes = fs.readFileSync(attributesPath, "utf8");
  } catch {
    // Missing attributes file: created by the append below.
  }
  const attributesOk = attributes.split(/\r?\n/).includes(line);
  if (configOk && attributesOk) return false;

  for (const [key, value] of wanted) {
    git(repo, ["config", key, value]);
  }
  if (!attributesOk) {
    fs.mkdirSync(path.dirname(attributesPath), { recursive: true });
    fs.appendFileSync(
      attributesPath,
      attributes && !attributes.endsWith("\n") ? `\n${line}\n` : `${line}\n`,
      "utf8",
    );
  }
  return true;
}

// The inverse of ensureRedactionFilter, for the one case where the checkout
// outlives sidecar's interest in it.
export function removeRedactionFilter(repo: string): void {
  git(repo, ["config", "--remove-section", `filter.${REDACTION_FILTER_NAME}`], { check: false });

  const attributesPath = path.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;
  let contents: string;
  try {
    contents = fs.readFileSync(attributesPath, "utf8");
  } catch {
    return;
  }
  const lines = contents.split(/\r?\n/);
  const kept = lines.filter((entry) => entry !== line);
  if (kept.length === lines.length) return;
  if (kept.every((entry) => !entry.trim())) {
    fs.rmSync(attributesPath, { force: true });
  } else {
    fs.writeFileSync(attributesPath, `${kept.join("\n").replace(/\s+$/g, "")}\n`, "utf8");
  }
}

// The filter must be runnable by plain git, outside this process: point it at
// the built CLI bundle (when running from TypeScript sources, e.g. tests, the
// sibling dist build).
function redactCliPath(): string {
  const self = fileURLToPath(import.meta.url);
  return self.endsWith(".ts") ? path.join(path.dirname(self), "..", "dist", "cli.js") : self;
}

// Git runs filter commands through sh; double quotes keep paths with spaces
// intact.
function filterCommandQuote(value: string): string {
  return `"${value.replace(/([\\"$`])/g, "\\$1")}"`;
}

function redactBuffer(data: Buffer, mode: RedactionMode): Buffer {
  const text = decodeUtf8Text(data);
  if (text === undefined || hasNoRedactPragma(text)) return data;
  const redacted = redactText(text, mode);
  return redacted === text ? data : Buffer.from(redacted, "utf8");
}

function decodeUtf8Text(data: Buffer): string | undefined {
  if (data.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
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
  console.log(`pushed ${paint("brand", branch)}`);
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

// .sidecar is committed and shared, so a cloned repo's remote value reaches
// git clone from an untrusted source. Restrict it to transports that only
// talk to a remote: a remote helper like "ext::sh -c ..." executes commands,
// and a leading dash would be parsed as an option.
export function validateRemote(remote: string): void {
  const allowedScheme = /^(https?|ssh|git|file):\/\//i;
  const scpLike = /^[A-Za-z0-9._~-]+@[A-Za-z0-9._-]+:/;
  const ok =
    remote.length > 0 &&
    !remote.startsWith("-") &&
    (allowedScheme.test(remote) || scpLike.test(remote) || path.isAbsolute(remote));
  if (!ok) {
    throw new SidecarError(
      `unsupported sidecar remote ${JSON.stringify(remote)}; use an https://, ssh://, git://, or file:// URL, user@host:path, or an absolute path`,
    );
  }
}

export function validateInboxTemplate(template: string): void {
  const prefix = inboxBranchPrefix(template);
  if (template.includes("{") && !prefix.endsWith("/")) {
    throw new SidecarError("inbox template must place variables under a static branch namespace, like sidecar-inbox/{user}/{random}");
  }
  // An inbox namespace overlapping the health one would make the merge sweep
  // every machine's heartbeat into the main branch — the one thing the
  // separate namespace exists to prevent.
  if (inboxPrefixCollidesWithHealth(prefix)) {
    throw new SidecarError(`inbox template must not use the ${HEALTH_BRANCH_PREFIX} namespace, which sidecar reserves for health branches`);
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

function unregisterInstance(root: string): void {
  const instances = readInstances();
  const remaining = instances.filter((instance) => realpathOr(instance.root) !== realpathOr(root));
  if (remaining.length !== instances.length) writeInstances(remaining);
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

export function readDaemonPid(): number | undefined {
  try {
    const pid = Number(fs.readFileSync(daemonPidPath(), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

// A pid file survives crashes and reboots, and the OS can hand the recorded
// pid to an unrelated process. Before trusting or signaling it, confirm the
// process actually looks like a sidecar daemon.
export function pidIsSidecarDaemon(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform === "win32") return true;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const command = (result.stdout ?? "").trim();
  return command.includes("daemon") && /sidecar|cli\.js/.test(command);
}

export function isDaemonRunning(): boolean {
  const pid = readDaemonPid();
  return pid !== undefined && pidIsSidecarDaemon(pid);
}

export function daemonServiceFileContents(invocation: string[]): string {
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
  const pid = readDaemonPid();
  if (!pid || pid === process.pid) return;
  if (!pidIsSidecarDaemon(pid)) {
    fs.rmSync(daemonPidPath(), { force: true });
    return;
  }
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

// Standalone is reachable but never accidental: you have to type "." and then
// confirm it. Scripts say the same thing with `--path .`, which skips both.
function promptSidecarPath(root: string): string {
  if (!process.stdin.isTTY) return DEFAULT_PATH;

  console.log(`sidecar keeps its files in a directory inside this repo — "." makes this repo itself the sidecar.`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = promptLine(`sidecar path ${paint("quiet", `[${DEFAULT_PATH}]`)}: `) || DEFAULT_PATH;
    if (!isStandalonePath(answer)) return answer;
    console.log(`standalone mode makes ${paint("repo", root)} itself the sidecar:`);
    console.log("  sidecar owns this repo's branches, commits every change, and syncs it to its own remote.");
    console.log("  your own commits still work; leave branch management to sidecar.");
    if (promptYesNoDefaultNo("use standalone mode?")) return ".";
  }
  console.log(`keeping the default (${DEFAULT_PATH})`);
  return DEFAULT_PATH;
}

function standaloneRemote(root: string): string {
  const origin = git(root, ["remote", "get-url", "origin"], { check: false });
  const remote = origin.status === 0 ? origin.stdout.trim() : "";
  if (!remote) {
    throw new SidecarError(
      "standalone mode syncs this repo to its own origin, but it has none; add one with `git remote add origin <url>`, or name a remote with `sidecar init <remote> --path .`",
    );
  }
  validateRemote(remote);
  console.log(`standalone remote: ${paint("brand", remote)} ${paint("quiet", "(this repo's origin)")}`);
  return remote;
}

function promptRemote(root: string): string {
  if (!process.stdin.isTTY) {
    throw new SidecarError("remote URL is required when no .sidecar config exists");
  }

  console.log("sidecar stores its files in a separate git repo that you own — any empty repo works.");
  // Re-ask on an invalid URL instead of failing the whole init over a typo.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = promptLine(`sidecar remote URL ${paint("quiet", "(leave blank to create one with gh)")}: `);
    if (!remote) return createRemoteWithGh(root);
    try {
      validateRemote(remote);
      return remote;
    } catch (error) {
      console.log(error instanceof SidecarError ? `sidecar: ${error.message}` : String(error));
    }
  }
  throw new SidecarError("no valid remote URL provided");
}

// Non-interactive inits keep the default rather than asking, so a script
// never ends up with a different redaction mode than an unattended
// `sidecar init` implies.
function promptRedactionMode(): RedactionMode {
  if (!process.stdin.isTTY) return DEFAULT_REDACTION_MODE;

  console.log("redaction rewrites sensitive values out of pushed content; your local files are never touched.");
  const describe = (mode: RedactionMode, text: string): string =>
    `  ${mode.padEnd(11)}  ${text}${mode === DEFAULT_REDACTION_MODE ? ` ${paint("quiet", "(recommended)")}` : ""}`;
  console.log(describe("secrets+pii", "redact API keys, tokens, emails, and other PII"));
  console.log(describe("secrets", "redact API keys and tokens only"));
  console.log(describe("none", "push content verbatim"));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = promptLine(`redaction mode ${paint("quiet", `[${DEFAULT_REDACTION_MODE}]`)}: `).toLowerCase();
    if (!answer) return DEFAULT_REDACTION_MODE;
    if ((REDACTION_MODES as readonly string[]).includes(answer)) return answer as RedactionMode;
    console.log(`invalid redaction mode; expected one of ${REDACTION_MODES.join(", ")}`);
  }
  console.log(`keeping the default (${DEFAULT_REDACTION_MODE})`);
  return DEFAULT_REDACTION_MODE;
}

function createRemoteWithGh(root: string): string {
  const gh = findExecutableOnPath(process.platform === "win32" ? "gh.exe" : "gh");
  if (!gh) {
    throw new SidecarError(
      "gh not found on PATH; install the GitHub CLI (https://cli.github.com) or rerun with `sidecar init <remote>`",
    );
  }

  const origin = git(root, ["remote", "get-url", "origin"], { check: false }).stdout.trim() || undefined;
  const parsedOrigin = origin ? parseGitHubRemote(origin) : undefined;
  const owner = parsedOrigin?.owner ?? ghLogin(gh);
  const baseName = parsedOrigin?.repo ?? path.basename(root);
  const suggested = owner ? `${owner}/${baseName}-sidecar` : `${baseName}-sidecar`;

  const answer = promptLine(`repository to create ${paint("quiet", `[${suggested}]`)}: `) || suggested;
  const fullName = answer.includes("/") ? answer : owner ? `${owner}/${answer}` : undefined;
  if (!fullName) {
    throw new SidecarError("could not determine the repository owner; enter it as owner/name");
  }

  console.log(`running gh repo create ${fullName} --private`);
  const create = spawnSync(gh, ["repo", "create", fullName, "--private"], { stdio: "inherit" });
  if (create.status !== 0) {
    throw new SidecarError("gh repo create failed; create the repo yourself and rerun `sidecar init <remote>`");
  }

  const ssh = origin
    ? origin.startsWith("git@") || origin.startsWith("ssh://")
    : ghGitProtocol(gh) === "ssh";
  return ssh ? `git@github.com:${fullName}.git` : `https://github.com/${fullName}.git`;
}

export function parseGitHubRemote(url: string): { owner: string; repo: string } | undefined {
  const match =
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ??
    /^(?:https|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return undefined;
  return { owner: match[1], repo: match[2] };
}

function ghLogin(gh: string): string | undefined {
  const result = spawnSync(gh, ["api", "user", "-q", ".login"], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const login = result.stdout.trim();
  return login || undefined;
}

function ghGitProtocol(gh: string): string {
  const result = spawnSync(gh, ["config", "get", "git_protocol"], { encoding: "utf8" });
  if (result.status !== 0) return "https";
  return result.stdout.trim() || "https";
}

function promptOverwriteConfig(configPath: string, existingRemote: string, newRemote: string): boolean {
  if (!process.stdin.isTTY) {
    throw new SidecarError(
      `${configPath} already exists (remote ${existingRemote}); delete it to reinitialize with ${newRemote}`,
    );
  }
  console.log(`${configPath} already exists (remote ${existingRemote})`);
  const answer = promptLine(`overwrite it with the new settings? ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}

// Non-interactive runs (CI, scripts) must not opt into anything by default;
// a missing terminal answers "no".
function promptYesNo(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = promptLine(`${question} ${paint("quiet", "[Y/n]")} `).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

// For choices that should never be arrived at by holding Enter.
function promptYesNoDefaultNo(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = promptLine(`${question} ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}

function promptLine(prompt: string): string {
  fs.writeSync(1, prompt);
  // Node keeps a TTY stdin non-blocking, so reads on fd 0 hit EAGAIN while idle.
  // Windows has no /dev/tty; CONIN$ is the console-input device there.
  const fd = fs.openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
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
  const root = gitToplevelOptional(cwd);
  if (!root) throw new SidecarError("not inside a Git repository");
  return root;
}

function gitToplevelOptional(cwd: string): string | undefined {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0) return undefined;
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
    `redaction = ${JSON.stringify(config.redaction ?? DEFAULT_REDACTION_MODE)}`,
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
    redaction: redactionModeConfigValue(
      stringConfigValue(configPath, values, "redaction", DEFAULT_REDACTION_MODE),
      configPath,
    ),
  };
  validateRemote(config.remote);
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  return config;
}

function redactionModeConfigValue(value: string, source: string): RedactionMode {
  if ((REDACTION_MODES as readonly string[]).includes(value)) return value as RedactionMode;
  throw new SidecarError(
    `${source}: invalid redaction mode ${JSON.stringify(value)}; expected one of ${REDACTION_MODES.join(", ")}`,
  );
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

// Syncs and snapshots serialize against each other rather than silently
// skipping: a concurrent holder (usually the daemon) is a hard error, so the
// command either did its work or clearly told you it didn't. In particular it
// never stamps lastSyncAt without syncing.
export function acquireSyncLockOrThrow(root: string): () => void {
  const release = acquireSyncLock(root);
  if (release) return release;
  throw new SidecarError("another sidecar sync is already running; try again once it finishes");
}

// The one place that decides what a busy lock means: "throw" for commands the
// user demanded, "skip" for soft requests that can no-op because their trigger
// will fire again. Returns whether the work ran.
export function withSyncLock(root: string, onBusy: "throw" | "skip", fn: () => void): boolean {
  const releaseLock = onBusy === "skip" ? acquireSyncLock(root) : acquireSyncLockOrThrow(root);
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

export function removeZedInclusion(root: string, sidecarPath: string): void {
  const settingsPath = path.join(root, ".zed", "settings.json");
  if (!fs.existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;
    const inclusions = settings.file_scan_inclusions;
    if (!Array.isArray(inclusions)) return;
    const glob = zedInclusionGlob(sidecarPath);
    const remaining = inclusions.filter((entry) => entry !== glob);
    if (remaining.length === inclusions.length) return;
    if (remaining.length) {
      settings.file_scan_inclusions = remaining;
    } else {
      delete settings.file_scan_inclusions;
    }
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // Zed settings may be JSONC. Leave files we cannot safely round-trip alone.
    console.error(`sidecar: warning: could not safely remove the Zed inclusion from ${settingsPath}`);
  }
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

export function git(
  repo: string,
  args: string[],
  options: { check?: boolean; input?: string } = {},
): GitResult {
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

export function gitRaw(args: string[], options: { check?: boolean; input?: string } = {}): GitResult {
  const check = options.check ?? true;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input: options.input,
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

/**
 * A standalone sidecar is one whose checkout *is* the repo (`path = "."`):
 * there is no parent to gitignore it from, and the tree the daemon syncs is
 * the tree the user works in. Everything else follows from that one fact, so
 * standalone needs no config key of its own.
 */
export function isStandalone(config: SidecarConfig): boolean {
  return isStandalonePath(config.path);
}

// Matches resolveSidecarPath's view of the same string: ".", "./" and "" all
// resolve to the root itself.
function isStandalonePath(sidecarPath: string): boolean {
  return path.normalize(sidecarPath).replace(/[/\\]+$/, "") === ".";
}

// Realpath catches symlinked spellings of the root — git reports toplevel as
// /private/var/... on macOS while the user types /var/... — that string
// resolution alone would miss.
function pathIsRepoRoot(root: string, candidate: string): boolean {
  const resolved = path.resolve(root, candidate);
  if (resolved === path.resolve(root)) return true;
  try {
    return fs.realpathSync(resolved) === fs.realpathSync(root);
  } catch {
    // Unresolvable paths cannot be the root.
    return false;
  }
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
