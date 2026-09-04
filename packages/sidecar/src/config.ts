// The .sidecar config file: reading, writing, validation, and everything
// derived purely from it — project discovery, the standalone/nested split,
// checkout paths, and inbox branch naming.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { SidecarError, currentHost, currentUser, slug } from "./util.js";
import { gitDir, gitRaw, hasGitMetadata } from "./git.js";
import { HEALTH_BRANCH_PREFIX, inboxPrefixCollidesWithHealth } from "./health.js";
import { DEFAULT_REDACTION_MODE, REDACTION_MODES, type RedactionMode } from "./redaction.js";

export const DEFAULT_PATH = "sidecar";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";

/**
 * What a merge does when two machines edited the same file. `fork` keeps
 * every version as separate files beside a manifest (the default: nothing is
 * ever lost, at the cost of a fork the user must fold back). `lww` keeps the
 * side whose last commit to that path is newer and records the dropped
 * version's oid in the manifest — right for a tree with one writer at a time,
 * where a conflict means two machines briefly overlapped and the newer state
 * is the one that matters.
 */
export const RESOLVE_MODES = ["fork", "lww"] as const;
export type ResolveMode = (typeof RESOLVE_MODES)[number];
export const DEFAULT_RESOLVE: ResolveMode = "fork";

export type SidecarConfig = {
  remote: string;
  version: number;
  path: string;
  branch: string;
  inbox: string;
  redaction: RedactionMode;
  resolve: ResolveMode;
};

export function loadProject(): [string, SidecarConfig] {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path.join(root, ".sidecar"))];
}

export function findConfigRoot(start: string): string {
  const root = findConfigRootOptional(start);
  if (root) return root;
  throw new SidecarError("could not find .sidecar");
}

export function findConfigRootOptional(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar"))) return current;
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
    resolve: resolveModeConfigValue(stringConfigValue(configPath, values, "resolve", DEFAULT_RESOLVE), configPath),
  };
  validateRemote(config.remote);
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  return config;
}

export function redactionModeConfigValue(value: string, source: string): RedactionMode {
  if ((REDACTION_MODES as readonly string[]).includes(value)) return value as RedactionMode;
  throw new SidecarError(
    `${source}: invalid redaction mode ${JSON.stringify(value)}; expected one of ${REDACTION_MODES.join(", ")}`,
  );
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
