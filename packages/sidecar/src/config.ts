// The .sidecar config file: reading, writing, validation, and everything
// derived purely from it — project discovery, the standalone/nested split,
// checkout paths, and inbox branch naming.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { type ParsedOptions, SidecarError, currentHost, currentUser, parseDuration, realpathOr, slug } from "./util.js";
import { gitDir, gitRaw, hasGitMetadata } from "./git.js";
import { HEALTH_BRANCH_PREFIX, inboxPrefixCollidesWithHealth } from "./health.js";
import { DEFAULT_REDACTION_MODE, REDACTION_MODES, type RedactionMode } from "./redaction.js";
import { peerRulesPath, readRules, type SidecarRules } from "./rules.js";

export const DEFAULT_PATH = "sidecar";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";
const branchValidity = new Map<string, boolean>();

// ---------------------------------------------------------------------------
// Peers
//
// A repo can carry several sidecars at once: `.sidecar` is the default peer,
// and every `.sidecar.<name>` beside it is another, with its own remote,
// checkout, and settings. Peers never interact — each is registered, locked,
// watched, and synced on its own — which is what lets them differ in the one
// way a single file could not express: one committed for the whole team, one
// gitignored for this machine alone.
//
// A dot after `sidecar` names a peer; a hyphen names supporting files such
// as `.sidecar-rules` and `.sidecar-conflicts/`. The two never collide.
// ---------------------------------------------------------------------------

/** The peer `.sidecar` itself is; `--peer default` selects it. */
export const DEFAULT_PEER = "default";
/** How the daemon names the peer a spawned sync is for; commands read it as `--peer`. */
export const PEER_ENV = "SIDECAR_PEER";
const PEER_NAME = /^[a-z0-9][a-z0-9-]*$/;
// Suffixes an editor or a cautious hand puts on a copy of `.sidecar`. A swap
// file or a backup must never be read as a peer, so these names are refused at
// init and passed over at discovery.
const RESERVED_PEER_SUFFIXES = new Set(["swp", "swo", "swx", "bak", "orig", "rej", "tmp", "old", "example", "sample", "lock"]);

export type Peer = {
  root: string;
  name: string;
  configPath: string;
  config: SidecarConfig;
};

export function validatePeerName(name: string): void {
  if (name === DEFAULT_PEER) return;
  if (!PEER_NAME.test(name)) {
    throw new SidecarError(
      `invalid peer name ${JSON.stringify(name)}; use lowercase letters, digits, and hyphens, starting with a letter or digit`,
    );
  }
  if (RESERVED_PEER_SUFFIXES.has(name)) {
    throw new SidecarError(`peer name ${JSON.stringify(name)} is reserved: .sidecar.${name} reads as a copy of .sidecar, not a peer`);
  }
}

export function peerFileName(name: string): string {
  return name === DEFAULT_PEER ? ".sidecar" : `.sidecar.${name}`;
}

export function peerConfigPath(root: string, name: string): string {
  return path.join(root, peerFileName(name));
}

/** The peer a file name denotes, or undefined for anything that is not one. */
export function peerNameOf(fileName: string): string | undefined {
  if (fileName === ".sidecar") return DEFAULT_PEER;
  if (!fileName.startsWith(".sidecar.")) return undefined;
  const name = fileName.slice(".sidecar.".length);
  if (name === DEFAULT_PEER || !PEER_NAME.test(name) || RESERVED_PEER_SUFFIXES.has(name)) return undefined;
  return name;
}

/** The peers declared at `root`: the default first, the rest alphabetical. */
export function listPeerNames(root: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .map(peerNameOf)
    .filter((name): name is string => name !== undefined)
    .sort((left, right) => (left === DEFAULT_PEER ? -1 : right === DEFAULT_PEER ? 1 : left.localeCompare(right)));
}

export function loadPeer(root: string, name: string, options: { loadRules?: boolean } = {}): Peer {
  const configPath = peerConfigPath(root, name);
  return { root, name, configPath, config: readConfig(configPath, options) };
}

/** The peer a command was pointed at: `--peer` first, the daemon's env var behind it. */
export function selectedPeer(parsed: ParsedOptions): string | undefined {
  return parsed.values.get("--peer") ?? process.env[PEER_ENV] ?? undefined;
}

/**
 * The peers a command acts on, found by walking up from the cwd to the nearest
 * directory declaring any. Named, exactly that one; unnamed, all of them —
 * a command with no peer in mind means every sidecar this repo has.
 */
export function loadPeers(selection: string | undefined, options: { loadRules?: boolean } = {}): Peer[] {
  const root = findConfigRoot(process.cwd());
  const names = listPeerNames(root);
  if (selection) {
    validatePeerName(selection);
    if (!names.includes(selection)) {
      throw new SidecarError(`no ${peerFileName(selection)} in ${root}; peers here: ${names.join(", ")}`);
    }
    return [loadPeer(root, selection, options)];
  }
  const peers = names.map((name) => loadPeer(root, name, options));
  ensureDistinctCheckouts(peers);
  return peers;
}

// Two peers on one checkout would each snapshot the other's inbox branch, and
// two on one remote would merge each other's inboxes and share one fleet of
// health branches — so both collisions are refused before anything runs
// rather than found in history. Checkouts are compared as real paths: a
// symlink is the same directory under another name, and the locks that keep
// peers apart are per peer, not per directory.
export function ensureDistinctCheckouts(peers: Peer[]): void {
  const checkoutOwners = new Map<string, string>();
  const remoteOwners = new Map<string, string>();
  for (const peer of peers) {
    const checkout = realpathOr(resolveSidecarPath(peer.root, peer.config));
    const checkoutOwner = checkoutOwners.get(checkout);
    if (checkoutOwner !== undefined) {
      throw new SidecarError(
        `peers ${checkoutOwner} and ${peer.name} both use the checkout ${checkout}; give each its own --path`,
      );
    }
    checkoutOwners.set(checkout, peer.name);

    const remote = sameRemoteKey(peer.config.remote);
    const remoteOwner = remoteOwners.get(remote);
    if (remoteOwner !== undefined) {
      throw new SidecarError(
        `peers ${remoteOwner} and ${peer.name} both sync to ${peer.config.remote}; give each its own remote`,
      );
    }
    remoteOwners.set(remote, peer.name);
  }
}

/** One spelling for the ways a remote URL can differ without naming a different repository. */
function sameRemoteKey(remote: string): string {
  return remote.trim().replace(/\/+$/, "").replace(/\.git$/, "");
}

/**
 * `fork` uses Git's content merge and preserves conflicting versions as
 * separate files beside a manifest. `lww` always selects one complete parent
 * version using its original write time, even when Git could merge the edits
 * cleanly; it never combines file contents from different writers.
 */
export const RESOLVE_MODES = ["fork", "lww"] as const;
export type ResolveMode = (typeof RESOLVE_MODES)[number];
export const DEFAULT_RESOLVE: ResolveMode = "fork";

export type SidecarConfig = {
  /** Which peer this is — derived from the file name, never written into it. */
  peer: string;
  remote: string;
  version: number;
  path: string;
  branch: string;
  inbox: string;
  redaction: RedactionMode;
  resolve: ResolveMode;
  /** Loaded from the adjacent peer rules file; never serialized into .sidecar. */
  rules?: SidecarRules;
  rulesPath?: string;
  /**
   * This repo's sync cadence, in seconds, overriding the daemon's defaults:
   * `debounce` is the least time between remote round trips once edits land,
   * `interval` the most time between them while the repo is quiet. Either
   * may be absent. The daemon's own cycle is the floor on `interval`.
   */
  debounce?: number;
  interval?: number;
};

export function findConfigRoot(start: string): string {
  const root = findConfigRootOptional(start);
  if (root) return root;
  throw new SidecarError("could not find .sidecar");
}

/** The nearest directory at or above `start` declaring any peer. */
export function findConfigRootOptional(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (listPeerNames(current).length) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function writeConfig(configPath: string, config: SidecarConfig): void {
  const text = [
    `version = ${config.version}`,
    `remote = ${JSON.stringify(config.remote)}`,
    `path = ${JSON.stringify(config.path)}`,
    `branch = ${JSON.stringify(config.branch)}`,
    `inbox = ${JSON.stringify(config.inbox)}`,
    `redaction = ${JSON.stringify(config.redaction ?? DEFAULT_REDACTION_MODE)}`,
    `resolve = ${JSON.stringify(config.resolve ?? DEFAULT_RESOLVE)}`,
    ...(config.debounce === undefined ? [] : [`debounce = ${config.debounce}`]),
    ...(config.interval === undefined ? [] : [`interval = ${config.interval}`]),
    "",
  ].join("\n");
  fs.writeFileSync(configPath, text, "utf8");
}

export function readConfig(configPath: string, options: { loadRules?: boolean } = {}): SidecarConfig {
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

  const peer = peerNameOf(path.basename(configPath)) ?? DEFAULT_PEER;
  const rulesPath = peerRulesPath(path.dirname(configPath), peer);
  const config = {
    peer,
    remote,
    version: numberConfigValue(configPath, values, "version", 1),
    path: stringConfigValue(configPath, values, "path", DEFAULT_PATH),
    branch: stringConfigValue(configPath, values, "branch", DEFAULT_BRANCH),
    inbox: stringConfigValue(configPath, values, "inbox", DEFAULT_INBOX),
    redaction: redactionModeConfigValue(
      stringConfigValue(configPath, values, "redaction", DEFAULT_REDACTION_MODE),
      configPath,
    ),
    resolve: resolveModeConfigValue(stringConfigValue(configPath, values, "resolve", DEFAULT_RESOLVE), configPath),
    debounce: durationConfigValue(values.debounce, `${configPath} debounce`),
    interval: durationConfigValue(values.interval, `${configPath} interval`),
    rules: options.loadRules === false ? undefined : readRules(rulesPath),
    rulesPath,
  };
  validateRemote(config.remote);
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  // Standalone means the repo is the sidecar, and a repo can be only one thing.
  if (peer !== DEFAULT_PEER && isStandalone(config)) {
    throw new SidecarError(`${configPath}: a peer cannot be standalone (path = "."); only .sidecar can`);
  }
  return config;
}

export function redactionModeConfigValue(value: string, source: string): RedactionMode {
  if ((REDACTION_MODES as readonly string[]).includes(value)) return value as RedactionMode;
  throw new SidecarError(
    `${source}: invalid redaction mode ${JSON.stringify(value)}; expected one of ${REDACTION_MODES.join(", ")}`,
  );
}

export function durationConfigValue(value: unknown, source: string): number | undefined {
  if (value === undefined) return undefined;
  const seconds = parseDuration(value);
  if (seconds === undefined) {
    throw new SidecarError(`${source}: invalid duration ${JSON.stringify(value)}; use seconds, or a number with an s, m, or h suffix like "10m"`);
  }
  return seconds;
}

export function resolveModeConfigValue(value: string, source: string): ResolveMode {
  if ((RESOLVE_MODES as readonly string[]).includes(value)) return value as ResolveMode;
  throw new SidecarError(
    `${source}: invalid resolve mode ${JSON.stringify(value)}; expected one of ${RESOLVE_MODES.join(", ")}`,
  );
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

export function validateBranch(branch: string): void {
  let valid = branchValidity.get(branch);
  if (valid === undefined) {
    valid = gitRaw(["check-ref-format", "--branch", branch], { check: false }).status === 0;
    branchValidity.set(branch, valid);
  }
  if (!valid) throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
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

export function resolveSidecarPath(root: string, config: SidecarConfig): string {
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
export function isStandalonePath(sidecarPath: string): boolean {
  return path.normalize(sidecarPath).replace(/[/\\]+$/, "") === ".";
}

// Realpath catches symlinked spellings of the root — git reports toplevel as
// /private/var/... on macOS while the user types /var/... — that string
// resolution alone would miss.
export function pathIsRepoRoot(root: string, candidate: string): boolean {
  const resolved = path.resolve(root, candidate);
  if (resolved === path.resolve(root)) return true;
  try {
    return fs.realpathSync(resolved) === fs.realpathSync(root);
  } catch {
    // Unresolvable paths cannot be the root.
    return false;
  }
}

export function requireSidecarCheckout(root: string, config: SidecarConfig): string {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    throw new SidecarError(`missing sidecar checkout at ${sidecarPath}; run \`sidecar clone\``);
  }
  return sidecarPath;
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

export function inboxPrefix(config: SidecarConfig): string {
  return inboxBranchPrefix(config.inbox);
}

export function remoteBranchName(remoteBranch: string): string {
  return remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
}

export function matchesInboxPrefix(prefix: string, branch: string): boolean {
  return prefix.endsWith("/") ? branch.startsWith(prefix) : branch === prefix;
}

function inboxBranchPrefix(template: string): string {
  const variableIndex = template.indexOf("{");
  if (variableIndex === -1) return template.replace(/^\/+|\/+$/g, "");

  const staticPrefix = template.slice(0, variableIndex).replace(/^\/+/, "");
  const slashIndex = staticPrefix.lastIndexOf("/");
  return slashIndex === -1 ? staticPrefix : staticPrefix.slice(0, slashIndex + 1);
}
