// Command registry and dispatch. Each command is one table entry — name,
// handler, section, and the usage lines help prints — so adding a command
// means one entry here plus its cmd* implementation. Dispatch, "did you
// mean" suggestions, and the help text all derive from this table.
import { colorLevel, paint } from "./color.js";
import { SidecarError } from "./util.js";
import { packageVersion } from "./install.js";
import { cmdClone, cmdDeinit, cmdInit, cmdRefresh } from "./cmd-init.js";
import { cmdHealth, cmdInstances, cmdStatus, cmdTail } from "./cmd-status.js";
import { cmdDaemon, cmdRegisterInstall, cmdSetInstallSource, cmdUpdate } from "./cmd-daemon.js";
import { cmdMerge, cmdRedact, cmdRedactions, cmdSnapshot, cmdSync } from "./cmd-sync.js";

type CommandSection = "common" | "sync" | "advanced";

type Command = {
  name: string;
  run: (args: string[]) => number | Promise<number>;
  section: CommandSection;
  /** The command with its arguments and options, as help prints it. */
  usage: string;
  /** A description printed on the usage line itself, in the notes column. */
  summary?: string;
  /** Extra lines printed under the usage line, in the notes column. */
  notes?: string[];
};

const COMMANDS: Command[] = [
  {
    name: "init",
    run: cmdInit,
    section: "common",
    usage:
      "init [remote] [--path sidecar|.] [--branch main] [--inbox template] [--redaction none|secrets|secrets+pii] [--local-install]",
    notes: [
      "--path . makes this repo itself the sidecar (standalone)",
      "--local-install adds the devDependency so fresh clones self-register",
    ],
  },
  { name: "status", run: cmdStatus, section: "common", usage: "status [--json]" },
  {
    name: "health",
    run: cmdHealth,
    section: "common",
    usage: "health [--json] [--no-fetch]",
    notes: ["how every machine sharing this sidecar is syncing"],
  },
  {
    name: "redactions",
    run: cmdRedactions,
    section: "common",
    usage: "redactions",
    summary: "preview what redaction rewrites before content is pushed",
  },
  {
    name: "sync",
    run: cmdSync,
    section: "sync",
    usage: "sync [--local] [--no-snapshot] [--soft] [-m message]",
    notes: ["--local settles this machine's checkouts without touching the remote"],
  },
  {
    name: "daemon",
    run: cmdDaemon,
    section: "sync",
    usage: "daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]",
  },
  { name: "instances", run: cmdInstances, section: "sync", usage: "instances [--json]" },
  { name: "tail", run: cmdTail, section: "sync", usage: "tail [-f|--follow] [-n|--lines count]" },
  { name: "update", run: cmdUpdate, section: "sync", usage: "update" },
  { name: "clone", run: cmdClone, section: "advanced", usage: "clone [--if-missing]" },
  {
    name: "refresh",
    run: cmdRefresh,
    section: "advanced",
    usage: "refresh [--force] [--yes]",
    // No summary: this usage string is exactly as wide as the notes column, so a
    // summary would run straight into it with no gap.
    notes: [
      "delete the sidecar checkout and clone it again",
      "discards anything unpushed; refuses until `sidecar sync` has run",
    ],
  },
  { name: "deinit", run: cmdDeinit, section: "advanced", usage: "deinit" },
  { name: "snapshot", run: cmdSnapshot, section: "advanced", usage: "snapshot [--push] [-m message]" },
  { name: "merge", run: cmdMerge, section: "advanced", usage: "merge [--fork-files] [--no-push]" },
  {
    name: "redact",
    run: cmdRedact,
    section: "advanced",
    usage: "redact",
    summary: "git clean filter: stdin -> redacted stdout",
  },
  { name: "register-install", run: cmdRegisterInstall, section: "advanced", usage: "register-install" },
  {
    name: "set-install-source",
    run: cmdSetInstallSource,
    section: "advanced",
    usage: "set-install-source npm|bun|curl [--if-unset]",
  },
];

const SECTION_TITLES: Record<CommandSection, string> = {
  common: "common:",
  sync: "sync & daemon:",
  advanced: "advanced (mostly run for you by init, git, and the daemon):",
};

export function run(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (!command) {
    // No command is an error, so usage goes to stderr and the exit is nonzero.
    printUsage("stderr");
    return 1;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printUsage("stdout");
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return 0;
  }

  const entry = COMMANDS.find((candidate) => candidate.name === command);
  if (!entry) {
    const suggestion = closestCommand(command);
    throw new SidecarError(
      `unknown command ${JSON.stringify(command)}${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`,
    );
  }
  return entry.run(rest);
}

// version and help are dispatched before the table but are still commands a
// user might mistype.
const KNOWN_COMMANDS = [...COMMANDS.map((command) => command.name), "version", "help"];

export function closestCommand(input: string): string | undefined {
  let best: { command: string; distance: number } | undefined;
  for (const command of KNOWN_COMMANDS) {
    const distance = editDistance(input.toLowerCase(), command);
    if (!best || distance < best.distance) best = { command, distance };
  }
  // Only suggest near-misses; "frobnicate" should not turn into "instances".
  return best && best.distance <= 2 ? best.command : undefined;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Summaries and continuation notes share one column: two spaces of indent
// plus the usage text, padded.
const USAGE_NOTE_COLUMN = 27;

function printUsage(target: "stdout" | "stderr"): void {
  const write = target === "stdout" ? console.log : console.error;
  const level = colorLevel(target === "stdout" ? process.stdout : process.stderr);
  const header = (text: string): string => paint("label", text, level);
  const sections = (Object.keys(SECTION_TITLES) as CommandSection[]).map((section) => {
    const entries = COMMANDS.filter((command) => command.section === section).flatMap((command) => [
      command.summary ? `  ${command.usage}`.padEnd(USAGE_NOTE_COLUMN) + command.summary : `  ${command.usage}`,
      ...(command.notes ?? []).map((note) => " ".repeat(USAGE_NOTE_COLUMN) + note),
    ]);
    return `${header(SECTION_TITLES[section])}\n${entries.join("\n")}`;
  });
  write(`usage: sidecar <command> [options]\n\n${sections.join("\n\n")}`);
}
