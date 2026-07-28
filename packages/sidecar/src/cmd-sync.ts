// The sync-facing commands: snapshot, sync, merge, and the redaction pair
// (redactions preview, redact clean filter). Thin wrappers — the real work
// lives in sync.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { colorLevel, stripColor } from "./color.js";
import { SidecarError, getValue, nowIso, parseOptions } from "./util.js";
import { ensureCommitIdentity, git, gitRaw } from "./git.js";
import { expandInbox, loadProject, redactionModeConfigValue, requireSidecarCheckout } from "./config.js";
import { registerCurrentInstance, withSyncLock } from "./state.js";
import {
  LOCAL_SYNC_ENV,
  SOFT_SYNC_ENV,
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
import { DEFAULT_REDACTION_MODE, NO_REDACT_PRAGMA } from "./redaction.js";

export function cmdSnapshot(args: string[]): number {
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

export function cmdSync(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot", "--soft", "--local"]),
    value: new Set(["-m", "--message"]),
  });
  if (parsed.positional.length) {
    throw new SidecarError("usage: sidecar sync [--local] [--no-snapshot] [--soft] [-m message]");
  }

  const [root, config] = loadProject();
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
        // --local settles this machine and stops there: no fetch, no push, and
        // nothing that can fail because a remote is unreachable.
        remote: !parsed.flags.has("--local") && process.env[LOCAL_SYNC_ENV] !== "1",
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

export function cmdMerge(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--no-push"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
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
    remote: true,
  });
  return 0;
}

// Previews exactly what the clean filter rewrites on the next push. The
// worktree keeps originals and redaction is deterministic, so this is always
// recomputable — no redaction log to store or dedupe.
export function cmdRedactions(args: string[]): number {
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
export function cmdRedact(args: string[]): number {
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
