// Terminal output and input helpers shared by the commands: aligned
// label/value rows, human timestamps, and the blocking prompts init uses.
import fs from "node:fs";

import { type Role, paint } from "./color.js";

/** One `label: value` row. The label is dim so the eye lands on the values. */
export function labelLine(width: number, label: string, value: string, role?: Role, indent = ""): void {
  const padded = `${label}:`.padEnd(width);
  console.log(`${indent}${paint("label", padded)} ${role ? paint(role, value) : value}`);
}

/** "4 minutes ago (2026-07-25 09:12)", falling back to the raw string. */
export function formatTimestampPair(iso: string): string {
  const relative = formatRelativeTime(iso);
  const absolute = formatLocalTimestamp(iso);
  if (!relative || !absolute) return iso;
  return `${relative} ${paint("quiet", `(${absolute})`)}`;
}

/** "4 minutes ago" — floored, so it never claims more time has passed than has. */
export function formatRelativeTime(iso: string, now = Date.now()): string | undefined {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;

  // Clocks on two machines writing the same registry drift; a small negative
  // age is normal and reads better as "just now" than as a negative duration.
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";

  const scales: [seconds: number, unit: string, limit: number][] = [
    [60, "minute", 60],
    [3600, "hour", 24],
    [86400, "day", 14],
    [604800, "week", 9],
    [2592000, "month", 18],
    [31536000, "year", Number.POSITIVE_INFINITY],
  ];
  for (const [size, unit, limit] of scales) {
    const count = Math.max(1, Math.floor(seconds / size));
    if (count < limit) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "a very long time ago";
}

/** Local wall-clock time, because that's the frame you remember working in. */
export function formatLocalTimestamp(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Non-interactive runs (CI, scripts) must not opt into anything by default;
// a missing terminal answers "no".
export function promptYesNo(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = promptLine(`${question} ${paint("quiet", "[Y/n]")} `).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

// For choices that should never be arrived at by holding Enter.
export function promptYesNoDefaultNo(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = promptLine(`${question} ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}

export function promptLine(prompt: string): string {
  fs.writeSync(1, prompt);
  // Node keeps a TTY stdin non-blocking, so reads on fd 0 hit EAGAIN while idle.
  // Windows has no /dev/tty; CONIN$ is the console-input device there.
  const fd = fs.openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
  try {
    const chunks: string[] = [];
    const buffer = Buffer.alloc(1);
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, 1, null);
      if (bytesRead === 0) break;
      const char = buffer.toString("utf8", 0, bytesRead);
      if (char === "\n" || char === "\r") break;
      chunks.push(char);
    }
    return chunks.join("").trim();
  } finally {
    fs.closeSync(fd);
  }
}
