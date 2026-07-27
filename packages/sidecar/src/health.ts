import { redactText } from "./redaction.js";

/**
 * Fleet health: every checkout publishes a heartbeat about itself.
 *
 * A sync can fail for reasons the failing machine is the only witness to — a
 * clean filter that has gone unrunnable, a remote that rejects its push, a
 * checkout someone left mid-rebase. Until now that only reached the local log,
 * so a laptop could stop contributing for a fortnight and no other machine
 * would know. The heartbeat is the fix: each checkout writes what happened to
 * its own branch, and any machine can read the whole fleet back.
 *
 * Two properties matter, and both come from the branch layout rather than from
 * this file:
 *
 * - **Single writer.** A checkout writes only `sidecar-health/{user}/{id}`, so
 *   two machines failing at once never contend. There is no merge, no
 *   conflict, and no fork-files fallout — the alert mechanism cannot become
 *   the thing generating alerts.
 * - **Never merged.** The prefix sits outside the inbox namespace, so
 *   `mergeInboxBranches` passes over it and the main branch stays purely
 *   notes. Health is read from refs, not from a file in your tree.
 *
 * Reporting is a heartbeat rather than an alarm because absence has to mean
 * something. A file that only appears on failure cannot distinguish "healthy"
 * from "that machine has been shut for a week" — and the silent stop is the
 * failure worth catching. A machine that reports `ok` on a schedule makes its
 * own silence legible: see `classifyHealthState`.
 */

export const HEALTH_BRANCH_PREFIX = "sidecar-health/";
/** The single file each health branch carries, at the root of its tree. */
export const HEALTH_FILE = "health.json";
const HEALTH_SCHEMA = 1;

/**
 * How long a checkout may go without reporting before the fleet view calls it
 * stale. The daemon syncs every 10 minutes and refreshes its heartbeat hourly,
 * so a day of silence is ~24 missed refreshes — far outside the noise, while
 * still letting a laptop stay shut overnight without turning the view yellow.
 */
export const HEALTH_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * The floor between two unchanged heartbeats. Every sync could publish, but a
 * healthy machine syncing on the 10-minute cycle would then force-push 144
 * times a day to say nothing new. Transitions and failures ignore this floor
 * (see `shouldPublishHealth`) — it only throttles the "still fine" case.
 */
export const HEALTH_HEARTBEAT_MS = 60 * 60 * 1000;
/** Long enough to identify a git failure, short enough to stay a summary. */
const MESSAGE_LIMIT = 500;

export type HealthStatus = "ok" | "failed";

/** What a sync attempt turned out to be, before it becomes a record. */
export type HealthOutcome =
  | { status: "ok" }
  | { status: "failed"; stage: string; message: string };

/** Who is reporting — the parts of a record that don't depend on the outcome. */
export type HealthIdentity = {
  machine: string;
  /**
   * The checkout's local path. It identifies which of a machine's clones this
   * is, which `machine` alone can't do — and it is published to the remote, so
   * it goes through the same redaction as everything else here.
   */
  root: string;
  inbox: string;
  version: string;
};

export type HealthRecord = HealthIdentity & {
  schema: number;
  status: HealthStatus;
  updatedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  /** Which step of the sync threw; only present on a failing record. */
  stage?: string;
  message?: string;
};

/** How the fleet view reads a record — `stale` is derived, never stored. */
export type HealthState = HealthStatus | "stale";

export function healthBranch(user: string, checkoutId: string): string {
  return `${HEALTH_BRANCH_PREFIX}${user}/${checkoutId}`;
}

/**
 * Whether an inbox namespace would swallow the health branches.
 *
 * The merge selects branches by the inbox template's static prefix, so an
 * inbox of `sidecar-health/{user}/{random}` would drag every machine's
 * heartbeat into the main branch — precisely what the separate namespace
 * exists to prevent. Rejecting it at config-read time is cheaper than
 * explaining the resulting history.
 */
export function inboxPrefixCollidesWithHealth(inboxPrefix: string): boolean {
  const prefix = inboxPrefix.replace(/^\/+/, "");
  // Either direction is a collision: an inbox inside the health namespace, and
  // a broader one (`sidecar-`) that contains it.
  return prefix.startsWith(HEALTH_BRANCH_PREFIX) || HEALTH_BRANCH_PREFIX.startsWith(prefix);
}

export function isHealthBranch(remoteBranch: string): boolean {
  const branch = remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
  return branch.startsWith(HEALTH_BRANCH_PREFIX);
}

export function parseHealthRecord(text: string): HealthRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  // A record another version wrote is still a heartbeat: read what's legible
  // and let the missing parts be absent, rather than discarding the machine
  // from the fleet view over a field this version happens to want.
  const status = record.status === "failed" ? "failed" : record.status === "ok" ? "ok" : undefined;
  if (!status || typeof record.updatedAt !== "string") return undefined;
  return {
    schema: typeof record.schema === "number" ? record.schema : 0,
    machine: typeof record.machine === "string" ? record.machine : "unknown",
    root: typeof record.root === "string" ? record.root : "",
    inbox: typeof record.inbox === "string" ? record.inbox : "",
    version: typeof record.version === "string" ? record.version : "",
    status,
    updatedAt: record.updatedAt,
    lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : undefined,
    lastFailureAt: typeof record.lastFailureAt === "string" ? record.lastFailureAt : undefined,
    consecutiveFailures:
      typeof record.consecutiveFailures === "number" && Number.isFinite(record.consecutiveFailures)
        ? record.consecutiveFailures
        : 0,
    stage: typeof record.stage === "string" ? record.stage : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

export function serializeHealthRecord(record: HealthRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * The record this attempt should publish, given what the branch already says.
 *
 * The carry-forward is the whole point: a failing record keeps the
 * `lastSuccessAt` it inherited, so "broken since Tuesday" survives however
 * many failures follow, and a recovery clears the failure state in one write
 * without any machine having to tidy up after another.
 */
export function nextHealthRecord(
  previous: HealthRecord | undefined,
  identity: HealthIdentity,
  outcome: HealthOutcome,
  now: string,
): HealthRecord {
  const base: HealthRecord = {
    schema: HEALTH_SCHEMA,
    ...identity,
    status: outcome.status,
    updatedAt: now,
    lastSuccessAt: previous?.lastSuccessAt,
    lastFailureAt: previous?.lastFailureAt,
    consecutiveFailures: 0,
  };
  if (outcome.status === "ok") return { ...base, lastSuccessAt: now };
  return {
    ...base,
    lastFailureAt: now,
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    stage: outcome.stage,
    // The message is a git failure verbatim, and git quotes remote URLs — which
    // carry tokens. Redacting here rather than at the call site means the
    // published path cannot forget: this branch deliberately bypasses the clean
    // filter, so nothing downstream would catch it.
    message: redactText(outcome.message).trim().slice(-MESSAGE_LIMIT),
  };
}

/**
 * Whether `next` is worth a push. Failures and transitions always are —
 * everything else is the same "still fine" the branch already holds, and only
 * needs a write often enough to keep the record out of `stale`.
 */
export function shouldPublishHealth(
  previous: HealthRecord | undefined,
  next: HealthRecord,
  now = Date.now(),
): boolean {
  if (!previous) return true;
  if (next.status === "failed" || previous.status !== next.status) return true;
  const last = Date.parse(previous.updatedAt);
  if (!Number.isFinite(last)) return true;
  // A clock behind the branch's own timestamp would otherwise defer forever.
  return now - last >= HEALTH_HEARTBEAT_MS || last > now;
}

/**
 * A failing machine says so; a silent one is inferred. Staleness outranks a
 * stored `ok` because that `ok` describes a sync that stopped happening.
 */
export function classifyHealthState(
  record: HealthRecord,
  now = Date.now(),
  staleAfterMs = HEALTH_STALE_AFTER_MS,
): HealthState {
  if (record.status === "failed") return "failed";
  const updated = Date.parse(record.updatedAt);
  if (!Number.isFinite(updated)) return "stale";
  return now - updated > staleAfterMs ? "stale" : "ok";
}

/** One line for the fleet view's summary — "2 ok, 1 failed, 1 stale". */
export function summarizeHealthStates(states: HealthState[]): string {
  const counts: Record<HealthState, number> = { ok: 0, failed: 0, stale: 0 };
  for (const state of states) counts[state] += 1;
  const parts: string[] = [];
  if (counts.ok) parts.push(`${counts.ok} ok`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.stale) parts.push(`${counts.stale} stale`);
  return parts.join(", ") || "none";
}
