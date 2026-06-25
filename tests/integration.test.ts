import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
    expect(fs.existsSync(path.join(main, "package.json"))).toBe(false);
    expect(gitRaw(["--git-dir", remote, "rev-parse", "--verify", "refs/heads/main"]).status).toBe(0);

    const inbox = git(path.join(main, "sidecar"), ["branch", "--show-current"]).stdout.trim();
    expect(inbox).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
  });

  test("init adds sidecar as a dev dependency when package.json exists", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ name: "app", dependencies: { leftpad: "1.0.0" } }, null, 2),
      "utf8",
    );

    const output = runSidecar(["init", remote, "--no-clone"], main, { SIDECAR_STATE_DIR: stateDir });

    expect(output).toContain("added devDependency @anteprojector/sidecar");
    const manifest = JSON.parse(fs.readFileSync(path.join(main, "package.json"), "utf8"));
    expect(manifest.dependencies).toEqual({ leftpad: "1.0.0" });
    expect(manifest.devDependencies["@anteprojector/sidecar"]).toBe("github:anteprojector/sidecar");
    const instances = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"));
    expect(instances).toHaveLength(1);
  });

  test("init supports sidecar paths outside the main repo without adding a gitignore entry", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const externalPath = path.join(tempDir(), "external-sidecar");

    const output = runSidecar(["init", remote, "--path", externalPath], main);

    expect(output).toContain("sidecar path outside repo; not updating");
    expect(fs.existsSync(path.join(externalPath, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(main, ".gitignore"))).toBe(false);
  });

  test("instances lists registered checkouts and writes the sidecar log", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();

    runSidecar(["init", remote], main, { SIDECAR_STATE_DIR: stateDir });
    const output = runSidecar(["instances"], main, { SIDECAR_STATE_DIR: stateDir });

    expect(output).toContain(`registry: ${path.join(stateDir, "instances.json")}`);
    expect(output).toContain(`log:      ${path.join(stateDir, "sidecar.log")}`);
    expect(output).toContain(main);
    expect(output).toContain("checkout: present");
    expect(output).toContain("dirty:   no");

    const instances = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"));
    expect(instances).toHaveLength(1);
    expect(fs.realpathSync(instances[0].root)).toBe(fs.realpathSync(main));
    expect(fs.realpathSync(instances[0].sidecarPath)).toBe(fs.realpathSync(path.join(main, "sidecar")));

    const log = fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8");
    expect(log).toContain('"event":"init"');
    expect(log).toContain('"event":"command"');
  });

  test("package-local-only execution does not register a global instance", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ dependencies: { "@anteprojector/sidecar": "0.1.0" } }),
      "utf8",
    );

    runSidecar(["init", remote], main, { SIDECAR_STATE_DIR: stateDir, SIDECAR_SKIP_LOCAL_EXEC: "1" });

    expect(fs.existsSync(path.join(stateDir, "instances.json"))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "sidecar.log"))).toBe(false);
  });

  test("postinstall registers a configured repo when a global sidecar exists", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ dependencies: { "@anteprojector/sidecar": "0.1.0" } }),
      "utf8",
    );
    runSidecar(["init", remote, "--no-clone"], main, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_LOCAL_EXEC: "1",
    });
    expect(fs.existsSync(path.join(stateDir, "instances.json"))).toBe(false);

    const binDir = tempDir();
    const fakeGlobal = path.join(binDir, process.platform === "win32" ? "sidecar.cmd" : "sidecar");
    fs.writeFileSync(
      fakeGlobal,
      [
        "#!/usr/bin/env node",
        'const { spawnSync } = require("node:child_process");',
        `const result = spawnSync(process.execPath, [${JSON.stringify(cliPath)}, ...process.argv.slice(2)], {`,
        '  stdio: "inherit",',
        '  env: { ...process.env, SIDECAR_GLOBAL_EXEC: "1" },',
        "});",
        "process.exit(result.status ?? 1);",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(fakeGlobal, 0o755);

    const result = spawnSync(process.execPath, [path.resolve("scripts/postinstall.js")], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        INIT_CWD: main,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
        SIDECAR_STATE_DIR: stateDir,
      },
    });

    expect(result.status).toBe(0);
    const instances = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"));
    expect(instances).toHaveLength(1);
    expect(fs.realpathSync(instances[0].root)).toBe(fs.realpathSync(main));
    expect(instances[0].remote).toBe(remote);
    expect(fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8")).toContain('"event":"install-register"');
  });

  test("daemon defaults enabled and can be disabled or enabled globally", () => {
    const project = tempDir();
    const stateDir = tempDir();

    const initial = runSidecar(["daemon", "status"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(initial).toContain("daemon:   enabled");
    expect(initial).toContain(`settings: ${path.join(stateDir, "settings.json")}`);
    expect(fs.existsSync(path.join(stateDir, "settings.json"))).toBe(false);

    const disabled = runSidecar(["daemon", "disable"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(disabled).toContain("daemon:   disabled");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8"))).toEqual({
      daemonEnabled: false,
    });

    const disabledStatus = runSidecar(["daemon", "status"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(disabledStatus).toContain("daemon:   disabled");

    const enabled = runSidecar(["daemon", "enable"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(enabled).toContain("daemon:   enabled");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8"))).toEqual({
      daemonEnabled: true,
    });

    const log = fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-disable"');
    expect(log).toContain('"event":"daemon-enable"');
  });

  test("daemon restart reinstalls the service and keeps daemon enabled", () => {
    const project = tempDir();
    const stateDir = tempDir();

    const output = runSidecar(["daemon", "restart"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });

    expect(output).toContain("daemon:   enabled");
    expect(output).toContain("service:  unavailable");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8"))).toEqual({
      daemonEnabled: true,
    });
    expect(fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8")).toContain('"event":"daemon-restart"');
  });

  test("tail prints the sidecar log", () => {
    const project = tempDir();
    const stateDir = tempDir();

    runSidecar(["daemon", "disable"], project, { SIDECAR_STATE_DIR: stateDir, SIDECAR_SKIP_SERVICE: "1" });
    const output = runSidecar(["tail"], project, { SIDECAR_STATE_DIR: stateDir });

    expect(output).toContain('"event":"daemon-disable"');
    expect(output).toContain('"event":"command"');
  });

  test("tail -f follows appended log lines", async () => {
    const project = tempDir();
    const stateDir = tempDir();
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "sidecar.log"), '{"event":"existing"}\n', "utf8");

    const processHandle = spawn(process.execPath, [cliPath, "tail", "-f"], {
      cwd: project,
      env: {
        ...process.env,
        SIDECAR_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    processHandle.stdout.setEncoding("utf8");
    processHandle.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    await waitFor(() => stdout.includes('"event":"existing"'));
    fs.appendFileSync(path.join(stateDir, "sidecar.log"), '{"event":"appended"}\n', "utf8");
    await waitFor(() => stdout.includes('"event":"appended"'));

    processHandle.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      processHandle.once("close", () => resolve());
    });
  });

  test("daemon run --once syncs dirty registered instances by default", () => {
    const { main, remote, sidecar } = initSidecarProject();
    fs.mkdirSync(path.join(sidecar, "notes"), { recursive: true });
    fs.writeFileSync(path.join(sidecar, "notes", "daemon.md"), "daemon\n", "utf8");

    const output = runSidecar(["daemon", "run", "--once"], main);

    expect(output).toContain("sidecar daemon polling");
    expect(git(sidecar, ["status", "--porcelain"]).stdout.trim()).toBe("");
    expect(gitRaw(["--git-dir", remote, "show", "main:notes/daemon.md"]).stdout).toBe("daemon\n");
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-sync-start"');
    expect(log).toContain('"event":"daemon-sync"');
    expect(log).toContain('"event":"daemon-cycle"');
  });

  test("daemon run --once pulls remote main changes for clean registered instances", () => {
    const { main, sidecar, remote } = initSidecarProject();
    const producer = cloneRemoteMain(remote);
    fs.mkdirSync(path.join(producer, "notes"), { recursive: true });
    fs.writeFileSync(path.join(producer, "notes", "remote-main.md"), "remote main\n", "utf8");
    git(producer, ["add", "."]);
    git(producer, ["commit", "-m", "Update remote main"]);
    git(producer, ["push", "origin", "HEAD:refs/heads/main"]);

    runSidecar(["daemon", "run", "--once"], main);

    expect(git(sidecar, ["show", "main:notes/remote-main.md"]).stdout).toBe("remote main\n");
    expect(fs.readFileSync(path.join(sidecar, "notes", "remote-main.md"), "utf8")).toBe("remote main\n");
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-sync-start"');
    expect(log).toContain('"remoteChanged":true');
  });

  test("daemon run --once merges remote inbox changes for clean registered instances", () => {
    const { main, sidecar, remote } = initSidecarProject();
    const producer = cloneRemoteMain(remote);
    git(producer, ["switch", "-c", "sidecar-inbox/test/remote"]);
    fs.mkdirSync(path.join(producer, "notes"), { recursive: true });
    fs.writeFileSync(path.join(producer, "notes", "remote-inbox.md"), "remote inbox\n", "utf8");
    git(producer, ["add", "."]);
    git(producer, ["commit", "-m", "Update remote inbox"]);
    git(producer, ["push", "origin", "HEAD:refs/heads/sidecar-inbox/test/remote"]);

    runSidecar(["daemon", "run", "--once"], main);

    expect(gitRaw(["--git-dir", remote, "show", "main:notes/remote-inbox.md"]).stdout).toBe("remote inbox\n");
    expect(fs.readFileSync(path.join(sidecar, "notes", "remote-inbox.md"), "utf8")).toBe("remote inbox\n");
    expect(git(sidecar, ["status", "--porcelain"]).stdout.trim()).toBe("");
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-sync-start"');
    expect(log).toContain('"remoteChanged":true');
  });

  test("daemon run --once clones registered instances with missing checkouts", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const output = runSidecar(["daemon", "run", "--once"], main);

    expect(output).toContain("sidecar daemon polling");
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-clone-start"');
    expect(log).toContain('"event":"daemon-clone"');
    expect(log).toContain('"cloned":1');
  });

  test("daemon run --once skips dirty instances when daemon is disabled", () => {
    const { main, sidecar } = initSidecarProject();
    runSidecar(["daemon", "disable"], main, { SIDECAR_SKIP_SERVICE: "1" });
    fs.writeFileSync(path.join(sidecar, "disabled.md"), "disabled\n", "utf8");

    runSidecar(["daemon", "run", "--once"], main);

    expect(git(sidecar, ["status", "--porcelain"]).stdout).toContain("disabled.md");
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-skip"');
    expect(log).toContain('"reason":"daemon-disabled"');
  });

  test("package-local-only execution cannot change daemon settings", () => {
    const project = tempDir();
    const stateDir = tempDir();
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { "@anteprojector/sidecar": "0.1.0" } }),
      "utf8",
    );

    const result = spawnSync(process.execPath, [cliPath, "daemon", "disable"], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        SIDECAR_STATE_DIR: stateDir,
        SIDECAR_SKIP_SERVICE: "1",
        SIDECAR_SKIP_LOCAL_EXEC: "1",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("daemon is only available from a globally installed sidecar");
    expect(fs.existsSync(path.join(stateDir, "settings.json"))).toBe(false);
  });

  test("sync snapshots, pushes the inbox branch, and merges it into main", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const inbox = git(sidecar, ["branch", "--show-current"]).stdout.trim();
    fs.writeFileSync(
      path.join(sidecar, "notes.md"),
      "OPENAI_API_KEY=sk-test1234567890abcdef\nemail alice@example.com\n",
      "utf8",
    );

    const output = runSidecar(["sync"], main);

    expect(output).toContain("redacted sensitive text");
    expect(output).toContain(`pushed ${inbox}`);
    const pushed = gitRaw(["--git-dir", remote, "show", `${inbox}:notes.md`]).stdout;
    expect(pushed).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(pushed).toContain("<EMAIL>");
    expect(pushed).not.toContain("sk-test");
    expect(pushed).not.toContain("alice@example.com");

    const merged = gitRaw(["--git-dir", remote, "show", "main:notes.md"]).stdout;
    expect(merged).toBe(pushed);
  });

  test("sync clones the sidecar checkout when it is missing", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote], main);
    fs.rmSync(path.join(main, "sidecar"), { recursive: true, force: true });

    const output = runSidecar(["sync"], main);

    expect(output).toContain("sidecar checkout ready");
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    expect(git(path.join(main, "sidecar"), ["status", "--porcelain"]).stdout.trim()).toBe("");
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

function cloneRemoteMain(remote: string): string {
  const repo = tempDir();
  gitRaw(["clone", "--branch", "main", remote, repo]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  return repo;
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

function runSidecar(args: string[], cwd: string, env: Record<string, string> = {}): string {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      SIDECAR_STATE_DIR: path.join(cwd, ".sidecar-test-state"),
      ...env,
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}
