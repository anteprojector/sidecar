import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { compileGitignoreMatcher, selectWatchTargets } from "../src/daemon.js";
import type { SidecarInstance } from "../src/cli.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("compileGitignoreMatcher", () => {
  test("matches basenames, anchored paths, directories, and globs", () => {
    const matches = compileGitignoreMatcher([
      "# comment",
      "",
      "*.log",
      "build/",
      "/top-only",
      "docs/*.tmp",
      "!keep.log",
    ]);

    expect(matches("debug.log")).toBe(true);
    expect(matches("nested/deep/debug.log")).toBe(true);
    expect(matches("debug.log.txt")).toBe(false);
    expect(matches("build")).toBe(true);
    expect(matches("build/output.txt")).toBe(true);
    expect(matches("nested/build/output.txt")).toBe(true);
    expect(matches("top-only")).toBe(true);
    expect(matches("nested/top-only")).toBe(false);
    expect(matches("docs/scratch.tmp")).toBe(true);
    expect(matches("docs/nested/scratch.tmp")).toBe(false);
    expect(matches("notes.md")).toBe(false);
    // Negations are skipped rather than honored: keep.log still matches *.log.
    expect(matches("keep.log")).toBe(true);
  });

  test("supports double-star patterns and windows separators", () => {
    const matches = compileGitignoreMatcher(["cache/**/blob", "*.swp"]);

    expect(matches("cache/a/b/blob")).toBe(true);
    expect(matches("cache/blob")).toBe(true);
    expect(matches("cache/blob/extra")).toBe(true);
    expect(matches(String.raw`nested\file.swp`)).toBe(true);
    expect(matches("cache-other/blob")).toBe(false);
  });
});

describe("selectWatchTargets", () => {
  test("keeps the most recently synced instances within the limit", () => {
    const instances = [
      makeInstance("stale", "2026-01-01T00:00:00.000Z"),
      makeInstance("recent", "2026-07-01T00:00:00.000Z"),
      makeInstance("middle", "2026-04-01T00:00:00.000Z"),
      makeInstance("never", undefined),
    ];

    const targets = selectWatchTargets(instances, 2);

    expect(targets.map((instance) => instance.root)).toEqual([instances[1].root, instances[2].root]);
  });

  test("skips instances whose config or checkout is gone", () => {
    const healthy = makeInstance("healthy", "2026-06-01T00:00:00.000Z");
    const missingCheckout = makeInstance("no-checkout", "2026-07-01T00:00:00.000Z");
    fs.rmSync(missingCheckout.sidecarPath, { recursive: true, force: true });
    const missingConfig = makeInstance("no-config", "2026-07-02T00:00:00.000Z");
    fs.rmSync(missingConfig.configPath, { force: true });

    const targets = selectWatchTargets([healthy, missingCheckout, missingConfig], 10);

    expect(targets.map((instance) => instance.root)).toEqual([healthy.root]);
  });
});

function makeInstance(name: string, lastSyncAt: string | undefined): SidecarInstance {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sidecar-unit-${name}-`));
  tempRoots.push(root);
  const configPath = path.join(root, ".sidecar");
  const sidecarPath = path.join(root, "sidecar");
  fs.writeFileSync(configPath, 'remote = "git@example.com:x.git"\n', "utf8");
  fs.mkdirSync(sidecarPath, { recursive: true });
  return {
    root,
    configPath,
    sidecarPath,
    remote: "git@example.com:x.git",
    branch: "main",
    inbox: "sidecar-inbox/test/abc",
    registeredAt: "2025-01-01T00:00:00.000Z",
    updatedAt: lastSyncAt ?? "2025-01-01T00:00:00.000Z",
    lastSyncAt,
  };
}
