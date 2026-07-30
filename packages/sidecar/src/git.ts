// Git plumbing: every spawn of the git binary goes through here, plus the
// ref/worktree predicates built on it and the "repo family" election (which
// working copy of a repo owns the shared VCS store).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { SidecarError, currentHost, currentUser, realpathOr, slug } from "./util.js";

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

export function gitToplevel(cwd: string): string {
  const root = gitToplevelOptional(cwd);
  if (!root) throw new SidecarError("not inside a Git repository");
  return root;
}

export function gitToplevelOptional(cwd: string): string | undefined {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

export function gitCommonDir(root: string): string {
  const commonDir = gitCommonDirOptional(root);
  if (!commonDir) throw new SidecarError("not inside a Git repository");
  return commonDir;
}

/** The shared git dir, or undefined where there is no git — a jj workspace. */
function gitCommonDirOptional(root: string): string | undefined {
  const result = gitRaw(["-C", root, "rev-parse", "--git-common-dir"], { check: false });
  if (result.status !== 0) return undefined;
  // Reported relative to the cwd git ran in, which is `root`.
  return path.resolve(root, result.stdout.trim());
}

export function gitDir(repo: string): string {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path.isAbsolute(result) ? result : path.resolve(repo, result);
}

export function hasGitMetadata(repo: string): boolean {
  return fs.existsSync(path.join(repo, ".git"));
}

export function isDirty(repo: string): boolean {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
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

// ---------------------------------------------------------------------------
// Repo families
//
// Several working copies of one repo — git worktrees, jj workspaces — used to
// get a full clone of the sidecar each, so two of them on one machine traded
// notes by pushing to the remote and fetching back. They share a VCS store
// already; the sidecar checkout can share one too, as a linked worktree of the
// clone held by whichever working copy owns that store.
//
// That owner is elected rather than recorded because it needs no repair: git
// and jj both die in every other working copy the moment it is deleted or
// moved, so hanging the shared checkout off it adds no failure mode they do
// not already have. Everything here degrades to undefined instead of throwing —
// an unresolvable family just means the checkout gets its own clone, which is
// what it would have had anyway.
// ---------------------------------------------------------------------------

/**
 * The root of the working copy owning this repo family's VCS store, or
 * undefined when `root` is that owner, stands alone, or cannot be resolved.
 */
export function familyPrimaryRoot(root: string): string | undefined {
  const primary = jjDefaultWorkspace(root) ?? gitMainWorktree(root);
  if (!primary) return undefined;
  return realpathOr(primary) === realpathOr(root) ? undefined : primary;
}

/**
 * jj publishes no command for this: `jj workspace list` omits paths and
 * `jj workspace root` answers for the current workspace. The layout is the only
 * route — a secondary workspace's `.jj/repo` is a file holding the path of the
 * default workspace's `.jj/repo` directory, which the default workspace has in
 * its place. Reading it is a reach into another tool's internals, so treat
 * every surprise as "no family".
 */
function jjDefaultWorkspace(root: string): string | undefined {
  const pointer = path.join(root, ".jj", "repo");
  try {
    if (!fs.statSync(pointer).isFile()) return undefined;
    const repo = path.resolve(path.dirname(pointer), fs.readFileSync(pointer, "utf8").trim());
    const workspace = path.dirname(path.dirname(repo));
    return fs.existsSync(path.join(workspace, ".jj")) ? workspace : undefined;
  } catch {
    return undefined;
  }
}

/** `git worktree list` names the main worktree first. */
function gitMainWorktree(root: string): string | undefined {
  const result = git(root, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0) return undefined;
  const entry = result.stdout.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  return entry?.slice("worktree ".length).trim() || undefined;
}
