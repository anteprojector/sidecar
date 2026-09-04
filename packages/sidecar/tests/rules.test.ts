import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readConfig, writeConfig } from "../src/config.js";
import { peerRulesFileName, peerRulesPath, readRules, resolveFileRules, rulesFingerprint, rulesMayRedact } from "../src/rules.js";

let directory: string;
const defaults = { resolve: "fork", redaction: "secrets" } as const;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-rules-")); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

function read(text: string) {
  const file = peerRulesPath(directory, "default");
  fs.writeFileSync(file, text);
  return readRules(file);
}

describe("per-file rules", () => {
  test("missing and empty files retain peer defaults", () => {
    expect(readRules(peerRulesPath(directory, "default"))).toEqual([]);
    expect(read("# no policies yet\n")).toEqual([]);
    expect(resolveFileRules(undefined, "notes.md", defaults)).toEqual(defaults);
  });

  test("ordered matches override only their specified properties", () => {
    const rules = read(`
[[rules]]
glob = "**/*.md"
resolve = "lww"
redaction = "secrets+pii"
[[rules]]
glob = "fixtures/**"
redaction = "none"
[[rules]]
glob = "fixtures/important.md"
resolve = "fork"
`);
    expect(resolveFileRules(rules, "README.md", defaults)).toEqual({ resolve: "lww", redaction: "secrets+pii" });
    expect(resolveFileRules(rules, "fixtures/nested/notes.md", defaults)).toEqual({ resolve: "lww", redaction: "none" });
    expect(resolveFileRules(rules, "fixtures/important.md", defaults)).toEqual({ resolve: "fork", redaction: "none" });
    expect(resolveFileRules(rules, "src/index.ts", defaults)).toEqual(defaults);
    expect(defaults).toEqual({ resolve: "fork", redaction: "secrets" });
  });

  test("globs are rooted at the checkout and include dotfiles", () => {
    const rules = read('[[rules]]\nglob = "*.md"\nresolve = "lww"\n');
    expect(resolveFileRules(rules, ".notes.md", defaults).resolve).toBe("lww");
    expect(resolveFileRules(rules, "notes/a.md", defaults).resolve).toBe("fork");
    const recursive = read('[[rules]]\nglob = "**/*.md"\nresolve = "lww"\n');
    expect(resolveFileRules(recursive, ".hidden/.notes.md", defaults).resolve).toBe("lww");
    expect(resolveFileRules(recursive, "café/日本語.md", defaults).resolve).toBe("lww");
  });

  test("a leading exclamation mark is literal, not a negation", () => {
    const rules = read('[[rules]]\nglob = "!notes.md"\nresolve = "lww"\n');
    expect(resolveFileRules(rules, "other.md", defaults).resolve).toBe("fork");
    expect(resolveFileRules(rules, "!notes.md", defaults).resolve).toBe("lww");
  });

  test.each([
    ['version = 1', 'unknown key "version"'],
    ['rules = "wrong"', "array"],
    ['rules = [1]', "rule 1 must be a table"],
    ['[[rules]]\nglob = "**"\nresovle = "fork"', 'rule 1: unknown key "resovle"'],
    ['[[rules]]\nglob = 42\nresolve = "fork"', "rule 1: glob"],
    ['[[rules]]\nglob = ""\nresolve = "fork"', "rule 1: glob"],
    ['[[rules]]\nglob = "**"', "rule 1: set at least one policy"],
    ['[[rules]]\nglob = "**"\nresolve = "newest"', "rule 1: resolve"],
    ['[[rules]]\nglob = "**"\nredaction = false', "rule 1: redaction"],
    ['[[rules]]\nglob = "[broken"\nresolve = "fork"', "rule 1: invalid glob"],
    ['[[rules', "not valid TOML"],
  ])("rejects malformed policy: %s", (text, message) => {
    expect(() => read(text)).toThrow(message);
    expect(() => read(text)).toThrow(peerRulesPath(directory, "default"));
  });

  test.each(["/etc/**", "../notes/**", "notes/../**", "C:/notes/**", "C:notes/**", "notes\\*.md"])(
    "rejects unsafe glob %s", (glob) => {
      expect(() => read(`[[rules]]\nglob = ${JSON.stringify(glob)}\nresolve = "fork"`)).toThrow("checkout-relative");
    },
  );

  test("unreadable rule paths fail instead of disabling policies", () => {
    expect(() => readRules(directory)).toThrow(`could not read ${directory}`);
  });

  test("a missing symlink target fails instead of silently restoring defaults", () => {
    const target = path.join(directory, "shared-rules.toml");
    const link = peerRulesPath(directory, "default");
    fs.writeFileSync(target, '[[rules]]\nglob = "**"\nredaction = "secrets"');
    fs.symlinkSync(target, link);
    expect(readRules(link)).toEqual([{ glob: "**", redaction: "secrets" }]);
    fs.rmSync(target);
    expect(() => readRules(link)).toThrow(`could not read ${link}`);
    fs.rmSync(link);
    expect(readRules(link)).toEqual([]);
  });

  test("fingerprints follow policy content and order, independent of formatting", () => {
    const first = read('[[rules]]\nglob = "**"\nresolve = "fork"\nredaction = "none"');
    const reformatted = read('# comment\n[[rules]]\nredaction="none"\nresolve="fork"\nglob="**"');
    const changed = read('[[rules]]\nglob = "**"\nresolve = "lww"\nredaction = "none"');
    expect(rulesFingerprint(first)).toBe(rulesFingerprint(reformatted));
    expect(rulesFingerprint(first)).not.toBe(rulesFingerprint(changed));
    expect(rulesFingerprint([...first, ...changed])).not.toBe(rulesFingerprint([...changed, ...first]));
    expect(rulesFingerprint(undefined)).toBe(rulesFingerprint([]));
  });

  test("redaction detection includes enabled overrides and is conservative", () => {
    expect(rulesMayRedact(undefined, "none")).toBe(false);
    expect(rulesMayRedact([{ glob: "**", redaction: "none" }], "secrets")).toBe(true);
    expect(rulesMayRedact([{ glob: "**", resolve: "lww" }], "none")).toBe(false);
    expect(rulesMayRedact([{ glob: "notes/**", redaction: "secrets" }], "none")).toBe(true);
  });

  test("loads each peer's adjacent rules without writing them into config", () => {
    expect(peerRulesFileName("default")).toBe(".sidecar-rules");
    expect(peerRulesFileName("notes")).toBe(".sidecar-rules.notes");
    for (const [peer, file] of [["default", ".sidecar"], ["notes", ".sidecar.notes"]]) {
      const configPath = path.join(directory, file);
      fs.writeFileSync(configPath, 'remote = "https://example.com/repo.git"\n');
      fs.writeFileSync(peerRulesPath(directory, peer), `[[rules]]\nglob = "${peer}/**"\nresolve = "lww"\n`);
      const config = readConfig(configPath);
      expect(config.rulesPath).toBe(peerRulesPath(directory, peer));
      expect(config.rules).toEqual([{ glob: `${peer}/**`, resolve: "lww" }]);
      writeConfig(configPath, config);
      expect(fs.readFileSync(configPath, "utf8")).not.toContain("rules");
    }
  });

  test("rules can be deferred so a malformed peer does not block other peers", () => {
    const configPath = path.join(directory, ".sidecar");
    fs.writeFileSync(configPath, 'remote = "https://example.com/repo.git"\n');
    fs.writeFileSync(peerRulesPath(directory, "default"), "invalid toml");
    expect(() => readConfig(configPath)).toThrow("not valid TOML");
    const config = readConfig(configPath, { loadRules: false });
    expect(config.rules).toBeUndefined();
    expect(config.rulesPath).toBe(peerRulesPath(directory, "default"));
  });
});
