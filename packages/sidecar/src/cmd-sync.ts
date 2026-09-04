// The sync-facing commands: snapshot, sync, merge, and the redaction pair
// (redactions preview, redact clean filter). Thin wrappers — the real work
// lives in sync.ts. Each acts on every peer the command was pointed at.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { colorLevel, stripColor } from "./color.js";
import { SidecarError, getValue, nowIso, parseOptions } from "./util.js";
import { ensureCommitIdentity, git, gitRaw } from "./git.js";
import {
  type Peer,
  expandInbox,
  loadPeers,
  redactionModeConfigValue,
  requireSidecarCheckout,
  resolveSidecarPath,
  selectedPeer,
} from "./config.js";
import { registerCurrentInstance, withSyncLock } from "./state.js";
import {
  LOCAL_SYNC_ENV,
  SOFT_SYNC_ENV,
  checkoutIsUnlinkedFromFamily,
  checkoutRedactionPolicy,
  ensureInboxBranch,
  ensureRedactionFilter,
  fileRedactionDelta,
  mergeInboxBranches,
  pushBranch,
  redactBuffer,
  reportSyncHealth,
  snapshot,
  syncBranchBeforePush,
  syncProject,
} from "./sync.js";
import { DEFAULT_REDACTION_MODE } from "./redaction.js";
import { readRules, resolveFileRules } from "./rules.js";
import { announcePeer } from "./ui.js";

export function cmdSnapshot(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--push"]),
    value: new Set(["-m", "--message", "--peer"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar snapshot [--push] [-m message] [--peer name]");

  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    const { root, config } = peer;
    const sidecarPath = requireSidecarCheckout(root, config);
    // Snapshotting while a daemon sync is mid-merge would commit on whatever
    // branch the merge has checked out, so take the same lock syncs use.
    withSyncLock(root, peer.name, "throw", () => {
      const inbox = expandInbox(config, sidecarPath);
      ensureCommitIdentity(sidecarPath);
      ensureRedactionFilter(sidecarPath, config.redaction, config);
      ensureInboxBranch(sidecarPath, config, inbox);
      const committed = snapshot(
        sidecarPath,
        root,
        inbox,
        getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
        config.redaction,
        config,
      );
      if (committed && parsed.flags.has("--push")) {
        syncBranchBeforePush(sidecarPath, inbox, config);
        pushBranch(sidecarPath, inbox);
      }
    });
  }
  return 0;
}

export function cmdSync(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot", "--soft", "--local"]),
    value: new Set(["-m", "--message", "--peer"]),
  });
  if (parsed.positional.length) {
    throw new SidecarError("usage: sidecar sync [--local] [--no-snapshot] [--soft] [-m message] [--peer name]");
  }

  // Peers never interact, so one failing must not stop the rest: every peer
  // gets its turn, and the failures are reported together at the end.
  const peers = loadPeers(selectedPeer(parsed), { loadRules: false });
  const failed: string[] = [];
  for (const peer of peers) {
    announcePeer(peer, peers);
    try {
      if (peer.config.rulesPath) peer.config.rules = readRules(peer.config.rulesPath);
      syncPeer(peer, parsed);
    } catch (error) {
      if (peers.length === 1) throw error;
      failed.push(peer.name);
      console.error(`sidecar: ${peer.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed.length) {
    throw new SidecarError(`${failed.length} of ${peers.length} peers failed to sync: ${failed.join(", ")}`);
  }
  return 0;
}

function syncPeer(peer: Peer, parsed: ReturnType<typeof parseOptions>): void {
  const { root, config } = peer;
  // A soft sync is a request, not a demand: the daemon issues them, and one
  // that loses the lock to a running sync can no-op because the interval or
  // watcher will simply request again. A manual sync must never pretend.
  const soft = parsed.flags.has("--soft") || process.env[SOFT_SYNC_ENV] === "1";
  const remote = !parsed.flags.has("--local") && process.env[LOCAL_SYNC_ENV] !== "1";
  // Which step was in flight when a sync threw, so the heartbeat can say
  // "failed at snapshot" rather than only "failed".
  let stage = "start";
  let synced: boolean;
  try {
    synced = withSyncLock(root, peer.name, soft ? "skip" : "throw", () => {
      syncProject(root, config, {
        snapshot: !parsed.flags.has("--no-snapshot"),
        // --local settles this machine and stops there: no fetch, no push, and
        // nothing that can fail because a remote is unreachable.
        remote,
        message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
        onStage: (name) => {
          stage = name;
        },
      });
      // Local settling is useful activity, but only a completed remote phase
      // establishes when this checkout last synchronized with other machines.
      registerCurrentInstance(root, config, remote
        ? { event: "sync", lastSyncAt: nowIso() }
        : { event: "sync-local" });
    });
  } catch (error) {
    if (remote) reportSyncHealth(root, config, {
      status: "failed",
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  // A soft sync that lost the lock never attempted anything, so it has nothing
  // to report; the sync holding the lock will report for this checkout.
  if (synced) {
    if (remote) reportSyncHealth(root, config, { status: "ok" });
    // Only on a sync someone asked for. The daemon runs the same command on its
    // interval, where a standing note about a working checkout is log noise.
    if (!soft) {
      const sidecarPath = resolveSidecarPath(root, config);
      if (checkoutIsUnlinkedFromFamily(root, config, sidecarPath)) {
        console.log(
          "sidecar: this checkout is an independent clone, so it settles with its siblings through the remote; `sidecar refresh` links it to the one this repo family shares",
        );
      }
    }
  }
}

export function cmdMerge(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--no-push"]),
    value: new Set(["--peer"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push] [--peer name]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
  }
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    const { root, config } = peer;
    const sidecarPath = requireSidecarCheckout(root, config);
    withSyncLock(root, peer.name, "throw", () => {
      // Filter wiring mutates the shared Git config too, so keep it under
      // the same lock as the merge and its temporary worktree cleanup.
      ensureRedactionFilter(sidecarPath, config.redaction, config);
      mergeInboxBranches(sidecarPath, config, {
        forkFiles: parsed.flags.has("--fork-files"),
        push: !parsed.flags.has("--no-push"),
        remote: true,
      });
    });
  }
  return 0;
}

// Previews exactly what the clean filter rewrites on the next push. The
// worktree keeps originals and redaction is deterministic, so this is always
// recomputable — no redaction log to store or dedupe.
export function cmdRedactions(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(), value: new Set(["--peer"]) });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar redactions [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    printPeerRedactions(peer);
  }
  return 0;
}

function printPeerRedactions({ root, config }: Peer): void {
  const sidecarPath = requireSidecarCheckout(root, config);
  // NUL-delimited names preserve Unicode and embedded newlines; unmerged
  // entries repeat per stage, hence the Set.
  const files = [
    ...new Set(
      git(sidecarPath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .stdout.split("\0")
        .filter(Boolean),
    ),
  ];
  let shown = 0;
  let items = 0;
  for (const relPath of files) {
    const delta = fileRedactionDelta(path.join(sidecarPath, relPath), config.redaction, { rules: config.rules, relativePath: relPath });
    if (!delta) continue;
    if (shown) console.log("");
    console.log(`${relPath}:`);
    printRedactionDiff(delta.text, delta.redacted);
    shown += 1;
    items += delta.items;
  }

  if (!shown) {
    console.log(`no redactions pending (default: ${config.redaction}; path rules applied)`);
    return;
  }
  console.log(
    `\n${items} redaction(s) in ${shown} file(s) will be pushed this way (default: ${config.redaction}; path rules applied).`,
  );
  console.log("local files are untouched; redaction is controlled by the peer's configuration and rules");
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
// on stdin, redacted content on stdout. Binary and non-UTF-8 input pass
// through untouched.
export function cmdRedact(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--checkout-policy"]),
    value: new Set(["--mode", "--rules", "--path"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar redact [--mode mode] [--rules file --path path]");
  const checkoutPolicy = parsed.flags.has("--checkout-policy");
  if (checkoutPolicy && (parsed.values.has("--mode") || parsed.values.has("--rules"))) {
    throw new SidecarError("--checkout-policy cannot be combined with --mode or --rules");
  }
  const mode = redactionModeConfigValue(getValue(parsed, "--mode", DEFAULT_REDACTION_MODE), "--mode");
  const rulesPath = parsed.values.get("--rules");
  const effective = checkoutPolicy
    ? checkoutRedactionPolicy(process.cwd())
    : { mode, rules: rulesPath ? readRules(path.resolve(rulesPath)) : [] };
  const relativePath = parsed.values.get("--path");
  if ((checkoutPolicy || rulesPath) && !relativePath) throw new SidecarError("redaction rules require --path");
  const effectiveMode = relativePath
    ? resolveFileRules(effective.rules, relativePath, { resolve: "fork", redaction: effective.mode }).redaction
    : effective.mode;
  const output = redactBuffer(fs.readFileSync(0), effectiveMode);
  // stdout is a pipe to git, and pipe writes are async on macOS — a buffered
  // process.stdout.write can be truncated by process.exit, committing a
  // corrupted blob. Write synchronously.
  let offset = 0;
  while (offset < output.length) {
    offset += fs.writeSync(1, output, offset, output.length - offset);
  }
  return 0;
}
