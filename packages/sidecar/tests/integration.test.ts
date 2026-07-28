import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import { git, gitRaw, syncLockDir } from "../src/cli.js";

const tempRoots: string[] = [];
const cliPath = path.resolve("dist/cli.js");

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe("sidecar CLI integration", () => {
  test("global executable delegates to a project-local sidecar dependency", () => {
    const project = tempDir();
    const localBin = path.join(project, "node_modules", "sidecarsync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
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
    expect(git(main, ["status", "--porcelain"]).stdout).not.toMatch(/^\?\? sidecar\//m);
    // Non-interactive runs must not opt into editor settings.
    expect(fs.existsSync(path.join(main, ".zed"))).toBe(false);
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    expect(fs.existsSync(path.join(main, "package.json"))).toBe(false);
    expect(gitRaw(["--git-dir", remote, "rev-parse", "--verify", "refs/heads/main"]).status).toBe(0);

    const inbox = git(path.join(main, "sidecar"), ["branch", "--show-current"]).stdout.trim();
    expect(inbox).toMatch(/^sidecar-inbox\/.+\/[a-f0-9]{12}$/);
  });

  test("init leaves an existing package.json untouched", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    const manifestBefore = JSON.stringify({ name: "app", dependencies: { leftpad: "1.0.0" } }, null, 2);
    fs.writeFileSync(path.join(main, "package.json"), manifestBefore, "utf8");

    const output = runSidecar(["init", remote, "--no-clone"], main, { SIDECAR_STATE_DIR: stateDir });

    expect(output).not.toContain("devDependency");
    expect(fs.readFileSync(path.join(main, "package.json"), "utf8")).toBe(manifestBefore);
    const instances = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"));
    expect(instances).toHaveLength(1);
  });

  test("init without a remote reuses existing sidecar config", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const output = runSidecar(["init"], main);

    expect(output).toContain(`using ${path.join(fs.realpathSync(main), ".sidecar")}`);
    expect(output).toContain("sidecar checkout ready");
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
  });

  test("init with an unchanged remote reuses the existing config", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const output = runSidecar(["init", remote, "--no-clone"], main);

    expect(output).toContain(`using ${path.join(fs.realpathSync(main), ".sidecar")}`);
  });

  test("init with a different remote refuses to overwrite the config non-interactively", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const otherRemote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);
    const configBefore = fs.readFileSync(path.join(main, ".sidecar"), "utf8");

    const result = spawnSync(process.execPath, [cliPath, "init", otherRemote, "--no-clone"], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
    expect(fs.readFileSync(path.join(main, ".sidecar"), "utf8")).toBe(configBefore);
  });

  test("init migrates an interim .git/info/exclude entry back to .gitignore", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const excludePath = path.join(main, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.writeFileSync(excludePath, "# comment\n/sidecar/\n", "utf8");

    runSidecar(["init", remote, "--no-clone"], main);

    expect(fs.readFileSync(path.join(main, ".gitignore"), "utf8")).toContain("/sidecar/");
    expect(fs.readFileSync(excludePath, "utf8")).not.toContain("/sidecar/");
  });

  test("deinit deletes artifacts created by init while preserving unrelated project configuration", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = path.join(main, ".sidecar-state");
    runSidecar(["init", remote], main, { SIDECAR_STATE_DIR: stateDir });
    fs.writeFileSync(path.join(main, ".gitignore"), "node_modules/\n/sidecar/\n", "utf8");
    fs.mkdirSync(path.join(main, ".zed"), { recursive: true });
    fs.writeFileSync(
      path.join(main, ".zed", "settings.json"),
      `${JSON.stringify({ theme: "One Dark", file_scan_inclusions: [".env*", "sidecar/**", "docs/**"] }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(main, "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          devDependencies: { "sidecarsync": "0.6.0", vitest: "3.2.7" },
          dependencies: { react: "19.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const output = runSidecar(["deinit"], main, { SIDECAR_STATE_DIR: stateDir });

    expect(output).toContain(`removed sidecar from ${fs.realpathSync(main)}`);
    expect(fs.existsSync(path.join(main, ".sidecar"))).toBe(false);
    expect(fs.existsSync(path.join(main, "sidecar"))).toBe(false);
    expect(fs.readFileSync(path.join(main, ".gitignore"), "utf8")).toBe("node_modules/\n");
    expect(JSON.parse(fs.readFileSync(path.join(main, ".zed", "settings.json"), "utf8"))).toEqual({
      theme: "One Dark",
      file_scan_inclusions: [".env*", "docs/**"],
    });
    expect(JSON.parse(fs.readFileSync(path.join(main, "package.json"), "utf8"))).toEqual({
      name: "app",
      devDependencies: { "sidecarsync": "0.6.0", vitest: "3.2.7" },
      dependencies: { react: "19.0.0" },
    });
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"))).toEqual([]);
  });

  test("deinit outside a repo and away from any config warns and exits successfully", () => {
    const outside = tempDir();
    const result = spawnSync(process.execPath, [cliPath, "deinit"], {
      cwd: outside,
      encoding: "utf8",
      env: { ...process.env, SIDECAR_STATE_DIR: path.join(outside, "state") },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("warning: no .sidecar config or Git repository found; nothing to remove");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test("deinit does not guess checkout ownership when config is missing", () => {
    const main = initMainRepo();
    fs.mkdirSync(path.join(main, "sidecar"));
    fs.writeFileSync(path.join(main, "sidecar", "keep.txt"), "not managed by Sidecar\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "deinit"], {
      cwd: main,
      encoding: "utf8",
      env: { ...process.env, SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state") },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("no .sidecar config found");
    // Skipped steps roll up into one closing summary the user can act on.
    expect(result.stderr).toContain("deinit could not fully complete");
    expect(result.stderr).toContain("ask your agent to scrub any remaining traces of sidecar");
    expect(fs.readFileSync(path.join(main, "sidecar", "keep.txt"), "utf8")).toBe("not managed by Sidecar\n");
  });

  test("init does not install git hooks and sync removes hooks left by old versions", () => {
    const { main } = initSidecarProject();
    const hooksDir = path.join(main, ".git", "hooks");
    expect(fs.existsSync(path.join(hooksDir, "post-commit"))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, "pre-push"))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, "sidecar-sync-hook"))).toBe(false);

    // Simulate hooks written by an earlier sidecar version.
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "post-commit"),
      '#!/bin/sh\n"$(dirname -- "$0")/sidecar-sync-hook" post-commit "$@" # sidecar-sync\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(hooksDir, "pre-push"),
      '#!/bin/sh\necho custom\n"$(dirname -- "$0")/sidecar-sync-hook" pre-push "$@" # sidecar-sync\n',
      "utf8",
    );
    fs.writeFileSync(path.join(hooksDir, "sidecar-sync-hook"), "#!/bin/sh\nexit 0\n", "utf8");

    runSidecar(["sync"], main);

    expect(fs.existsSync(path.join(hooksDir, "post-commit"))).toBe(false);
    const prePush = fs.readFileSync(path.join(hooksDir, "pre-push"), "utf8");
    expect(prePush).toContain("echo custom");
    expect(prePush).not.toContain("sidecar-sync");
    expect(fs.existsSync(path.join(hooksDir, "sidecar-sync-hook"))).toBe(false);
  });

  test("global executable runs daemon commands itself instead of delegating locally", () => {
    const project = tempDir();
    const localBin = path.join(project, "node_modules", "sidecarsync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
      "utf8",
    );
    fs.writeFileSync(localBin, "console.log(JSON.stringify({ local: true }))\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "daemon", "status"], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        SIDECAR_STATE_DIR: path.join(project, ".sidecar-test-state"),
        SIDECAR_SKIP_SERVICE: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("local");
    expect(result.stdout).toContain("daemon:");
  });

  test("daemon commands refuse to run from a project-local executable", () => {
    const project = tempDir();
    const localBin = path.join(project, "node_modules", "sidecarsync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
      "utf8",
    );
    fs.copyFileSync(cliPath, localBin);

    const result = spawnSync(process.execPath, [localBin, "daemon", "status"], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        SIDECAR_STATE_DIR: path.join(project, ".sidecar-test-state"),
        SIDECAR_SKIP_SERVICE: "1",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("globally installed sidecar");
  });

  test("--version prints the package version", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

    const result = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(manifest.version);
  });

  test("clone --if-missing clones once and leaves an existing checkout untouched", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    runSidecar(["clone", "--if-missing"], main);
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);

    const marker = path.join(main, "sidecar", "marker.txt");
    fs.writeFileSync(marker, "keep\n", "utf8");
    const output = runSidecar(["clone", "--if-missing"], main);

    expect(output).not.toContain("sidecar checkout ready");
    expect(fs.existsSync(marker)).toBe(true);
  });

  test("a second working copy links to the primary's checkout instead of cloning again", () => {
    const { main, worktree, state } = initWorktreeFamily();

    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });

    // A clone keeps a .git directory; a linked worktree keeps a .git file.
    expect(fs.statSync(path.join(main, "sidecar", ".git")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(worktree, "sidecar", ".git")).isFile()).toBe(true);

    // One object store, one working copy each, and an inbox branch per checkout.
    const listed = git(path.join(main, "sidecar"), ["worktree", "list", "--porcelain"]).stdout;
    expect(listed).toContain(fs.realpathSync(path.join(worktree, "sidecar")));
    const inboxOf = (cwd: string): string =>
      JSON.parse(runSidecar(["status", "--json"], cwd, { SIDECAR_STATE_DIR: state })).inbox;
    expect(inboxOf(worktree)).not.toBe(inboxOf(main));
  });

  test("a secondary cloning first creates the primary's checkout, then links to it", () => {
    const { main, worktree, state } = initWorktreeFamily();
    // The ordering a fresh working copy actually hits: postinstall runs there
    // before anything has populated the primary.
    fs.rmSync(path.join(main, "sidecar"), { recursive: true, force: true });

    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });

    expect(fs.statSync(path.join(main, "sidecar", ".git")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(worktree, "sidecar", ".git")).isFile()).toBe(true);
  });

  test("a snapshot in one working copy reaches its sibling without being pushed", () => {
    const { main, worktree, remote, state } = initWorktreeFamily();
    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });

    fs.writeFileSync(path.join(worktree, "sidecar", "from-worktree.md"), "wt\n", "utf8");
    // snapshot commits and stops; nothing reaches the remote.
    runSidecar(["snapshot"], worktree, { SIDECAR_STATE_DIR: state });
    expect(
      gitRaw(["--git-dir", remote, "cat-file", "-e", "main:from-worktree.md"], { check: false }).status,
    ).not.toBe(0);

    const output = runSidecar(["sync"], main, { SIDECAR_STATE_DIR: state });

    // The local ref, not origin/ — the sibling's work never made a round trip.
    expect(output).toMatch(/merging sidecar-inbox\//);
    expect(fs.readFileSync(path.join(main, "sidecar", "from-worktree.md"), "utf8")).toBe("wt\n");
  });

  test("sync --local settles siblings with no remote in existence", () => {
    const { main, worktree, remote, state } = initWorktreeFamily();
    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });
    // Deleting the remote outright is the strongest available proof that the
    // local phase never reaches for it.
    fs.rmSync(remote, { recursive: true, force: true });

    fs.writeFileSync(path.join(main, "sidecar", "local-only.md"), "local\n", "utf8");
    runSidecar(["sync", "--local"], main, { SIDECAR_STATE_DIR: state });

    expect(fs.readFileSync(path.join(worktree, "sidecar", "local-only.md"), "utf8")).toBe("local\n");
  });

  test("the local phase settles siblings even when the remote phase fails", () => {
    const { main, worktree, remote, state } = initWorktreeFamily();
    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });
    fs.rmSync(remote, { recursive: true, force: true });

    fs.writeFileSync(path.join(main, "sidecar", "offline.md"), "offline\n", "utf8");
    const result = spawnSync(process.execPath, [cliPath, "sync"], {
      cwd: main,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: state },
    });

    // The sync fails, loudly and for the right reason — and the sibling is
    // current anyway, because local settling ran before anything could fail.
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(path.join(worktree, "sidecar", "offline.md"), "utf8")).toBe("offline\n");
  });

  test("deinit in a secondary unregisters its worktree and leaves the primary whole", () => {
    const { main, worktree, state } = initWorktreeFamily();
    runSidecar(["clone", "--if-missing"], worktree, { SIDECAR_STATE_DIR: state });

    runSidecar(["deinit"], worktree, { SIDECAR_STATE_DIR: state });

    expect(fs.existsSync(path.join(worktree, "sidecar"))).toBe(false);
    // A deleted-but-registered worktree would block a later add at that path.
    const listed = git(path.join(main, "sidecar"), ["worktree", "list", "--porcelain"]).stdout;
    expect(listed).not.toContain(fs.realpathSync(worktree));
    expect(fs.statSync(path.join(main, "sidecar", ".git")).isDirectory()).toBe(true);
  });

  test("postinstall clones a missing sidecar checkout for local installs", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const result = spawnSync(process.execPath, [path.resolve("scripts", "postinstall.js")], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        INIT_CWD: main,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    expect(fs.existsSync(path.join(main, ".git", "hooks", "post-commit"))).toBe(false);
    expect(fs.existsSync(path.join(main, ".git", "hooks", "sidecar-sync-hook"))).toBe(false);
  });

  test("clone does not create editor settings", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);
    fs.rmSync(path.join(main, ".zed"), { recursive: true, force: true });

    runSidecar(["clone"], main);

    expect(git(main, ["status", "--porcelain"]).stdout).not.toMatch(/^\?\? sidecar\//m);
    expect(fs.existsSync(path.join(main, ".zed"))).toBe(false);
  });

  test("init without a remote requires an interactive prompt when config is missing", () => {
    const main = initMainRepo();

    const result = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("remote URL is required when no .sidecar config exists");
    expect(fs.existsSync(path.join(main, ".sidecar"))).toBe(false);
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
    expect(output).toMatch(/dirty:\s+no/);

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
    const pathWithoutSidecar = tempDir();
    fs.symlinkSync(findExecutable("git"), path.join(pathWithoutSidecar, "git"));
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
      "utf8",
    );

    runSidecar(["init", remote], main, {
      PATH: pathWithoutSidecar,
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_LOCAL_EXEC: "1",
    });

    expect(fs.existsSync(path.join(stateDir, "instances.json"))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "sidecar.log"))).toBe(false);
  });

  test("local init registers the repo through an existing global sidecar", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.2.0" } }),
      "utf8",
    );

    const binDir = tempDir();
    const fakeGlobal = path.join(binDir, process.platform === "win32" ? "sidecar.cmd" : "sidecar");
    fs.writeFileSync(
      fakeGlobal,
      [
        "#!/usr/bin/env node",
        'const { spawnSync } = require("node:child_process");',
        `const result = spawnSync(process.execPath, [${JSON.stringify(cliPath)}, ...process.argv.slice(2)], {`,
        '  stdio: "inherit",',
        '  env: { ...process.env, SIDECAR_GLOBAL_EXEC: "1", SIDECAR_SKIP_LOCAL_EXEC: "1" },',
        "});",
        "process.exit(result.status ?? 1);",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(fakeGlobal, 0o755);

    runSidecar(["init", remote, "--no-clone"], main, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_LOCAL_EXEC: "1",
    });

    const instances = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"));
    expect(instances).toHaveLength(1);
    expect(fs.realpathSync(instances[0].root)).toBe(fs.realpathSync(main));
    expect(fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8")).toContain('"event":"install-register"');
  });

  test("postinstall registers a configured repo when a global sidecar exists", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    const stateDir = tempDir();
    const pathWithoutSidecar = tempDir();
    fs.symlinkSync(findExecutable("git"), path.join(pathWithoutSidecar, "git"));
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
      "utf8",
    );
    runSidecar(["init", remote, "--no-clone"], main, {
      PATH: pathWithoutSidecar,
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
      autoUpdate: true,
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
      autoUpdate: true,
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
      autoUpdate: true,
    });
    expect(fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8")).toContain('"event":"daemon-restart"');
  });

  test("update installs the newer registry version and reports it", () => {
    const project = tempDir();
    const stateDir = tempDir();
    const binDir = tempDir();
    const marker = path.join(tempDir(), "npm-calls.log");
    fs.writeFileSync(
      path.join(binDir, "npm"),
      `#!/bin/sh\necho "$@" >> "${marker}"\nif [ "$1" = "view" ]; then echo "9.9.9"; fi\nexit 0\n`,
      "utf8",
    );
    fs.chmodSync(path.join(binDir, "npm"), 0o755);

    const output = runSidecar(["update"], project, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });

    expect(output).toContain("updated sidecar");
    expect(output).toContain("-> v9.9.9");
    const calls = fs.readFileSync(marker, "utf8");
    expect(calls).toContain("view sidecarsync version");
    expect(calls).toContain("install -g sidecarsync@9.9.9");
    expect(fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8")).toContain('"event":"manual-update"');
  });

  test("update reports up to date when the registry matches", () => {
    const project = tempDir();
    const stateDir = tempDir();
    const binDir = tempDir();
    const ownVersion = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version;
    fs.writeFileSync(
      path.join(binDir, "npm"),
      `#!/bin/sh\nif [ "$1" = "view" ]; then echo "${ownVersion}"; fi\nexit 0\n`,
      "utf8",
    );
    fs.chmodSync(path.join(binDir, "npm"), 0o755);

    const output = runSidecar(["update"], project, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });

    expect(output).toContain(`sidecar v${ownVersion} is up to date`);
  });

  test("daemon autoupdate can be toggled off and on", () => {
    const project = tempDir();
    const stateDir = tempDir();

    const off = runSidecar(["daemon", "autoupdate", "off"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(off).toContain("autoupdate: off");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8"))).toEqual({
      daemonEnabled: true,
      autoUpdate: false,
    });

    const status = runSidecar(["daemon", "status"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(status).toContain("update:   manual");

    const on = runSidecar(["daemon", "autoupdate", "on"], project, {
      SIDECAR_STATE_DIR: stateDir,
      SIDECAR_SKIP_SERVICE: "1",
    });
    expect(on).toContain("autoupdate: on");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8"))).toEqual({
      daemonEnabled: true,
      autoUpdate: true,
    });
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
    expect(log).toContain('"event":"daemon-sync"');
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
    expect(log).toContain('"event":"daemon-sync"');
  });

  test("daemon run --once clones registered instances with missing checkouts", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const output = runSidecar(["daemon", "run", "--once"], main);

    expect(output).toContain("sidecar daemon polling");
    expect(fs.existsSync(path.join(main, "sidecar", ".git"))).toBe(true);
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-sync-start"');
    expect(log).toContain('"event":"daemon-sync"');
    expect(log).toContain('"synced":1');
  });

  test("daemon run --once delegates syncing to a project-local sidecar install", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    // Adding the dependency and a fake local CLI afterwards simulates a repo
    // whose local sidecar version must own its own sync.
    fs.writeFileSync(
      path.join(main, "package.json"),
      JSON.stringify({ devDependencies: { "sidecarsync": "0.2.0" } }),
      "utf8",
    );
    const localCli = path.join(main, "node_modules", "sidecarsync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localCli), { recursive: true });
    fs.writeFileSync(
      localCli,
      'require("node:fs").writeFileSync(__filename + ".marker", JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n',
      "utf8",
    );

    runSidecar(["daemon", "run", "--once"], main);

    const marker = JSON.parse(fs.readFileSync(`${localCli}.marker`, "utf8"));
    expect(marker.argv).toEqual(["sync"]);
    expect(fs.realpathSync(marker.cwd)).toBe(fs.realpathSync(main));
    const log = fs.readFileSync(path.join(main, ".sidecar-test-state", "sidecar.log"), "utf8");
    expect(log).toContain('"event":"daemon-sync"');
    expect(log).toContain('"local":true');
  });

  test(
    "daemon watches registered sidecars and syncs after the debounce",
    async () => {
      const { main, remote, sidecar } = initSidecarProject();
      const stateDir = path.join(main, ".sidecar-test-state");
      const logPath = path.join(stateDir, "sidecar.log");
      const daemon = spawn(
        process.execPath,
        [cliPath, "daemon", "run", "--interval", "3600", "--debounce", "1"],
        {
          cwd: main,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            SIDECAR_STATE_DIR: stateDir,
            SIDECAR_SKIP_SERVICE: "1",
            SIDECAR_SKIP_UPDATE: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      try {
        await waitFor(
          () => fs.existsSync(logPath) && fs.readFileSync(logPath, "utf8").includes('"event":"daemon-watch"'),
          30000,
        );
        // Wait out the post-sync echo grace so the write is seen as new work.
        await new Promise((resolve) => setTimeout(resolve, 6000));
        fs.writeFileSync(path.join(sidecar, "watched.md"), "watched\n", "utf8");
        await waitFor(
          () => gitRaw(["--git-dir", remote, "cat-file", "-e", "main:watched.md"], { check: false }).status === 0,
          30000,
        );
      } finally {
        daemon.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          daemon.once("close", () => resolve());
        });
        // The daemon spawns syncs as children; killing it does not kill an
        // in-flight sync, so wait for the lock to clear before cleanup.
        await waitFor(() => !fs.existsSync(testSyncLockDir(main)), 15000);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    60000,
  );

  test(
    "daemon exits when its install is updated in place so the service restarts it",
    async () => {
      // Run the daemon from a disposable copy of the package so the manifest
      // can be rewritten underneath it, like `npm install -g` does.
      const pkgRoot = path.join(tempDir(), "pkg");
      fs.mkdirSync(path.join(pkgRoot, "dist"), { recursive: true });
      const manifestPath = path.join(pkgRoot, "package.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ name: "sidecarsync", version: "9.9.9", type: "module" }),
        "utf8",
      );
      fs.copyFileSync(cliPath, path.join(pkgRoot, "dist", "cli.js"));

      const stateDir = tempDir();
      const logPath = path.join(stateDir, "sidecar.log");
      const pathWithoutSidecar = tempDir();
      fs.symlinkSync(findExecutable("git"), path.join(pathWithoutSidecar, "git"));

      const daemon = spawn(
        process.execPath,
        [path.join(pkgRoot, "dist", "cli.js"), "daemon", "run", "--interval", "1"],
        {
          cwd: pkgRoot,
          env: {
            ...process.env,
            PATH: pathWithoutSidecar,
            SIDECAR_STATE_DIR: stateDir,
            SIDECAR_SKIP_SERVICE: "1",
            SIDECAR_SKIP_UPDATE: "1",
            SIDECAR_SKIP_LOCAL_EXEC: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        daemon.once("close", (code) => resolve(code));
      });

      try {
        await waitFor(
          () => fs.existsSync(logPath) && fs.readFileSync(logPath, "utf8").includes('"event":"daemon-start"'),
          15000,
        );
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ name: "sidecarsync", version: "9.9.10", type: "module" }),
          "utf8",
        );

        const code = await Promise.race([
          exited,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("daemon did not exit")), 15000)),
        ]);

        expect(code).toBe(0);
        const log = fs.readFileSync(logPath, "utf8");
        expect(log).toContain('"event":"daemon-stale"');
        expect(log).toContain('"reason":"in-place-update"');
        expect(log).toContain('"installed":"9.9.10"');
      } finally {
        daemon.kill("SIGTERM");
        await exited;
      }
    },
    40000,
  );

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
      JSON.stringify({ dependencies: { "sidecarsync": "0.1.0" } }),
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
    // secrets+pii pinned: the <EMAIL> and item-count assertions below
    // exercise the PII rules, which the default mode no longer runs.
    const { main, remote, sidecar } = initSidecarProject(["--redaction", "secrets+pii"]);
    const inbox = git(sidecar, ["branch", "--show-current"]).stdout.trim();
    const original = "OPENAI_API_KEY=sk-test1234567890abcdef\nemail alice@example.com\n";
    fs.writeFileSync(path.join(sidecar, "notes.md"), original, "utf8");

    const preview = runSidecar(["redactions"], main);
    expect(preview).toContain("notes.md:");
    expect(preview).toContain("-OPENAI_API_KEY=sk-test1234567890abcdef");
    expect(preview).toContain("+OPENAI_API_KEY=<API_KEY>");

    const output = runSidecar(["sync"], main);

    expect(output).toContain("redacted 2 item(s) in 1 file(s)");
    expect(output).toContain(`pushed ${inbox}`);
    const pushed = gitRaw(["--git-dir", remote, "show", `${inbox}:notes.md`]).stdout;
    expect(pushed).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(pushed).toContain("<EMAIL>");
    expect(pushed).not.toContain("sk-test");
    expect(pushed).not.toContain("alice@example.com");
    // The clean filter redacts committed blobs only; the local file keeps
    // the user's original text.
    expect(fs.readFileSync(path.join(sidecar, "notes.md"), "utf8")).toBe(original);

    const merged = gitRaw(["--git-dir", remote, "show", "main:notes.md"]).stdout;
    expect(merged).toBe(pushed);
  });

  test("large files survive the clean filter without truncation", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const inbox = git(sidecar, ["branch", "--show-current"]).stdout.trim();
    // Well past the ~64KB pipe buffer, with the secret at the very end so
    // truncation would also silently skip the redaction.
    const big = `${"an ordinary line of scratchpad text\n".repeat(8000)}OPENAI_API_KEY=sk-test1234567890abcdef\n`;
    fs.writeFileSync(path.join(sidecar, "big.md"), big, "utf8");

    runSidecar(["sync"], main);

    const pushed = gitRaw(["--git-dir", remote, "show", `${inbox}:big.md`]).stdout;
    expect(pushed.length).toBe(big.length - "sk-test1234567890abcdef".length + "<API_KEY>".length);
    expect(pushed.endsWith("OPENAI_API_KEY=<API_KEY>\n")).toBe(true);
  });

  test("a second machine round-trips redacted content without wedging or leaking", () => {
    const { main: mainA, remote, sidecar: sidecarA } = initSidecarProject();
    const original = "OPENAI_API_KEY=sk-test1234567890abcdef\n";
    fs.writeFileSync(path.join(sidecarA, "notes.md"), original, "utf8");
    runSidecar(["sync"], mainA);

    // Machine B joins the same remote: its checkout receives the redacted
    // blob (the secret never left machine A).
    const mainB = initMainRepo();
    runSidecar(["init", remote], mainB);
    const sidecarB = path.join(mainB, "sidecar");
    expect(fs.readFileSync(path.join(sidecarB, "notes.md"), "utf8")).toBe(
      "OPENAI_API_KEY=<API_KEY>\n",
    );
    // Redaction must be idempotent: a checkout full of placeholders reads as
    // clean, or every sync on B would churn or wedge.
    expect(git(sidecarB, ["status", "--porcelain"]).stdout.trim()).toBe("");

    fs.writeFileSync(path.join(sidecarB, "from-b.md"), "hello from machine B\n", "utf8");
    runSidecar(["sync"], mainB);
    expect(git(sidecarB, ["status", "--porcelain"]).stdout.trim()).toBe("");

    // A picks up B's file; A's untouched secret file keeps its original.
    runSidecar(["sync"], mainA);
    expect(fs.readFileSync(path.join(sidecarA, "from-b.md"), "utf8")).toBe("hello from machine B\n");
    expect(fs.readFileSync(path.join(sidecarA, "notes.md"), "utf8")).toBe(original);
  });

  test("a lost push race on main retries, reconciles, and lands the merge", () => {
    const { main, remote, sidecar } = initSidecarProject();
    fs.writeFileSync(path.join(sidecar, "first.md"), "first\n", "utf8");
    runSidecar(["sync"], main);

    // Simulate the race window: the remote rejects the next main push once,
    // exactly what the loser of a concurrent merge sees.
    const hookPath = path.join(remote, "hooks", "pre-receive");
    fs.writeFileSync(
      hookPath,
      [
        "#!/bin/sh",
        'while read old new ref; do',
        '  if [ "$ref" = "refs/heads/main" ] && [ ! -f reject-once-marker ]; then',
        "    touch reject-once-marker",
        '    echo "simulated concurrent push" >&2',
        "    exit 1",
        "  fi",
        "done",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(hookPath, 0o755);

    fs.writeFileSync(path.join(sidecar, "second.md"), "second\n", "utf8");
    const output = runSidecar(["sync"], main);

    expect(output).toContain("push of main was rejected; refetching and retrying");
    expect(output).toContain("pushed main");
    expect(gitRaw(["--git-dir", remote, "show", "main:second.md"]).stdout).toBe("second\n");
  });

  test("a diverged local main heals from the remote without touching checkout files", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const original = "OPENAI_API_KEY=sk-test1234567890abcdef\n";
    fs.writeFileSync(path.join(sidecar, "notes.md"), original, "utf8");
    runSidecar(["sync"], main);

    // Another machine wins a race and the remote main is rewritten without
    // this machine's merge commit: drop it and add an unrelated commit.
    const other = cloneRemoteMain(remote);
    git(other, ["reset", "--hard", "HEAD~1"]);
    fs.writeFileSync(path.join(other, "from-other.md"), "other machine\n", "utf8");
    git(other, ["add", "from-other.md"]);
    git(other, ["commit", "-m", "Other machine change"]);
    git(other, ["push", "--force", "origin", "main"]);

    fs.writeFileSync(path.join(sidecar, "second.md"), "second\n", "utf8");
    runSidecar(["sync"], main);

    // The remote side won, the still-pending inbox branch was re-merged on
    // top of it, and the local originals survived the reset.
    expect(gitRaw(["--git-dir", remote, "show", "main:from-other.md"]).stdout).toBe("other machine\n");
    expect(gitRaw(["--git-dir", remote, "show", "main:second.md"]).stdout).toBe("second\n");
    expect(gitRaw(["--git-dir", remote, "show", "main:notes.md"]).stdout).toBe(
      "OPENAI_API_KEY=<API_KEY>\n",
    );
    expect(fs.readFileSync(path.join(sidecar, "notes.md"), "utf8")).toBe(original);
  });

  test("--redaction secrets flows through init, config, and the git filter", () => {
    const { main, remote, sidecar } = initSidecarProject(["--redaction", "secrets"]);
    const inbox = git(sidecar, ["branch", "--show-current"]).stdout.trim();
    expect(fs.readFileSync(path.join(main, ".sidecar"), "utf8")).toContain('redaction = "secrets"');
    fs.writeFileSync(
      path.join(sidecar, "notes.md"),
      "OPENAI_API_KEY=sk-test1234567890abcdef\nemail alice@example.com\n",
      "utf8",
    );

    runSidecar(["sync"], main);

    const pushed = gitRaw(["--git-dir", remote, "show", `${inbox}:notes.md`]).stdout;
    expect(pushed).toContain("OPENAI_API_KEY=<API_KEY>");
    expect(pushed).toContain("alice@example.com");
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

    // The fixture parks the checkout on main; merging moves it back to its
    // inbox branch and does the branch dance in a throwaway worktree, so the
    // forks land in the pushed main instead of rewriting the user's files.
    expect(git(sidecar, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);
    const mergedFiles = gitRaw(["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"]).stdout.split("\n");
    const conflictFiles = mergedFiles.filter((name) => name.startsWith("notes/") && name.includes(".conflict."));
    expect(conflictFiles).toHaveLength(2);
    const manifestPath = mergedFiles.find((name) => name.startsWith(".sidecar-conflicts/"));
    expect(manifestPath).toBeDefined();
    const manifestText = gitRaw(["--git-dir", remote, "show", `main:${manifestPath}`]).stdout;
    expect(manifestText).not.toContain("content_base64");
    expect(manifestText).toContain("sidecar-inbox/test/conflict");

    const secondMerge = runSidecar(["merge", "--fork-files"], main);

    expect(secondMerge).toContain("no inbox branches to merge");
  });

  test("status reports checkout, daemon, sync, and pending inbox state", () => {
    const { main, remote, sidecar } = initSidecarProject();

    const before = runSidecar(["status"], main);
    expect(before).toMatch(/main repo:\s+\S/);
    expect(before).toMatch(/sidecar path:\s+\S/);
    expect(before).toMatch(/remote:\s+\S/);
    expect(before).toMatch(/inbox branch:\s+sidecar-inbox\//);
    expect(before).toMatch(/checkout:\s+present/);
    expect(before).toMatch(/dirty:\s+no/);
    expect(before).toMatch(/daemon:\s+\S/);
    expect(before).toMatch(/pending inbox:\s+none/);

    runSidecar(["sync"], main);
    fs.writeFileSync(path.join(sidecar, "pending.md"), "pending\n", "utf8");
    const producer = cloneRemoteMain(remote);
    git(producer, ["switch", "-c", "sidecar-inbox/test/pending"]);
    fs.writeFileSync(path.join(producer, "note.md"), "note\n", "utf8");
    git(producer, ["add", "."]);
    git(producer, ["commit", "-m", "Pending inbox work"]);
    git(producer, ["push", "origin", "HEAD:refs/heads/sidecar-inbox/test/pending"]);

    const after = runSidecar(["status"], main);
    expect(after).toMatch(/dirty:\s+yes/);
    expect(after).toMatch(/last sync:\s+just now/);
    expect(after).toMatch(/pending inbox:\s+1/);
    expect(after).toContain("sidecar-inbox/test/pending");
  });

  test("status shows a missing checkout without last sync", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--no-clone"], main);

    const output = runSidecar(["status"], main);

    expect(output).toMatch(/checkout:\s+missing/);
    expect(output).toMatch(/last sync:\s+never/);
  });

  test("two writers on the same inbox branch reconcile instead of diverging", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    runSidecar(["init", remote, "--inbox", "sidecar-inbox/shared"], main);
    const sidecar = path.join(main, "sidecar");
    runSidecar(["sync"], main);

    const other = cloneRemoteMain(remote);
    git(other, ["fetch", "origin"]);
    git(other, ["switch", "-c", "sidecar-inbox/shared", "origin/sidecar-inbox/shared"]);
    fs.writeFileSync(path.join(other, "other.md"), "other\n", "utf8");
    git(other, ["add", "."]);
    git(other, ["commit", "-m", "Other machine work"]);
    git(other, ["push", "origin", "HEAD:refs/heads/sidecar-inbox/shared"]);

    fs.writeFileSync(path.join(sidecar, "local.md"), "local\n", "utf8");
    const output = runSidecar(["sync"], main);

    expect(output).toContain("pushed sidecar-inbox/shared");
    expect(gitRaw(["--git-dir", remote, "show", "main:local.md"]).stdout).toBe("local\n");
    expect(gitRaw(["--git-dir", remote, "show", "main:other.md"]).stdout).toBe("other\n");
    expect(fs.readFileSync(path.join(sidecar, "other.md"), "utf8")).toBe("other\n");
  });

  test("set-install-source runs globally even inside a repo that depends on sidecar", () => {
    const project = tempDir();
    const stateDir = tempDir();
    const localBin = path.join(project, "node_modules", "sidecarsync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ devDependencies: { "sidecarsync": "0.1.0" } }),
      "utf8",
    );
    fs.writeFileSync(localBin, "console.log('delegated to local')\n", "utf8");

    const output = runSidecar(["set-install-source", "curl"], project, { SIDECAR_STATE_DIR: stateDir });

    expect(output).toContain("install source: curl");
    expect(output).not.toContain("delegated to local");
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "settings.json"), "utf8")).installSource).toBe("curl");
  });

  test("sync errors while another sync holds the lock and does not stamp last sync", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const stateDir = path.join(main, ".sidecar-test-state");
    runSidecar(["sync"], main);
    const lastSyncBefore = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"))[0].lastSyncAt;
    expect(lastSyncBefore).toBeTruthy();
    const lockDir = testSyncLockDir(main);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid), "utf8");
    fs.writeFileSync(path.join(sidecar, "held.md"), "held\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "sync"], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: stateDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("another sidecar sync is already running");
    expect(gitRaw(["--git-dir", remote, "cat-file", "-e", "main:held.md"], { check: false }).status).not.toBe(0);
    const lastSyncAfter = JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"))[0].lastSyncAt;
    expect(lastSyncAfter).toBe(lastSyncBefore);

    fs.rmSync(lockDir, { recursive: true, force: true });
    runSidecar(["sync"], main);
    expect(gitRaw(["--git-dir", remote, "show", "main:held.md"]).stdout).toBe("held\n");
  });

  test("a soft sync silently no-ops while another sync holds the lock", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const stateDir = path.join(main, ".sidecar-test-state");
    const lockDir = testSyncLockDir(main);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid), "utf8");
    fs.writeFileSync(path.join(sidecar, "soft.md"), "soft\n", "utf8");

    // Same soft request the daemon makes, via flag and via env var.
    const flagged = runSidecar(["sync", "--soft"], main);
    expect(flagged).toContain("skipping this soft sync");
    const viaEnv = runSidecar(["sync"], main, { SIDECAR_SYNC_SOFT: "1" });
    expect(viaEnv).toContain("skipping this soft sync");

    expect(gitRaw(["--git-dir", remote, "cat-file", "-e", "main:soft.md"], { check: false }).status).not.toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, "instances.json"), "utf8"))[0].lastSyncAt).toBeUndefined();

    fs.rmSync(lockDir, { recursive: true, force: true });
    expect(runSidecar(["sync", "--soft"], main)).toContain("pushed");
    expect(gitRaw(["--git-dir", remote, "show", "main:soft.md"]).stdout).toBe("soft\n");
  });

  test("snapshot errors while another sync holds the lock", () => {
    const { main, sidecar } = initSidecarProject();
    const lockDir = testSyncLockDir(main);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid), "utf8");
    fs.writeFileSync(path.join(sidecar, "held.md"), "held\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "snapshot"], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("another sidecar sync is already running");
    expect(git(sidecar, ["status", "--porcelain"]).stdout).toContain("held.md");
  });

  test("init --local-install adds the devDependency with the bun trust entry", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    fs.writeFileSync(path.join(main, "package.json"), '{\n  "name": "app",\n  "version": "1.0.0"\n}\n', "utf8");
    fs.writeFileSync(path.join(main, "bun.lock"), "{}\n", "utf8");

    runSidecar(["init", remote, "--redaction", "none", "--local-install"], main);

    const manifest = JSON.parse(fs.readFileSync(path.join(main, "package.json"), "utf8"));
    expect(Object.keys(manifest.devDependencies)).toContain("sidecarsync");
    // The dependency without the trust entry would register nothing: bun
    // blocks lifecycle scripts by default, and the postinstall is the point.
    expect(manifest.trustedDependencies).toContain("sidecarsync");
    expect(manifest.pnpm).toBeUndefined();
  });

  test("init --local-install adds the pnpm trust entry for pnpm repos", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    fs.writeFileSync(path.join(main, "package.json"), '{\n  "name": "app",\n  "version": "1.0.0"\n}\n', "utf8");
    fs.writeFileSync(path.join(main, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    runSidecar(["init", remote, "--redaction", "none", "--local-install"], main);

    const manifest = JSON.parse(fs.readFileSync(path.join(main, "package.json"), "utf8"));
    expect(manifest.pnpm.onlyBuiltDependencies).toContain("sidecarsync");
    expect(manifest.trustedDependencies).toBeUndefined();
  });

  test("init --local-install warns when no lockfile identifies the package manager", () => {
    const main = initMainRepo();
    const remote = initBareRemote();
    fs.writeFileSync(path.join(main, "package.json"), '{\n  "name": "app",\n  "version": "1.0.0"\n}\n', "utf8");

    const result = spawnSync(process.execPath, [cliPath, "init", remote, "--redaction", "none", "--local-install"], {
      cwd: main,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("the package manager is unknown");
    const manifest = JSON.parse(fs.readFileSync(path.join(main, "package.json"), "utf8"));
    expect(Object.keys(manifest.devDependencies)).toContain("sidecarsync");
  });

  test("standalone init --local-install syncs the edit and warns about node_modules", () => {
    const { repo, remote, state } = initStandaloneRepo();
    fs.writeFileSync(path.join(repo, "package.json"), '{\n  "name": "setup",\n  "version": "1.0.0"\n}\n', "utf8");
    fs.writeFileSync(path.join(repo, "bun.lock"), "{}\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "Add manifest"]);
    git(repo, ["push", "origin", "main"]);

    const result = spawnSync(process.execPath, [cliPath, "init", "--path", ".", "--local-install"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: state },
    });

    expect(result.status).toBe(0);
    // node_modules would be swept into snapshots wholesale in a standalone
    // repo, so the missing ignore entry deserves a warning.
    expect(result.stderr).toContain("node_modules is not gitignored");
    // The edit rides init's ending sync, so other machines get it for free.
    const pushed = JSON.parse(gitRaw(["--git-dir", remote, "show", "main:package.json"]).stdout);
    expect(Object.keys(pushed.devDependencies)).toContain("sidecarsync");
    expect(pushed.trustedDependencies).toContain("sidecarsync");
  });

  test("init --path . adopts the repo itself as the sidecar", () => {
    const { repo, remote, state } = initStandaloneRepo();

    const output = runSidecar(["init", "--path", "."], repo, { SIDECAR_STATE_DIR: state });

    expect(output).toContain("standalone:");
    const config = fs.readFileSync(path.join(repo, ".sidecar"), "utf8");
    expect(config).toContain('path = "."');
    expect(config).toContain(`remote = ${JSON.stringify(remote)}`);
    // One default everywhere: secrets. PII rules carry most of the false
    // positives, so the default mode is never the one most likely to mangle
    // a file — standalone or nested.
    expect(config).toContain('redaction = "secrets"');
    // Nothing to hide from itself: no ignore entry, no editor inclusion.
    expect(fs.existsSync(path.join(repo, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".zed"))).toBe(false);
    expect(git(repo, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);
    // Init itself changed the tree it syncs, and the daemon's watcher only
    // sees changes made after it attaches — so init ends with a sync and the
    // committed .sidecar is already on the remote for the next machine.
    const mainFiles = gitRaw(["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"]).stdout;
    expect(mainFiles).toContain(".sidecar");
  });

  test("init treats any path spelling of the repo root as standalone", () => {
    const { repo, remote, state } = initStandaloneRepo();

    // An absolute path to the root would otherwise dodge the "." string
    // check and land in the nested code path, pointed at the repo itself.
    runSidecar(["init", "--path", repo], repo, { SIDECAR_STATE_DIR: state });

    const config = fs.readFileSync(path.join(repo, ".sidecar"), "utf8");
    expect(config).toContain('path = "."');
    expect(config).toContain(`remote = ${JSON.stringify(remote)}`);
    expect(git(repo, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);
  });

  test("init --path . refuses a repo with no origin to sync to", () => {
    const repo = initMainRepo();

    const result = spawnSync(process.execPath, [cliPath, "init", "--path", "."], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(repo, ".sidecar-test-state"),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/its own origin, but it has none/);
    expect(fs.existsSync(path.join(repo, ".sidecar"))).toBe(false);
  });

  test("a standalone repo round-trips edits between two machines", () => {
    const { repo, remote, state } = initStandaloneRepo();
    runSidecar(["init", "--path", "."], repo, { SIDECAR_STATE_DIR: state });
    fs.writeFileSync(path.join(repo, "install.sh"), "#!/bin/sh\necho updated\n", "utf8");
    runSidecar(["sync"], repo, { SIDECAR_STATE_DIR: state });

    // A second machine joins by cloning the repo: .sidecar rode along in the
    // sync, so init has everything it needs and never prompts.
    const second = cloneRemoteMain(remote);
    runSidecar(["init"], second, { SIDECAR_STATE_DIR: state });

    expect(fs.readFileSync(path.join(second, "install.sh"), "utf8")).toContain("updated");
    const secondInbox = git(second, ["branch", "--show-current"]).stdout.trim();
    expect(secondInbox).toMatch(/^sidecar-inbox\//);
    expect(secondInbox).not.toBe(git(repo, ["branch", "--show-current"]).stdout.trim());

    fs.writeFileSync(path.join(second, "aliases.sh"), "alias g=git\n", "utf8");
    runSidecar(["sync"], second, { SIDECAR_STATE_DIR: state });
    runSidecar(["sync"], repo, { SIDECAR_STATE_DIR: state });

    expect(fs.readFileSync(path.join(repo, "aliases.sh"), "utf8")).toBe("alias g=git\n");
    // Two machines and six syncs; this one has always run close to the default.
  }, 30000);

  test("standalone init forks the inbox from HEAD on a repo ahead of its origin", () => {
    const { repo, remote, state } = initStandaloneRepo();
    // The shape a dotfiles repo is usually in: a commit origin hasn't seen,
    // plus an uncommitted edit on top. Forking the inbox from origin/main
    // would roll the tree back to the pushed state — or refuse to overwrite
    // install.sh and kill init after .sidecar was already written.
    fs.writeFileSync(path.join(repo, "install.sh"), "#!/bin/sh\necho v2\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "v2 unpushed"]);
    fs.appendFileSync(path.join(repo, "install.sh"), "echo wip\n");

    runSidecar(["init", "--path", "."], repo, { SIDECAR_STATE_DIR: state });

    expect(git(repo, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);
    expect(fs.readFileSync(path.join(repo, "install.sh"), "utf8")).toBe("#!/bin/sh\necho v2\necho wip\n");

    // The first sync carries both the unpushed commit and the dirty edit home.
    runSidecar(["sync"], repo, { SIDECAR_STATE_DIR: state });
    const pushed = gitRaw(["--git-dir", remote, "show", "main:install.sh"]).stdout;
    expect(pushed).toContain("echo v2");
    expect(pushed).toContain("echo wip");
  });

  test("a standalone clone reached over a different origin URL still inits", () => {
    const { repo, remote, state } = initStandaloneRepo();
    runSidecar(["init", "--path", "."], repo, { SIDECAR_STATE_DIR: state });
    runSidecar(["sync"], repo, { SIDECAR_STATE_DIR: state });

    // Machine two reaches the same repo by another URL form (ssh vs https in
    // real life; file:// vs a plain path here). The committed .sidecar
    // records machine one's URL; for a standalone repo, origin wins.
    const second = cloneRemoteMain(`file://${remote}`);
    const output = runSidecar(["init"], second, { SIDECAR_STATE_DIR: state });

    expect(output).toContain("using origin");
    expect(git(second, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);

    fs.writeFileSync(path.join(second, "aliases.sh"), "alias g=git\n", "utf8");
    runSidecar(["sync"], second, { SIDECAR_STATE_DIR: state });
    runSidecar(["sync"], repo, { SIDECAR_STATE_DIR: state });
    expect(fs.readFileSync(path.join(repo, "aliases.sh"), "utf8")).toBe("alias g=git\n");
  });

  test("deinit releases a standalone repo instead of deleting it", () => {
    const { repo, state } = initStandaloneRepo();
    // Explicit "none": the branch-switch below is deinit's redaction-off
    // behavior; under the default (secrets) it stays parked and says why.
    runSidecar(["init", "--path", ".", "--redaction", "none"], repo, { SIDECAR_STATE_DIR: state });
    expect(git(repo, ["config", "--get", "filter.sidecar-redact.clean"]).stdout.trim()).toBeTruthy();

    const output = runSidecar(["deinit"], repo, { SIDECAR_STATE_DIR: state });

    expect(output).toContain("switched back to main");
    expect(fs.existsSync(path.join(repo, ".sidecar"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "install.sh"))).toBe(true);
    expect(git(repo, ["branch", "--show-current"]).stdout.trim()).toBe("main");
    // Nothing deleted the checkout here, so the wiring a recursive remove
    // would have taken with it has to be gone on its own — a leftover
    // required=true filter would fail every later `git add`.
    expect(git(repo, ["config", "--get", "filter.sidecar-redact.clean"], { check: false }).status).not.toBe(0);
    const attributes = path.join(repo, ".git", "info", "attributes");
    const attributesText = fs.existsSync(attributes) ? fs.readFileSync(attributes, "utf8") : "";
    expect(attributesText).not.toContain("sidecar-redact");
    expect(git(repo, ["status", "--porcelain"], { check: false }).status).toBe(0);
  });

  test("deinit under redaction reports the branch it refused to switch", () => {
    const { repo, state } = initStandaloneRepo();
    runSidecar(["init", "--path", ".", "--redaction", "secrets"], repo, { SIDECAR_STATE_DIR: state });

    const result = spawnSync(process.execPath, [cliPath, "deinit"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: state },
    });

    expect(result.status).toBe(0);
    // The filter still comes out — that's the trace that breaks git add if
    // it goes stale — but the branch switch is left to the user, and deinit
    // says so instead of quietly stopping short.
    expect(git(repo, ["config", "--get", "filter.sidecar-redact.clean"], { check: false }).status).not.toBe(0);
    expect(git(repo, ["branch", "--show-current"]).stdout.trim()).toMatch(/^sidecar-inbox\//);
    expect(result.stderr).toContain("redacted pushed contents");
    expect(result.stderr).toContain("deinit could not fully complete");
    expect(result.stderr).toContain("ask your agent to scrub any remaining traces of sidecar");
  });

  test("deinit with an unreadable config still unwires the redaction filter", () => {
    const { repo, state } = initStandaloneRepo();
    runSidecar(["init", "--path", ".", "--redaction", "secrets"], repo, { SIDECAR_STATE_DIR: state });
    fs.writeFileSync(path.join(repo, ".sidecar"), "not [ valid { toml\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "deinit"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: state },
    });

    expect(result.status).toBe(0);
    // A corrupt config hides whether this repo is standalone, so the one
    // trace deinit can still safely take out is the required=true filter —
    // leaving it wired would fail every future `git add` here.
    expect(git(repo, ["config", "--get", "filter.sidecar-redact.clean"], { check: false }).status).not.toBe(0);
    const attributes = path.join(repo, ".git", "info", "attributes");
    const attributesText = fs.existsSync(attributes) ? fs.readFileSync(attributes, "utf8") : "";
    expect(attributesText).not.toContain("sidecar-redact");
    expect(result.stderr).toContain("could not read");
    expect(result.stderr).toContain("deinit could not fully complete");
    expect(result.stderr).toContain("ask your agent to scrub any remaining traces of sidecar");
  });

  test("status reports a standalone sidecar as a single repo", () => {
    const { repo, state } = initStandaloneRepo();
    runSidecar(["init", "--path", "."], repo, { SIDECAR_STATE_DIR: state });

    const output = runSidecar(["status"], repo, { SIDECAR_STATE_DIR: state });

    expect(output).toMatch(/standalone:\s+\S/);
    expect(output).not.toContain("main repo:");
    expect(output).not.toContain("sidecar path:");

    const payload = JSON.parse(runSidecar(["status", "--json"], repo, { SIDECAR_STATE_DIR: state }));
    expect(payload.standalone).toBe(true);
    expect(payload.root).toBe(payload.sidecarPath);
  });

  test("status flags a checkout parked off its inbox branch", () => {
    const { main, sidecar } = initSidecarProject();
    git(sidecar, ["switch", "main"]);

    const output = runSidecar(["status"], main);

    expect(output).toMatch(/branch:\s+main — not the inbox branch/);
  });

  test("sync publishes a heartbeat that the main branch never absorbs", () => {
    const { main, remote } = initSidecarProject();

    runSidecar(["sync"], main);

    const healthBranches = remoteBranches(remote).filter((branch) => branch.startsWith("sidecar-health/"));
    expect(healthBranches).toHaveLength(1);
    expect(healthBranches[0]).toMatch(/^sidecar-health\/.+\/[a-f0-9]{12}$/);

    const record = JSON.parse(
      gitRaw(["--git-dir", remote, "show", `${healthBranches[0]}:health.json`]).stdout,
    );
    expect(record.status).toBe("ok");
    expect(record.consecutiveFailures).toBe(0);
    expect(record.lastSuccessAt).toBe(record.updatedAt);
    expect(record.inbox).toMatch(/^sidecar-inbox\//);

    // The whole reason for a separate namespace: the merge must pass over it,
    // so notes stay notes.
    expect(gitRaw(["--git-dir", remote, "cat-file", "-e", "main:health.json"], { check: false }).status).not.toBe(0);
    // And a root commit each time, so liveness pings never accumulate history.
    expect(gitRaw(["--git-dir", remote, "rev-list", "--count", healthBranches[0]]).stdout.trim()).toBe("1");
  });

  test("a failing sync reports the stage it broke at, then clears on recovery", () => {
    const { main, remote, sidecar } = initSidecarProject();
    runSidecar(["sync"], main);

    // A remote that refuses the inbox push but still accepts the heartbeat —
    // the exact split the separate write path exists to survive.
    rejectPushesTo(remote, "refs/heads/sidecar-inbox/");
    fs.writeFileSync(path.join(sidecar, "note.md"), "note\n", "utf8");
    const failed = spawnSync(process.execPath, [cliPath, "sync"], {
      cwd: main,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state") },
    });
    expect(failed.status).toBe(1);

    const broken = healthEntries(main)[0];
    expect(broken.state).toBe("failed");
    expect(broken.record.status).toBe("failed");
    expect(broken.record.stage).toBe("push-inbox");
    expect(broken.record.consecutiveFailures).toBe(1);
    // The last good sync survives the failure, so "working until when" is answerable.
    expect(broken.record.lastSuccessAt).toBeTruthy();
    expect(broken.record.lastSuccessAt).not.toBe(broken.record.updatedAt);

    allowAllPushes(remote);
    runSidecar(["sync"], main);

    const recovered = healthEntries(main)[0];
    expect(recovered.state).toBe("ok");
    expect(recovered.record.consecutiveFailures).toBe(0);
    expect(recovered.record.stage).toBeUndefined();
    expect(recovered.record.message).toBeUndefined();
  });

  test("health reports every checkout sharing the remote, worst first", () => {
    const remote = initBareRemote();
    const firstMain = initMainRepo();
    const secondMain = initMainRepo();
    runSidecar(["init", remote], firstMain);
    runSidecar(["init", remote], secondMain);
    runSidecar(["sync"], firstMain);

    // Break only the second checkout, so the two machines disagree.
    rejectPushesTo(remote, "refs/heads/sidecar-inbox/");
    fs.writeFileSync(path.join(secondMain, "sidecar", "note.md"), "note\n", "utf8");
    spawnSync(process.execPath, [cliPath, "sync"], {
      cwd: secondMain,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        SIDECAR_STATE_DIR: path.join(secondMain, ".sidecar-test-state"),
      },
    });
    allowAllPushes(remote);

    // Read the fleet from the checkout that never broke: the point of the
    // heartbeat is that a healthy machine can see an unhealthy one.
    const entries = healthEntries(firstMain);
    expect(entries).toHaveLength(2);
    expect(entries[0].state).toBe("failed");
    expect(entries[1].state).toBe("ok");
    expect(entries[1].self).toBe(true);
    expect(entries[0].self).toBe(false);

    const output = runSidecar(["health"], firstMain);
    expect(output).toMatch(/fleet:\s+1 ok, 1 failed/);
    expect(output).toMatch(/status:\s+failed at push-inbox/);
    expect(output).toContain("(this checkout)");
  });

  // The heartbeat rides the same remote it reports on, so a remote that is
  // wholly unreachable can't be told about. What must not happen is the
  // reporting failure replacing the sync failure the user needs to see.
  test("a heartbeat that cannot be published never masks the sync error", () => {
    const { main, remote, sidecar } = initSidecarProject();
    const stateDir = path.join(main, ".sidecar-test-state");
    runSidecar(["sync"], main);

    // Every ref rejected, so the heartbeat has nowhere to go either.
    rejectPushesTo(remote, "refs/");
    fs.writeFileSync(path.join(sidecar, "note.md"), "note\n", "utf8");

    const result = spawnSync(process.execPath, [cliPath, "sync"], {
      cwd: main,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: stateDir },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rejected by test hook");
    expect(result.stderr).not.toContain("could not publish health");
    // The attempt is still recorded where this machine can read it.
    const log = fs.readFileSync(path.join(stateDir, "sidecar.log"), "utf8");
    expect(log).toContain("could not publish health");
  });

  test("init refuses an inbox namespace that would swallow the health branches", () => {
    const main = initMainRepo();
    const remote = initBareRemote();

    const result = spawnSync(
      process.execPath,
      [cliPath, "init", remote, "--inbox", "sidecar-health/{user}/{random}"],
      {
        cwd: main,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", SIDECAR_STATE_DIR: path.join(main, ".sidecar-test-state") },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sidecar-health/");
  });
});

function remoteBranches(remote: string): string[] {
  return gitRaw(["--git-dir", remote, "branch", "--format=%(refname:short)"])
    .stdout.split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
}

function healthEntries(main: string): Array<{ branch: string; self: boolean; state: string; record: Record<string, string | number> }> {
  return JSON.parse(runSidecar(["health", "--json"], main));
}

/** An `update` hook on the bare remote, so one ref namespace can fail alone. */
function rejectPushesTo(remote: string, refPrefix: string): void {
  const hook = path.join(remote, "hooks", "update");
  fs.writeFileSync(
    hook,
    `#!/bin/sh\ncase "$1" in\n  ${refPrefix}*) echo "rejected by test hook" >&2; exit 1 ;;\nesac\nexit 0\n`,
    "utf8",
  );
  fs.chmodSync(hook, 0o755);
}

function allowAllPushes(remote: string): void {
  fs.rmSync(path.join(remote, "hooks", "update"), { force: true });
}

function initSidecarProject(initArgs: string[] = []): { main: string; remote: string; sidecar: string } {
  const main = initMainRepo();
  const remote = initBareRemote();
  runSidecar(["init", remote, ...initArgs], main);
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

// A repo that lives on every machine and belongs to no parent — the shape
// standalone mode exists for. `state` has to sit outside the repo: the default
// test state dir is a child of cwd, which in standalone mode is inside the tree
// being snapshotted, so the registry and log would sync themselves.
function initStandaloneRepo(): { repo: string; remote: string; state: string } {
  const remote = initBareRemote();
  const repo = initMainRepo();
  git(repo, ["remote", "add", "origin", remote]);
  fs.writeFileSync(path.join(repo, "install.sh"), "#!/bin/sh\necho setup\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "Add setup script"]);
  git(repo, ["push", "-u", "origin", "main"]);
  return { repo, remote, state: tempDir() };
}

/**
 * A repo plus a second working copy of it — the shape jj workspaces and git
 * worktrees both make. Uses git worktrees so the suite needs no jj on PATH.
 *
 * `.sidecar` has to be committed before the worktree is added, or the new
 * working copy checks out a commit that never heard of the sidecar.
 */
function initWorktreeFamily(): { main: string; worktree: string; remote: string; state: string } {
  const { main, remote } = initSidecarProject();
  git(main, ["add", ".sidecar", ".gitignore"]);
  git(main, ["commit", "-m", "Add sidecar config"]);
  const worktree = path.join(tempDir(), "worktree");
  git(main, ["worktree", "add", worktree, "-b", "feature"]);
  return { main, worktree, remote, state: path.join(main, ".sidecar-test-state") };
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

function findExecutable(name: string): string {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`missing executable ${name}`);
}

// The sync lock lives under the state dir, so it has to be resolved with the
// same SIDECAR_STATE_DIR the spawned CLI runs with.
function testSyncLockDir(main: string): string {
  const previous = process.env.SIDECAR_STATE_DIR;
  process.env.SIDECAR_STATE_DIR = path.join(main, ".sidecar-test-state");
  try {
    return syncLockDir(main);
  } finally {
    if (previous === undefined) delete process.env.SIDECAR_STATE_DIR;
    else process.env.SIDECAR_STATE_DIR = previous;
  }
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}
