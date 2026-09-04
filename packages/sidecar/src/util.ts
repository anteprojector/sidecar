// Shared plumbing with no sidecar knowledge: the error type, CLI option
// parsing, process/OS identity, and small path and string helpers. This module
// imports nothing from the rest of the package — keep it that way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

export type ParsedOptions = {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
};

export function parseOptions(
  args: string[],
  spec: { boolean: Set<string>; value: Set<string> },
): ParsedOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const [name, inlineValue] = equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
    if (spec.value.has(name)) {
      const value = inlineValue ?? args[++index];
      if (value === undefined) throw new SidecarError(`${name} requires a value`);
      values.set(name, value);
      continue;
    }
    if (inlineValue !== undefined) throw new SidecarError(`${name} does not take a value`);
    if (spec.boolean.has(name)) {
      flags.add(name);
      continue;
    }
    throw new SidecarError(`unknown option ${name}`);
  }

  return { flags, values, positional };
}

export function getValue(parsed: ParsedOptions, name: string, fallback: string): string {
  return parsed.values.get(name) ?? fallback;
}

export function findExecutableOnPath(name: string): string | undefined {
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    if (isFilePath(candidate)) return candidate;
  }
  return undefined;
}

export function isFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[./]+|[./]+$/g, "");
  return slugged || "unknown";
}

export function realpathOr(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function isInsidePath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function currentUser(): string {
  return process.env.USER || os.userInfo().username || "unknown";
}

export function currentHost(): string {
  return os.hostname().split(".", 1)[0] || "unknown";
}

/**
 * A duration as seconds: a bare number is seconds, a string takes an
 * `s`, `m`, or `h` suffix ("90s", "10m", "1h"). Undefined when unparseable.
 */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h)?\s*$/i.exec(value);
  if (!match) return undefined;
  const scale = { s: 1, m: 60, h: 3600 }[(match[2] ?? "s").toLowerCase() as "s" | "m" | "h"];
  return Number(match[1]) * scale;
}

export function utcTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function nowIso(): string {
  return new Date().toISOString();
}
