import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

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
  ensureGitignoreEntry,
} from "../src/cli.js";
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

  test("gitignore entry is root anchored", () => {
    const root = tempDir();
    const gitignorePath = path.join(root, ".gitignore");

    ensureGitignoreEntry(gitignorePath, "sidecar");

    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("/sidecar/\n");
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

  test("redacts text files in the sidecar tree before staging", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, "notes.md"), "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n", "utf8");

    const changed = scrubSidecarTree(repo);

    expect(changed).toBe(1);
    expect(fs.readFileSync(path.join(repo, "notes.md"), "utf8")).toBe("GITHUB_TOKEN=<TOKEN>\n");
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

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}
