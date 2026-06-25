#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABEL = "com.anteprojector.sidecar";
const BIN_NAME = process.platform === "win32" ? "sidecar.cmd" : "sidecar";

try {
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (isGlobalInstall()) {
    enableDaemon(packageRoot);
  } else {
    registerWithGlobalSidecar(packageRoot);
  }
} catch (error) {
  console.warn(`sidecar: postinstall failed: ${error instanceof Error ? error.message : String(error)}`);
}

function isGlobalInstall() {
  return process.env.npm_config_global === "true" || process.env.npm_config_global === "1";
}

function enableDaemon(packageRoot) {
  const cliPath = path.join(packageRoot, "dist", "cli.js");
  if (!fs.existsSync(cliPath)) {
    console.warn(`sidecar: skipping daemon install; missing ${cliPath}`);
    return;
  }

  const result = spawnSync(process.execPath, [cliPath, "daemon", "enable"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.warn(`sidecar: daemon enable failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return;
  }
  console.warn(result.stdout.trim() || `sidecar: enabled daemon ${LABEL}`);
}

function registerWithGlobalSidecar(packageRoot) {
  const projectRoot = findInstallProjectRoot();
  if (!projectRoot || !fs.existsSync(path.join(projectRoot, ".sidecar"))) return;

  const globalSidecar = findGlobalSidecar(packageRoot);
  if (!globalSidecar) return;

  const result = spawnSync(globalSidecar, ["register-install"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    console.warn(`sidecar: install registration failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return;
  }
  const output = result.stdout.trim();
  if (output) console.warn(output);
}

function findInstallProjectRoot() {
  const candidates = [
    process.env.INIT_CWD,
    process.env.npm_config_local_prefix,
    process.env.PROJECT_CWD,
    process.cwd(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = findConfigRoot(candidate);
    if (root) return root;
  }
  return undefined;
}

function findConfigRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findGlobalSidecar(packageRoot) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, BIN_NAME);
    if (isUsableGlobalSidecar(candidate, packageRoot)) return candidate;
    if (process.platform === "win32") {
      const psCandidate = path.join(entry, "sidecar.ps1");
      if (isUsableGlobalSidecar(psCandidate, packageRoot)) return psCandidate;
    }
  }
  return undefined;
}

function isUsableGlobalSidecar(candidate, packageRoot) {
  if (!isFile(candidate)) return false;
  const realCandidate = realpath(candidate);
  const realPackageRoot = realpath(packageRoot);
  if (realCandidate === path.join(realPackageRoot, "dist", "cli.js")) return false;
  if (isInside(realCandidate, realPackageRoot)) return false;
  return true;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function realpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
