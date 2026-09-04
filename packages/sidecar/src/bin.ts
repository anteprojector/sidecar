#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { compareVersions, installedPackageVersion, main, packageVersion } from "./cli.js";

const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
const PACKAGE_NAME = "sidecarsync";
// Commands that mutate global state (launchd service, instance registry) must
// execute in this global install, never in a project-local copy — a delegated
// daemon command would write a launchd plist pointing at node_modules.
const GLOBAL_ONLY_COMMANDS = new Set(["daemon", "deinit", "register-install", "set-install-source", "update"]);

// Git runs the clean filter from the synced checkout. Its package files must
// never select executable code: use the exact install bound into Git config.
if (process.argv[2] !== "redact" && !process.env[SKIP_LOCAL_EXEC_ENV]) {
  const local = findLocalInstall(process.cwd(), fileURLToPath(import.meta.url));
  if (local) {
    // A project-local install exists and this process is the global one, so
    // wherever the command ends up running, it operates the global registry.
    process.env[GLOBAL_EXEC_ENV] = "1";
    if (local.newer && !GLOBAL_ONLY_COMMANDS.has(process.argv[2])) {
      const result = spawnSync(process.execPath, [local.executable, ...process.argv.slice(2)], {
        stdio: "inherit",
        env: {
          ...process.env,
          [SKIP_LOCAL_EXEC_ENV]: "1",
          [GLOBAL_EXEC_ENV]: "1",
        },
      });
      if (result.signal) {
        process.kill(process.pid, result.signal);
      }
      process.exit(result.status ?? 1);
    }
  }
}

process.exit(await main());

// The newest install wins: a project-local copy handles the command only when
// it is newer than this one, so updating the global takes effect in every repo
// at once while a repo pinned ahead of a stale global still runs its own.
function findLocalInstall(start: string, self: string): { executable: string; newer: boolean } | undefined {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current)) {
      const candidate = path.join(current, "node_modules", PACKAGE_NAME, "dist", "cli.js");
      if (isFile(candidate) && !sameFile(candidate, self)) {
        return { executable: candidate, newer: localIsNewer(current) };
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function localIsNewer(projectRoot: string): boolean {
  const localVersion = installedPackageVersion(projectRoot);
  return localVersion !== undefined && compareVersions(localVersion, packageVersion()) > 0;
}

function projectDependsOnSidecar(projectRoot: string): boolean {
  const manifestPath = path.join(projectRoot, "package.json");
  if (!isFile(manifestPath)) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return Boolean(
      manifest.dependencies?.[PACKAGE_NAME] ||
        manifest.devDependencies?.[PACKAGE_NAME] ||
        manifest.optionalDependencies?.[PACKAGE_NAME] ||
        manifest.peerDependencies?.[PACKAGE_NAME],
    );
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sameFile(first: string, second: string): boolean {
  try {
    return fs.realpathSync(first) === fs.realpathSync(second);
  } catch {
    return false;
  }
}
