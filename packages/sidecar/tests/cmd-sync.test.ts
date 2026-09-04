import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config.js")>(),
  loadPeers: vi.fn(),
  requireSidecarCheckout: vi.fn(() => "/project/sidecar"),
}));
vi.mock("../src/state.js", () => ({
  registerCurrentInstance: vi.fn(),
  withSyncLock: vi.fn(),
}));
vi.mock("../src/sync.js", async (original) => ({
  ...await original<typeof import("../src/sync.js")>(),
  checkoutIsUnlinkedFromFamily: vi.fn(() => false),
  ensureRedactionFilter: vi.fn(),
  mergeInboxBranches: vi.fn(),
  reportSyncHealth: vi.fn(),
  syncProject: vi.fn(),
}));
vi.mock("../src/ui.js", () => ({ announcePeer: vi.fn() }));
vi.mock("../src/rules.js", async (original) => ({
  ...await original<typeof import("../src/rules.js")>(),
  readRules: vi.fn(() => []),
}));

import { cmdMerge, cmdSync } from "../src/cmd-sync.js";
import { readRules } from "../src/rules.js";
import { loadPeers, type Peer } from "../src/config.js";
import { registerCurrentInstance, withSyncLock } from "../src/state.js";
import { ensureRedactionFilter, mergeInboxBranches, reportSyncHealth, syncProject } from "../src/sync.js";

const peer: Peer = {
  name: "default", root: "/project", configPath: "/project/.sidecar",
  config: { remote: "unused", path: "sidecar", branch: "main", inbox: "sidecar-inbox/{user}/{random}", resolve: "fork", redaction: "none", peer: "default" },
};
let locked = false;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SIDECAR_SYNC_LOCAL", "");
  vi.stubEnv("SIDECAR_SYNC_SOFT", "");
  vi.mocked(loadPeers).mockReturnValue([peer]);
  vi.mocked(withSyncLock).mockImplementation((_root, _peer, _mode, callback) => {
    locked = true;
    try { callback(); } finally { locked = false; }
    return true;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("manual merge locking", () => {
  test("holds the sync lock for filter wiring and the entire merge", () => {
    vi.mocked(ensureRedactionFilter).mockImplementation(() => { expect(locked).toBe(true); return false; });
    vi.mocked(mergeInboxBranches).mockImplementation(() => { expect(locked).toBe(true); return 0; });
    cmdMerge(["--fork-files", "--no-push"]);
    expect(withSyncLock).toHaveBeenCalledWith(peer.root, peer.name, "throw", expect.any(Function));
    expect(ensureRedactionFilter).toHaveBeenCalledOnce();
    expect(mergeInboxBranches).toHaveBeenCalledOnce();
  });
  test("a busy lock prevents both filter changes and merging", () => {
    vi.mocked(withSyncLock).mockImplementation(() => { throw new Error("busy"); });
    expect(() => cmdMerge(["--fork-files"])).toThrow("busy");
    expect(ensureRedactionFilter).not.toHaveBeenCalled();
    expect(mergeInboxBranches).not.toHaveBeenCalled();
  });
});

describe.each(["flag", "environment"])("local sync via %s", (source) => {
  function run(): number {
    if (source === "environment") vi.stubEnv("SIDECAR_SYNC_LOCAL", "1");
    return cmdSync(source === "flag" ? ["--local"] : []);
  }
  test("settles locally without publishing health or stamping remote success", () => {
    vi.mocked(registerCurrentInstance).mockImplementation(() => { expect(locked).toBe(true); });
    expect(run()).toBe(0);
    expect(syncProject).toHaveBeenCalledWith(peer.root, peer.config, expect.objectContaining({ remote: false }));
    expect(registerCurrentInstance).toHaveBeenCalledWith(peer.root, peer.config, { event: "sync-local" });
    expect(reportSyncHealth).not.toHaveBeenCalled();
  });
  test("does not publish failure health", () => {
    vi.mocked(syncProject).mockImplementation(() => { throw new Error("snapshot failed"); });
    expect(run).toThrow("snapshot failed");
    expect(reportSyncHealth).not.toHaveBeenCalled();
    expect(registerCurrentInstance).not.toHaveBeenCalled();
  });
});

test("remote sync still stamps success and publishes health", () => {
  cmdSync([]);
  expect(registerCurrentInstance).toHaveBeenCalledWith(peer.root, peer.config, { event: "sync", lastSyncAt: expect.any(String) });
  expect(reportSyncHealth).toHaveBeenCalledWith(peer.root, peer.config, { status: "ok" });
});

test("soft sync skipped by its lock reports no activity or health", () => {
  vi.mocked(withSyncLock).mockReturnValue(false);
  cmdSync(["--soft"]);
  expect(syncProject).not.toHaveBeenCalled();
  expect(registerCurrentInstance).not.toHaveBeenCalled();
  expect(reportSyncHealth).not.toHaveBeenCalled();
});


test("invalid rules fail only their peer and leave healthy peers running", () => {
  const bad = { ...peer, name: "bad", config: { ...peer.config, peer: "bad", rulesPath: "/project/.sidecar-rules.bad" } };
  const healthy = { ...peer, name: "healthy", config: { ...peer.config, peer: "healthy", rulesPath: "/project/.sidecar-rules.healthy" } };
  vi.mocked(loadPeers).mockReturnValue([bad, healthy]);
  vi.mocked(readRules).mockImplementation((filePath) => {
    if (filePath.endsWith(".bad")) throw new Error("rules are not valid TOML");
    return [];
  });
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => cmdSync(["--local"])).toThrow("1 of 2 peers failed to sync: bad");
    expect(loadPeers).toHaveBeenCalledWith(undefined, { loadRules: false });
    expect(syncProject).toHaveBeenCalledOnce();
    expect(syncProject).toHaveBeenCalledWith(healthy.root, healthy.config, expect.objectContaining({ remote: false }));
    expect(output).toHaveBeenCalledWith("sidecar: bad: rules are not valid TOML");
  } finally { output.mockRestore(); }
});
