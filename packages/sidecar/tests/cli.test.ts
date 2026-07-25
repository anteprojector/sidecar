import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DEFAULT_INBOX,
  checkoutRandom,
  expandInbox,
  fileLabel,
  forkConflicts,
  forkPath,
  git,
  gitRaw,
  readConfig,
  isAncestor,
  pendingInboxBranches,
  scrubSidecarTree,
  snapshot,
  type SidecarConfig,
  writeConfig,
  acquireSyncLock,
  ensureIgnoreEntry,
  ensureZedInclusion,
  hasZedInclusion,
  ignoreEntryForSidecarPath,
  removeIgnoreEntry,
  removeLegacyGitHooks,
  lastLines,
  parseGitHubRemote,
  formatLocalTimestamp,
  formatRelativeTime,
} from "../src/cli.js";
import { colorLevel, paint, stripColor } from "../src/color.js";
import { redactText } from "../src/redaction.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("config", () => {
  test("round-trips minimal config", () => {
    const root = tempDir();
    const configPath = path.join(root, ".sidecar");
    writeConfig(configPath, {
      remote: "git@github.com:org/repo-sidecar.git",
      version: 1,
      path: "metadata",
      branch: "main",
      inbox: DEFAULT_INBOX,
    });

    const config = readConfig(configPath);

    expect(config.remote).toBe("git@github.com:org/repo-sidecar.git");
    expect(config.path).toBe("metadata");
    expect(config.branch).toBe("main");
    expect(config.inbox).toBe(DEFAULT_INBOX);
  });

  test("parses TOML strings with comments and escapes", () => {
    const root = tempDir();
    const configPath = path.join(root, ".sidecar");
    fs.writeFileSync(
      configPath,
      [
        'remote = "git@github.com:org/repo#sidecar.git" # comment outside the value',
        'path = "meta\\\\data"',
        'branch = "main"',
        'inbox = "sidecar-inbox/{user}/{random}"',
        "",
      ].join("\n"),
      "utf8",
    );

    const config = readConfig(configPath);

    expect(config.remote).toBe("git@github.com:org/repo#sidecar.git");
    expect(config.path).toBe("meta\\data");
  });

  test("ignore entry is root anchored and idempotent", () => {
    const root = tempDir();
    const excludePath = path.join(root, "exclude");

    ensureIgnoreEntry(excludePath, "sidecar");
    ensureIgnoreEntry(excludePath, "sidecar");

    expect(fs.readFileSync(excludePath, "utf8")).toBe("/sidecar/\n");
  });

  test("removes migrated gitignore entries and deletes emptied files", () => {
    const root = tempDir();
    const gitignorePath = path.join(root, ".gitignore");

    fs.writeFileSync(gitignorePath, "node_modules/\n/sidecar/\n", "utf8");
    removeIgnoreEntry(gitignorePath, "sidecar");
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("node_modules/\n");

    fs.writeFileSync(gitignorePath, "/sidecar/\n", "utf8");
    removeIgnoreEntry(gitignorePath, "sidecar");
    expect(fs.existsSync(gitignorePath)).toBe(false);

    removeIgnoreEntry(gitignorePath, "sidecar");
    expect(fs.existsSync(gitignorePath)).toBe(false);
  });

  test("zed inclusion creates settings with the default inclusion preserved", () => {
    const root = tempDir();
    const settingsPath = path.join(root, ".zed", "settings.json");

    expect(hasZedInclusion(root, "sidecar")).toBe(false);
    expect(ensureZedInclusion(root, "sidecar")).toBe(true);
    expect(ensureZedInclusion(root, "sidecar")).toBe(true);
    expect(hasZedInclusion(root, "sidecar")).toBe(true);

    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual({
      file_scan_inclusions: [".env*", "sidecar/**"],
    });
  });

  test("zed inclusion merges into existing settings and skips unparseable ones", () => {
    const root = tempDir();
    const settingsPath = path.join(root, ".zed", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, '{\n  "theme": "One Dark",\n  "file_scan_inclusions": ["docs/**"]\n}\n', "utf8");

    expect(ensureZedInclusion(root, "sidecar")).toBe(true);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual({
      theme: "One Dark",
      file_scan_inclusions: ["docs/**", "sidecar/**"],
    });

    const jsonc = '{\n  // comment\n  "theme": "One Dark"\n}\n';
    fs.writeFileSync(settingsPath, jsonc, "utf8");
    expect(ensureZedInclusion(root, "sidecar")).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(jsonc);
  });

  test("does not produce ignore entries for sidecar paths outside the repo", () => {
    const root = tempDir();

    expect(ignoreEntryForSidecarPath(root, "sidecar")).toBe("sidecar");
    expect(ignoreEntryForSidecarPath(root, path.join(root, "sidecar"))).toBe("sidecar");
    expect(ignoreEntryForSidecarPath(root, "../external-sidecar")).toBeUndefined();
  });
});

describe("legacy git hooks", () => {
  test("removal deletes sidecar-owned hooks but preserves foreign hook content", () => {
    process.env.SIDECAR_STATE_DIR = tempDir();
    const repo = initRepo();
    const hooksDir = path.join(repo, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "post-commit"),
      '#!/bin/sh\n"$(dirname -- "$0")/sidecar-sync-hook" post-commit "$@" # sidecar-sync\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(hooksDir, "pre-push"),
      '#!/bin/sh\necho existing\n"$(dirname -- "$0")/sidecar-sync-hook" pre-push "$@" # sidecar-sync\n',
      "utf8",
    );
    fs.writeFileSync(path.join(hooksDir, "sidecar-sync-hook"), "#!/bin/sh\nexit 0\n", "utf8");
    fs.writeFileSync(path.join(repo, ".git", "sidecar-last-sync"), "0", "utf8");

    expect(removeLegacyGitHooks(repo)).toBe(true);

    expect(fs.existsSync(path.join(hooksDir, "post-commit"))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, "sidecar-sync-hook"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".git", "sidecar-last-sync"))).toBe(false);
    const prePush = fs.readFileSync(path.join(hooksDir, "pre-push"), "utf8");
    expect(prePush).toContain("echo existing");
    expect(prePush).not.toContain("sidecar-sync");
  });

  test("removal leaves unrelated hooks alone and reports nothing removed", () => {
    const repo = initRepo();
    const hooksDir = path.join(repo, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "pre-push"), "#!/bin/sh\necho existing\n", "utf8");

    expect(removeLegacyGitHooks(repo)).toBe(false);

    expect(fs.readFileSync(path.join(hooksDir, "pre-push"), "utf8")).toContain("echo existing");
  });
});

describe("sync lock", () => {
  test("is exclusive while held, released after, and stolen from dead holders", () => {
    const repo = initRepo();

    const release = acquireSyncLock(repo);
    expect(release).toBeDefined();
    expect(acquireSyncLock(repo)).toBeUndefined();
    release!();

    const second = acquireSyncLock(repo);
    expect(second).toBeDefined();
    // Simulate a crashed holder: overwrite the pid with one that cannot be running.
    fs.writeFileSync(path.join(repo, ".git", "sidecar-sync-lock", "pid"), "999999999", "utf8");
    const stolen = acquireSyncLock(repo);
    expect(stolen).toBeDefined();
    stolen!();
  });
});

describe("inbox identity", () => {
  test("uses a stable random checkout id", () => {
    const repo = initRepo();
    const config: SidecarConfig = {
      remote: "x",
      version: 1,
      path: "sidecar",
      branch: "main",
      inbox: DEFAULT_INBOX,
    };

    const first = expandInbox(config, repo);
    const second = expandInbox(config, repo);

    expect(first).toBe(second);
    expect(first).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
    expect(checkoutRandom(repo)).toBe(first.split("/").at(-1));
  });

  test("rejects templated inbox branches without a stable namespace", () => {
    const repo = initRepo();
    const config: SidecarConfig = {
      remote: "x",
      version: 1,
      path: "sidecar",
      branch: "main",
      inbox: "sidecar-{user}-{random}",
    };

    expect(() => expandInbox(config, repo)).toThrow(/static branch namespace/);
  });
});

describe("redaction", () => {
  test("redacts credentials and basic PII while preserving normal coding context", () => {
    const input = [
      "OPENAI_API_KEY=sk-test1234567890abcdef",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "email alice@example.com or 555-123-4567",
      "On May 20, 2026, update apps/backend/convex/messages.ts for Acme Corp.",
    ].join("\n");

    const redacted = redactText(input);

    expect(redacted).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(redacted).toContain("Authorization: Bearer <TOKEN>");
    expect(redacted).toContain("<EMAIL>");
    expect(redacted).toContain("<PHONENUMBER>");
    expect(redacted).not.toContain("sk-test");
    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).toContain("On May 20, 2026, update apps/backend/convex/messages.ts for Acme Corp.");
  });

  test("redacts env-style secret assignments", () => {
    const redacted = redactText(
      [
        "OPENAI_API_KEY=sk-test1234567890abcdef",
        "DATABASE_PASSWORD=\"hunter2\"",
        "AWS_SECRET_ACCESS_KEY='super-secret-value'",
        "PRIVATE_KEY=-----BEGIN_FAKE_KEY-----",
      ].join("\n"),
    );

    expect(redacted).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(redacted).toContain('DATABASE_PASSWORD="<SECRET>"');
    expect(redacted).toContain("AWS_SECRET_ACCESS_KEY='<SECRET>'");
    expect(redacted).toContain("PRIVATE_KEY=<SECRET>");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("super-secret-value");
  });

  test("redacts JSON secret fields", () => {
    const redacted = redactText(
      JSON.stringify({
        apiKey: "sk-test1234567890abcdef",
        nested: {
          refreshToken: "refresh-token-value",
          clientSecret: "client-secret-value",
        },
      }),
    );

    expect(redacted).toContain('"apiKey":"<API_KEY>"');
    expect(redacted).toContain('"refreshToken":"<TOKEN>"');
    expect(redacted).toContain('"clientSecret":"<SECRET>"');
    expect(redacted).not.toContain("sk-test");
    expect(redacted).not.toContain("refresh-token-value");
    expect(redacted).not.toContain("client-secret-value");
  });

  test("redacts YAML-style fields and bearer headers", () => {
    const redacted = redactText(
      [
        "token: ghp_abcdefghijklmnopqrstuvwxyz1234567890",
        "secret_key: very-secret",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      ].join("\n"),
    );

    expect(redacted).toContain("token: <TOKEN>");
    expect(redacted).toContain("secret_key: <SECRET>");
    expect(redacted).toContain("Authorization: Bearer <TOKEN>");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("very-secret");
    expect(redacted).not.toContain("eyJhbGciOi");
  });

  test("redacts common provider token patterns", () => {
    const slackToken = ["xo", "xb-1234567890-abcdefghijklmnop"].join("");
    const redacted = redactText(
      [
        "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
        "github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
        slackToken,
        "AKIAABCDEFGHIJKLMNOP",
        "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      ].join("\n"),
    );

    expect(redacted).toBe(["<API_KEY>", "<TOKEN>", "<TOKEN>", "<API_KEY>", "<TOKEN>"].join("\n"));
  });

  test("does not redact ordinary coding context or invalid card-like numbers", () => {
    const input = [
      "const tokenCount = 10;",
      "const secretSauce = recipe;",
      "On May 20, 2026, update apps/backend/convex/messages.ts for Acme Corp.",
      "tracking id 1234-5678-9012-3456",
    ].join("\n");

    expect(redactText(input)).toBe(input);
  });

  test("redacts valid credit-card-looking numbers", () => {
    expect(redactText("card: 4111 1111 1111 1111")).toBe("card: <CREDITCARD>");
  });

  test("redacts text files in the sidecar tree before staging", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, "notes.md"), "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n", "utf8");

    const changed = scrubSidecarTree(repo);

    expect(changed).toBe(1);
    expect(fs.readFileSync(path.join(repo, "notes.md"), "utf8")).toBe("GITHUB_TOKEN=<TOKEN>\n");
  });

  test("does not redact through symlinks", () => {
    const repo = initRepo();
    const external = path.join(tempDir(), "external.txt");
    fs.writeFileSync(external, "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n", "utf8");
    fs.symlinkSync(external, path.join(repo, "linked.txt"));

    const changed = scrubSidecarTree(repo);

    expect(changed).toBe(0);
    expect(fs.readFileSync(external, "utf8")).toBe("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n");
  });
});

describe("snapshot", () => {
  test("does not include the absolute main repo path in commit messages", () => {
    const main = initRepo();
    const sidecar = initRepo();
    fs.writeFileSync(path.join(sidecar, "notes.md"), "hello\n", "utf8");

    snapshot(sidecar, main, "sidecar-inbox/test/random");

    const message = git(sidecar, ["log", "-1", "--pretty=%B"]).stdout;
    expect(message).not.toContain("main-repo:");
    expect(message).not.toContain(main);
    expect(message).toContain("main-head:");
  });
});

describe("merge ancestry", () => {
  test("keeps inbox branches but skips tips already contained in main", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, "notes.md"), "base\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "base"]);
    git(repo, ["switch", "-c", "sidecar-inbox/test/random"]);
    fs.writeFileSync(path.join(repo, "notes.md"), "inbox\n", "utf8");
    git(repo, ["commit", "-am", "inbox"]);
    const inboxTip = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    git(repo, ["switch", "main"]);
    git(repo, ["merge", "--no-ff", "-m", "merge inbox", "sidecar-inbox/test/random"]);
    git(repo, ["update-ref", "refs/remotes/origin/sidecar-inbox/test/random", inboxTip]);

    const config: SidecarConfig = {
      remote: "x",
      version: 1,
      path: "sidecar",
      branch: "main",
      inbox: DEFAULT_INBOX,
    };
    const unmerged = pendingInboxBranches(repo, config).filter((branch) => !isAncestor(repo, branch, "HEAD"));

    expect(unmerged).toEqual([]);
  });
});

describe("conflict forking", () => {
  test("fork path keeps extension and flattens branch labels", () => {
    expect(forkPath("notes/plan.md", "sidecar-inbox/zack/random", "abcdef123")).toBe(
      "notes/plan.conflict.sidecar-inbox-zack-random.abcdef1.md",
    );
    expect(forkPath("TODO", "main", "abcdef123")).toBe("TODO.conflict.main.abcdef1");
    expect(fileLabel("sidecar-inbox/zack/random")).toBe("sidecar-inbox-zack-random");
  });

  test("manifest records metadata without duplicating file contents", () => {
    const repo = initRepo();
    fs.mkdirSync(path.join(repo, "notes"));
    fs.writeFileSync(path.join(repo, "notes", "plan.md"), "base\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "base"]);
    git(repo, ["switch", "-c", "sidecar-inbox/test/random"]);
    fs.writeFileSync(path.join(repo, "notes", "plan.md"), "inbox\n", "utf8");
    git(repo, ["commit", "-am", "inbox"]);
    git(repo, ["switch", "main"]);
    fs.writeFileSync(path.join(repo, "notes", "plan.md"), "main\n", "utf8");
    git(repo, ["commit", "-am", "main"]);
    git(repo, ["merge", "--no-ff", "sidecar-inbox/test/random"], { check: false });

    forkConflicts(repo, "origin/sidecar-inbox/test/random");

    const manifestDir = path.join(repo, ".sidecar-conflicts");
    const manifestPath = path.join(manifestDir, fs.readdirSync(manifestDir)[0]);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(JSON.stringify(manifest)).not.toContain("content_base64");
    expect(manifest.paths[0].versions[0]).toHaveProperty("sha256");
    expect(manifest.paths[0].versions[0]).toHaveProperty("path");
  });
});

describe("lastLines", () => {
  test("returns the trailing lines with a final newline", () => {
    expect(lastLines("a\nb\nc\n", 2)).toBe("b\nc\n");
  });

  test("handles content without a trailing newline", () => {
    expect(lastLines("a\nb\nc", 2)).toBe("b\nc\n");
  });

  test("returns everything when the limit exceeds the line count", () => {
    expect(lastLines("a\nb\n", 50)).toBe("a\nb\n");
  });

  test("returns empty output for empty content", () => {
    expect(lastLines("", 50)).toBe("");
    expect(lastLines("\n", 50)).toBe("");
  });
});

describe("parseGitHubRemote", () => {
  test("parses ssh remotes", () => {
    expect(parseGitHubRemote("git@github.com:org/repo.git")).toEqual({ owner: "org", repo: "repo" });
    expect(parseGitHubRemote("git@github.com:org/repo")).toEqual({ owner: "org", repo: "repo" });
  });

  test("parses https and ssh-url remotes", () => {
    expect(parseGitHubRemote("https://github.com/org/repo.git")).toEqual({ owner: "org", repo: "repo" });
    expect(parseGitHubRemote("https://github.com/org/repo")).toEqual({ owner: "org", repo: "repo" });
    expect(parseGitHubRemote("ssh://git@github.com/org/repo.git")).toEqual({ owner: "org", repo: "repo" });
  });

  test("rejects non-github remotes", () => {
    expect(parseGitHubRemote("git@gitlab.com:org/repo.git")).toBeUndefined();
    expect(parseGitHubRemote("/local/path/repo.git")).toBeUndefined();
  });
});

describe("status color", () => {
  const keys = ["NO_COLOR", "FORCE_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "TERM", "COLORTERM"];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of keys) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("stays off for piped output so `status | grep` sees no escapes", () => {
    expect(colorLevel({ isTTY: undefined })).toBe(0);
    expect(paint("brand", "sidecar", colorLevel({ isTTY: undefined }))).toBe("sidecar");
  });

  test("honors NO_COLOR and FORCE_COLOR=0 even on a tty", () => {
    process.env.NO_COLOR = "1";
    expect(colorLevel({ isTTY: true })).toBe(0);
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "0";
    expect(colorLevel({ isTTY: true })).toBe(0);
  });

  test("FORCE_COLOR overrides a non-tty, TERM=dumb does not color", () => {
    process.env.FORCE_COLOR = "1";
    expect(colorLevel({ isTTY: undefined })).toBeGreaterThan(0);
    delete process.env.FORCE_COLOR;
    process.env.TERM = "dumb";
    expect(colorLevel({ isTTY: true })).toBe(0);
  });

  test("picks the widest palette the terminal advertises", () => {
    process.env.COLORTERM = "truecolor";
    expect(colorLevel({ isTTY: true })).toBe(3);
    delete process.env.COLORTERM;
    process.env.TERM = "xterm-256color";
    expect(colorLevel({ isTTY: true })).toBe(2);
    process.env.TERM = "vt100";
    expect(colorLevel({ isTTY: true })).toBe(1);
  });

  test("brand yellow degrades from truecolor to 256 to basic", () => {
    expect(paint("brand", "x", 3)).toBe("\x1b[38;2;255;198;30mx\x1b[0m");
    expect(paint("brand", "x", 2)).toBe("\x1b[38;5;214mx\x1b[0m");
    expect(paint("brand", "x", 1)).toBe("\x1b[33mx\x1b[0m");
  });

  test("the repo purple degrades to 256 and then to magenta", () => {
    expect(paint("repo", "x", 3)).toBe("\x1b[38;2;139;92;246mx\x1b[0m");
    expect(paint("repo", "x", 2)).toBe("\x1b[38;5;99mx\x1b[0m");
    expect(paint("repo", "x", 1)).toBe("\x1b[35mx\x1b[0m");
  });

  test("attention is the brand yellow bolded, so it reads against the path", () => {
    expect(paint("attn", "yes", 2)).toBe("\x1b[1;38;5;214myes\x1b[0m");
    expect(paint("ok", "running", 2)).toBe("\x1b[32mrunning\x1b[0m");
    expect(paint("bad", "stopped", 2)).toBe("\x1b[31mstopped\x1b[0m");
    expect(paint("label", "dirty:", 2)).toBe("\x1b[2mdirty:\x1b[0m");
  });

  test("stripColor undoes painting", () => {
    expect(stripColor(paint("attn", "2", 3))).toBe("2");
  });
});

describe("relative timestamps", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  const ago = (ms: number): string | undefined =>
    formatRelativeTime(new Date(now - ms).toISOString(), now);

  test("floors so it never overstates the age", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(44_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(119_000)).toBe("1 minute ago");
    expect(ago(4 * 60_000)).toBe("4 minutes ago");
    expect(ago(90 * 60_000)).toBe("1 hour ago");
    expect(ago(26 * 3_600_000)).toBe("1 day ago");
    expect(ago(30 * 86_400_000)).toBe("4 weeks ago");
    expect(ago(70 * 86_400_000)).toBe("2 months ago");
    expect(ago(800 * 86_400_000)).toBe("2 years ago");
  });

  test("reads a clock-skewed future timestamp as just now", () => {
    expect(ago(-30_000)).toBe("just now");
    expect(ago(-86_400_000)).toBe("just now");
  });

  test("returns undefined for unparseable input", () => {
    expect(formatRelativeTime("not a date", now)).toBeUndefined();
    expect(formatLocalTimestamp("not a date")).toBeUndefined();
  });

  test("formats local wall-clock time to the minute", () => {
    expect(formatLocalTimestamp(new Date(now).toISOString())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-test-"));
  tempRoots.push(root);
  return root;
}

function initRepo(): string {
  const repo = tempDir();
  gitRaw(["init", "-b", "main", repo]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  return repo;
}
