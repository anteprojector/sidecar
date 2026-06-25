import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import { git, gitRaw } from "../src/cli.js";

const tempRoots: string[] = [];
const cliPath = path.resolve("dist/cli.js");

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("sidecar CLI integration", () => {
  test("global executable delegates to a project-local sidecar dependency", () => {
    const project = tempDir();
    const localBin = path.join(project, "node_modules", "@anteprojector", "sidecar", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { "@anteprojector/sidecar": "0.1.0" } }),
      "utf8",
    );
    fs.writeFileSync(
      localBin,
      "console.log(JSON.stringify({ local: true, argv: process.argv.slice(2), skip: process.env.SIDECAR_SKIP_LOCAL_EXEC }))\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [cliPath, "status"], {
      cwd: project,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ local: true, argv: ["status"], skip: "1" });
  });

  test("init writes config, bootstraps sidecar main, and creates an inbox branch", () => {
    const main = initMainRepo();
    const remote = initBareRemote();

    const output = runSidecar(["init", remote], main);

    expect(output).toContain("sidecar checkout ready");
    expect(fs.readFileSync(path.join(main, ".sidecar"), "utf8")).toContain(
      'inbox = "sidecar-inbox/{user}/{random}"',
    );
    expect(fs.readFileSync(path.join(main, ".gitignore"), "utf8")).toContain("/sidecar/");
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    expect(gitRaw(["--git-dir", remote, "rev-parse", "--verify", "refs/heads/main"]).status).toBe(0);

    const inbox = git(path.join(main, "sidecar"), ["branch", "--show-current"]).stdout.trim();
    expect(inbox).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
  });

  test("push snapshots redacted text to the checkout-specific inbox branch", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const inbox = git(sidecar, ["branch", "--show-current"]).stdout.trim();
    fs.writeFileSync(
      path.join(sidecar, "notes.md"),
      "OPENAI_API_KEY=sk-test1234567890abcdef\nemail alice@example.com\n",
      "utf8",
    );

    const output = runSidecar(["push"], main);

    expect(output).toContain("redacted sensitive text");
    expect(output).toContain(`pushed ${inbox}`);
    const pushed = gitRaw(["--git-dir", remote, "show", `${inbox}:notes.md`]).stdout;
    expect(pushed).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(pushed).toContain("<EMAIL>");
    expect(pushed).not.toContain("sk-test");
    expect(pushed).not.toContain("alice@example.com");
  });

  test("separate checkouts use separate random inbox branches for the same remote", () => {
    const remote = initBareRemote();
    const firstMain = initMainRepo();
    const secondMain = initMainRepo();

    runSidecar(["init", remote], firstMain);
    gitRaw(["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/master"]);
    runSidecar(["init", remote], secondMain);

    const firstInbox = git(path.join(firstMain, "sidecar"), ["branch", "--show-current"]).stdout.trim();
    const secondInbox = git(path.join(secondMain, "sidecar"), ["branch", "--show-current"]).stdout.trim();

    expect(firstInbox).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
    expect(secondInbox).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
    expect(firstInbox).not.toBe(secondInbox);
  });

  test("merge forks conflicts, retains inbox branches, and skips already-merged tips", () => {
    const { main, remote, sidecar } = initSidecarProject();
    seedRemoteConflict(sidecar);

    const firstMerge = runSidecar(["merge", "--fork-files"], main);

    expect(firstMerge).toContain("merged 1 inbox branch(es)");
    expect(gitRaw(["--git-dir", remote, "rev-parse", "--verify", "refs/heads/sidecar-inbox/test/conflict"]).status).toBe(
      0,
    );

    const conflictFiles = fs
      .readdirSync(path.join(sidecar, "notes"))
      .filter((name) => name.includes(".conflict."));
    expect(conflictFiles).toHaveLength(2);
    const manifestDir = path.join(sidecar, ".sidecar-conflicts");
    const manifestPath = path.join(manifestDir, fs.readdirSync(manifestDir)[0]);
    const manifestText = fs.readFileSync(manifestPath, "utf8");
    expect(manifestText).not.toContain("content_base64");
    expect(manifestText).toContain("sidecar-inbox/test/conflict");

    const secondMerge = runSidecar(["merge", "--fork-files"], main);

    expect(secondMerge).toContain("no inbox branches to merge");
  });
});

function initSidecarProject(): { main: string; remote: string; sidecar: string } {
  const main = initMainRepo();
  const remote = initBareRemote();
  runSidecar(["init", remote], main);
  return { main, remote, sidecar: path.join(main, "sidecar") };
}

function seedRemoteConflict(sidecar: string): void {
  git(sidecar, ["switch", "main"]);
  fs.mkdirSync(path.join(sidecar, "notes"), { recursive: true });
  fs.writeFileSync(path.join(sidecar, "notes", "plan.md"), "base\n", "utf8");
  git(sidecar, ["add", "."]);
  git(sidecar, ["commit", "-m", "Add base plan"]);
  git(sidecar, ["push", "origin", "HEAD:refs/heads/main"]);

  git(sidecar, ["switch", "-c", "sidecar-inbox/test/conflict", "main"]);
  fs.writeFileSync(path.join(sidecar, "notes", "plan.md"), "inbox\n", "utf8");
  git(sidecar, ["commit", "-am", "Update plan from inbox"]);
  git(sidecar, ["push", "origin", "HEAD:refs/heads/sidecar-inbox/test/conflict"]);

  git(sidecar, ["switch", "main"]);
  fs.writeFileSync(path.join(sidecar, "notes", "plan.md"), "main\n", "utf8");
  git(sidecar, ["commit", "-am", "Update plan from main"]);
  git(sidecar, ["push", "origin", "HEAD:refs/heads/main"]);
}

function initMainRepo(): string {
  const repo = tempDir();
  gitRaw(["init", "-b", "main", repo]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(repo, "README.md"), "# Main\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "Initial main"]);
  return repo;
}

function initBareRemote(): string {
  const remote = path.join(tempDir(), "sidecar.git");
  gitRaw(["init", "--bare", remote]);
  return remote;
}

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-it-"));
  tempRoots.push(root);
  return root;
}

function runSidecar(args: string[], cwd: string): string {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      [`sidecar ${args.join(" ")} failed with ${result.status}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout;
}
