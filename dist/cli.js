#!/usr/bin/env node

// src/cli.ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TextDecoder } from "node:util";

// src/redaction.ts
var KEY_NAME_PATTERN = String.raw`[A-Za-z_][A-Za-z0-9_-]*`;
var QUOTED_KEY_SECRET_REGEX = new RegExp(String.raw`(["'])(${KEY_NAME_PATTERN})\1(\s*:\s*)(["'])([^"'\r\n]+)(\4)`, "g");
var ASSIGNMENT_SECRET_REGEX = new RegExp(String.raw`\b(${KEY_NAME_PATTERN})(\s*[:=]\s*)(["']?)([^\s"',;` + "`" + String.raw`]+)(\3)`, "g");
var AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*:\s*bearer\s+)([^\s"',;`]+)/gi;
var BARE_BEARER_TOKEN_REGEX = /\b(Bearer\s+)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g;
var TOKEN_PATTERNS = [
  [/\bAKIA[0-9A-Z]{16}\b/g, "<API_KEY>"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<TOKEN>"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<TOKEN>"]
];
var EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
var PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
var SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
var CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
function redactText(input) {
  let output = input.replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(QUOTED_KEY_SECRET_REGEX, (match, keyQuote, key, separator, valueQuote, _value) => isSensitiveKey(key) ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}` : match).replace(ASSIGNMENT_SECRET_REGEX, (match, key, separator, quote) => isSensitiveKey(key) ? `${key}${separator}${quote}${placeholderForKey(key)}${quote}` : match);
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(EMAIL_REGEX, "<EMAIL>").replace(PHONE_REGEX, "<PHONENUMBER>").replace(SSN_REGEX, "<SSN>").replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) => isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate);
}
function placeholderForKey(key) {
  if (/api[_-]?key/i.test(key))
    return "<API_KEY>";
  if (/password|passwd|pwd|passphrase|secret|private/i.test(key))
    return "<SECRET>";
  return "<TOKEN>";
}
function isSensitiveKey(key) {
  const normalized = key.replace(/-/g, "_");
  const lower = normalized.toLowerCase();
  const compact = lower.replace(/_/g, "");
  const compactSensitive = new Set([
    "apikey",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "authtoken",
    "githubtoken",
    "bearertoken",
    "clientsecret",
    "secretkey",
    "privatekey",
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "token",
    "secret"
  ]);
  if (compactSensitive.has(compact))
    return true;
  const parts = normalized.toUpperCase().split("_").filter(Boolean);
  const last = parts.at(-1);
  if (["PASSWORD", "PASSWD", "PWD", "PASSPHRASE", "TOKEN", "SECRET"].includes(last ?? "")) {
    return true;
  }
  if (parts.includes("API") && parts.includes("KEY"))
    return true;
  if (parts.includes("ACCESS") && parts.includes("TOKEN"))
    return true;
  if (parts.includes("REFRESH") && parts.includes("TOKEN"))
    return true;
  if (parts.includes("SECRET") && (parts.includes("KEY") || parts.includes("ACCESS")))
    return true;
  if (parts.includes("PRIVATE") && parts.includes("KEY"))
    return true;
  return false;
}
function isLikelyCreditCard(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19)
    return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1;index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9)
        digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

// src/cli.ts
var DEFAULT_PATH = "sidecar";
var DEFAULT_BRANCH = "main";
var DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";

class SidecarError extends Error {
  constructor(message) {
    super(message);
    this.name = "SidecarError";
  }
}
function main(argv = process.argv.slice(2)) {
  try {
    return run(argv);
  } catch (error) {
    if (error instanceof SidecarError) {
      console.error(`sidecar: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.error("sidecar: stopped");
      return 130;
    }
    throw error;
  }
}
function run(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }
  switch (command) {
    case "init":
      return cmdInit(rest);
    case "clone":
      return cmdClone(rest);
    case "status":
      return cmdStatus(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "push":
      return cmdPush(rest);
    case "watch":
      return cmdWatch(rest);
    case "merge":
      return cmdMerge(rest);
    default:
      throw new SidecarError(`unknown command ${JSON.stringify(command)}`);
  }
}
function printUsage() {
  console.error(`usage: sidecar <command> [options]

commands:
  init <remote> [--path sidecar] [--branch main] [--inbox template]
  clone
  status
  snapshot [--push] [-m message]
  push [--no-snapshot] [-m message]
  watch [--debounce 30] [--interval 2] [--max-interval 300]
  merge [--fork-files] [--no-push]`);
}
function cmdInit(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main"]),
    value: new Set(["--path", "--branch", "--inbox"])
  });
  const remote = parsed.positional[0];
  if (!remote || parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init <remote> [--path sidecar] [--branch main] [--inbox template]");
  }
  const root = gitToplevel(process.cwd());
  const config = {
    remote,
    version: 1,
    path: getValue(parsed, "--path", DEFAULT_PATH),
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX)
  };
  validateBranch(config.branch);
  writeConfig(path.join(root, ".sidecar"), config);
  ensureGitignoreEntry(path.join(root, ".gitignore"), config.path);
  console.log(`wrote ${path.join(root, ".sidecar")}`);
  console.log(`ignored ${config.path.replace(/\/+$/, "")}/`);
  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  return 0;
}
function cmdClone(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar clone [--no-bootstrap-main]");
  const [root, config] = loadProject();
  cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  return 0;
}
function cmdStatus(args) {
  const parsed = parseOptions(args, { boolean: new Set, value: new Set });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar status");
  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  console.log(`main repo:    ${root}`);
  console.log(`sidecar path: ${sidecarPath}`);
  console.log(`remote:       ${config.remote}`);
  console.log(`main branch:  ${config.branch}`);
  console.log(`inbox branch: ${inbox}`);
  if (!checkoutPresent) {
    console.log("checkout:     missing");
    return 0;
  }
  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  console.log("checkout:     present");
  console.log(`branch:       ${branch || "(detached)"}`);
  console.log(`dirty:        ${dirty ? "yes" : "no"}`);
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch) ? `origin/${config.branch}` : branchExists(sidecarPath, config.branch) ? config.branch : "HEAD";
  const pending = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base));
  if (pending.length) {
    console.log("pending inbox:");
    for (const branchName of pending)
      console.log(`  ${branchName}`);
  } else {
    console.log("pending inbox: none");
  }
  return 0;
}
function cmdSnapshot(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--push"]),
    value: new Set(["-m", "--message"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar snapshot [--push] [-m message]");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  const committed = snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined);
  if (committed && parsed.flags.has("--push")) {
    syncBranchBeforePush(sidecarPath, inbox);
    pushBranch(sidecarPath, inbox);
  }
  return 0;
}
function cmdPush(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot"]),
    value: new Set(["-m", "--message"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar push [--no-snapshot] [-m message]");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, true, false);
  ensureInboxBranch(sidecarPath, config, inbox);
  if (!parsed.flags.has("--no-snapshot")) {
    snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined);
  }
  syncBranchBeforePush(sidecarPath, inbox);
  pushBranch(sidecarPath, inbox);
  return 0;
}
function cmdWatch(args) {
  const parsed = parseOptions(args, {
    boolean: new Set,
    value: new Set(["--debounce", "--interval", "--max-interval"])
  });
  if (parsed.positional.length) {
    throw new SidecarError("usage: sidecar watch [--debounce 30] [--interval 2] [--max-interval 300]");
  }
  const debounce = Number(getValue(parsed, "--debounce", "30"));
  const interval = Number(getValue(parsed, "--interval", "2"));
  const maxInterval = Number(getValue(parsed, "--max-interval", "300"));
  if (!Number.isFinite(debounce) || debounce < 0)
    throw new SidecarError("--debounce must be >= 0");
  if (!Number.isFinite(interval) || interval <= 0)
    throw new SidecarError("--interval must be > 0");
  if (!Number.isFinite(maxInterval) || maxInterval <= 0)
    throw new SidecarError("--max-interval must be > 0");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`watching ${sidecarPath} -> ${inbox}`);
  let lastSignature = treeSignature(sidecarPath);
  let firstDirtyAt;
  let lastChangeAt;
  while (true) {
    sleep(interval * 1000);
    const signature = treeSignature(sidecarPath);
    const now = Date.now() / 1000;
    if (signature !== lastSignature) {
      lastSignature = signature;
      firstDirtyAt ??= now;
      lastChangeAt = now;
      continue;
    }
    if (firstDirtyAt === undefined || lastChangeAt === undefined)
      continue;
    const quietFor = now - lastChangeAt;
    const dirtyFor = now - firstDirtyAt;
    if (quietFor >= debounce || dirtyFor >= maxInterval) {
      console.log("snapshotting sidecar changes");
      ensureInboxBranch(sidecarPath, config, inbox);
      snapshot(sidecarPath, root, inbox);
      syncBranchBeforePush(sidecarPath, inbox);
      pushBranch(sidecarPath, inbox);
      firstDirtyAt = undefined;
      lastChangeAt = undefined;
      lastSignature = treeSignature(sidecarPath);
    }
  }
}
function cmdMerge(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--delete-merged-inbox", "--no-push"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
  }
  if (parsed.flags.has("--delete-merged-inbox")) {
    throw new SidecarError("--delete-merged-inbox is no longer supported; merged inbox branches are kept and skipped by ancestry");
  }
  if (!parsed.flags.has("--fork-files")) {
    console.log("sidecar: conflicts will stop the merge; pass --fork-files to preserve all versions");
  }
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  ensureClean(sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, false);
  ensureMainBranch(sidecarPath, config);
  const inboxBranches = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"));
  if (!inboxBranches.length) {
    console.log("no inbox branches to merge");
    return 0;
  }
  const merged = [];
  for (const remoteBranch of inboxBranches) {
    console.log(`merging ${remoteBranch}`);
    const result = git(sidecarPath, ["merge", "--no-ff", "-m", `Merge ${remoteBranch}`, remoteBranch], { check: false });
    if (result.status === 0) {
      merged.push(remoteBranch);
      continue;
    }
    if (!hasUnmergedPaths(sidecarPath)) {
      throw new SidecarError(result.stderr.trim() || `merge failed for ${remoteBranch}`);
    }
    if (!parsed.flags.has("--fork-files")) {
      git(sidecarPath, ["merge", "--abort"], { check: false });
      throw new SidecarError(`merge conflict in ${remoteBranch}; rerun with --fork-files`);
    }
    forkConflicts(sidecarPath, remoteBranch);
    git(sidecarPath, ["commit", "-m", `Merge ${remoteBranch} with forked conflict files`]);
    merged.push(remoteBranch);
  }
  if (!parsed.flags.has("--no-push")) {
    pushBranch(sidecarPath, config.branch);
  }
  console.log(`merged ${merged.length} inbox branch(es)`);
  return 0;
}
function cloneOrUpdate(root, config, bootstrapMain) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (fs.existsSync(sidecarPath) && !hasGitMetadata(sidecarPath)) {
    if (fs.readdirSync(sidecarPath).length) {
      throw new SidecarError(`${sidecarPath} exists and is not an empty Git repo`);
    }
    fs.rmdirSync(sidecarPath);
  }
  if (!fs.existsSync(sidecarPath)) {
    gitRaw(["clone", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }
  ensureCommitIdentity(sidecarPath);
  if (bootstrapMain)
    bootstrapMainBranch(sidecarPath, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${sidecarPath}`);
}
function bootstrapMainBranch(repo, config) {
  if (remoteRefExists(repo, config.branch))
    return;
  if (hasAnyCommit(repo)) {
    const current = git(repo, ["branch", "--show-current"]).stdout.trim();
    if (current !== config.branch) {
      if (branchExists(repo, config.branch)) {
        git(repo, ["switch", config.branch]);
      } else {
        git(repo, ["switch", "-c", config.branch]);
      }
    }
    pushBranch(repo, config.branch);
    return;
  }
  git(repo, ["switch", "--orphan", config.branch]);
  fs.writeFileSync(path.join(repo, "README.md"), `# Sidecar

Canonical sidecar state for this repository.
`, "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "Initialize sidecar"]);
  pushBranch(repo, config.branch);
}
function ensureMainBranch(repo, config) {
  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", config.branch]);
  } else if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", config.branch, "--track", `origin/${config.branch}`]);
  } else if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", config.branch]);
  } else {
    bootstrapMainBranch(repo, config);
    return;
  }
  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["merge", "--ff-only", `origin/${config.branch}`]);
  }
}
function ensureInboxBranch(repo, config, inbox) {
  const current = git(repo, ["branch", "--show-current"]).stdout.trim();
  if (current === inbox)
    return;
  if (branchExists(repo, inbox)) {
    git(repo, ["switch", inbox]);
    return;
  }
  if (remoteRefExists(repo, inbox)) {
    git(repo, ["switch", "-c", inbox, "--track", `origin/${inbox}`]);
    return;
  }
  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, `origin/${config.branch}`]);
    return;
  }
  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, config.branch]);
    return;
  }
  if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
    return;
  }
  bootstrapMainBranch(repo, config);
  git(repo, ["switch", "-c", inbox, config.branch]);
}
function snapshot(repo, mainRoot, inbox, message = "sidecar snapshot") {
  scrubSidecarTree(repo);
  git(repo, ["add", "-A"]);
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    console.log("no sidecar changes to snapshot");
    return false;
  }
  const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
  const mainHeadText = mainHead.status === 0 ? mainHead.stdout.trim() : "unborn";
  const source = `${currentUser()}@${currentHost()}`;
  const body = [
    message,
    "",
    `source: ${source}`,
    `main-head: ${mainHeadText}`,
    `inbox: ${inbox}`
  ];
  git(repo, ["commit", "-m", body.join(`
`)]);
  console.log(`committed sidecar snapshot to ${inbox}`);
  return true;
}
function scrubSidecarTree(root) {
  let changed = 0;
  for (const filePath of walkFiles(root)) {
    const relative = path.relative(root, filePath).split(path.sep);
    if (relative.includes(".git"))
      continue;
    let data;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (data.includes(0))
      continue;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      continue;
    }
    const redacted = redactText(text);
    if (redacted !== text) {
      fs.writeFileSync(filePath, redacted, "utf8");
      changed += 1;
    }
  }
  if (changed) {
    console.log(`redacted sensitive text in ${changed} sidecar file(s)`);
  }
  return changed;
}
function syncBranchBeforePush(repo, branch) {
  fetch(repo, true, false);
  if (!remoteRefExists(repo, branch))
    return;
  const remoteBranch = `origin/${branch}`;
  if (isAncestor(repo, remoteBranch, "HEAD"))
    return;
  if (isDirty(repo)) {
    throw new SidecarError(`${remoteBranch} has commits not in local ${branch}, and the sidecar checkout has uncommitted changes`);
  }
  if (isAncestor(repo, "HEAD", remoteBranch)) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }
  const result = git(repo, ["rebase", remoteBranch], { check: false });
  if (result.status !== 0) {
    git(repo, ["rebase", "--abort"], { check: false });
    throw new SidecarError(result.stderr.trim() || `could not rebase ${branch} onto ${remoteBranch}`);
  }
}
function pushBranch(repo, branch) {
  git(repo, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  console.log(`pushed ${branch}`);
}
function forkConflicts(repo, remoteBranch) {
  const conflicts = unmergedPaths(repo);
  if (!Object.keys(conflicts).length) {
    throw new SidecarError("merge reported conflicts, but no unmerged paths were found");
  }
  const timestamp = utcTimestamp();
  const branch = remoteBranchName(remoteBranch) || remoteBranch;
  const branchLabel = slug(branch);
  const manifestLabel = fileLabel(branch);
  const manifest = {
    timestamp,
    resolved_by: "fork-files",
    source_branch: branch,
    paths: []
  };
  for (const [conflictPath, stages] of Object.entries(conflicts).sort(([left], [right]) => left.localeCompare(right))) {
    const versions = [];
    for (const [stage, label] of [
      [2, "main"],
      [3, branchLabel]
    ]) {
      const blob = showStage(repo, stage, conflictPath);
      if (!blob)
        continue;
      const oid = stages[stage] ?? "";
      const outPath = forkPath(conflictPath, label, oid);
      const fullOut = path.join(repo, outPath);
      fs.mkdirSync(path.dirname(fullOut), { recursive: true });
      fs.writeFileSync(fullOut, blob);
      versions.push({
        stage,
        label,
        oid,
        path: outPath,
        sha256: crypto.createHash("sha256").update(blob).digest("hex")
      });
    }
    git(repo, ["rm", "-f", "--ignore-unmatch", "--", conflictPath], { check: false });
    const original = path.join(repo, conflictPath);
    if (fs.existsSync(original) && fs.statSync(original).isFile())
      fs.unlinkSync(original);
    manifest.paths.push({ path: conflictPath, versions });
  }
  const manifestDir = path.join(repo, ".sidecar-conflicts");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${timestamp}-${manifestLabel}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  git(repo, ["add", "-A"]);
  if (hasUnmergedPaths(repo)) {
    throw new SidecarError("fork-files did not clear all unmerged paths");
  }
}
function forkPath(conflictPath, label, oid) {
  const parsed = path.parse(conflictPath);
  const shortOid = oid ? oid.slice(0, 7) : "missing";
  const safeLabel = fileLabel(label);
  const forkName = parsed.ext ? `${parsed.name}.conflict.${safeLabel}.${shortOid}${parsed.ext}` : `${parsed.name}.conflict.${safeLabel}.${shortOid}`;
  return path.join(parsed.dir, forkName);
}
function fileLabel(value) {
  return slug(value).replaceAll("/", "-");
}
function unmergedPaths(repo) {
  const result = gitBytes(repo, ["ls-files", "-u", "-z"]);
  const paths = {};
  for (const record of result.stdout.toString("binary").split("\x00")) {
    if (!record)
      continue;
    const separator = record.indexOf("\t");
    const meta = record.slice(0, separator);
    const rawPath = record.slice(separator + 1);
    const parts = meta.split(/\s+/);
    const oid = parts[1] ?? "";
    const stage = Number(parts[2]);
    paths[rawPath] ??= {};
    paths[rawPath][stage] = oid;
  }
  return paths;
}
function hasUnmergedPaths(repo) {
  return Object.keys(unmergedPaths(repo)).length > 0;
}
function showStage(repo, stage, conflictPath) {
  const result = gitBytes(repo, ["show", `:${stage}:${conflictPath}`], { check: false });
  return result.status === 0 ? result.stdout : undefined;
}
function pendingInboxBranches(repo, config) {
  const prefix = `origin/${inboxPrefix(config)}`;
  const refs = git(repo, ["branch", "-r", "--format=%(refname:short)"]).stdout.split(/\r?\n/);
  return refs.map((ref) => ref.trim()).filter((ref) => ref.startsWith(prefix) && ref !== "origin/HEAD").sort();
}
function inboxPrefix(config) {
  const beforeVars = config.inbox.split("{", 1)[0] ?? "";
  return `${beforeVars.replace(/\/+$/, "")}/`;
}
function remoteBranchName(remoteBranch) {
  return remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
}
function expandInbox(config, repo) {
  const values = {
    user: slug(currentUser()),
    host: slug(currentHost()),
    random: repo ? checkoutRandom(repo) : "pending"
  };
  const inbox = config.inbox.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined)
      throw new SidecarError(`unknown inbox template variable {${key}}`);
    return value;
  }).replace(/^\/+|\/+$/g, "");
  validateBranch(inbox);
  return inbox;
}
function checkoutRandom(repo) {
  const gitDirectory = gitDir(repo);
  const idPath = path.join(gitDirectory, "sidecar-id");
  if (fs.existsSync(idPath)) {
    const existing = slug(fs.readFileSync(idPath, "utf8"));
    if (existing)
      return existing;
  }
  const id = crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(idPath, `${id}
`, { encoding: "utf8", mode: 384 });
  return id;
}
function validateBranch(branch) {
  const result = gitRaw(["check-ref-format", "--branch", branch], { check: false });
  if (result.status !== 0)
    throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
}
function slug(value) {
  const slugged = value.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").replace(/^[./]+|[./]+$/g, "");
  return slugged || "unknown";
}
function treeSignature(root) {
  const digest = crypto.createHash("sha256");
  for (const filePath of Array.from(walkEntries(root)).sort()) {
    const relative = path.relative(root, filePath);
    if (relative.split(path.sep).includes(".git"))
      continue;
    try {
      const stat = fs.statSync(filePath);
      digest.update(relative);
      digest.update(String(stat.mtimeMs));
      digest.update(String(stat.size));
    } catch {
      continue;
    }
  }
  return digest.digest("hex");
}
function loadProject() {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path.join(root, ".sidecar"))];
}
function findConfigRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar")))
      return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new SidecarError("could not find .sidecar");
    current = parent;
  }
}
function gitToplevel(cwd) {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0)
    throw new SidecarError("not inside a Git repository");
  return result.stdout.trim();
}
function requireSidecarCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    throw new SidecarError(`missing sidecar checkout at ${sidecarPath}; run \`sidecar clone\``);
  }
  return sidecarPath;
}
function writeConfig(configPath, config) {
  const text = [
    `version = ${config.version}`,
    `remote = ${JSON.stringify(config.remote)}`,
    `path = ${JSON.stringify(config.path)}`,
    `branch = ${JSON.stringify(config.branch)}`,
    `inbox = ${JSON.stringify(config.inbox)}`,
    ""
  ].join(`
`);
  fs.writeFileSync(configPath, text, "utf8");
}
function readConfig(configPath) {
  const values = {};
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  for (let index = 0;index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].split("#", 1)[0].trim();
    if (!line)
      continue;
    if (!line.includes("="))
      throw new SidecarError(`${configPath}:${lineNumber} expected key = value`);
    const [rawKey, ...rawValueParts] = line.split("=");
    const key = rawKey.trim();
    const rawValue = rawValueParts.join("=").trim();
    let value;
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      value = rawValue.slice(1, -1);
    } else if (/^\d+$/.test(rawValue)) {
      value = Number(rawValue);
    } else {
      value = rawValue;
    }
    values[key] = value;
  }
  if (!values.remote)
    throw new SidecarError(`${configPath} is missing remote`);
  const config = {
    remote: String(values.remote),
    version: Number(values.version ?? 1),
    path: String(values.path ?? DEFAULT_PATH),
    branch: String(values.branch ?? DEFAULT_BRANCH),
    inbox: String(values.inbox ?? DEFAULT_INBOX)
  };
  validateBranch(config.branch);
  return config;
}
function ensureGitignoreEntry(gitignorePath, sidecarPath) {
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(gitignorePath, `${lines.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function ensureClean(repo) {
  if (isDirty(repo))
    throw new SidecarError("sidecar checkout has uncommitted changes");
}
function ensureCommitIdentity(repo) {
  if (git(repo, ["config", "user.name"], { check: false }).status !== 0) {
    git(repo, ["config", "user.name", currentUser()]);
  }
  if (git(repo, ["config", "user.email"], { check: false }).status !== 0) {
    git(repo, ["config", "user.email", `${slug(currentUser())}@${slug(currentHost())}.local`]);
  }
}
function currentUser() {
  return process.env.USER || os.userInfo().username || "unknown";
}
function currentHost() {
  return os.hostname().split(".", 1)[0] || "unknown";
}
function fetch(repo, quiet, check = true) {
  const args = ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"];
  if (quiet)
    args.splice(1, 0, "--quiet");
  git(repo, args, { check });
}
function hasAnyCommit(repo) {
  return git(repo, ["rev-parse", "--verify", "HEAD"], { check: false }).status === 0;
}
function branchExists(repo, branch) {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { check: false }).status === 0;
}
function remoteRefExists(repo, branch) {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], {
    check: false
  }).status === 0;
}
function isAncestor(repo, maybeAncestor, descendant) {
  return git(repo, ["merge-base", "--is-ancestor", maybeAncestor, descendant], { check: false }).status === 0;
}
function git(repo, args, options = {}) {
  return gitRaw(["-C", repo, ...args], options);
}
function gitBytes(repo, args, options = {}) {
  const check = options.check ?? true;
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024
  });
  const status = result.status ?? 1;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  if (check && status !== 0) {
    throw new SidecarError(stderr.toString("utf8").trim() || stdout.toString("utf8").trim());
  }
  return { status, stdout, stderr };
}
function gitRaw(args, options = {}) {
  const check = options.check ?? true;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (check && status !== 0) {
    throw new SidecarError(stderr.trim() || stdout.trim());
  }
  return { status, stdout, stderr };
}
function parseOptions(args, spec) {
  const flags = new Set;
  const values = new Map;
  const positional = [];
  for (let index = 0;index < args.length; index += 1) {
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
      if (value === undefined)
        throw new SidecarError(`${name} requires a value`);
      values.set(name, value);
      continue;
    }
    if (inlineValue !== undefined)
      throw new SidecarError(`${name} does not take a value`);
    if (spec.boolean.has(name)) {
      flags.add(name);
      continue;
    }
    throw new SidecarError(`unknown option ${name}`);
  }
  return { flags, values, positional };
}
function getValue(parsed, name, fallback) {
  return parsed.values.get(name) ?? fallback;
}
function resolveSidecarPath(root, config) {
  return path.resolve(root, config.path);
}
function hasGitMetadata(repo) {
  return fs.existsSync(path.join(repo, ".git"));
}
function isDirty(repo) {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
}
function gitDir(repo) {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path.isAbsolute(result) ? result : path.resolve(repo, result);
}
function* walkEntries(root) {
  if (!fs.existsSync(root))
    return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    yield entryPath;
    if (entry.isDirectory())
      yield* walkEntries(entryPath);
  }
}
function* walkFiles(root) {
  for (const entryPath of walkEntries(root)) {
    try {
      if (fs.statSync(entryPath).isFile())
        yield entryPath;
    } catch {
      continue;
    }
  }
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function utcTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// src/bin.ts
process.exit(main());
