import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "", ignored: false, tracked: new Set<string>() }));
vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config.js")>(),
  findConfigRootOptional: () => fixture.root,
}));
vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(() => ({ status: 0, stdout: "sidecar-inbox/test/abc\n", stderr: "" })),
  gitRaw: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
  gitExcludePath: () => path.join(fixture.root, ".git", "info", "exclude"),
  isGitIgnored: () => fixture.ignored,
  isGitTracked: (_root: string, file: string) => fixture.tracked.has(file),
  ensureCommitIdentity: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../src/install.js", async (original) => ({
  ...await original<typeof import("../src/install.js")>(),
  findGlobalSidecarExecutable: () => undefined,
}));
vi.mock("../src/state.js", async (original) => ({
  ...await original<typeof import("../src/state.js")>(),
  registerCurrentInstance: vi.fn(),
  unregisterInstance: vi.fn(),
  withSyncLock: vi.fn((_root, _peer, _mode, run) => { run(); return true; }),
  logSidecarEvent: vi.fn(),
}));
vi.mock("../src/sync.js", async (original) => ({
  ...await original<typeof import("../src/sync.js")>(),
  removeRedactionFilter: vi.fn(),
  ensureRedactionFilter: vi.fn(),
  ensureMainBranch: vi.fn(),
}));
vi.mock("../src/ui.js", async (original) => ({
  ...await original<typeof import("../src/ui.js")>(),
  promptYesNo: () => false,
}));

import { cmdDeinit, cmdInit } from "../src/cmd-init.js";
import { refreshStandaloneCheckout } from "../src/cmd-refresh.js";
import { readConfig } from "../src/config.js";
import { git } from "../src/git.js";
import { ensureMainBranch, ensureRedactionFilter } from "../src/sync.js";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-rules-lifecycle-"));
  fixture.ignored = false;
  fixture.tracked.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(fixture.root, { recursive: true, force: true });
});
function write(name: string, content: string) {
  fs.writeFileSync(path.join(fixture.root, name), content);
}
function privatePeer() {
  write(".sidecar.private", 'remote = "https://example.com/private.git"\npath = "private"\n');
}
function standalone() {
  write(".sidecar", 'remote = "https://example.com/notes.git"\npath = "."\nredaction = "none"\n');
  write(".sidecar-rules", '[[rules]]\nglob = "*.env"\nredaction = "secrets"\n');
}

test("ignored init excludes a peer's rules before the file exists", () => {
  privatePeer();
  cmdInit(["--peer", "private", "--ignored", "--no-clone"]);
  expect(fs.readFileSync(path.join(fixture.root, ".git/info/exclude"), "utf8"))
    .toContain("/.sidecar-rules.private\n");
});

test("rejoining an already ignored peer also excludes its rules", () => {
  privatePeer();
  fixture.ignored = true;
  cmdInit(["--peer", "private", "--no-clone"]);
  expect(fs.readFileSync(path.join(fixture.root, ".git/info/exclude"), "utf8"))
    .toContain("/.sidecar-rules.private\n");
});

test("ignored init refuses tracked rules instead of pretending they are private", () => {
  privatePeer();
  fixture.tracked.add(".sidecar-rules.private");
  expect(() => cmdInit(["--peer", "private", "--ignored", "--no-clone"]))
    .toThrow(".sidecar-rules.private is tracked");
  expect(fs.existsSync(path.join(fixture.root, ".git/info/exclude"))).toBe(false);
});

test("deinit removes only the selected peer's rules", () => {
  privatePeer();
  write(".sidecar-rules.private", '[[rules]]\nglob = "**"\nresolve = "lww"\n');
  write(".sidecar-rules", "# another peer's policy\n");
  cmdDeinit(["--peer", "private", "--yes"]);
  expect(fs.existsSync(path.join(fixture.root, ".sidecar-rules.private"))).toBe(false);
  expect(fs.readFileSync(path.join(fixture.root, ".sidecar-rules"), "utf8")).toContain("another peer");
});

test("standalone deinit keeps branches when a rule enables redaction over default none", () => {
  standalone();
  cmdDeinit(["--yes"]);
  expect(vi.mocked(git).mock.calls.some(([, args]) => args[0] === "switch")).toBe(false);
});

test("standalone refresh preserves originals when a rule enables redaction", () => {
  standalone();
  const config = readConfig(path.join(fixture.root, ".sidecar"));
  expect(refreshStandaloneCheckout(fixture.root, config, true)).toContain("under redaction");
  expect(ensureRedactionFilter).toHaveBeenCalledWith(fixture.root, "none", config);
  expect(ensureMainBranch).not.toHaveBeenCalled();
});
