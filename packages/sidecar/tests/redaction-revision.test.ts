import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(),
  gitDir: vi.fn(),
  gitCommonDir: vi.fn(),
  hasAnyCommit: vi.fn(() => true),
}));
import { git, gitCommonDir, gitDir } from "../src/git.js";
import { ensureRedactionFilter, removeRedactionFilter, snapshot } from "../src/sync.js";

let root: string;
let ownGitDir: string;
const config = new Map<string, string>();
beforeEach(() => {
  vi.resetAllMocks();
  config.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-revision-unit-"));
  ownGitDir = path.join(root, ".git");
  fs.mkdirSync(ownGitDir);
  vi.mocked(gitDir).mockImplementation(() => ownGitDir);
  vi.mocked(gitCommonDir).mockReturnValue(path.join(root, ".git"));
  vi.mocked(git).mockImplementation((_repo, args) => {
    if (args[0] === "config") {
      if (args[1] === "--get-regexp") return { status: 0, stdout: [...config].map(([k, v]) => `${k} ${v}`).join("\n"), stderr: "" };
      if (args[1] === "--remove-section") config.clear();
      else config.set(args[1], args[2]);
    }
    return { status: 0, stdout: "", stderr: "" };
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function renormalizations(): number {
  return vi.mocked(git).mock.calls.filter(([, args]) => args.includes("--renormalize")).length;
}

test("an unfinished merge cannot become a snapshot after failed recovery", () => {
  fs.writeFileSync(path.join(ownGitDir, "MERGE_HEAD"), "unfinished merge");
  expect(() => snapshot(root, root, "inbox")).toThrow("cannot snapshot an unfinished merge");
  expect(git).not.toHaveBeenCalled();
});

test("repairing filter wiring cannot consume the next snapshot's revision upgrade", () => {
  expect(ensureRedactionFilter(root)).toBe(true);
  expect(ensureRedactionFilter(root)).toBe(false);
  config.delete("filter.sidecar-redact.revision");
  expect(ensureRedactionFilter(root)).toBe(true);
  snapshot(root, root, "inbox");
  expect(renormalizations()).toBe(1);
  snapshot(root, root, "inbox");
  expect(renormalizations()).toBe(1);
});

test("each linked checkout applies a filter revision independently", () => {
  snapshot(root, root, "inbox");
  ownGitDir = path.join(root, ".git", "worktrees", "sibling");
  fs.mkdirSync(ownGitDir, { recursive: true });
  snapshot(root, root, "sibling-inbox");
  expect(renormalizations()).toBe(2);
});

test("a failed renormalization is retried on the next snapshot", () => {
  ensureRedactionFilter(root);
  vi.mocked(git).mockImplementationOnce(() => ({ status: 0, stdout: [...config].map(([k, v]) => `${k} ${v}`).join("\n"), stderr: "" }))
    .mockImplementationOnce(() => ({ status: 0, stdout: "", stderr: "" }))
    .mockImplementationOnce(() => { throw new Error("filter failed"); });
  expect(() => snapshot(root, root, "inbox")).toThrow("filter failed");
  expect(fs.existsSync(path.join(ownGitDir, "sidecar-redaction-revision"))).toBe(false);
  snapshot(root, root, "inbox");
  expect(renormalizations()).toBe(2);
});

test("removing the filter clears both desired and applied revisions", () => {
  snapshot(root, root, "inbox");
  removeRedactionFilter(root);
  expect(config.size).toBe(0);
  expect(fs.existsSync(path.join(ownGitDir, "sidecar-redaction-revision"))).toBe(false);
});
