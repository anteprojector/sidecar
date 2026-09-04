// The refresh command: delete this repo's sidecar checkout and clone it again,
// or — in standalone mode, where the checkout is the user's own repo — put
// sidecar's wiring back and settle onto the remote's state.
//
// Everything refresh needs lives here rather than in sync.ts. Nothing else calls
// it: it is the one path that destroys a checkout, and keeping the destructive
// half of the codebase in one file is worth more than filing each helper next to
// the engine function it resembles.
import fs from "node:fs";
import path from "node:path";

import { paint } from "./color.js";
import { type ParsedOptions, SidecarError, parseOptions, realpathOr, slug, utcTimestamp } from "./util.js";
import {
  branchExists,
  ensureCommitIdentity,
  fetch,
  git,
  hasAnyCommit,
  isDirty,
} from "./git.js";
import {
  type Peer,
  type SidecarConfig,
  expandInbox,
  isStandalone,
  loadPeers,
  requireSidecarCheckout,
  resolveSidecarPath,
  selectedPeer,
} from "./config.js";
import { logSidecarEvent, registerCurrentInstance, withSyncLock } from "./state.js";
import {
  cloneOrUpdate,
  ensureInboxBranch,
  ensureMainBranch,
  ensureRedactionFilter,
  familySidecarCheckout,
} from "./sync.js";
import { announcePeer, promptYesNoDefaultNo } from "./ui.js";

/**
 * Which of a repo's worktrees holds a branch, if any.
 *
 * Git allows one worktree to hold a branch, so this is what lets a refresh fail as
 * a precondition rather than partway through. It answers with the path rather than
 * a boolean because the checkout being refreshed is itself in the list — a caller
 * that cannot tell the holder from itself refuses every rebuild of a checkout that
 * was already linked.
 */
export function worktreeHoldingBranch(repo: string, branch: string): string | undefined {
  const result = git(repo, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0) return undefined;
  let current: string | undefined;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length).trim();
    else if (line === `branch refs/heads/${branch}`) return current;
  }
  return undefined;
}

/**
 * Whether the checkout is a Git repository in its own right.
 *
 * Not `rev-parse --git-dir`: a checkout whose `.git` is corrupt is not a repo, and
 * git's discovery then walks up and answers for the repo the checkout sits inside.
 * Every later status and rev-list would describe the user's own repo instead of
 * the sidecar — and a guard that reads the wrong repo is worse than no guard.
 */
export function checkoutIsOwnRepo(sidecarPath: string): boolean {
  const top = git(sidecarPath, ["rev-parse", "--show-toplevel"], { check: false });
  if (top.status !== 0) return false;
  return realpathOr(top.stdout.trim()) === realpathOr(sidecarPath);
}

/**
 * How many commits this checkout holds that no branch on the remote has.
 *
 * Measured against every origin ref at once rather than against origin/<inbox>,
 * because a settled checkout is legitimately ahead of its own inbox branch: a sync
 * merges the inbox into main, pushes main, then fast-forwards the inbox to it. Those
 * commits are on the remote under another name, and counting them as unpushed would
 * make refresh refuse forever right after a successful sync.
 */
export function unpushedCommits(sidecarPath: string): number {
  if (!hasAnyCommit(sidecarPath)) return 0;
  const counted = git(sidecarPath, ["rev-list", "--count", "HEAD", "--not", "--remotes=origin"], {
    check: false,
  });
  return counted.status === 0 ? Number(counted.stdout.trim()) || 0 : 0;
}

/**
 * Checkouts hanging off this one as linked worktrees — the ones that deleting it
 * would break. Empty unless this checkout owns the store: asked of a linked
 * worktree, `worktree list` answers for the whole family.
 */
export function dependentWorktrees(sidecarPath: string): string[] {
  try {
    if (!fs.statSync(path.join(sidecarPath, ".git")).isDirectory()) return [];
  } catch {
    return [];
  }
  const result = git(sidecarPath, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0) return [];
  const self = realpathOr(sidecarPath);
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((entry) => entry && realpathOr(entry) !== self);
}

/**
 * This checkout's id without requiring it to be a working repo.
 *
 * Deliberately forgiving: a checkout too broken to answer `git rev-parse` is one
 * of the things refresh exists to replace, and a lost id costs only a new inbox
 * branch name.
 */
function existingCheckoutId(sidecarPath: string): string | undefined {
  const candidates: string[] = [];
  const reported = git(sidecarPath, ["rev-parse", "--git-dir"], { check: false });
  if (reported.status === 0) candidates.push(path.resolve(sidecarPath, reported.stdout.trim()));
  candidates.push(path.join(sidecarPath, ".git"));
  for (const candidate of candidates) {
    try {
      const id = slug(fs.readFileSync(path.join(candidate, "sidecar-id"), "utf8"));
      if (id) return id;
    } catch {
      // Next candidate; a missing or unreadable id is not an error here.
    }
  }
  return undefined;
}

/**
 * Deletes the sidecar checkout and clones it again from scratch.
 *
 * Deliberately blunt, and deliberately without a rescue path. Whatever a sync has
 * pushed comes back on its own — cloneOrUpdate rebuilds the checkout the way this
 * working copy would have got it in the first place, tracking the same inbox
 * branch off the remote — so the caller's job is to be sure a sync has run, which
 * is what `sidecar refresh` refuses without. Buying that with the user's
 * confirmation rather than with ref surgery is the point: there is no step here
 * that can half-succeed and leave the repo worse than it found it.
 *
 * Being blunt is also what makes it general. A checkout can be wrong in more ways
 * than sidecar has repairs for — an independent clone that should be a linked
 * worktree, a wedged merge, a corrupt object store, a wrong origin, a diverged
 * main — and rebuilding fixes all of them without having to name any of them.
 *
 * The checkout id is the one thing carried across. It names the inbox branch and
 * the health branch, and nothing prunes abandoned ones from the remote, so a
 * fresh id would strand this checkout's pushed history under a name no machine
 * claims again and leave a machine in `sidecar health` that never reports.
 */
export function refreshCheckout(root: string, config: SidecarConfig): void {
  const sidecarPath = resolveSidecarPath(root, config);

  // Both guards sit on the delete rather than in the caller because this is the
  // only recursive delete in the codebase, and `path` is a committed config value
  // that nothing validates on read — until refresh, no code path deleted the
  // sidecar path outright, so a wrong one could not cost anything.
  if (isStandalone(config)) {
    throw new SidecarError("refusing to delete a standalone sidecar, which is the repo itself");
  }
  const relative = path.relative(root, sidecarPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SidecarError(`refusing to delete ${sidecarPath}, which is not inside ${root}`);
  }

  const checkoutId = existingCheckoutId(sidecarPath);
  fs.rmSync(sidecarPath, { recursive: true, force: true });
  // Something may still hold an admin entry for the path this checkout occupied:
  // the family's clone if it was a linked worktree, or the family's clone again
  // if an earlier refresh died between the remove and the add. `worktree add`
  // refuses a path it still has registered, so clear it before rebuilding.
  const family = familySidecarCheckout(root, config);
  if (family) {
    git(family, ["worktree", "prune", "--expire", "now"], { check: false });
    // A clone fetches on its own, but a linked worktree inherits whatever the
    // shared store last fetched — which can be older than this checkout's last
    // push. ensureInboxBranch reads those refs to choose where the rebuilt inbox
    // starts, so a stale origin/<inbox> would fork it off an older main and the
    // pushed history refresh is relying on would only return on a later merge.
    // Fetching in the family's checkout updates the very refs the new worktree
    // will read, which keeps this in refresh rather than in the clone path.
    fetch(family, true, false);
  }

  cloneOrUpdate(root, config, true, { checkoutId });
  logSidecarEvent("checkout-refresh", { root, sidecarPath, checkoutId: checkoutId ?? null });
}

/**
 * The standalone answer to the same question, where deleting the checkout is not
 * on the table: it is the user's own repo, with their own source in it.
 *
 * So instead of rebuilding, re-establish. Rewire the redaction filter, settle the
 * canonical branch onto the remote's copy — ensureMainBranch parks a diverged tip
 * under refs/sidecar-discarded/ on its way past — and put the checkout back on
 * its inbox branch. `resetInbox` goes one step further and moves the inbox back
 * to the canonical branch, which is the only thing that clears an inbox that has
 * diverged; the tip it drops is parked the same way.
 *
 * Returns what it declined to do, for the caller to report.
 */
export function refreshStandaloneCheckout(
  root: string,
  config: SidecarConfig,
  resetInbox: boolean,
): string | undefined {
  ensureCommitIdentity(root);
  ensureRedactionFilter(root, config.redaction);
  fetch(root, true, false);

  // Switching materializes committed blobs, and under redaction those are the
  // redacted versions while the working tree still holds the originals — the same
  // reason deinit refuses to switch a standalone repo back to its canonical branch.
  // Settling costs two switches, off the inbox and back onto it, so under redaction
  // the rewire above is the whole of a standalone refresh. Git happens to refuse
  // the second switch itself, which is not a guarantee worth leaning on and leaves
  // the repo parked off its inbox branch when it does.
  if (config.redaction !== "none") {
    logSidecarEvent("checkout-refresh", { root, standalone: true, settled: false });
    return `left ${config.branch} and the inbox branch untouched: settling them means switching branches, which under redaction would replace local files with their redacted pushed contents`;
  }

  ensureMainBranch(root, config);
  const inbox = expandInbox(config, root);
  // After ensureMainBranch the checkout is on the canonical branch, so the inbox
  // is not checked out and can be moved.
  if (resetInbox && branchExists(root, inbox) && branchExists(root, config.branch)) {
    const tip = git(root, ["rev-parse", "--short", inbox]).stdout.trim();
    const discarded = `refs/sidecar-discarded/${inbox}/${utcTimestamp()}-${tip}`;
    git(root, ["update-ref", discarded, inbox], { check: false });
    git(root, ["branch", "-f", inbox, config.branch]);
    console.log(`reset ${paint("brand", inbox)} to ${config.branch}; old tip kept at ${paint("brand", discarded)}`);
  }
  ensureInboxBranch(root, config, inbox);
  logSidecarEvent("checkout-refresh", { root, standalone: true, settled: true, resetInbox });
  return undefined;
}

/**
 * Rebuilds this repo's sidecar checkout from the remote.
 *
 * The blunt instrument, and the only thing that converts or replaces a checkout —
 * it runs because someone typed it, never because an install hook or the daemon
 * decided to. Being blunt is what makes it general: a checkout can be wrong in
 * more ways than sidecar has repairs for, and deleting it fixes all of them
 * without having to name any of them.
 *
 * Everything that has reached the remote survives; everything that has not is
 * discarded. Rather than try to rescue the difference, refuse while there is a
 * difference to rescue and name the command that removes it. `--force` is for
 * people who mean to throw the work away.
 *
 * Standalone has no checkout to delete — the repo itself is the sidecar, source
 * and all — so there it re-establishes instead of rebuilding. See
 * refreshStandaloneCheckout.
 */
export function cmdRefresh(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--force", "--yes", "-y"]),
    value: new Set(["--peer"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar refresh [--force] [--yes] [--peer name]");

  // One peer at a time, like deinit: this deletes a checkout, and with several
  // declared and none named, guessing would delete one the user did not mean.
  const selection = selectedPeer(parsed);
  const peers = loadPeers(selection);
  if (!selection && peers.length > 1) {
    const names = peers.map((peer) => peer.name).join(", ");
    throw new SidecarError(`this repo has several sidecar peers (${names}); name the one to refresh with --peer`);
  }
  announcePeer(peers[0], peers);
  refreshPeer(peers[0], parsed);
  return 0;
}

function refreshPeer({ root, config, name }: Peer, parsed: ParsedOptions): void {
  const force = parsed.flags.has("--force");
  const standalone = isStandalone(config);
  const sidecarPath = requireSidecarCheckout(root, config);

  // A checkout too broken to answer git is one of the things refresh exists to
  // replace. It is also one whose contents cannot be weighed, so it takes an
  // explicit --force rather than a silent assumption that nothing was in there.
  const readable = checkoutIsOwnRepo(sidecarPath);
  if (!readable && standalone) {
    throw new SidecarError(
      `${sidecarPath} is not a readable Git repository, and in standalone mode that repo is your own — sidecar will not rebuild it`,
    );
  }
  if (!readable && !force) {
    throw new SidecarError(
      `${sidecarPath} is not a readable Git repository, so what it still holds cannot be checked; \`sidecar refresh --force\` replaces it anyway`,
    );
  }

  let inbox: string | undefined;
  if (readable) {
    inbox = expandInbox(config, sidecarPath);
    // origin/<inbox> is what decides how much is unpushed, so it has to be as
    // current as the network allows before anything is counted against it. A
    // stale one over-counts, which errs toward refusing.
    fetch(sidecarPath, true, false);
    const unpushed = unpushedCommits(sidecarPath);
    const dirtyFiles = git(sidecarPath, ["status", "--porcelain"], { check: false })
      .stdout.split("\n")
      .filter(Boolean).length;
    if ((unpushed || dirtyFiles) && !force) {
      const held = [
        unpushed ? `${unpushed} commit(s) the remote has not seen` : "",
        dirtyFiles ? `${dirtyFiles} uncommitted file(s)` : "",
      ].filter(Boolean);
      throw new SidecarError(
        `this checkout still holds ${held.join(" and ")}; run \`sidecar sync\` to push them, then refresh — or \`sidecar refresh --force\` to discard them`,
      );
    }
  }

  if (standalone) {
    console.log(`${paint("repo", root)} is its own sidecar, so refresh does not rebuild it.`);
    console.log(
      config.redaction === "none"
        ? `it rewires the redaction filter and settles ${config.branch} onto ${paint("brand", `origin/${config.branch}`)}${
            force ? `, then resets the inbox branch to ${config.branch}` : ""
          }.`
        : `it rewires the redaction filter and, because redaction is on, leaves your branches where they are.`,
    );
  } else {
    // Deleting a checkout that owns the store strands every linked worktree of
    // it, which is a much bigger blast radius than the one repo being refreshed.
    const dependents = dependentWorktrees(sidecarPath);
    if (dependents.length && !force) {
      throw new SidecarError(
        `${dependents.length} other checkout(s) share this one's Git store (${dependents.join(", ")}); refresh those working copies instead, or \`sidecar refresh --force\` to replace this one and leave them to be refreshed too`,
      );
    }

    const family = familySidecarCheckout(root, config);
    const holder = inbox && family ? worktreeHoldingBranch(family, inbox) : undefined;
    // This checkout holding its own inbox is the normal case, not a collision.
    if (holder && realpathOr(holder) !== realpathOr(sidecarPath)) {
      // Git allows one worktree to hold a branch, so the rebuilt checkout could
      // not take its inbox back. Checked before anything is removed, never after.
      throw new SidecarError(
        `${inbox} is already checked out at ${holder}; give this working copy its own inbox (a {random} in the .sidecar inbox template) before refreshing`,
      );
    }

    console.log(
      `refresh deletes ${paint("brand", sidecarPath)} and clones it again from ${paint("brand", config.remote)}, ${paint("attn", "discarding anything not pushed")}.`,
    );
    if (family) console.log(`the rebuilt checkout will share this repo family's Git store.`);
  }

  const confirmed = parsed.flags.has("--yes") || parsed.flags.has("-y") || promptYesNoDefaultNo("continue?");
  if (!confirmed) {
    // A non-TTY lands here too: an unattended refresh has to be asked for in the
    // arguments, never inferred from a prompt nobody could answer.
    console.log("nothing changed");
    return;
  }

  let declined: string | undefined;
  withSyncLock(root, name, "throw", () => {
    // Re-read under the lock: the prompt above is unbounded, and a sync or an
    // agent could have written to the checkout while it sat there.
    if (readable && !force && isDirty(sidecarPath)) {
      throw new SidecarError("the sidecar checkout changed while waiting for confirmation; rerun refresh");
    }
    if (standalone) declined = refreshStandaloneCheckout(root, config, force);
    else refreshCheckout(root, config);
  });
  registerCurrentInstance(root, config, { event: "refresh" });
  console.log(`refreshed sidecar at ${paint("brand", sidecarPath)}`);
  // A closing warning rather than a failure, the way deinit reports the steps it
  // would not take: the refresh did everything it was willing to do.
  if (declined) console.error(`sidecar: ${declined}`);
}

