import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  gitignoreEntryForSidecarPath,
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

  test("gitignore entry is root anchored", () => {
    const root = tempDir();
    const gitignorePath = path.join(root, ".gitignore");

    ensureGitignoreEntry(gitignorePath, "sidecar");

    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("/sidecar/\n");
  });

  test("does not produce gitignore entries for sidecar paths outside the repo", () => {
    const root = tempDir();

    expect(gitignoreEntryForSidecarPath(root, "sidecar")).toBe("sidecar");
    expect(gitignoreEntryForSidecarPath(root, path.join(root, "sidecar"))).toBe("sidecar");
    expect(gitignoreEntryForSidecarPath(root, "../external-sidecar")).toBeUndefined();
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
