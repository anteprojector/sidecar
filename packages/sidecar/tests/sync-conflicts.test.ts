import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(),
  gitBytes: vi.fn(),
  gitRaw: vi.fn(),
  hasAnyCommit: vi.fn(),
  hasGitMetadata: vi.fn(),
}));
import { git, gitBytes, gitRaw, hasAnyCommit, hasGitMetadata } from "../src/git.js";
import { forkConflicts, syncProject, unmergedPaths } from "../src/sync.js";
import type { SidecarConfig } from "../src/config.js";

const oid2 = "a".repeat(40);
const oid3 = "b".repeat(40);
const roots: string[] = [];
let index: Buffer;
const blobs = new Map<string, Buffer>();
beforeEach(() => {
  vi.resetAllMocks();
  index = Buffer.alloc(0);
  blobs.clear();
  vi.mocked(git).mockReturnValue({ status: 0, stdout: "", stderr: "" });
  vi.mocked(gitBytes).mockImplementation((_repo, args) => {
    if (args[0] === "ls-files") return { status: 0, stdout: index, stderr: Buffer.alloc(0) };
    const blob = blobs.get(args[1]);
    return { status: blob === undefined ? 1 : 0, stdout: blob ?? Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
});
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-conflict-unit-"));
  roots.push(root);
  return root;
}
function entry(filePath: string, stage: number, mode = "100644"): string {
  return `${mode} ${stage === 2 ? oid2 : oid3} ${stage}\t${filePath}\0`;
}
function simulateStaging(): void {
  vi.mocked(git).mockImplementation((root, args) => {
    if (args[0] === "rm") fs.rmSync(path.join(root, args.at(-1)!.replace(/^:\(literal\)/, "")), { force: true });
    if (args[0] === "add") index = Buffer.alloc(0);
    return { status: 0, stdout: "", stderr: "" };
  });
}

describe("conflict index paths", () => {
  test("preserves UTF-8, tabs, newlines, and prototype-shaped filenames", () => {
    const names = ["notes/café.md", "计划.md", "tab\tline\n.md", "__proto__"];
    index = Buffer.from(names.map((name) => entry(name, 2) + entry(name, 3)).join(""));
    expect(unmergedPaths("unused")).toEqual(Object.fromEntries(names.map((name) => [name, { 2: oid2, 3: oid3 }])));
  });
  test("rejects invalid UTF-8 instead of resolving a different path", () => {
    index = Buffer.concat([Buffer.from(`100644 ${oid2} 2\t`), Buffer.from([0xff, 0])]);
    expect(() => unmergedPaths("unused")).toThrow("not valid UTF-8");
  });
});

describe("conflict forks", () => {
  test("preserves Unicode names, empty files, and executable mode", () => {
    const root = repo();
    const name = "café.md";
    fs.writeFileSync(path.join(root, name), "<<<<<<< conflict markers");
    index = Buffer.from(entry(name, 2, "100755") + entry(name, 3));
    blobs.set(`:2:${name}`, Buffer.from("ours\n"));
    blobs.set(`:3:${name}`, Buffer.alloc(0));
    simulateStaging();
    forkConflicts(root, "origin/sidecar-inbox/test/abc");
    expect(fs.existsSync(path.join(root, name))).toBe(false);
    expect(fs.readFileSync(path.join(root, "café.conflict.main.aaaaaaa.md"), "utf8")).toBe("ours\n");
    expect(fs.statSync(path.join(root, "café.conflict.main.aaaaaaa.md")).mode & 0o777).toBe(0o755);
    const manifestDir = path.join(root, ".sidecar-conflicts");
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, fs.readdirSync(manifestDir)[0]), "utf8"));
    expect(manifest.paths[0].path).toBe(name);
    expect(manifest.paths[0].versions).toHaveLength(2);
    expect(fs.readFileSync(path.join(root, manifest.paths[0].versions[1].path)).length).toBe(0);
  });
  test("treats wildcard filenames as literal paths when staging forks and removing originals", () => {
    const root = repo();
    fs.mkdirSync(path.join(root, "notes"));
    const name = "notes/*.md";
    fs.writeFileSync(path.join(root, name), "conflict markers");
    fs.writeFileSync(path.join(root, "notes", "keep.md"), "keep this note");
    index = Buffer.from(entry(name, 2) + entry(name, 3));
    blobs.set(`:2:${name}`, Buffer.from("ours"));
    blobs.set(`:3:${name}`, Buffer.from("theirs"));
    simulateStaging();
    forkConflicts(root, "origin/inbox");
    const writes = vi.mocked(git).mock.calls.filter(([, args]) => ["add", "rm"].includes(args[0]));
    expect(writes.every(([, args]) => args.at(-1)!.startsWith(":(literal)"))).toBe(true);
    expect(git).toHaveBeenCalledWith(root, ["rm", "-f", "--", ":(literal)notes/*.md"]);
    expect(fs.readFileSync(path.join(root, "notes", "keep.md"), "utf8")).toBe("keep this note");
    expect(fs.readFileSync(path.join(root, "notes", "*.conflict.main.aaaaaaa.md"), "utf8")).toBe("ours");
    expect(fs.existsSync(path.join(root, name))).toBe(false);
  });
  test("leaves originals and index untouched when an expected blob cannot be read", () => {
    const root = repo();
    index = Buffer.from(entry("first.md", 2) + entry("second.md", 3));
    blobs.set(":2:first.md", Buffer.from("first"));
    fs.writeFileSync(path.join(root, "first.md"), "markers");
    expect(() => forkConflicts(root, "origin/inbox")).toThrow("could not read conflict stage 3 for second.md");
    expect(fs.readdirSync(root)).toEqual(["first.md"]);
    expect(fs.readFileSync(path.join(root, "first.md"), "utf8")).toBe("markers");
    expect(git).not.toHaveBeenCalled();
  });
  test("preserves symlinks without overwriting a previous fork's target", () => {
    const root = repo();
    const target = path.join(root, "outside.txt");
    fs.writeFileSync(target, "safe");
    fs.symlinkSync(target, path.join(root, "link.conflict.main.aaaaaaa"));
    index = Buffer.from(entry("link", 2, "120000"));
    blobs.set(":2:link", Buffer.from("new-target"));
    simulateStaging();
    forkConflicts(root, "origin/inbox");
    expect(fs.readlinkSync(path.join(root, "link.conflict.main.aaaaaaa"))).toBe("new-target");
    expect(fs.readFileSync(target, "utf8")).toBe("safe");
  });
});

describe("local sync initialization", () => {
  const config: SidecarConfig = { remote: "unused", path: "sidecar", branch: "main", inbox: "sidecar-inbox/{user}/{random}", resolve: "fork", redaction: "none", peer: "default" };
  test("does not clone a missing checkout", () => {
    vi.mocked(hasGitMetadata).mockReturnValue(false);
    expect(() => syncProject("/project", config, { snapshot: true, remote: false })).toThrow("missing sidecar checkout");
    expect(gitRaw).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });
  test("does not bootstrap or repair an unborn or broken checkout", () => {
    vi.mocked(hasGitMetadata).mockReturnValue(true);
    vi.mocked(hasAnyCommit).mockReturnValue(false);
    expect(() => syncProject("/project", config, { snapshot: true, remote: false })).toThrow("local sync requires an initialized");
    expect(gitRaw).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });
});
