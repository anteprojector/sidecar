import { describe, expect, test } from "vitest";

import {
  HEALTH_HEARTBEAT_MS,
  HEALTH_STALE_AFTER_MS,
  type HealthIdentity,
  type HealthRecord,
  classifyHealthState,
  healthBranch,
  inboxPrefixCollidesWithHealth,
  isHealthBranch,
  nextHealthRecord,
  parseHealthRecord,
  serializeHealthRecord,
  shouldPublishHealth,
  summarizeHealthStates,
} from "../src/health.js";

const identity: HealthIdentity = {
  machine: "zack@fox",
  root: "/Users/zack/dev/sidecar",
  inbox: "sidecar-inbox/zack/a3f9",
  version: "0.9.0",
};

const T0 = "2026-07-26T09:00:00.000Z";
const T1 = "2026-07-26T10:00:00.000Z";
const T2 = "2026-07-26T11:00:00.000Z";

function ok(updatedAt: string, overrides: Partial<HealthRecord> = {}): HealthRecord {
  return {
    schema: 1,
    ...identity,
    status: "ok",
    updatedAt,
    lastSuccessAt: updatedAt,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("health branch naming", () => {
  test("puts every checkout under its own path in the reserved namespace", () => {
    expect(healthBranch("zack", "a3f9")).toBe("sidecar-health/zack/a3f9");
    expect(isHealthBranch("sidecar-health/zack/a3f9")).toBe(true);
    expect(isHealthBranch("origin/sidecar-health/zack/a3f9")).toBe(true);
    expect(isHealthBranch("origin/sidecar-inbox/zack/a3f9")).toBe(false);
    expect(isHealthBranch("origin/main")).toBe(false);
  });

  // The merge selects by the inbox template's static prefix, so an overlapping
  // inbox would sweep every machine's heartbeat into the main branch.
  test("rejects inbox namespaces that would be merged alongside health", () => {
    expect(inboxPrefixCollidesWithHealth("sidecar-health/")).toBe(true);
    expect(inboxPrefixCollidesWithHealth("sidecar-health/team/")).toBe(true);
    expect(inboxPrefixCollidesWithHealth("sidecar-")).toBe(true);
    expect(inboxPrefixCollidesWithHealth("sidecar-inbox/")).toBe(false);
    expect(inboxPrefixCollidesWithHealth("notes")).toBe(false);
  });
});

describe("nextHealthRecord", () => {
  test("a success stamps both the report and the last-known-good time", () => {
    const record = nextHealthRecord(undefined, identity, { status: "ok" }, T0);
    expect(record.status).toBe("ok");
    expect(record.updatedAt).toBe(T0);
    expect(record.lastSuccessAt).toBe(T0);
    expect(record.consecutiveFailures).toBe(0);
  });

  // The carry-forward is the point: "broken since Tuesday" has to survive
  // however many failures follow it.
  test("a failure keeps the inherited last success and counts up", () => {
    const first = nextHealthRecord(
      ok(T0),
      identity,
      { status: "failed", stage: "snapshot", message: "filter failed" },
      T1,
    );
    expect(first.status).toBe("failed");
    expect(first.lastSuccessAt).toBe(T0);
    expect(first.lastFailureAt).toBe(T1);
    expect(first.consecutiveFailures).toBe(1);
    expect(first.stage).toBe("snapshot");

    const second = nextHealthRecord(
      first,
      identity,
      { status: "failed", stage: "snapshot", message: "filter failed" },
      T2,
    );
    expect(second.lastSuccessAt).toBe(T0);
    expect(second.consecutiveFailures).toBe(2);
  });

  test("a recovery clears the failure state in a single write", () => {
    const failed = nextHealthRecord(
      ok(T0),
      identity,
      { status: "failed", stage: "merge", message: "boom" },
      T1,
    );
    const recovered = nextHealthRecord(failed, identity, { status: "ok" }, T2);
    expect(recovered.status).toBe("ok");
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.stage).toBeUndefined();
    expect(recovered.message).toBeUndefined();
    expect(recovered.lastSuccessAt).toBe(T2);
    // Kept, so the view can still say when it last broke.
    expect(recovered.lastFailureAt).toBe(T1);
  });

  // This branch bypasses the clean filter by design, so redaction has to
  // happen here or the token in a git error reaches the remote in the clear.
  test("redacts the failure message it publishes", () => {
    const record = nextHealthRecord(
      undefined,
      identity,
      {
        status: "failed",
        stage: "push-inbox",
        message: "fatal: unable to access 'https://user:ghp_aaaaaaaaaaaaaaaaaaaaaa@github.com/x.git'",
      },
      T0,
    );
    expect(record.message).not.toContain("ghp_aaaaaaaaaaaaaaaaaaaaaa");
    expect(record.message).toContain("<SECRET>");
  });
});

describe("shouldPublishHealth", () => {
  const heartbeatAgo = (ms: number): number => Date.parse(T0) + ms;

  test("always publishes the first record, failures, and transitions", () => {
    const failed = nextHealthRecord(ok(T0), identity, { status: "failed", stage: "merge", message: "x" }, T1);
    expect(shouldPublishHealth(undefined, ok(T0))).toBe(true);
    expect(shouldPublishHealth(ok(T0), failed, heartbeatAgo(1000))).toBe(true);
    expect(shouldPublishHealth(failed, ok(T2), heartbeatAgo(1000))).toBe(true);
  });

  // A healthy machine on the 10-minute daemon cycle would otherwise force-push
  // 144 times a day to say nothing new.
  test("throttles unchanged healthy heartbeats to the refresh interval", () => {
    expect(shouldPublishHealth(ok(T0), ok(T1), heartbeatAgo(HEALTH_HEARTBEAT_MS - 1))).toBe(false);
    expect(shouldPublishHealth(ok(T0), ok(T1), heartbeatAgo(HEALTH_HEARTBEAT_MS))).toBe(true);
  });

  test("publishes rather than waiting forever when a clock runs behind the branch", () => {
    expect(shouldPublishHealth(ok(T2), ok(T2), Date.parse(T0))).toBe(true);
    expect(shouldPublishHealth({ ...ok(T0), updatedAt: "not a date" }, ok(T1))).toBe(true);
  });
});

describe("classifyHealthState", () => {
  const now = Date.parse(T2);

  test("a machine that stopped reporting is stale, not ok", () => {
    expect(classifyHealthState(ok(T2), now)).toBe("ok");
    expect(classifyHealthState(ok(T2), now + HEALTH_STALE_AFTER_MS)).toBe("ok");
    expect(classifyHealthState(ok(T2), now + HEALTH_STALE_AFTER_MS + 1)).toBe("stale");
  });

  // A stored failure is a machine telling you something; staleness is only
  // inferred, so an explicit failure keeps precedence.
  test("an explicit failure outranks age", () => {
    const failed = nextHealthRecord(ok(T0), identity, { status: "failed", stage: "merge", message: "x" }, T1);
    expect(classifyHealthState(failed, now + HEALTH_STALE_AFTER_MS * 10)).toBe("failed");
  });

  test("an unreadable timestamp reads as stale", () => {
    expect(classifyHealthState({ ...ok(T0), updatedAt: "whenever" }, now)).toBe("stale");
  });
});

describe("record round-tripping", () => {
  test("survives serialize and parse", () => {
    const record = nextHealthRecord(ok(T0), identity, { status: "failed", stage: "merge", message: "x" }, T1);
    expect(parseHealthRecord(serializeHealthRecord(record))).toEqual(record);
  });

  // A heartbeat written by another version is still a heartbeat; dropping the
  // machine from the fleet view over an unfamiliar field would hide it.
  test("reads a record missing this version's fields", () => {
    const record = parseHealthRecord(JSON.stringify({ status: "ok", updatedAt: T0 }));
    expect(record?.machine).toBe("unknown");
    expect(record?.consecutiveFailures).toBe(0);
  });

  test("rejects what isn't a record at all", () => {
    expect(parseHealthRecord("not json")).toBeUndefined();
    expect(parseHealthRecord("[]")).toBeUndefined();
    expect(parseHealthRecord(JSON.stringify({ status: "ok" }))).toBeUndefined();
    expect(parseHealthRecord(JSON.stringify({ status: "weird", updatedAt: T0 }))).toBeUndefined();
  });
});

describe("summarizeHealthStates", () => {
  test("counts only the states present", () => {
    expect(summarizeHealthStates(["ok", "ok", "failed"])).toBe("2 ok, 1 failed");
    expect(summarizeHealthStates(["stale"])).toBe("1 stale");
    expect(summarizeHealthStates([])).toBe("none");
  });
});
