import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  git: vi.fn(), gitRaw: vi.fn(), gitDir: vi.fn(), gitCommonDir: vi.fn(), hasAnyCommit: vi.fn(() => true),
}));
vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config.js")>(),
  loadPeers: vi.fn(), requireSidecarCheckout: vi.fn(),
}));
import { git, gitRaw, gitDir, gitCommonDir } from "../src/git.js";
import { loadPeers, requireSidecarCheckout } from "../src/config.js";
import { checkoutRedactionPolicy, ensureRedactionFilter, fileRedactionDelta, snapshot } from "../src/sync.js";
import { cmdRedact, cmdRedactions } from "../src/cmd-sync.js";
import { readRules } from "../src/rules.js";

let root: string;
let ownGitDir: string;
const config = new Map<string, string>();
const content = "<!-- sidecar:no-redact -->\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n";
const redacted = "<!-- sidecar:no-redact -->\nGITHUB_TOKEN=<TOKEN>\n";
beforeEach(() => {
  vi.resetAllMocks();
  config.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-rules-redaction-unit-"));
  ownGitDir = path.join(root, ".git");
  fs.mkdirSync(ownGitDir);
  vi.mocked(gitDir).mockImplementation(() => ownGitDir);
  vi.mocked(gitCommonDir).mockReturnValue(path.join(root, ".git"));
  vi.mocked(git).mockImplementation((_repo, args) => {
    if (args[0] === "config") {
      if (args[1] === "--get-regexp") return { status: 0, stdout: [...config].map(([k, v]) => `${k} ${v}`).join("\n"), stderr: "" };
      config.set(args[1], args[2]);
    }
    return { status: 0, stdout: "", stderr: "" };
  });
  vi.mocked(gitRaw).mockReturnValue({ status: 1, stdout: "@@ -1 +1 @@\n-secret\n+<TOKEN>\n", stderr: "" });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function policy(text: string, name = ".sidecar-rules") {
  const rulesPath = path.join(root, name);
  fs.writeFileSync(rulesPath, text);
  return { rulesPath, rules: readRules(rulesPath) };
}
function filter(args: string[]): string {
  let output = "";
  const originalRead = fs.readFileSync;
  const reader = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
    if (file === 0) return Buffer.from(content);
    return Reflect.apply(originalRead, fs, [file, ...args]);
  });
  const writer = vi.spyOn(fs, "writeSync").mockImplementation((fd, data, offset, length) => {
    if (fd !== 1 || !Buffer.isBuffer(data)) throw new Error("unexpected write");
    output += data.subarray(offset as number, (offset as number) + (length as number)).toString("utf8");
    return length as number;
  });
  try { expect(cmdRedact(args)).toBe(0); } finally { reader.mockRestore(); writer.mockRestore(); }
  return output;
}

describe("path redaction", () => {
  test("clean filter and preview apply exceptions and overrides from the same peer rules", () => {
    const bound = policy('[[rules]]\nglob = "private/**"\nredaction = "secrets"\n[[rules]]\nglob = "private/fixture.md"\nredaction = "none"\n');
    ensureRedactionFilter(root, "none", bound);
    for (const [name, expected] of [["private/café.md", redacted], ["private/fixture.md", content], ["public.md", content]]) {
      expect(filter(["--checkout-policy", "--path", name])).toBe(expected);
      const filePath = path.join(root, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      expect(fileRedactionDelta(filePath, "none", { ...bound, relativePath: name })?.redacted ?? content).toBe(expected);
    }
    expect(config.get("filter.sidecar-redact.clean")).toContain("--checkout-policy --path %f");
    expect(config.get("filter.sidecar-redact.clean")).not.toContain(bound.rulesPath);
  });

  test("direct clean filter validates an explicit rules file even when default mode is none", () => {
    const bound = policy('[[rules]]\nglob = "**"\nredaction = "secrets"\n');
    expect(filter(["--mode", "none", "--rules", bound.rulesPath, "--path", "notes.md"])).toBe(redacted);
    fs.writeFileSync(bound.rulesPath, "[[rules]]\nglob =");
    expect(() => cmdRedact(["--mode", "none", "--rules", bound.rulesPath, "--path", "notes.md"])).toThrow("not valid TOML");
  });

  test("content in the sidecar cannot supply or change the host rules binding", () => {
    const bound = policy('[[rules]]\nglob = "**"\nredaction = "secrets"\n', "host-rules");
    ensureRedactionFilter(root, "none", bound);
    fs.writeFileSync(path.join(root, ".sidecar-rules"), '[[rules]]\nglob = "**"\nredaction = "none"\n');
    expect(filter(["--checkout-policy", "--path", "notes.md"])).toBe(redacted);
  });

  test("a sibling with default none cannot disable another checkout's redaction", () => {
    const firstDir = ownGitDir;
    ensureRedactionFilter(root, "secrets");
    const command = config.get("filter.sidecar-redact.clean");
    ownGitDir = path.join(root, ".git", "worktrees", "second");
    fs.mkdirSync(ownGitDir, { recursive: true });
    ensureRedactionFilter(root, "none");
    expect(config.get("filter.sidecar-redact.clean")).toBe(command);
    expect(filter(["--checkout-policy", "--path", "notes.md"])).toBe(content);
    ownGitDir = firstDir;
    expect(filter(["--checkout-policy", "--path", "notes.md"])).toBe(redacted);
  });

  test("changing or deleting the bound policy stops filters until the next operation binds it", () => {
    const bound = policy('[[rules]]\nglob = "**"\nredaction = "secrets"\n');
    ensureRedactionFilter(root, "none", bound);
    fs.writeFileSync(bound.rulesPath, '[[rules]]\nglob = "**"\nredaction = "none"\n');
    expect(() => checkoutRedactionPolicy(root)).toThrow("rules changed");
    expect(() => ensureRedactionFilter(root, "none", bound)).toThrow("rules changed");
    fs.rmSync(bound.rulesPath);
    expect(() => checkoutRedactionPolicy(root)).toThrow("rules changed");
    ensureRedactionFilter(root, "none", { ...bound, rules: readRules(bound.rulesPath) });
    expect(checkoutRedactionPolicy(root).rules).toEqual([]);
  });

  test("rules changes and deletion reprocess unchanged files once per checkout", () => {
    const bound = policy('[[rules]]\nglob = "**"\nredaction = "none"\n');
    snapshot(root, root, "inbox", undefined, "secrets", bound);
    fs.writeFileSync(bound.rulesPath, '[[rules]]\nglob = "private/**"\nredaction = "none"\n');
    snapshot(root, root, "inbox", undefined, "secrets", { ...bound, rules: readRules(bound.rulesPath) });
    fs.rmSync(bound.rulesPath);
    const deleted = { ...bound, rules: readRules(bound.rulesPath) };
    snapshot(root, root, "inbox", undefined, "secrets", deleted);
    snapshot(root, root, "inbox", undefined, "secrets", deleted);
    expect(vi.mocked(git).mock.calls.filter(([, args]) => args.includes("--renormalize"))).toHaveLength(3);
  });

  test("snapshot reports path redactions even when the default is none", () => {
    const bound = policy('[[rules]]\nglob = "private/**"\nredaction = "secrets"\n');
    fs.mkdirSync(path.join(root, "private"));
    fs.writeFileSync(path.join(root, "private", "notes.md"), content);
    const existingGit = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation((repo, args, options) => {
      if (args[0] === "diff" && args.includes("--quiet")) return { status: 1, stdout: "", stderr: "" };
      if (args[0] === "diff" && args.includes("--name-only")) return { status: 0, stdout: "private/notes.md\0", stderr: "" };
      return existingGit(repo, args, options);
    });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    snapshot(root, root, "inbox", undefined, "none", bound);
    expect(output.mock.calls.flat().join(" ")).toContain("redacted 1 item(s) in 1 file(s)");
  });

  test("preview does not stop at a default of none when path rules enable redaction", () => {
    const bound = policy('[[rules]]\nglob = "private/**"\nredaction = "secrets"\n');
    fs.mkdirSync(path.join(root, "private"));
    fs.writeFileSync(path.join(root, "private", "notes.md"), content);
    vi.mocked(loadPeers).mockReturnValue([{ name: "default", root, configPath: path.join(root, ".sidecar"), config: {
      remote: "unused", path: "sidecar", branch: "main", inbox: "sidecar-inbox/{user}/{random}", resolve: "fork", redaction: "none", peer: "default", ...bound,
    } }]);
    vi.mocked(requireSidecarCheckout).mockReturnValue(root);
    vi.mocked(git).mockReturnValue({ status: 0, stdout: "private/notes.md\0", stderr: "" });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    cmdRedactions([]);
    expect(output).toHaveBeenCalledWith("private/notes.md:");
    expect(output.mock.calls.flat().join(" ")).toContain("1 redaction(s) in 1 file(s)");
  });
});
