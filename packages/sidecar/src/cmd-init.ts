// Lifecycle commands: init, clone, and deinit, plus everything only they use —
// the interactive prompts, the .gitignore and Zed wiring in the host repo, the
// local-install offer, and global-install bootstrapping.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { paint } from "./color.js";
import {
  type ParsedOptions,
  SidecarError,
  compareVersions,
  findExecutableOnPath,
  getValue,
  nowIso,
  parseOptions,
} from "./util.js";
import {
  familyPrimaryRoot,
  fetch,
  git,
  gitToplevel,
  gitToplevelOptional,
  hasGitMetadata,
  isDirty,
} from "./git.js";
import {
  GLOBAL_EXEC_ENV,
  PACKAGE_NAME,
  PACKAGE_SPEC,
  SKIP_LOCAL_EXEC_ENV,
  findGlobalSidecarExecutable,
  globalSidecarVersion,
  packageVersion,
  projectDependsOnSidecar,
} from "./install.js";
import {
  DEFAULT_BRANCH,
  DEFAULT_INBOX,
  DEFAULT_PATH,
  type SidecarConfig,
  expandInbox,
  findConfigRootOptional,
  isStandalone,
  isStandalonePath,
  loadProject,
  pathIsRepoRoot,
  readConfig,
  redactionModeConfigValue,
  requireSidecarCheckout,
  resolveSidecarPath,
  validateBranch,
  validateInboxTemplate,
  validateRemote,
  writeConfig,
} from "./config.js";
import { readSettings, registerCurrentInstance, unregisterInstance, withSyncLock, writeSettings } from "./state.js";
import { SKIP_SERVICE_ENV, daemonServiceStatus } from "./service.js";
import {
  branchIsCheckedOut,
  checkoutIsUnlinkedFromFamily,
  cloneOrUpdate,
  familySidecarCheckout,
  refreshFamilyCheckout,
  removeRedactionFilter,
  syncProject,
  unpushedInboxCommits,
} from "./sync.js";
import { promptLine, promptYesNo, promptYesNoDefaultNo } from "./ui.js";
import { DEFAULT_REDACTION_MODE, REDACTION_MODES, type RedactionMode } from "./redaction.js";

export function cmdDeinit(args: string[]): number {
  if (args.length) throw new SidecarError("usage: sidecar deinit");

  // The config is what deinit removes, so it locates the repo the way every
  // other command does — by walking up for .sidecar. Falling back to git covers
  // the repo whose config is already gone but whose ignore entries are not; a
  // jj workspace has no git root at all and would otherwise be unremovable.
  const root = findConfigRootOptional(process.cwd()) ?? gitToplevelOptional(process.cwd());
  if (!root) {
    console.error("sidecar: warning: no .sidecar config or Git repository found; nothing to remove");
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
      removeCheckout(checkoutPath);
    }
    const ignoreEntry = ignoreEntryForSidecarPath(root, config.path);
    if (ignoreEntry) {
      removeIgnoreEntry(path.join(root, ".gitignore"), ignoreEntry);
      removeZedInclusion(root, ignoreEntry);
    }
  }
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

/**
 * Deletes a checkout, unregistering it first when it is a linked worktree: the
 * clone it hangs off would otherwise keep an admin entry that blocks a later
 * `worktree add` at the same path. A linked worktree's `.git` is a file, where
 * a clone's is a directory.
 */
function removeCheckout(checkoutPath: string): void {
  try {
    if (fs.statSync(path.join(checkoutPath, ".git")).isFile()) {
      git(checkoutPath, ["worktree", "remove", "--force", checkoutPath], { check: false });
    }
  } catch {
    // No .git at all: nothing is registered anywhere, so the delete is enough.
  }
  fs.rmSync(checkoutPath, { recursive: true, force: true });
}

export function cmdInit(args: string[]): number {
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
      syncProject(root, config, { snapshot: true, remote: true });
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

export function cmdClone(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main", "--if-missing"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar clone [--if-missing] [--no-bootstrap-main]");

  const [root, config] = loadProject();
  if (parsed.flags.has("--if-missing")) {
    const sidecarPath = resolveSidecarPath(root, config);
    if (fs.existsSync(sidecarPath) && hasGitMetadata(sidecarPath)) return 0;
  }
  cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  registerCurrentInstance(root, config, { event: "clone" });
  return 0;
}

/**
 * Rebuilds an independent secondary checkout as a linked worktree of the one its
 * repo family shares.
 *
 * This is the only thing that converts a checkout, and it only ever runs because
 * someone typed it. An unlinked checkout is slow, not broken, so nothing about it
 * justifies an unprompted rewrite of a directory holding the user's notes — the
 * install hooks and the daemon report it and leave it alone.
 *
 * Everything that has reached the remote survives; everything that has not is
 * discarded. Rather than try to rescue the difference, refuse while there is a
 * difference to rescue and name the command that removes it. `--force` is for
 * people who mean to throw the work away.
 */
export function cmdRefresh(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--force", "--yes", "-y"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar refresh [--force] [--yes]");

  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  if (!checkoutIsUnlinkedFromFamily(root, config, sidecarPath)) {
    console.log("this sidecar checkout already shares its repo family's Git store; nothing to refresh");
    return 0;
  }

  const inbox = expandInbox(config, sidecarPath);
  const primary = familyPrimaryRoot(root);
  // origin/<inbox> is what decides how much is unpushed, so it has to be current
  // before anything is counted against it. A refresh with an unreachable remote
  // can only be a --force.
  fetch(sidecarPath, true, false);
  const unpushed = unpushedInboxCommits(sidecarPath, config, inbox);
  const dirtyFiles = git(sidecarPath, ["status", "--porcelain"]).stdout.split("\n").filter(Boolean).length;

  console.log(`${paint("brand", sidecarPath)} is an independent clone of ${paint("brand", config.remote)}.`);
  if (primary) {
    console.log(`this repo family shares a sidecar checkout under ${paint("repo", primary)}.`);
  }
  console.log(
    `refresh replaces this one with a linked worktree of that checkout, ${paint("attn", "discarding anything not pushed")}.`,
  );

  if ((unpushed || dirtyFiles) && !parsed.flags.has("--force")) {
    const held = [
      unpushed ? `${unpushed} commit(s) the remote has not seen` : "",
      dirtyFiles ? `${dirtyFiles} uncommitted file(s)` : "",
    ].filter(Boolean);
    throw new SidecarError(
      `this checkout still holds ${held.join(" and ")}; run \`sidecar sync\` to push them, then refresh — or \`sidecar refresh --force\` to discard them`,
    );
  }

  const primaryCheckout = familySidecarCheckout(root, config);
  if (primaryCheckout && branchIsCheckedOut(primaryCheckout, inbox)) {
    // Git allows one worktree to hold a branch, so the rebuilt worktree could not
    // take its inbox back. Checked before anything is removed, never after.
    throw new SidecarError(
      `${inbox} is already checked out elsewhere in this repo family; give this working copy its own inbox (an {random} in the .sidecar inbox template) before refreshing`,
    );
  }

  const confirmed =
    parsed.flags.has("--yes") ||
    parsed.flags.has("-y") ||
    promptYesNoDefaultNo(`replace ${sidecarPath}?`);
  if (!confirmed) {
    // A non-TTY lands here too: an unattended refresh has to be asked for in the
    // arguments, never inferred from a prompt nobody could answer.
    console.log("nothing changed");
    return 0;
  }

  withSyncLock(root, "throw", () => {
    // Re-read under the lock: the prompt above is unbounded, and a sync or an
    // agent could have written to the checkout while it sat there.
    if (!parsed.flags.has("--force") && isDirty(sidecarPath)) {
      throw new SidecarError("the sidecar checkout changed while waiting for confirmation; rerun refresh");
    }
    refreshFamilyCheckout(root, config);
  });
  registerCurrentInstance(root, config, { event: "refresh" });
  console.log(`refreshed sidecar checkout at ${paint("brand", sidecarPath)}`);
  return 0;
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

export function ensureSidecarIgnored(root: string, sidecarPath: string): string | undefined {
  const entry = ignoreEntryForSidecarPath(root, sidecarPath);
  if (!entry) return undefined;
  ensureIgnoreEntry(path.join(root, ".gitignore"), entry);
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
