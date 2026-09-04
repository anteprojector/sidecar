// The sync engine: snapshot, inbox merging, conflict forking, checkout
// cloning and settling, the redaction clean filter wiring, and the fleet
// health heartbeat. Commands and the daemon drive this; it owns every write
// to the sidecar checkout and its remote.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paint } from "./color.js";
import { SidecarError, currentHost, currentUser, nowIso, realpathOr, slug, utcTimestamp } from "./util.js";
import {
  branchExists,
  ensureClean,
  ensureCommitIdentity,
  familyPrimaryRoot,
  fetch,
  git,
  gitBytes,
  gitCommonDir,
  gitDir,
  gitRaw,
  hasAnyCommit,
  hasGitMetadata,
  isAncestor,
  isDirty,
  remoteRefExists,
} from "./git.js";
import { packageVersion } from "./install.js";
import {
  type SidecarConfig,
  checkoutRandom,
  expandInbox,
  inboxPrefix,
  isStandalone,
  matchesInboxPrefix,
  readConfig,
  remoteBranchName,
  requireSidecarCheckout,
  resolveSidecarPath,
} from "./config.js";
import { logSidecarEvent, sidecarStateDir } from "./state.js";
import {
  HEALTH_FILE,
  type HealthIdentity,
  type HealthOutcome,
  type HealthRecord,
  type HealthState,
  classifyHealthState,
  healthBranch,
  isHealthBranch,
  nextHealthRecord,
  parseHealthRecord,
  serializeHealthRecord,
  shouldPublishHealth,
} from "./health.js";
import {
  DEFAULT_REDACTION_MODE,
  NO_REDACT_PRAGMA,
  type RedactionMode,
  countRedactionPlaceholders,
  hasNoRedactPragma,
  redactText,
} from "./redaction.js";

// An env var rather than a flag so the daemon can request soft syncs from
// older pinned project-local CLIs, which ignore it instead of rejecting an
// unknown option.
export const SOFT_SYNC_ENV = "SIDECAR_SYNC_SOFT";
// Likewise a variable rather than a flag: the daemon settles this machine far
// more often than it talks to the remote, and a pinned older CLI has to be able
// to ignore the request instead of rejecting an option it never heard of.
export const LOCAL_SYNC_ENV = "SIDECAR_SYNC_LOCAL";

/**
 * A sync in two phases, local first. Runs inside the repo's sync lock —
 * callers hold it via withSyncLock.
 *
 * The local phase captures this checkout's edits and settles them across every
 * working copy on this machine, touching nothing but the shared object store.
 * The remote phase then trades the same work with the other machines. Running
 * them in that order is what makes local collaboration independent of the
 * network: by the time a push can fail, the sibling worktrees are already
 * current, so an unreachable remote or an expired credential no longer stops
 * two agents on one laptop from seeing each other's notes.
 */
export function syncProject(
  root: string,
  config: SidecarConfig,
  options: { snapshot: boolean; remote: boolean; message?: string; onStage?: (stage: string) => void },
): void {
  const stage = (name: string): void => options.onStage?.(name);

  stage("checkout");
  const sidecarPath = ensureSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);

  stage("snapshot");
  if (options.snapshot) {
    snapshot(sidecarPath, root, inbox, options.message, config.redaction);
  } else {
    // Without a snapshot nothing else repairs a stale filter command, and
    // required=true would fail every git status until one runs.
    ensureRedactionFilter(sidecarPath, config.redaction);
  }

  // The local phase exists to bring sibling working copies current early, before
  // anything that can fail on the network. With no siblings there is nothing to
  // bring current, and the remote phase performs the same merge on its way past,
  // so a lone checkout — every standalone repo, and most others — skips it and
  // pays only the ref lookup. A local-only sync always runs it: there is no
  // second phase behind it to do the work.
  const siblings = siblingCheckouts(sidecarPath, config);
  if (siblings.length || !options.remote) {
    stage("merge-local");
    mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: false, remote: false });
    stage("settle");
    settleCheckouts(sidecarPath, config, inbox, siblings);
  }
  if (!options.remote) return;

  stage("push-inbox");
  syncBranchBeforePush(sidecarPath, inbox);
  pushBranch(sidecarPath, inbox);
  stage("merge");
  mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: true, remote: true });
  stage("settle-remote");
  settleCheckouts(sidecarPath, config, inbox, siblings);
}

/**
 * Brings this checkout and its siblings up to the main branch as it now stands.
 *
 * Propagation is the cheap half of a sync and deliberately carries no debounce
 * of its own: the objects are already in the shared store, so each sibling is
 * one fast-forward and a working-tree write from current. It runs as the tail
 * of whichever phase advanced the branch, which is to say exactly as often as
 * there is something to move.
 *
 * Siblings are best effort. One mid-edit is dirty and gets skipped — its own
 * watcher reconciles it moments later — and no sibling may fail the sync that
 * is only doing it a favour.
 */
function settleCheckouts(
  sidecarPath: string,
  config: SidecarConfig,
  inbox: string,
  siblings: string[],
): void {
  refreshInboxFromMain(sidecarPath, config, inbox);

  let settled = 0;
  for (const sibling of siblings) {
    // Dirty is the only reason left to pass one over: siblingCheckouts already
    // narrowed these to checkouts sidecar owns. An edit in flight is transient,
    // so leave it for that checkout's own next sync.
    if (isDirty(sibling)) continue;
    if (git(sibling, ["merge", "--ff-only", config.branch], { check: false }).status === 0) settled += 1;
  }
  if (settled) logSidecarEvent("settle", { sidecarPath, siblings: settled });
}

/**
 * The other working copies of this sidecar on this machine.
 *
 * Asked of git rather than of the instance registry: the worktree list is the
 * authoritative set, it needs no bookkeeping to stay true, and it is right even
 * where the registry is unavailable.
 */
function siblingCheckouts(sidecarPath: string, config: SidecarConfig): string[] {
  const result = git(sidecarPath, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0) return [];
  const self = realpathOr(sidecarPath);
  const prefix = inboxPrefix(config);

  // Only a checkout parked on an inbox branch is sidecar's. That rules out the
  // detached merge scratch worktree, one mid-switch on the main branch, and — in
  // a standalone repo, where the sidecar is the user's own repo — the user's own
  // worktrees, whatever branch they hold. Narrowing here rather than at the
  // point of use keeps the count honest: it is what decides whether the local
  // phase is worth running at all, and worktrees it would never settle used to
  // buy a whole merge pass that settled nothing.
  //
  // The listing already names each branch, so this costs no extra git call. A
  // detached worktree has no branch line and so is never collected.
  const siblings: string[] = [];
  let checkout = "";
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      checkout = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      const branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      if (checkout && realpathOr(checkout) !== self && matchesInboxPrefix(prefix, branch)) {
        siblings.push(checkout);
      }
    }
  }
  return siblings;
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
export function reportSyncHealth(root: string, config: SidecarConfig, outcome: HealthOutcome): void {
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
export function readFleetHealth(sidecarPath: string): FleetHealthEntry[] {
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

export function mergeInboxBranches(
  sidecarPath: string,
  config: SidecarConfig,
  options: { forkFiles: boolean; push: boolean; remote: boolean },
): number {
  ensureClean(sidecarPath);
  ensureCommitIdentity(sidecarPath);

  // Most syncs have no merge work. Detect that from refs alone, before paying
  // for a worktree checkout — asking exactly what the merge loop would ask, so
  // the two cannot disagree: is any inbox branch still outside local main? A
  // local merge sees only what this machine holds and does not fetch; a remote
  // one fetches first, so the same question also covers the other machines.
  if (options.remote) fetch(sidecarPath, false);
  if (!hasPendingInboxWork(sidecarPath, config)) {
    // Nothing to merge, but the local phase advances main before the remote
    // phase runs, so main is routinely owed to the remote with no merge behind
    // it. Sending a branch needs no checkout — and so needs no worktree. A
    // rejected push means another machine moved main and this is a real
    // reconcile after all, so fall through and do it properly.
    if (options.push && !mainMatchesRemote(sidecarPath, config)) {
      const push = git(sidecarPath, ["push", "origin", `refs/heads/${config.branch}:refs/heads/${config.branch}`], {
        check: false,
      });
      if (push.status === 0) {
        console.log(`pushed ${config.branch}`);
        return 0;
      }
      console.log(`push of ${config.branch} was rejected; refetching and retrying`);
    } else {
      console.log("no inbox branches to merge");
      return 0;
    }
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

/** Whether any inbox branch still sits outside the local main branch. */
function hasPendingInboxWork(repo: string, config: SidecarConfig): boolean {
  const main = `refs/heads/${config.branch}`;
  return pendingInboxBranches(repo, config).some((branch) => !isAncestor(repo, branch, main));
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
    // Nothing left to merge is not the same as nothing left to do: the local
    // phase merges into main before the remote phase runs, so by here the work
    // is routinely already in main and still owed to the remote.
    const mainOwedToRemote = options.push && !mainMatchesRemote(sidecarPath, config);
    if (!inboxBranches.length && !mainOwedToRemote && attempt === 1) {
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

      if (config.resolve === "lww") {
        resolveLastWriterWins(sidecarPath, remoteBranch);
        git(sidecarPath, ["commit", "-m", `Merge ${remoteBranch}, last writer wins`]);
        merged.push(remoteBranch);
        continue;
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

/**
 * The family primary's own sidecar checkout, created if it does not exist yet.
 *
 * Creating it is the point: a secondary is as likely to run `sidecar clone`
 * first as the primary is — a fresh jj workspace does exactly that through
 * postinstall — and the worktree it needs has to hang off something. A primary
 * that declares no sidecar, or a different one, is not ours to populate.
 */
function familySidecarCheckout(root: string, config: SidecarConfig): string | undefined {
  const primary = familyPrimaryRoot(root);
  if (!primary) return undefined;

  let primaryConfig: SidecarConfig;
  try {
    primaryConfig = readConfig(path.join(primary, ".sidecar"));
  } catch {
    return undefined;
  }
  if (primaryConfig.remote !== config.remote) return undefined;

  const primaryPath = resolveSidecarPath(primary, primaryConfig);
  if (path.resolve(primaryPath) === path.resolve(primary)) return undefined;
  if (!hasGitMetadata(primaryPath)) cloneOrUpdate(primary, primaryConfig, true);
  return hasGitMetadata(primaryPath) ? primaryPath : undefined;
}

/**
 * Reconnects a linked checkout whose worktree pointer went stale, which is what
 * moving the repo on disk does to every linked worktree — git's own included.
 * Repair needs the new path spelled out; the argument-less form does not find
 * it.
 */
function repairLinkedCheckout(root: string, config: SidecarConfig, sidecarPath: string): void {
  if (git(sidecarPath, ["rev-parse", "--git-dir"], { check: false }).status === 0) return;

  const primaryPath = familySidecarCheckout(root, config);
  if (primaryPath && git(primaryPath, ["worktree", "repair", sidecarPath], { check: false }).status === 0) {
    logSidecarEvent("checkout-repair", { root, sidecarPath });
    return;
  }
  // Unrepairable here: a moved repo breaks the working copy this checkout hangs
  // off before it breaks the checkout, and that has to be fixed first. Say so —
  // every git call from here reports something else as the problem.
  throw new SidecarError(
    `sidecar checkout at ${sidecarPath} is not a usable Git checkout; if this repo moved, repair it there first (\`git worktree repair\`), or delete the checkout and run \`sidecar clone\``,
  );
}

/**
 * An old secondary checkout may be a full clone from before repo-family
 * linking worked. A clone's .git is a directory; a linked worktree's is a
 * file. Only secondaries with the same committed sidecar remote are eligible.
 */
function checkoutNeedsFamilyRelink(root: string, config: SidecarConfig, sidecarPath: string): boolean {
  if (isStandalone(config)) return false;
  try {
    if (!fs.statSync(path.join(sidecarPath, ".git")).isDirectory()) return false;
  } catch {
    return false;
  }

  const primary = familyPrimaryRoot(root);
  if (!primary) return false;
  try {
    const primaryConfig = readConfig(path.join(primary, ".sidecar"));
    return primaryConfig.remote === config.remote;
  } catch {
    return false;
  }
}

function branchIsCheckedOut(repo: string, branch: string): boolean {
  const result = git(repo, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0) return false;
  return result.stdout.split(/\r?\n/).some((line) => line === `branch refs/heads/${branch}`);
}

/**
 * Converts a secondary's independent clone into a linked worktree.
 *
 * Everything recoverable from Git is imported into private refs before the
 * old checkout moves. Dirty files are snapshotted first. The original clone is
 * renamed, never deleted in place, so any failure can put it straight back.
 * Ignored files are not part of a snapshot; where any exist, the backup is
 * deliberately retained and reported instead of guessing that they are safe
 * to discard.
 */
function maybeRelinkFamilyCheckout(root: string, config: SidecarConfig, sidecarPath: string): boolean {
  if (!checkoutNeedsFamilyRelink(root, config, sidecarPath)) return false;

  const primaryPath = familySidecarCheckout(root, config);
  if (!primaryPath) return false;
  if (realpathOr(gitCommonDir(primaryPath)) === realpathOr(gitCommonDir(sidecarPath))) return false;

  let backupPath: string | undefined;
  let previousInbox: string | undefined;
  let inboxRef = "";
  try {
    const inbox = expandInbox(config, sidecarPath);
    if (isDirty(sidecarPath)) {
      snapshot(sidecarPath, root, inbox, "sidecar snapshot before workspace relink", config.redaction);
    }
    ensureClean(sidecarPath);

    const checkoutId = checkoutRandom(sidecarPath);
    const token = `${utcTimestamp()}-${crypto.randomBytes(4).toString("hex")}`;
    const recoveryRoot = `refs/sidecar-relinked/${checkoutId}/${token}`;
    const recoveryInbox = `${recoveryRoot}/heads/${inbox}`;
    inboxRef = `refs/heads/${inbox}`;

    if (branchIsCheckedOut(primaryPath, inbox)) {
      throw new SidecarError(`${inbox} is already checked out in this sidecar family`);
    }

    const imported = git(
      primaryPath,
      ["fetch", "--no-tags", sidecarPath, `+refs/heads/*:${recoveryRoot}/heads/*`],
      { check: false },
    );
    if (imported.status !== 0) {
      throw new SidecarError(imported.stderr.trim() || "could not preserve the existing sidecar refs");
    }

    const preservedHead = git(primaryPath, ["rev-parse", "--verify", recoveryInbox]).stdout.trim();
    const previous = git(primaryPath, ["rev-parse", "--verify", inboxRef], { check: false });
    previousInbox = previous.status === 0 ? previous.stdout.trim() : undefined;
    git(primaryPath, ["update-ref", inboxRef, preservedHead]);

    const ignored = git(sidecarPath, ["ls-files", "--others", "--ignored", "--exclude-standard"], {
      check: false,
    });
    const keepBackup = ignored.status !== 0 || Boolean(ignored.stdout.trim());

    const recoveryDir = path.join(sidecarStateDir(), "recovery");
    fs.mkdirSync(recoveryDir, { recursive: true });
    backupPath = path.join(recoveryDir, `${slug(path.basename(root))}-${checkoutId}-${token}`);
    fs.renameSync(sidecarPath, backupPath);

    git(primaryPath, ["worktree", "add", "--detach", sidecarPath, preservedHead]);
    fs.writeFileSync(path.join(gitDir(sidecarPath), "sidecar-id"), `${checkoutId}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    ensureInboxBranch(sidecarPath, config, inbox);

    const linkedHead = git(sidecarPath, ["rev-parse", "HEAD"]).stdout.trim();
    if (linkedHead !== preservedHead) throw new SidecarError("relinked checkout did not preserve HEAD");
    if (realpathOr(gitCommonDir(sidecarPath)) !== realpathOr(gitCommonDir(primaryPath))) {
      throw new SidecarError("relinked checkout did not join the shared Git store");
    }

    if (keepBackup) {
      console.error(`sidecar: kept the previous checkout at ${backupPath} because it contains ignored files`);
    } else {
      try {
        fs.rmSync(backupPath, { recursive: true, force: true });
        backupPath = undefined;
      } catch {
        console.error(`sidecar: could not remove the previous checkout; kept it at ${backupPath}`);
      }
    }
    logSidecarEvent("checkout-relink", { root, sidecarPath, backupPath: backupPath ?? null });
    console.log(`relinked sidecar checkout for this repo family`);
    return true;
  } catch (error) {
    if (backupPath && fs.existsSync(backupPath) && fs.existsSync(sidecarPath)) {
      git(primaryPath, ["worktree", "remove", "--force", sidecarPath], { check: false });
      fs.rmSync(sidecarPath, { recursive: true, force: true });
    }
    if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(sidecarPath)) {
      try {
        fs.renameSync(backupPath, sidecarPath);
        backupPath = undefined;
      } catch {
        // The warning below names the retained backup when rollback cannot.
      }
    }
    if (inboxRef) {
      if (previousInbox) git(primaryPath, ["update-ref", inboxRef, previousInbox], { check: false });
      else git(primaryPath, ["update-ref", "-d", inboxRef], { check: false });
    }

    const message = error instanceof Error ? error.message : String(error);
    const recovery = backupPath ? `; previous checkout kept at ${backupPath}` : "";
    console.error(`sidecar: could not relink this checkout: ${message}${recovery}`);
    logSidecarEvent("failure", { command: "checkout-relink", root, sidecarPath, message, backupPath });
    return false;
  }
}

export function cloneIfMissing(root: string, config: SidecarConfig, bootstrapMain: boolean): boolean {
  const sidecarPath = resolveSidecarPath(root, config);
  if (
    fs.existsSync(sidecarPath) &&
    hasGitMetadata(sidecarPath) &&
    !checkoutNeedsFamilyRelink(root, config, sidecarPath)
  ) {
    return false;
  }
  cloneOrUpdate(root, config, bootstrapMain);
  return true;
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
    const primaryPath = familySidecarCheckout(root, config);
    // Detached, because the inbox branch is named after this worktree's own git
    // dir — which does not exist until the worktree does. ensureInboxBranch
    // below puts it on its branch.
    if (primaryPath) git(primaryPath, ["worktree", "add", "--detach", sidecarPath]);
    else gitRaw(["clone", "--", config.remote, sidecarPath]);
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
  if (maybeRelinkFamilyCheckout(root, config, sidecarPath)) {
    ensureCommitIdentity(sidecarPath);
    ensureRedactionFilter(sidecarPath, config.redaction);
    ensureInboxBranch(sidecarPath, config, inbox);
  }
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

export function ensureSidecarCheckout(root: string, config: SidecarConfig): string {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    cloneOrUpdate(root, config, true);
  } else {
    repairLinkedCheckout(root, config, sidecarPath);
    if (checkoutNeedsFamilyRelink(root, config, sidecarPath)) {
      cloneOrUpdate(root, config, true);
    }
  }
  return requireSidecarCheckout(root, config);
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
export function fileRedactionDelta(
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

export function redactBuffer(data: Buffer, mode: RedactionMode): Buffer {
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

/**
 * Last writer wins, per path: the side whose most recent commit touching the
 * path is newer keeps the file, the other side's blob is dropped from the tree
 * and named in the manifest (it stays reachable in the inbox branch that
 * carried it). A tie goes to the incoming branch — the merge was asked to
 * bring it in. A side that deleted the path wins by deleting it.
 */
export function resolveLastWriterWins(repo: string, remoteBranch: string): void {
  const conflicts = unmergedPaths(repo);
  if (!Object.keys(conflicts).length) {
    throw new SidecarError("merge reported conflicts, but no unmerged paths were found");
  }

  const timestamp = utcTimestamp();
  const branch = remoteBranchName(remoteBranch) || remoteBranch;
  const manifest: LastWriterManifest = { timestamp, resolved_by: "lww", source_branch: branch, paths: [] };

  for (const [conflictPath, stages] of Object.entries(conflicts).sort(([left], [right]) => left.localeCompare(right))) {
    const ours = lastWriteAt(repo, "HEAD", conflictPath);
    const theirs = lastWriteAt(repo, remoteBranch, conflictPath);
    const winner = theirs >= ours ? 3 : 2;
    const loser = winner === 3 ? 2 : 3;
    const blob = showStage(repo, winner, conflictPath);
    const full = path.join(repo, conflictPath);
    if (blob) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, blob);
      git(repo, ["add", "--", conflictPath]);
    } else {
      git(repo, ["rm", "-f", "--ignore-unmatch", "--", conflictPath], { check: false });
      if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.unlinkSync(full);
    }
    manifest.paths.push({
      path: conflictPath,
      kept: winner === 3 ? branch : "main",
      kept_at: winner === 3 ? theirs : ours,
      dropped: winner === 3 ? "main" : branch,
      dropped_oid: stages[loser] ?? "",
    });
  }

  const manifestDir = path.join(repo, ".sidecar-conflicts");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, `${timestamp}-${fileLabel(branch)}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  git(repo, ["add", "-A"]);
  if (hasUnmergedPaths(repo)) {
    throw new SidecarError("last-writer-wins did not clear all unmerged paths");
  }
  console.log(`resolved ${manifest.paths.length} conflict(s) by last writer`);
}

type LastWriterManifest = {
  timestamp: string;
  resolved_by: "lww";
  source_branch: string;
  paths: Array<{ path: string; kept: string; kept_at: number; dropped: string; dropped_oid: string }>;
};

/** Unix time of the last commit on `ref` that touched the path; 0 when none did (the path was never committed there). */
function lastWriteAt(repo: string, ref: string, filePath: string): number {
  const result = git(repo, ["log", "-1", "--format=%ct", ref, "--", filePath], { check: false });
  return Number(result.stdout.trim()) || 0;
}

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

/**
 * Every inbox branch this checkout can reach, local heads as well as
 * remote-tracking refs.
 *
 * The local half is what lets checkouts sharing a clone see each other without
 * the remote: a sibling worktree's snapshot is committed here the moment it is
 * taken, so its branch is readable — and fresher than origin — before any push
 * happens. A name held in both places is listed once, local first, for the same
 * reason.
 */
export function pendingInboxBranches(repo: string, config: SidecarConfig): string[] {
  const prefix = inboxPrefix(config);
  const local = refNames(repo, "refs/heads/").filter((branch) => matchesInboxPrefix(prefix, branch));
  const claimed = new Set(local);
  const remote = refNames(repo, "refs/remotes/origin/").filter((ref) => {
    const branch = remoteBranchName(ref);
    return ref !== "origin/HEAD" && matchesInboxPrefix(prefix, branch) && !claimed.has(branch);
  });
  return [...local, ...remote].sort();
}

function refNames(repo: string, namespace: string): string[] {
  return git(repo, ["for-each-ref", "--format=%(refname:short)", namespace])
    .stdout.split(/\r?\n/)
    .map((ref) => ref.trim())
    .filter(Boolean);
}
