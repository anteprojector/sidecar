import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config.js")>(),
  findConfigRootOptional: () => fixture.root,
}));
vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(() => ({ status: 0, stdout: "main\n", stderr: "" })),
  gitRaw: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));
vi.mock("../src/state.js", async (original) => ({
  ...await original<typeof import("../src/state.js")>(),
  unregisterInstance: vi.fn(),
  withSyncLock: vi.fn((_root, _peer, _busy, fn) => { fn(); return true; }),
}));
vi.mock("../src/ui.js", async (original) => ({
  ...await original<typeof import("../src/ui.js")>(),
  promptYesNoDefaultNo: vi.fn(() => false),
}));
vi.mock("../src/sync.js", async (original) => ({
  ...await original<typeof import("../src/sync.js")>(),
  removeRedactionFilter: vi.fn(),
}));

import { cmdDeinit } from "../src/cmd-init.js";
import { promptYesNoDefaultNo } from "../src/ui.js";
import { unregisterInstance, withSyncLock } from "../src/state.js";
import { removeRedactionFilter } from "../src/sync.js";

let scratch: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(promptYesNoDefaultNo).mockReturnValue(false);
  vi.spyOn(console, "log").mockImplementation(() => {});
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-deinit-unit-"));
  fixture.root = path.join(scratch, "host");
  fs.mkdirSync(path.join(fixture.root, "sidecar"), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, "sidecar", "note.md"), "unpublished work\n");
  configure("sidecar");
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});
function configure(checkout: string) {
  fs.writeFileSync(path.join(fixture.root, ".sidecar"), `remote = "https://example.com/notes.git"\npath = ${JSON.stringify(checkout)}\n`);
}

test("declining confirmation preserves files, config, and registration", () => {
  expect(cmdDeinit([])).toBe(0);
  expect(fs.readFileSync(path.join(fixture.root, "sidecar", "note.md"), "utf8")).toContain("unpublished");
  expect(fs.existsSync(path.join(fixture.root, ".sidecar"))).toBe(true);
  expect(unregisterInstance).not.toHaveBeenCalled();
  expect(withSyncLock).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(path.join(fixture.root, "sidecar")));
});

test.each([{ args: [] }, { args: ["--yes"] }, { args: ["-y"] }])("confirmed deinit removes the named checkout under the sync lock: $args", ({ args }) => {
  vi.mocked(promptYesNoDefaultNo).mockReturnValue(true);
  expect(cmdDeinit(args)).toBe(0);
  expect(fs.existsSync(path.join(fixture.root, "sidecar"))).toBe(false);
  expect(fs.existsSync(path.join(fixture.root, ".sidecar"))).toBe(false);
  expect(withSyncLock).toHaveBeenCalledWith(fixture.root, "default", "throw", expect.any(Function));
  expect(unregisterInstance).toHaveBeenCalledWith(path.join(fixture.root, ".sidecar"));
  if (args.length) expect(promptYesNoDefaultNo).not.toHaveBeenCalled();
});

test("an external checkout can be deleted after confirmation", () => {
  const external = path.join(scratch, "external");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "note.md"), "notes");
  configure("../external");
  cmdDeinit([]);
  expect(fs.existsSync(external)).toBe(true);
  cmdDeinit(["--yes"]);
  expect(fs.existsSync(external)).toBe(false);
});

test("a failed checkout removal preserves config and registration for retry", () => {
  const remove = fs.rmSync;
  const checkout = path.join(fixture.root, "sidecar");
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (target === checkout) throw new Error("checkout is busy");
    return remove(target, options);
  });
  expect(() => cmdDeinit(["--yes"])).toThrow("checkout is busy");
  expect(fs.existsSync(path.join(fixture.root, ".sidecar"))).toBe(true);
  expect(fs.existsSync(path.join(checkout, "note.md"))).toBe(true);
  expect(unregisterInstance).not.toHaveBeenCalled();
});

test.each(["..", ".git", ".jj"])("even --yes cannot delete the host or its metadata through %s", (checkout) => {
  configure(checkout);
  expect(() => cmdDeinit(["--yes"])).toThrow("refusing to delete");
  expect(fs.existsSync(path.join(fixture.root, ".sidecar"))).toBe(true);
});

test("standalone deinit requires confirmation and keeps user files", () => {
  configure(".");
  cmdDeinit([]);
  expect(removeRedactionFilter).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(fixture.root, ".sidecar"))).toBe(true);
  cmdDeinit(["--yes"]);
  expect(removeRedactionFilter).toHaveBeenCalledWith(fixture.root);
  expect(fs.existsSync(path.join(fixture.root, "sidecar", "note.md"))).toBe(true);
});
