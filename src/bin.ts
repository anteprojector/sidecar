#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { main } from "./cli.js";

const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
const PACKAGE_NAME = "@anteprojector/sidecar";

if (!process.env[SKIP_LOCAL_EXEC_ENV]) {
  const localExecutable = findLocalExecutable(process.cwd(), fileURLToPath(import.meta.url));
  if (localExecutable) {
    const result = spawnSync(process.execPath, [localExecutable, ...process.argv.slice(2)], {
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

process.exit(main());

function findLocalExecutable(start: string, self: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current)) {
      const candidate = path.join(current, "node_modules", "@anteprojector", "sidecar", "dist", "cli.js");
      if (isFile(candidate) && !sameFile(candidate, self)) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
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
