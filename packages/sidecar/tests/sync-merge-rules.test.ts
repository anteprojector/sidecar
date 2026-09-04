import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(),
  gitBytes: vi.fn(),
}));
import { git, gitBytes } from "../src/git.js";
import { resolveMergeConflicts } from "../src/sync.js";
import type { SidecarConfig } from "../src/config.js";

const oursOid = "a".repeat(40);
const theirsOid = "b".repeat(40);
const incoming = "origin/sidecar-inbox/test/abc";
const defaults: SidecarConfig = {
  remote: "unused", path: "sidecar", branch: "main", inbox: "sidecar-inbox/{user}/{random}",
  resolve: "fork", redaction: "none", peer: "default",
};
let root: string;
const unmerged = new Set<string>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-merge-rules-unit-"));
  unmerged.clear();
  vi.mocked(gitBytes).mockImplementation((_repo, args) => {
    const stdout = args[0] === "ls-files"
      ? [...unmerged].map((name) => `100644 ${oursOid} 2\t${name}\0` + `100644 ${theirsOid} 3\t${name}\0`).join("")
      : args.includes("ls-tree") ? `100644 blob ${args.includes("HEAD") ? oursOid : theirsOid}\t${args.at(-1)}\0`
      : args[1].startsWith(":2:") ? "ours\n" : "theirs\n";
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  });
  vi.mocked(git).mockImplementation((_repo, args) => {
    if (args[0] === "merge-base") return { status: 0, stdout: "base", stderr: "" };
    if (args[0] === "log") return { status: 0,
      stdout: args.includes("--name-only") ? [...unmerged].join("\0") : args.includes("base") || args.some((arg) => arg.startsWith("--grep=")) ? ""
        : args.includes("HEAD") ? `${oursOid}\n100\n` : `${theirsOid}\n200\n`, stderr: "" };
    const name = args.at(-1)!.replace(/^:\(literal\)/, "");
    if (args[0] === "restore") {
      fs.writeFileSync(path.join(root, name), args.includes(`--source=${incoming}`) ? "theirs\n" : "ours\n");
      unmerged.delete(name);
    }
    if (args[0] === "rm") {
      fs.rmSync(path.join(root, name), { force: true });
      unmerged.delete(name);
    }
    if (args[0] === "add") {
      // Staging the whole checkout would silently resolve another policy's
      // files with their conflict markers. The unit fake refuses that path.
      if (args.includes("-A")) throw new Error("staged unresolved conflicts indiscriminately");
      unmerged.delete(name);
    }
    return { status: 0, stdout: "", stderr: "" };
  });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

function conflict(name: string): void {
  const fullPath = path.join(root, name);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, "<<<<<<< conflict markers");
  unmerged.add(name);
}

function manifests(): Array<{ resolved_by: string; paths: Array<{ path: string; kept?: string }> }> {
  const dir = path.join(root, ".sidecar-conflicts");
  return fs.readdirSync(dir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

describe("per-path merge resolution", () => {
  test("mixes fork and LWW policies, keeps both manifests, and commits once", () => {
    conflict("notes/café.md");
    conflict("state/current.json");
    resolveMergeConflicts(root, {
      ...defaults, rules: [{ glob: "state/**", resolve: "lww" }],
    }, incoming, { forkFiles: true });

    expect(fs.existsSync(path.join(root, "notes/café.md"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "notes/café.conflict.main.aaaaaaa.md"), "utf8")).toBe("ours\n");
    expect(fs.readFileSync(path.join(root, "state/current.json"), "utf8")).toBe("theirs\n");
    expect(manifests().map((manifest) => [manifest.resolved_by, manifest.paths.map((entry) => entry.path)]).sort()).toEqual([
      ["fork-files", ["notes/café.md"]], ["lww", ["state/current.json"]],
    ]);
    expect(unmerged.size).toBe(0);
    expect(vi.mocked(git).mock.calls.filter(([, args]) => args[0] === "commit")).toHaveLength(1);
  });

  test("aborts before any resolution when one path requires disabled forks", () => {
    conflict("state/current.json");
    conflict("notes/plan.md");
    expect(() => resolveMergeConflicts(root, {
      ...defaults, resolve: "lww", rules: [{ glob: "notes/**", resolve: "fork" }],
    }, incoming, { forkFiles: false })).toThrow("rerun with --fork-files");

    expect(vi.mocked(git).mock.calls.map(([, args]) => args)).toEqual([["merge", "--abort"]]);
    expect(fs.readFileSync(path.join(root, "state/current.json"), "utf8")).toBe("<<<<<<< conflict markers");
    expect(fs.existsSync(path.join(root, ".sidecar-conflicts"))).toBe(false);
  });

  test("allows LWW overrides with forks disabled and honors the last matching rule", () => {
    conflict("notes/plan.md");
    resolveMergeConflicts(root, {
      ...defaults, rules: [{ glob: "notes/**", resolve: "fork" }, { glob: "**/*.md", resolve: "lww" }],
    }, incoming, { forkFiles: false });
    expect(fs.readFileSync(path.join(root, "notes/plan.md"), "utf8")).toBe("theirs\n");
    expect(manifests()).toEqual([expect.objectContaining({ resolved_by: "lww" })]);
    expect(vi.mocked(git).mock.calls.filter(([, args]) => args[0] === "commit")).toHaveLength(1);
  });

  test("uses the configured LWW default when rules are absent", () => {
    conflict("state.json");
    resolveMergeConflicts(root, { ...defaults, resolve: "lww" }, incoming, { forkFiles: false });
    expect(fs.readFileSync(path.join(root, "state.json"), "utf8")).toBe("theirs\n");
    expect(manifests()).toEqual([expect.objectContaining({ resolved_by: "lww" })]);
  });
});
