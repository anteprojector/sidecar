import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, test, vi } from "vitest";

import { compileGitignoreMatcher, refreshWatchers, scheduleFor, selectWatchTargets, watchIgnoreMatcher } from "../src/daemon.js";
import type { SidecarInstance } from "../src/cli.js";
import * as cli from "../src/cli.js";

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("chokidar", () => ({ watch }));

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  watch.mockReset();
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
    expect(matches("build")).toBe(false);
    expect(matches("build/")).toBe(true);
    expect(matches("build/output.txt")).toBe(true);
    expect(matches("nested/build/output.txt")).toBe(true);
    expect(matches("top-only")).toBe(true);
    expect(matches("nested/top-only")).toBe(false);
    expect(matches("docs/scratch.tmp")).toBe(true);
    expect(matches("docs/nested/scratch.tmp")).toBe(false);
    expect(matches("notes.md")).toBe(false);
    expect(matches("keep.log")).toBe(false);
    expect(matches("nested/keep.log")).toBe(false);
  });

  test("supports double-star patterns and native path separators", () => {
    const matches = compileGitignoreMatcher(["cache/**/blob", "*.swp"]);

    expect(matches("cache/a/b/blob")).toBe(true);
    expect(matches("cache/blob")).toBe(true);
    expect(matches("cache/blob/extra")).toBe(true);
    expect(matches(path.join("nested", "file.swp"))).toBe(true);
    expect(matches("cache-other/blob")).toBe(false);
  });

  test("applies negations in order and requires excluded parents to be reopened", () => {
    const matches = compileGitignoreMatcher([
      "*.md", "!keep.md", "private/keep.md", "closed/", "!closed/keep.md",
      "open/*", "!open/notes/", "open/notes/*", "!open/notes/keep.md",
    ]);
    expect(matches("keep.md")).toBe(false);
    expect(matches("private/keep.md")).toBe(true);
    expect(matches("closed/keep.md")).toBe(true);
    expect(matches("open/notes/")).toBe(false);
    expect(matches("open/notes/keep.md")).toBe(false);
    expect(matches("open/notes/draft.md")).toBe(true);
  });

  test("preserves escapes, significant spaces, character classes, and case", () => {
    const matches = compileGitignoreMatcher([
      String.raw`\#literal`, String.raw`\!literal`, String.raw`space\ `,
      " leading", "trailing   ", "report[0-9].txt", "secret?.txt", "UPPER",
    ]);
    expect(matches("#literal")).toBe(true);
    expect(matches("!literal")).toBe(true);
    expect(matches("space ")).toBe(true);
    expect(matches("space")).toBe(false);
    expect(matches(" leading")).toBe(true);
    expect(matches("leading")).toBe(false);
    expect(matches("trailing")).toBe(true);
    expect(matches("report3.txt")).toBe(true);
    expect(matches("reporta.txt")).toBe(false);
    expect(matches("secret1.txt")).toBe(true);
    expect(matches("secret12.txt")).toBe(false);
    expect(matches("upper")).toBe(false);
    expect(matches("UPPER")).toBe(true);
    expect(matches("")).toBe(false);
    expect(matches("../outside")).toBe(false);
  });
});

describe("watchIgnoreMatcher", () => {
  test("uses directory stats before pruning and always watches root ignore rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-watch-ignore-"));
    tempRoots.push(root);
    fs.writeFileSync(path.join(root, ".gitignore"), "*\n!notes/\nnotes/*\n!notes/keep.md\n!cache\ncache/\n!file-dir\nfile-dir/\n");
    fs.mkdirSync(path.join(root, "notes"));
    fs.mkdirSync(path.join(root, "cache"));
    fs.writeFileSync(path.join(root, "notes/keep.md"), "keep");
    fs.writeFileSync(path.join(root, "notes/drop.md"), "drop");
    fs.writeFileSync(path.join(root, "file-dir"), "not a directory");
    const matches = watchIgnoreMatcher(root);
    const check = (relative: string) => {
      const candidate = path.join(root, relative);
      return matches(candidate, fs.statSync(candidate));
    };

    expect(matches(path.join(root, "notes"))).toBe(false);
    expect(check("notes")).toBe(false);
    expect(check("notes/keep.md")).toBe(false);
    expect(check("notes/drop.md")).toBe(true);
    expect(check("cache")).toBe(true);
    expect(check("file-dir")).toBe(false);
    expect(check(".gitignore")).toBe(false);
    expect(matches(path.join(root, ".git"))).toBe(true);
    expect(matches(path.join(root, ".git/config"))).toBe(true);
    expect(matches(path.join(root, "../outside"))).toBe(true);
  });

  test("does not mistake a filename beginning with two dots for a parent path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-watch-ignore-"));
    tempRoots.push(root);
    fs.writeFileSync(path.join(root, "..notes"), "keep");
    const candidate = path.join(root, "..notes");
    expect(watchIgnoreMatcher(root)(candidate, fs.statSync(candidate))).toBe(false);
  });
});

describe("watcher refresh", () => {
  test("reloads changed rules and queues refresh requests made during another refresh", async () => {
    const instance = makeInstance("reload", undefined);
    const ignorePath = path.join(instance.sidecarPath, ".gitignore");
    fs.writeFileSync(ignorePath, "notes/\n");
    fs.mkdirSync(path.join(instance.sidecarPath, "notes"));
    const notesPath = path.join(instance.sidecarPath, "notes");
    const notesStats = fs.statSync(notesPath);
    const instances = vi.spyOn(cli, "readInstances").mockReturnValue([instance]);
    vi.spyOn(cli, "logSidecarEvent").mockImplementation(() => undefined);

    const initial = Object.assign(new EventEmitter(), { close: vi.fn(async () => undefined) });
    const replacement = Object.assign(new EventEmitter(), { close: vi.fn(async () => undefined) });
    watch.mockReturnValueOnce(initial).mockReturnValueOnce(replacement);
    const state: Parameters<typeof refreshWatchers>[0] = {
      options: { once: false, intervalSeconds: 600, debounceSeconds: 60 },
      // Mark the peer as syncing so events queue another sync without spawning anything.
      syncing: new Set([instance.configPath]), syncingFamilies: new Set(),
      lastRemoteSyncAt: new Map(), remoteTimers: new Map(), pendingTimers: new Map(),
      trailingPending: new Set(), failures: new Map(), skipUntilCycle: new Map(),
      misses: new Map(), watchers: new Map(), cycleCount: 0, lastWatchCount: -1,
      refreshing: false, refreshPending: false, staleNotified: false,
    };
    await refreshWatchers(state);
    expect(watch.mock.calls[0][1].ignored(notesPath, notesStats)).toBe(true);

    let finishClose!: () => void;
    const stale = {
      on: vi.fn(),
      close: vi.fn(() => new Promise<void>((resolve) => { finishClose = resolve; })),
    };
    state.watchers.set("removed-peer", stale);
    const inProgress = refreshWatchers(state);
    await vi.waitFor(() => expect(stale.close).toHaveBeenCalledOnce());

    fs.writeFileSync(ignorePath, "notes/*\n!notes/keep.md\n");
    initial.emit("all", "change", ignorePath);
    await vi.waitFor(() => expect(state.refreshPending).toBe(true));
    expect(initial.close).toHaveBeenCalledOnce();

    finishClose();
    await inProgress;
    expect(instances).toHaveBeenCalledTimes(3);
    expect(state.refreshing).toBe(false);
    expect(state.refreshPending).toBe(false);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(state.watchers.get(instance.configPath)).toBe(replacement);
    const reloaded = watch.mock.calls[1][1].ignored;
    expect(reloaded(notesPath, notesStats)).toBe(false);
    const fileStats = fs.statSync(ignorePath);
    expect(reloaded(path.join(notesPath, "keep.md"), fileStats)).toBe(false);
    expect(reloaded(path.join(notesPath, "drop.md"), fileStats)).toBe(true);
    expect(state.trailingPending.has(instance.configPath)).toBe(true);
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

describe("scheduleFor", () => {
  const defaults = { once: false, intervalSeconds: 600, debounceSeconds: 60 };

  test("takes the repo's own debounce and interval, with the daemon cycle as the floor on interval", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-schedule-"));
    tempRoots.push(root);
    fs.writeFileSync(path.join(root, ".sidecar"), 'remote = "git@github.com:org/repo.git"\ndebounce = "10m"\ninterval = "1h"\n', "utf8");
    expect(scheduleFor(path.join(root, ".sidecar"), defaults)).toEqual({ debounceSeconds: 600, intervalSeconds: 3600 });
    fs.writeFileSync(path.join(root, ".sidecar"), 'remote = "git@github.com:org/repo.git"\ninterval = 30\n', "utf8");
    expect(scheduleFor(path.join(root, ".sidecar"), defaults)).toEqual({ debounceSeconds: 60, intervalSeconds: 600 });
  });

  test("falls back to the daemon defaults when the config is absent or unreadable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-schedule-"));
    tempRoots.push(root);
    expect(scheduleFor(path.join(root, ".sidecar"), defaults)).toEqual({ debounceSeconds: 60, intervalSeconds: 600 });
    fs.writeFileSync(path.join(root, ".sidecar"), "remote = [\n", "utf8");
    expect(scheduleFor(path.join(root, ".sidecar"), defaults)).toEqual({ debounceSeconds: 60, intervalSeconds: 600 });
  });
});
