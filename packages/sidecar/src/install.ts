// Install identity: what this package is called, which version this is,
// whether this process is the global install or a project-local dependency,
// and how to find the global executable on PATH.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isFilePath, isInsidePath, realpathOr } from "./util.js";

export const PACKAGE_NAME = "sidecarsync";
export const PACKAGE_SPEC = "sidecarsync";
export const GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
export const SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";

export type InstallSource = "npm" | "bun" | "curl";

export const INSTALL_SOURCES = new Set<InstallSource>(["npm", "bun", "curl"]);

export function packageVersion(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string; version?: string };
        if (manifest.name === PACKAGE_NAME && manifest.version) return manifest.version;
      } catch {
        // keep walking; an unrelated or unreadable manifest is not ours
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return "0.0.0";
    current = parent;
  }
}

function findDependencyRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function projectDependsOnSidecar(projectRoot: string): boolean {
  const manifestPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(manifestPath)) return false;

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

export function shouldUseGlobalRegistry(): boolean {
  return process.env[GLOBAL_EXEC_ENV] === "1" || !findDependencyRoot(process.cwd());
}

export function isProjectLocalPath(executable: string): boolean {
  const depRoot = findDependencyRoot(path.dirname(executable));
  if (!depRoot) return false;
  if (realpathOr(depRoot) === realpathOr(bunGlobalRoot())) return false;
  return isInsidePath(executable, path.join(depRoot, "node_modules"));
}

export function bunGlobalRoot(): string {
  return path.join(process.env.BUN_INSTALL || path.join(os.homedir(), ".bun"), "install", "global");
}

export function currentExecutablePath(): string {
  return realpathOr(process.argv[1] || fileURLToPath(import.meta.url));
}

export function findGlobalSidecarExecutable(): string | undefined {
  const names = process.platform === "win32" ? ["sidecar.cmd", "sidecar.ps1", "sidecar"] : ["sidecar"];
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (!isFilePath(candidate)) continue;
      if (isProjectLocalPath(realpathOr(candidate))) continue;
      return candidate;
    }
  }
  return undefined;
}

export function globalSidecarVersion(executable: string): string | undefined {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1" },
  });
  if (result.status !== 0) return undefined;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
}
