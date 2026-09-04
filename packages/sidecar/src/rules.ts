// Per-file policy belongs beside its peer's .sidecar config, while every glob
// is relative to the checkout that peer syncs. Keep this module independent of
// config's runtime: readConfig loads rules and clean filters load them directly.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { parse as parseToml } from "smol-toml";

import type { ResolveMode } from "./config.js";
import { REDACTION_MODES, type RedactionMode } from "./redaction.js";
import { SidecarError } from "./util.js";

export type SidecarRule = Readonly<{
  glob: string;
  resolve?: ResolveMode;
  redaction?: RedactionMode;
}>;
export type SidecarRules = readonly SidecarRule[];
export type FileRules = { resolve: ResolveMode; redaction: RedactionMode };

const matchers = new WeakMap<SidecarRule, (relativePath: string) => boolean>();
const globOptions = { dot: true, nonegate: true, noextglob: true, strictBrackets: true, windows: false };

export function peerRulesFileName(name: string): string {
  return name === "default" ? ".sidecar-rules" : `.sidecar-rules.${name}`;
}

export function peerRulesPath(root: string, name: string): string {
  return path.join(root, peerRulesFileName(name));
}

export function readRules(filePath: string): SidecarRules {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // A dangling symlink is an unreadable policy, not an intentional
      // deletion. Falling back to defaults could turn redaction off.
      try {
        if (!fs.lstatSync(filePath, { throwIfNoEntry: false })) return Object.freeze([]);
      } catch {
        // If absence cannot be established, report the original read error.
      }
    }
    throw new SidecarError(`could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let values: Record<string, unknown>;
  try {
    values = parseToml(text) as Record<string, unknown>;
  } catch (error) {
    throw new SidecarError(`${filePath} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  rejectUnknownKeys(values, ["rules"], filePath);
  if (values.rules === undefined) return Object.freeze([]);
  if (!Array.isArray(values.rules)) throw new SidecarError(`${filePath}: rules must be an array of [[rules]] tables`);
  return Object.freeze(values.rules.map((value, index): SidecarRule => {
    const source = `${filePath}: rule ${index + 1}`;
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
      throw new SidecarError(`${source} must be a table`);
    }
    const record = value as Record<string, unknown>;
    rejectUnknownKeys(record, ["glob", "resolve", "redaction"], source);
    if (typeof record.glob !== "string" || record.glob.length === 0) {
      throw new SidecarError(`${source}: glob must be a nonempty string`);
    }
    if (!isRelativePath(record.glob) || record.glob.includes("\\") || record.glob.includes("\0")) {
      throw new SidecarError(`${source}: glob must be checkout-relative, use / separators, and contain no .. segments`);
    }
    if (record.resolve !== undefined && record.resolve !== "fork" && record.resolve !== "lww") {
      throw new SidecarError(`${source}: resolve must be fork or lww`);
    }
    if (record.redaction !== undefined && !(REDACTION_MODES as readonly unknown[]).includes(record.redaction)) {
      throw new SidecarError(`${source}: redaction must be one of ${REDACTION_MODES.join(", ")}`);
    }
    if (record.resolve === undefined && record.redaction === undefined) {
      throw new SidecarError(`${source}: set at least one policy (resolve or redaction)`);
    }
    const rule: SidecarRule = Object.freeze({
      glob: record.glob,
      ...(record.resolve === undefined ? {} : { resolve: record.resolve as ResolveMode }),
      ...(record.redaction === undefined ? {} : { redaction: record.redaction as RedactionMode }),
    });
    try {
      matchers.set(rule, picomatch(rule.glob, globOptions));
    } catch (error) {
      throw new SidecarError(`${source}: invalid glob ${JSON.stringify(rule.glob)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return rule;
  }));
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], source: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new SidecarError(`${source}: unknown key ${JSON.stringify(key)}`);
  }
}

function isRelativePath(value: string): boolean {
  return !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[a-z]:/i.test(value)
    && !value.split("/").includes("..");
}

export function resolveFileRules(rules: SidecarRules | undefined, relativePath: string, defaults: FileRules): FileRules {
  const result = { ...defaults };
  if (!isRelativePath(relativePath)) throw new SidecarError(`rules require a checkout-relative path: ${relativePath}`);
  for (const rule of rules ?? []) {
    let matches = matchers.get(rule);
    if (!matches) {
      matches = picomatch(rule.glob, globOptions);
      matchers.set(rule, matches);
    }
    if (!matches(relativePath)) continue;
    if (rule.resolve !== undefined) result.resolve = rule.resolve;
    if (rule.redaction !== undefined) result.redaction = rule.redaction;
  }
  return result;
}

/** Hash policy, not TOML formatting or the location from which it was loaded. */
export function rulesFingerprint(rules: SidecarRules | undefined): string {
  const canonical = (rules ?? []).map(({ glob, resolve, redaction }) => ({ glob, resolve, redaction }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Conservative: an override may enable redaction even when the default is off. */
export function rulesMayRedact(rules: SidecarRules | undefined, defaultMode: RedactionMode): boolean {
  return defaultMode !== "none" || (rules ?? []).some((rule) => rule.redaction !== undefined && rule.redaction !== "none");
}
