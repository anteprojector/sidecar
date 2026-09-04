// Read-only reporting commands: status (this checkout), health (the fleet),
// instances (this machine's registry), and tail (the event log).
import fs from "node:fs";

import { type Role, paint } from "./color.js";
import { SidecarError, getValue, parseOptions } from "./util.js";
import { branchExists, fetch, git, hasGitMetadata, isAncestor, remoteRefExists } from "./git.js";
import { PACKAGE_SPEC, findGlobalSidecarExecutable, shouldUseGlobalRegistry } from "./install.js";
import {
  DEFAULT_PEER,
  type Peer,
  type SidecarConfig,
  expandInbox,
  isStandalone,
  loadPeers,
  requireSidecarCheckout,
  resolveSidecarPath,
  selectedPeer,
} from "./config.js";
import { instancePeer, instancesPath, listInstanceStatuses, readInstances, readSettings, sidecarLogPath } from "./state.js";
import { daemonServiceStatus } from "./service.js";
import { checkoutIsUnlinkedFromFamily, pendingInboxBranches, readFleetHealth } from "./sync.js";
import { announcePeer, formatRelativeTime, formatTimestampPair, labelLine } from "./ui.js";
import { type HealthRecord, type HealthState, summarizeHealthStates } from "./health.js";

// "pending inbox:" is the longest label; every value starts one space past it.
const STATUS_LABEL_WIDTH = "pending inbox:".length;

function statusLine(label: string, value: string, role?: Role): void {
  labelLine(STATUS_LABEL_WIDTH, label, value, role);
}

export function cmdStatus(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(["--json"]), value: new Set(["--peer"]) });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar status [--json] [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  if (parsed.flags.has("--json")) {
    // Always an array, one object per peer: a reader written against a
    // single-sidecar repo keeps working the day a second peer is added.
    console.log(JSON.stringify(peers.map(statusPayload), null, 2));
    return 0;
  }
  for (const peer of peers) {
    announcePeer(peer, peers);
    printPeerStatus(peer);
  }
  return 0;
}

function printPeerStatus({ root, config, configPath }: Peer): void {
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  if (isStandalone(config)) {
    statusLine("standalone", root, "repo");
  } else {
    statusLine("main repo", root, "repo");
    statusLine("sidecar path", sidecarPath, "brand");
  }
  statusLine("remote", config.remote, "brand");
  statusLine("main branch", config.branch);
  statusLine("inbox branch", inbox);
  statusLine("conflicts", config.resolve === "lww" ? "last writer wins" : "fork files");

  if (!checkoutPresent) {
    // The state a fresh clone lands in when nothing cloned for it: say what to
    // run, since the daemon line below only explains why nothing did. `init` on
    // an already-configured repo is the catchall — it clones the checkout,
    // registers the repo, and offers the global install this may also be
    // missing, where `clone` would fix only the one line it sits under.
    statusLine("checkout", "missing — run `sidecar init`", "bad");
    printDaemonLine();
    printLastSyncLine(configPath);
    return;
  }

  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  statusLine("checkout", "present");
  // Sidecar keeps the checkout on its inbox branch; anywhere else is either a
  // sync mid-flight or a hand-made switch, and the next sync moves it back.
  if (!branch) statusLine("branch", "(detached)", "attn");
  else if (branch === inbox) statusLine("branch", branch);
  else statusLine("branch", `${branch} — not the inbox branch; sync will switch back`, "attn");
  statusLine("dirty", dirty ? "yes" : "no", dirty ? "attn" : "quiet");
  // Nothing converts this on its own, so the only way a user learns the command
  // exists is a line here and on a manual sync.
  if (checkoutIsUnlinkedFromFamily(root, config, sidecarPath)) {
    statusLine("family", "independent clone — syncs via the remote; `sidecar refresh` links it", "attn");
  }
  printDaemonLine();
  printLastSyncLine(configPath);

  const pending = pendingStatusInboxBranches(sidecarPath, config);
  if (pending.length) {
    statusLine("pending inbox", String(pending.length), "attn");
    for (const branchName of pending) console.log(`  ${paint("brand", branchName)}`);
  } else {
    statusLine("pending inbox", "none", "quiet");
  }
}

function statusPayload({ root, name, config, configPath }: Peer): Record<string, unknown> {
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  const branch = checkoutPresent ? git(sidecarPath, ["branch", "--show-current"]).stdout.trim() : undefined;
  return {
    root,
    peer: name,
    sidecarPath,
    standalone: isStandalone(config),
    remote: config.remote,
    branch: config.branch,
    inbox,
    checkout: checkoutPresent ? "present" : "missing",
    globalInstall: shouldUseGlobalRegistry() || Boolean(findGlobalSidecarExecutable()),
    currentBranch: branch || undefined,
    dirty: checkoutPresent ? Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim()) : undefined,
    familyLinked: checkoutPresent ? !checkoutIsUnlinkedFromFamily(root, config, sidecarPath) : undefined,
    daemon: daemonHealth().text,
    lastSyncAt: readInstances().find((instance) => instance.configPath === configPath)?.lastSyncAt,
    pendingInbox: checkoutPresent ? pendingStatusInboxBranches(sidecarPath, config) : undefined,
  };
}

function pendingStatusInboxBranches(sidecarPath: string, config: SidecarConfig): string[] {
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch)
    ? `origin/${config.branch}`
    : branchExists(sidecarPath, config.branch)
      ? config.branch
      : "HEAD";
  return pendingInboxBranches(sidecarPath, config).filter(
    (remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base),
  );
}

/**
 * Green when the daemon is up, red when it should be up and isn't, and dim when
 * this install can't run one at all — a project-local sidecar has no daemon to
 * report on, which is a fact about the install rather than a fault.
 *
 * The exception is a project-local install with nothing global on the machine:
 * no install owns a daemon, so this repo will never sync on its own. That is a
 * fault, and the one this line exists to make impossible to miss.
 */
export function daemonHealth(): { text: string; role: Role } {
  if (!shouldUseGlobalRegistry()) {
    if (!findGlobalSidecarExecutable()) {
      return { text: `no global install — nothing syncs; \`npm install -g ${PACKAGE_SPEC}\``, role: "bad" };
    }
    return { text: "owned by the global install", role: "quiet" };
  }

  const service = daemonServiceStatus();
  if (!service.available) return { text: service.message ?? "unavailable", role: "quiet" };
  if (service.running) return { text: "running", role: "ok" };
  if (!readSettings().daemonEnabled) return { text: "disabled", role: "attn" };
  if (!service.installed) return { text: "not installed — run `sidecar daemon enable`", role: "bad" };
  return { text: "stopped", role: "bad" };
}

function printDaemonLine(): void {
  const health = daemonHealth();
  statusLine("daemon", health.text, health.role);
}

function printLastSyncLine(configPath: string): void {
  const lastSyncAt = readInstances().find((instance) => instance.configPath === configPath)?.lastSyncAt;
  if (!lastSyncAt) {
    statusLine("last sync", "never", "quiet");
    return;
  }
  // Age isn't colored: a sidecar only syncs when something changed, so a quiet
  // week is normal and flagging it would train you to ignore the color.
  statusLine("last sync", formatTimestampPair(lastSyncAt));
}

/**
 * The fleet view: what every checkout of this sidecar last said about itself.
 *
 * Kept out of `status`, which answers "how is *this* checkout" and would lose
 * that focus if it also had to fetch and summarise every other machine.
 */
export function cmdHealth(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json", "--no-fetch"]),
    value: new Set(["--peer"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar health [--json] [--no-fetch] [--peer name]");

  const peers = loadPeers(selectedPeer(parsed));
  if (parsed.flags.has("--json")) {
    const entries = peers.map((peer) => fleetHealthEntries(peer, !parsed.flags.has("--no-fetch")));
    console.log(JSON.stringify(entries.length === 1 ? entries[0] : entries, null, 2));
    return 0;
  }
  for (const peer of peers) {
    announcePeer(peer, peers);
    printPeerHealth(peer, !parsed.flags.has("--no-fetch"));
  }
  return 0;
}

function fleetHealthEntries({ root, config }: Peer, refresh: boolean): ReturnType<typeof readFleetHealth> {
  const sidecarPath = requireSidecarCheckout(root, config);
  // A stale view is worse than a slow one — it would report a machine as fine
  // hours after it started failing. `--no-fetch` is for reading offline.
  if (refresh) fetch(sidecarPath, true, false);
  return readFleetHealth(sidecarPath);
}

function printPeerHealth(peer: Peer, refresh: boolean): void {
  const { config } = peer;
  const entries = fleetHealthEntries(peer, refresh);

  console.log(`${paint("label", "remote:")} ${paint("brand", config.remote)}`);
  console.log(`${paint("label", "fleet: ")} ${summarizeHealthStates(entries.map((entry) => entry.state))}`);
  if (!entries.length) {
    console.log("");
    console.log(paint("quiet", "no checkout has reported yet; each one publishes on its next sync"));
    return;
  }

  const width = "checkout:".length;
  const line = (label: string, value: string, role?: Role): void => labelLine(width, label, value, role, "  ");
  for (const { record, state, self } of entries) {
    console.log("");
    console.log(`${paint("repo", record.machine)}${self ? paint("quiet", "  (this checkout)") : ""}`);
    const status = healthStatusLine(state, record);
    line("status", status.text, status.role);
    if (record.message) line("detail", record.message);
    if (record.consecutiveFailures > 1) line("failures", `${record.consecutiveFailures} in a row`, "attn");
    if (record.root) line("checkout", record.root);
    if (record.peer) line("peer", record.peer);
    if (record.inbox) line("inbox", record.inbox);
    line("reported", formatTimestampPair(record.updatedAt));
    // Only worth a line when it isn't the reported time already — on a healthy
    // machine the two are the same and the repetition just adds noise.
    if (record.lastSuccessAt && record.lastSuccessAt !== record.updatedAt) {
      line("last ok", formatTimestampPair(record.lastSuccessAt));
    } else if (!record.lastSuccessAt) {
      line("last ok", "never", "attn");
    }
    if (record.version) line("version", record.version, "quiet");
  }
}

/** Red for a machine reporting its own failure, bold yellow for one gone quiet. */
function healthStatusLine(state: HealthState, record: HealthRecord): { text: string; role: Role } {
  if (state === "failed") {
    return { text: record.stage ? `failed at ${record.stage}` : "failed", role: "bad" };
  }
  if (state === "stale") {
    const age = formatRelativeTime(record.updatedAt) ?? record.updatedAt;
    return { text: `stale — last reported ${age}`, role: "attn" };
  }
  return { text: "ok", role: "ok" };
}

export function cmdInstances(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json"]),
    value: new Set(),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar instances [--json]");

  const statuses = listInstanceStatuses();
  if (parsed.flags.has("--json")) {
    console.log(`${JSON.stringify(statuses, null, 2)}`);
    return 0;
  }

  console.log(`${paint("label", "registry:")} ${paint("quiet", instancesPath())}`);
  console.log(`${paint("label", "log:     ")} ${paint("quiet", sidecarLogPath())}`);
  if (!statuses.length) {
    console.log("instances: none");
    return 0;
  }

  // "checkout:" is the longest label; matches the width `status` values use.
  const width = "checkout:".length;
  const line = (label: string, value: string, role?: Role): void => labelLine(width, label, value, role, "  ");
  for (const status of statuses) {
    console.log("");
    console.log(paint("repo", status.root));
    const peer = instancePeer(status);
    if (peer !== DEFAULT_PEER) line("peer", peer, "brand");
    line("sidecar", status.sidecarPath, "brand");
    line("remote", status.remote, "brand");
    line("branch", status.currentBranch || "(unknown)");
    line("config", status.config, status.config === "ok" ? undefined : "bad");
    line("checkout", status.checkout, status.checkout === "present" ? undefined : "bad");
    line("dirty", status.dirty, status.dirty === "yes" ? "attn" : "quiet");
    line("updated", formatTimestampPair(status.updatedAt));
    if (status.lastSyncAt) line("synced", formatTimestampPair(status.lastSyncAt));
  }
  return 0;
}

export function cmdTail(args: string[]): number {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set(["-n", "--lines"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar tail [-f|--follow] [-n|--lines count]");
  const rawLines = getValue(parsed, "--lines", getValue(parsed, "-n", "50"));
  const lines = Number.parseInt(rawLines, 10);
  if (!Number.isFinite(lines) || lines < 1 || String(lines) !== rawLines) {
    throw new SidecarError("--lines requires a positive integer");
  }

  const filePath = sidecarLogPath();
  if (!fs.existsSync(filePath)) {
    if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
      followLog(filePath, 0);
      return 0;
    }
    return 0;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > 0) {
    process.stdout.write(lastLines(fs.readFileSync(filePath, "utf8"), lines));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}

export function lastLines(content: string, count: number): string {
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!trimmed) return "";
  return `${trimmed.split("\n").slice(-count).join("\n")}\n`;
}

function followLog(filePath: string, startOffset: number): never {
  let offset = startOffset;
  while (true) {
    sleep(1000);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      offset = 0;
      continue;
    }

    if (stat.size < offset) offset = 0;
    if (stat.size <= offset) continue;

    const fd = fs.openSync(filePath, "r");
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
        offset += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
