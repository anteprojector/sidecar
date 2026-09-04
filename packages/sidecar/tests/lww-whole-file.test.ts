import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(), gitBytes: vi.fn(), isAncestor: vi.fn(() => false),
  fetch: vi.fn(), remoteRefExists: vi.fn(() => true), isDirty: vi.fn(() => false),
}));
import { git, gitBytes, isAncestor } from "../src/git.js";
import { lastWriteAt, mergeInboxBranch, syncBranchBeforePush } from "../src/sync.js";
import type { SidecarConfig } from "../src/config.js";

type Entry = { mode: string; oid: string };
const incoming = "origin/inbox";
const config: SidecarConfig = { remote: "unused", path: "sidecar", branch: "main", inbox: "inbox/{user}/{random}", resolve: "lww", redaction: "none", peer: "default" };
let root: string;
const trees = new Map<string, Map<string, Entry>>();
const writes = new Map<string, Set<string>>();
const times = new Map<string, Map<string, string>>();
const metadata = new Map<string, string>();
const index = new Map<string, Entry>();
const ancestors = new Set<string>();
const combined = { mode: "100644", oid: "combined-by-git" };
function literal(arg: string): string { return arg.replace(/^:\(literal\)/, ""); }
function entry(oid: string, mode = "100644"): Entry { return { oid, mode }; }
function write(ref: string, name: string, value: Entry | undefined, time: number, changed = true): void {
  if (value) trees.get(ref)!.set(name, value);
  else trees.get(ref)!.delete(name);
  if (changed) writes.get(ref)!.add(name);
  const record = `${changed ? `${ref}-write` : "base-write"}\n${time}\nwritten: ${time} ${name}\n`;
  times.get(ref)!.set(name, record);
  if (!changed) times.get("base")!.set(name, record);
}
function clock(name: string, time: number, source = "selected-source"): string {
  return `sidecar-lww-${crypto.createHash("sha256").update(name).digest("hex")}: ${time} ${source}`;
}
function commits(): string[] { return vi.mocked(git).mock.calls.filter(([, args]) => args[0] === "commit").map(([, args]) => args[2]); }
beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-lww-unit-"));
  trees.clear(); writes.clear(); times.clear(); metadata.clear(); index.clear(); ancestors.clear();
  for (const ref of ["HEAD", incoming, "base"]) { trees.set(ref, new Map()); writes.set(ref, new Set()); times.set(ref, new Map()); }
  vi.mocked(isAncestor).mockImplementation((_repo, a, b) => ancestors.has(`${a}:${b}`));
  vi.mocked(gitBytes).mockImplementation((_repo, args) => {
    if (args.includes("ls-tree")) {
      const value = trees.get(args[args.indexOf("--full-tree") + 1])?.get(args.at(-1)!);
      return { status: 0, stdout: Buffer.from(value ? `${value.mode} ${value.mode === "040000" ? "tree" : "blob"} ${value.oid}\t${args.at(-1)}\0` : ""), stderr: Buffer.alloc(0) };
    }
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  vi.mocked(git).mockImplementation((_repo, args) => {
    let stdout = "";
    if (args[0] === "merge-base") stdout = "base";
    if (args[0] === "log") {
      if (args.includes("--name-only")) stdout = [...writes.get(args.at(-1)!.slice("base..".length))!].join("\0");
      else if (args.some((arg) => arg.startsWith("--grep="))) stdout = metadata.get(args.at(-1)!) ?? "";
      else stdout = times.get(args[args.indexOf("--") - 1])?.get(literal(args.at(-1)!)) ?? "";
    }
    if (args[0] === "merge" && args.includes("--no-commit")) {
      // Simulate Git reporting a clean content merge that combines both sides.
      for (const name of new Set([...writes.get("HEAD")!, ...writes.get(incoming)!])) index.set(name, combined);
    }
    if (args[0] === "ls-files") stdout = [...index.keys()].join("\0");
    if (args[0] === "restore") index.set(literal(args.at(-1)!), trees.get(args[1].slice("--source=".length))!.get(literal(args.at(-1)!))!);
    if (args[0] === "rm") index.delete(literal(args.at(-1)!));
    return { status: 0, stdout, stderr: "" };
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("whole-file last writer wins", () => {
  test("replaces clean non-overlapping content merges while retaining Git merges for fork-policy files", () => {
    write("HEAD", "state.json", entry("ours-complete-json"), 100);
    write(incoming, "state.json", entry("theirs-complete-json"), 200);
    write("HEAD", "notes.md", entry("ours-note"), 100);
    write(incoming, "notes.md", entry("theirs-note"), 200);
    mergeInboxBranch(root, { ...config, rules: [{ glob: "*.md", resolve: "fork" }] }, incoming, { forkFiles: true });
    expect(index.get("state.json")).toEqual(entry("theirs-complete-json"));
    expect(index.get("notes.md")).toBe(combined);
    expect(git).toHaveBeenCalledWith(root, ["merge", "--no-ff", "--no-commit", "-Xno-renames", incoming], { check: false });
    expect(commits()).toHaveLength(1);
    expect(commits()[0]).toContain(clock("state.json", 200, "origin/inbox-write"));
    expect(git).toHaveBeenCalledWith(root, ["add", "--renormalize", "--", ":(literal)state.json"]);
  });

  test("preserves a one-sided causal update despite an older copied mtime", () => {
    write("HEAD", "state.json", entry("base"), 300, false);
    write(incoming, "state.json", entry("new-update-old-mtime"), 100);
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("state.json")).toEqual(entry("new-update-old-mtime"));
    expect(commits()[0]).toContain(clock("state.json", 100, "origin/inbox-write"));
  });

  test("an explicit revert counts as a newer concurrent write", () => {
    write("HEAD", "state.json", entry("same-as-base-after-revert"), 200);
    write(incoming, "state.json", entry("other-change"), 150);
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("state.json")).toEqual(entry("same-as-base-after-revert"));
  });

  test("selects complete additions and winning deletions", () => {
    write("HEAD", "added", undefined, 0, false);
    write(incoming, "added", entry("new"), 100);
    write("HEAD", "deleted", entry("old"), 100);
    write(incoming, "deleted", undefined, 200);
    write("HEAD", "keep", entry("newer"), 300);
    write(incoming, "keep", undefined, 200);
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("added")).toEqual(entry("new"));
    expect(index.has("deleted")).toBe(false);
    expect(index.get("keep")).toEqual(entry("newer"));
    expect(git).toHaveBeenCalledWith(root, ["rm", "-f", "--ignore-unmatch", "--", ":(literal)deleted"]);
  });

  test("uses deterministic entry ties and deletion wins an equal-time tie", () => {
    write("HEAD", "oid", entry("bbb"), 100);
    write(incoming, "oid", entry("aaa"), 100);
    write("HEAD", "mode", entry("aaa", "100755"), 100);
    write(incoming, "mode", entry("bbb", "100644"), 100);
    write("HEAD", "gone", undefined, 100);
    write(incoming, "gone", entry("zzz"), 100);
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("oid")).toEqual(entry("bbb"));
    expect(index.get("mode")).toEqual(entry("aaa", "100755"));
    expect(index.has("gone")).toBe(false);
  });

  test("restores parent modes and symlinks through literal Git paths", () => {
    for (const [name, value] of [["run[*].sh", entry("script", "100755")], ["link", entry("link-target", "120000")]] as const) {
      write("HEAD", name, entry("old"), 100);
      write(incoming, name, value, 200);
    }
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("run[*].sh")).toEqual(entry("script", "100755"));
    expect(index.get("link")).toEqual(entry("link-target", "120000"));
    expect(gitBytes).toHaveBeenCalledWith(root, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", incoming, "--", "run[*].sh"]);
    expect(git).toHaveBeenCalledWith(root, ["restore", `--source=${incoming}`, "--staged", "--worktree", "--", ":(literal)run[*].sh"]);
  });

  test("handles a one-sided file-to-directory transition", () => {
    write("HEAD", "item", entry("old-file"), 100, false);
    write(incoming, "item", entry("directory", "040000"), 200);
    write("HEAD", "item/child", undefined, 0, false);
    write(incoming, "item/child", entry("child"), 200);
    const implementation = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation((repo, args, options) => {
      if (args[0] === "rm" && literal(args.at(-1)!) === "item") {
        throw new Error("not removing directory recursively without -r");
      }
      const result = implementation(repo, args, options);
      // Git's clean merge has already replaced the old leaf with a directory.
      if (args[0] === "merge" && args.includes("--no-commit")) index.delete("item");
      return result;
    });
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.has("item")).toBe(false);
    expect(index.get("item/child")).toEqual(entry("child"));
    expect(git).not.toHaveBeenCalledWith(root, ["rm", "-f", "--ignore-unmatch", "--", ":(literal)item"]);
  });

  test("fails incompatible parent and descendant winners before modifying selected entries", () => {
    write("HEAD", "item", entry("new-file"), 300);
    write(incoming, "item", entry("directory", "040000"), 200);
    write("HEAD", "item/child", undefined, 100);
    write(incoming, "item/child", entry("child"), 200);
    expect(() => mergeInboxBranch(root, config, incoming, { forkFiles: false })).toThrow("incompatible file and directory paths");
    expect(commits()).toEqual([]);
    expect(vi.mocked(git).mock.calls.some(([, args]) => ["restore", "rm"].includes(args[0]))).toBe(false);
  });

  test("a failed policy application aborts the provisional merge", () => {
    write("HEAD", "state.json", entry("ours"), 100);
    write(incoming, "state.json", entry("theirs"), 200);
    const implementation = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation((repo, args, options) => {
      if (args.includes("--renormalize")) throw new Error("filter failed");
      return implementation(repo, args, options);
    });
    expect(() => mergeInboxBranch(root, config, incoming, { forkFiles: false })).toThrow("filter failed");
    expect(git).toHaveBeenCalledWith(root, ["merge", "--abort"], { check: false });
    expect(commits()).toEqual([]);
  });

  test("divergent inbox tips use the same whole-file policy instead of rebasing", () => {
    write("HEAD", "state.json", entry("ours"), 100);
    write(incoming, "state.json", entry("theirs"), 200);
    syncBranchBeforePush(root, "inbox", config);
    expect(index.get("state.json")).toEqual(entry("theirs"));
    expect(vi.mocked(git).mock.calls.some(([, args]) => args[0] === "rebase")).toBe(false);
    expect(commits()).toHaveLength(1);
  });
});

describe("write-time provenance", () => {
  test("a synthesized merge keeps the selected write timestamp", () => {
    times.get("HEAD")!.set("state.json", `merge-commit\n900\n${clock("state.json", 200)}\n`);
    expect(lastWriteAt(root, "HEAD", "state.json")).toBe(200);
  });

  test("identical-blob merges retain the newer clock even when path history skips the merge", () => {
    times.get("HEAD")!.set("state.json", "old-write\n100\nwritten: 100 state.json\n");
    metadata.set("HEAD", `clock-merge\n900\n${clock("state.json", 200)}\n`);
    ancestors.add("old-write:clock-merge");
    write("HEAD", "state.json", entry("identical-winner"), 100);
    times.get("HEAD")!.set("state.json", "old-write\n100\nwritten: 100 state.json\n");
    write(incoming, "state.json", entry("intermediate-write"), 150);
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("state.json")).toEqual(entry("identical-winner"));
    expect(commits()[0]).toContain(clock("state.json", 200));
  });

  test("a subsequent actual write supersedes inherited metadata even with an older mtime", () => {
    times.get("HEAD")!.set("state.json", "new-write\n1000\nwritten: 50 state.json\n");
    metadata.set("HEAD", `older-merge\n900\n${clock("state.json", 200)}\n`);
    expect(lastWriteAt(root, "HEAD", "state.json")).toBe(50);
  });

  test("discarded historical writes do not turn a causal update into a timestamp contest", () => {
    write("HEAD", "state.json", entry("base-version"), 200);
    write(incoming, "state.json", entry("causal-update-old-mtime"), 100);
    times.get("base")!.set("state.json", "base-write\n200\nwritten: 200 state.json\n");
    times.get("HEAD")!.set("state.json", "base-write\n200\nwritten: 200 state.json\n");
    metadata.set("HEAD", `discarded-old-write-merge\n900\n${clock("state.json", 200, "base-write")}\n`);
    ancestors.add("base-write:discarded-old-write-merge");
    mergeInboxBranch(root, config, incoming, { forkFiles: false });
    expect(index.get("state.json")).toEqual(entry("causal-update-old-mtime"));
    expect(commits()[0]).toContain(clock("state.json", 100, "origin/inbox-write"));
  });

  test("a carried deletion clock survives merges whose first parent already lacked the file", () => {
    times.get("HEAD")!.set("gone", "old-delete\n100\n");
    metadata.set("HEAD", `newer-delete-merge\n900\n${clock("gone", 200)}\n`);
    ancestors.add("old-delete:newer-delete-merge");
    expect(lastWriteAt(root, "HEAD", "gone")).toBe(200);
  });
});
