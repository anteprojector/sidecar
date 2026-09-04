#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/color.ts
function colorLevel(stream = process.stdout) {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "")
    return 0;
  if (env.FORCE_COLOR === "0" || env.CLICOLOR === "0")
    return 0;
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" || env.CLICOLOR_FORCE !== undefined && env.CLICOLOR_FORCE !== "0";
  if (!forced) {
    if (env.TERM === "dumb")
      return 0;
    if (!stream.isTTY)
      return 0;
  }
  const term = env.TERM ?? "";
  const colorterm = env.COLORTERM ?? "";
  if (/truecolor|24bit/i.test(colorterm))
    return 3;
  if (/-256(color)?$/i.test(term) || term === "xterm-kitty" || colorterm !== "")
    return 2;
  return 1;
}
function code(role, level) {
  switch (role) {
    case "label":
    case "quiet":
      return "2";
    case "ok":
      return "32";
    case "bad":
      return "31";
    case "repo":
      if (level === 3)
        return `38;2;${REPO.r};${REPO.g};${REPO.b}`;
      if (level === 2)
        return `38;5;${REPO_256}`;
      return "35";
    case "brand":
    case "attn": {
      const bold = role === "attn" ? "1;" : "";
      if (level === 3)
        return `${bold}38;2;${BRAND.r};${BRAND.g};${BRAND.b}`;
      if (level === 2)
        return `${bold}38;5;${BRAND_256}`;
      return `${bold}33`;
    }
  }
}
function paint(role, text, level = colorLevel()) {
  if (level === 0 || text === "")
    return text;
  const sgr = code(role, level);
  return sgr ? `\x1B[${sgr}m${text}\x1B[0m` : text;
}
function stripColor(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
var BRAND, BRAND_256 = 214, REPO, REPO_256 = 99;
var init_color = __esm(() => {
  BRAND = { r: 255, g: 198, b: 30 };
  REPO = { r: 139, g: 92, b: 246 };
});

// src/util.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
function findExecutableOnPath(name) {
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    if (isFilePath(candidate))
      return candidate;
  }
  return;
}
function isFilePath(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function compareVersions(a, b) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0;index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff)
      return diff < 0 ? -1 : 1;
  }
  return 0;
}
function slug(value) {
  const slugged = value.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").replace(/^[./]+|[./]+$/g, "");
  return slugged || "unknown";
}
function realpathOr(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
function isInsidePath(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function currentUser() {
  return process.env.USER || os.userInfo().username || "unknown";
}
function currentHost() {
  return os.hostname().split(".", 1)[0] || "unknown";
}
function parseDuration(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string")
    return;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h)?\s*$/i.exec(value);
  if (!match)
    return;
  const scale = { s: 1, m: 60, h: 3600 }[(match[2] ?? "s").toLowerCase()];
  return Number(match[1]) * scale;
}
function utcTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function nowIso() {
  return new Date().toISOString();
}
var SidecarError;
var init_util = __esm(() => {
  SidecarError = class SidecarError extends Error {
    constructor(message) {
      super(message);
      this.name = "SidecarError";
    }
  };
});

// src/install.ts
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function packageVersion() {
  let current = path2.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifestPath = path2.join(current, "package.json");
    if (fs2.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
        if (manifest.name === PACKAGE_NAME && manifest.version)
          return manifest.version;
      } catch {}
    }
    const parent = path2.dirname(current);
    if (parent === current)
      return "0.0.0";
    current = parent;
  }
}
function findDependencyRoot(start) {
  let current = path2.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current))
      return current;
    const parent = path2.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function projectDependsOnSidecar(projectRoot) {
  const manifestPath = path2.join(projectRoot, "package.json");
  if (!fs2.existsSync(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME] || manifest.devDependencies?.[PACKAGE_NAME] || manifest.optionalDependencies?.[PACKAGE_NAME] || manifest.peerDependencies?.[PACKAGE_NAME]);
  } catch {
    return false;
  }
}
function installedPackageVersion(projectRoot) {
  const manifestPath = path2.join(projectRoot, "node_modules", PACKAGE_NAME, "package.json");
  try {
    const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
    return manifest.name === PACKAGE_NAME ? manifest.version : undefined;
  } catch {
    return;
  }
}
function shouldUseGlobalRegistry() {
  return process.env[GLOBAL_EXEC_ENV] === "1" || !findDependencyRoot(process.cwd());
}
function isProjectLocalPath(executable) {
  const depRoot = findDependencyRoot(path2.dirname(executable));
  if (!depRoot)
    return false;
  if (realpathOr(depRoot) === realpathOr(bunGlobalRoot()))
    return false;
  return isInsidePath(executable, path2.join(depRoot, "node_modules"));
}
function bunGlobalRoot() {
  return path2.join(process.env.BUN_INSTALL || path2.join(os2.homedir(), ".bun"), "install", "global");
}
function currentExecutablePath() {
  return realpathOr(process.argv[1] || fileURLToPath(import.meta.url));
}
function findGlobalSidecarExecutable() {
  const names = process.platform === "win32" ? ["sidecar.cmd", "sidecar.ps1", "sidecar"] : ["sidecar"];
  for (const entry of (process.env.PATH || "").split(path2.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path2.join(entry, name);
      if (!isFilePath(candidate))
        continue;
      if (isProjectLocalPath(realpathOr(candidate)))
        continue;
      return candidate;
    }
  }
  return;
}
function globalSidecarVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1" }
  });
  if (result.status !== 0)
    return;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
}
var PACKAGE_NAME = "sidecarsync", PACKAGE_SPEC = "sidecarsync", GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC", SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC", INSTALL_SOURCES;
var init_install = __esm(() => {
  init_util();
  INSTALL_SOURCES = new Set(["npm", "bun", "curl"]);
});

// src/git.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
function git(repo, args, options = {}) {
  return gitRaw(["-C", repo, ...args], options);
}
function gitBytes(repo, args, options = {}) {
  const check = options.check ?? true;
  const result = spawnSync2("git", ["-C", repo, ...args], {
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
  const result = spawnSync2("git", args, {
    encoding: "utf8",
    input: options.input,
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
function gitToplevel(cwd) {
  const root = gitToplevelOptional(cwd);
  if (!root)
    throw new SidecarError("not inside a Git repository");
  return root;
}
function gitToplevelOptional(cwd) {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0)
    return;
  return result.stdout.trim();
}
function gitCommonDir(root) {
  const commonDir = gitCommonDirOptional(root);
  if (!commonDir)
    throw new SidecarError("not inside a Git repository");
  return commonDir;
}
function gitExcludePath(root) {
  const commonDir = gitCommonDirOptional(root);
  return commonDir ? path3.join(commonDir, "info", "exclude") : undefined;
}
function isGitIgnored(root, relativePath) {
  return git(root, ["check-ignore", "-q", "--", relativePath], { check: false }).status === 0;
}
function isGitTracked(root, relativePath) {
  return git(root, ["ls-files", "--error-unmatch", "--", relativePath], { check: false }).status === 0;
}
function gitCommonDirOptional(root) {
  const result = gitRaw(["-C", root, "rev-parse", "--git-common-dir"], { check: false });
  if (result.status !== 0)
    return;
  return path3.resolve(root, result.stdout.trim());
}
function gitDir(repo) {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path3.isAbsolute(result) ? result : path3.resolve(repo, result);
}
function hasGitMetadata(repo) {
  return fs3.existsSync(path3.join(repo, ".git"));
}
function isDirty(repo) {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
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
function familyPrimaryRoot(root) {
  const primary = jjDefaultWorkspace(root) ?? gitMainWorktree(root);
  if (!primary)
    return;
  return realpathOr(primary) === realpathOr(root) ? undefined : primary;
}
function jjDefaultWorkspace(root) {
  const pointer = path3.join(root, ".jj", "repo");
  try {
    if (!fs3.statSync(pointer).isFile())
      return;
    const repo = path3.resolve(path3.dirname(pointer), fs3.readFileSync(pointer, "utf8").trim());
    const workspace = path3.dirname(path3.dirname(repo));
    return fs3.existsSync(path3.join(workspace, ".jj")) ? workspace : undefined;
  } catch {
    return;
  }
}
function gitMainWorktree(root) {
  const result = git(root, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0)
    return;
  const entry = result.stdout.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  return entry?.slice("worktree ".length).trim() || undefined;
}
var init_git = __esm(() => {
  init_util();
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/date.js
var DATE_TIME_RE, TomlDate;
var init_date = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
  TomlDate = class TomlDate extends Date {
    #hasDate = false;
    #hasTime = false;
    #offset = null;
    constructor(date) {
      let hasDate = true;
      let hasTime = true;
      let offset = "Z";
      if (typeof date === "string") {
        let match = date.match(DATE_TIME_RE);
        if (match) {
          if (!match[1]) {
            hasDate = false;
            date = `0000-01-01T${date}`;
          }
          hasTime = !!match[2];
          hasTime && date[10] === " " && (date = date.replace(" ", "T"));
          if (match[2] && +match[2] > 23) {
            date = "";
          } else {
            offset = match[3] || null;
            date = date.toUpperCase();
            if (!offset && hasTime)
              date += "Z";
          }
        } else {
          date = "";
        }
      }
      super(date);
      if (!isNaN(this.getTime())) {
        this.#hasDate = hasDate;
        this.#hasTime = hasTime;
        this.#offset = offset;
      }
    }
    isDateTime() {
      return this.#hasDate && this.#hasTime;
    }
    isLocal() {
      return !this.#hasDate || !this.#hasTime || !this.#offset;
    }
    isDate() {
      return this.#hasDate && !this.#hasTime;
    }
    isTime() {
      return this.#hasTime && !this.#hasDate;
    }
    isValid() {
      return this.#hasDate || this.#hasTime;
    }
    toISOString() {
      let iso = super.toISOString();
      if (this.isDate())
        return iso.slice(0, 10);
      if (this.isTime())
        return iso.slice(11, 23);
      if (this.#offset === null)
        return iso.slice(0, -1);
      if (this.#offset === "Z")
        return iso;
      let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
      offset = this.#offset[0] === "-" ? offset : -offset;
      let offsetDate = new Date(this.getTime() - offset * 60000);
      return offsetDate.toISOString().slice(0, -1) + this.#offset;
    }
    static wrapAsOffsetDateTime(jsDate, offset = "Z") {
      let date = new TomlDate(jsDate);
      date.#offset = offset;
      return date;
    }
    static wrapAsLocalDateTime(jsDate) {
      let date = new TomlDate(jsDate);
      date.#offset = null;
      return date;
    }
    static wrapAsLocalDate(jsDate) {
      let date = new TomlDate(jsDate);
      date.#hasTime = false;
      date.#offset = null;
      return date;
    }
    static wrapAsLocalTime(jsDate) {
      let date = new TomlDate(jsDate);
      date.#hasDate = false;
      date.#offset = null;
      return date;
    }
  };
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1;i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += `
`;
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += `^
`;
    }
  }
  return codeblock;
}
var TomlError;
var init_error = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  TomlError = class TomlError extends Error {
    line;
    column;
    codeblock;
    constructor(message, options) {
      const [line, column] = getLineColFromPtr(options.toml, options.ptr);
      const codeblock = makeCodeBlock(options.toml, line, column);
      super(`Invalid TOML document: ${message}

${codeblock}`, options);
      this.line = line;
      this.column = column;
      this.codeblock = codeblock;
    }
  };
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/primitive.js
function parseString(str, ptr) {
  let c = str[ptr++];
  let first = c;
  let isLiteral = c === "'";
  let isMultiline = c === str[ptr] && c === str[ptr + 1];
  if (isMultiline) {
    if (str[ptr += 2] === `
`)
      ptr++;
    else if (str[ptr] === "\r" && str[ptr + 1] === `
`)
      ptr += 2;
  }
  let parsed = "";
  let sliceStart = ptr;
  let state = 0;
  for (let i = ptr;i < str.length; i++) {
    c = str[i];
    if (isMultiline && (c === `
` || c === "\r" && str[i + 1] === `
`)) {
      state = state && 3;
    } else if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: i
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || str[i + 1] === first && str[i + 2] === first)) {
      if (isMultiline) {
        if (str[i + 3] === first)
          i++;
        if (str[i + 3] === first)
          i++;
      }
      return [
        state ? parsed : parsed + str.slice(sliceStart, i),
        i + (isMultiline ? 3 : 1)
      ];
    } else if (!state) {
      if (!isLiteral && c === "\\") {
        parsed += str.slice(sliceStart, sliceStart = i);
        state = 1;
      }
    } else if (state === 1) {
      if (c === "x" || c === "u" || c === "U") {
        let value = 0;
        let len = c === "x" ? 2 : c === "u" ? 4 : 8;
        for (let j = 0;j < len; j++, i++) {
          let hex = str.charCodeAt(i + 1);
          let digit = hex >= 48 && hex <= 57 ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 65 + 10 : hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1;
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: str, ptr: i + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: str, ptr: i });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = i + 1;
        state = 0;
      } else if (c === " " || c === "\t") {
        state = 2;
      } else {
        if (c === "b")
          parsed += "\b";
        else if (c === "t")
          parsed += "\t";
        else if (c === "n")
          parsed += `
`;
        else if (c === "f")
          parsed += "\f";
        else if (c === "r")
          parsed += "\r";
        else if (c === "e")
          parsed += "\x1B";
        else if (c === '"')
          parsed += '"';
        else if (c === "\\")
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: str, ptr: i });
        sliceStart = i + 1;
        state = 0;
      }
    } else if (c !== " " && c !== "\t") {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: str,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === "\\" ? 1 : 0;
      sliceStart = i;
    }
  }
  throw new TomlError("unfinished string", { toml: str, ptr });
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}
var INT_REGEX, FLOAT_REGEX, LEADING_ZERO;
var init_primitive = __esm(() => {
  init_date();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
  FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
  LEADING_ZERO = /^[+-]?0[0-9_]/;
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf(`
`, start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === `
`)
      return i;
    if (c === "\r" && str[i + 1] === `
`)
      return i + 1;
    if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while (true) {
    while ((c = str[ptr]) === " " || c === "\t" || !banNewLines && (c === `
` || c === "\r" && str[ptr + 1] === `
`))
      ptr++;
    if (banComments || c !== "#")
      break;
    ptr = skipComment(str, ptr);
  }
  return ptr;
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === `
` || c === "\r" && str[i + 1] === `
`)) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}
var init_util2 = __esm(() => {
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/extract.js
function sliceAndTrimEndOf(str, startPtr, endPtr) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] === ",")
        endPtr2++;
      else if (str[endPtr2] !== end) {
        throw new TomlError("expected comma or end of structure", {
          toml: str,
          ptr: endPtr2
        });
      }
    }
    return [value, endPtr2];
  }
  if (c === '"' || c === "'") {
    let [parsed, endPtr2] = parseString(str, ptr);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] && str[endPtr2] !== "," && str[endPtr2] !== end && str[endPtr2] !== `
` && str[endPtr2] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr2
        });
      }
      if (str[endPtr2] === ",")
        endPtr2++;
    }
    return [parsed, endPtr2];
  }
  let endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - (str[endPtr - 1] === "," ? 1 : 0));
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    if (str[endPtr] === ",")
      endPtr++;
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}
var init_extract = __esm(() => {
  init_primitive();
  init_struct();
  init_util2();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/struct.js
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "\t") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let [part, eos] = parseString(str, ptr);
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(part);
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = new Set;
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "\t" && c !== `
` && c !== "\r") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0;i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
    }
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "\t" && c !== `
` && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
var KEY_PART_RE;
var init_struct = __esm(() => {
  init_primitive();
  init_extract();
  init_util2();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0;i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1000, integersAsBigInt } = {}) {
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0);ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(k[0], res, meta, isTableArray ? 2 : 1);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(k[0], tbl, m, 0);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], undefined, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== `
` && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}
var init_parse = __esm(() => {
  init_struct();
  init_extract();
  init_util2();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/stringify.js
var init_stringify = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/index.js
var init_dist = __esm(() => {
  init_parse();
  init_stringify();
  init_date();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// src/redaction.ts
function redactText(input, mode = DEFAULT_REDACTION_MODE) {
  if (mode === "none")
    return input;
  let output = input.replace(PEM_PRIVATE_KEY_REGEX, "<PRIVATEKEY>").replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(URL_CREDENTIALS_REGEX, (_match, prefix) => `${prefix}:<SECRET>@`).replace(QUOTED_SECRET_REGEX, (match, ...args) => {
    const { keyQuote = "", key, separator, valueQuote } = args.at(-1);
    if (!isSensitiveKey(key))
      return match;
    return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}`;
  }).replace(BARE_ASSIGNMENT_SECRET_REGEX, (match, key, separator) => isSensitiveKey(key) ? `${key}${separator}${placeholderForKey(key)}` : match);
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  if (mode === "secrets")
    return output;
  return output.replace(EMAIL_REGEX, "<EMAIL>").replace(PHONE_REGEX, "<PHONENUMBER>").replace(SSN_REGEX, "<SSN>").replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) => isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate);
}
function countRedactionPlaceholders(text) {
  return text.match(PLACEHOLDER_REGEX)?.length ?? 0;
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
  if (COMPACT_SENSITIVE_KEYS.has(compact))
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
  if (!/[ -]/.test(value) && digits.length !== 15 && digits.length !== 16)
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
var DEFAULT_REDACTION_MODE = "secrets", REDACTION_MODES, KEY_NAME_PATTERN, QUOTED_SECRET_REGEX, BARE_ASSIGNMENT_SECRET_REGEX, AUTHORIZATION_HEADER_REGEX, PEM_PRIVATE_KEY_REGEX, URL_CREDENTIALS_REGEX, BARE_BEARER_TOKEN_REGEX, TOKEN_PATTERNS, EMAIL_REGEX, PHONE_REGEX, SSN_REGEX, CREDIT_CARD_CANDIDATE_REGEX, PLACEHOLDER_REGEX, COMPACT_SENSITIVE_KEYS;
var init_redaction = __esm(() => {
  REDACTION_MODES = ["none", "secrets", "secrets+pii"];
  KEY_NAME_PATTERN = String.raw`[A-Za-z0-9_][A-Za-z0-9_-]*`;
  QUOTED_SECRET_REGEX = new RegExp(String.raw`(?:(?<keyQuote>["'])|\b)(?<key>${KEY_NAME_PATTERN})\k<keyQuote>` + String.raw`(?<separator>\s*[:=]\s*)(?<valueQuote>["'])(?:\\[^\r\n]|(?!\k<valueQuote>)[^\\\r\n])+\k<valueQuote>`, "g");
  BARE_ASSIGNMENT_SECRET_REGEX = new RegExp(String.raw`\b(${KEY_NAME_PATTERN})(\s*[:=]\s*)([^\s"',;` + "`" + String.raw`]+)`, "g");
  AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)([^\s"',;`]+)/gi;
  PEM_PRIVATE_KEY_REGEX = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;
  URL_CREDENTIALS_REGEX = /(\/\/[^\s/:@"'`]+):([^\s/@"'`]+)@/g;
  BARE_BEARER_TOKEN_REGEX = /\b(Bearer\s+)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g;
  TOKEN_PATTERNS = [
    [/\bAKIA[0-9A-Z]{16}\b/g, "<API_KEY>"],
    [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<TOKEN>"],
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<TOKEN>"]
  ];
  EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g;
  SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
  PLACEHOLDER_REGEX = /<(?:API_KEY|TOKEN|SECRET|PRIVATEKEY|EMAIL|PHONENUMBER|SSN|CREDITCARD)>/g;
  COMPACT_SENSITIVE_KEYS = new Set([
    "apikey",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "authtoken",
    "githubtoken",
    "bearertoken",
    "clientsecret",
    "credential",
    "credentials",
    "secretkey",
    "privatekey",
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "token",
    "secret"
  ]);
});

// src/health.ts
function healthBranch(user, checkoutId) {
  return `${HEALTH_BRANCH_PREFIX}${user}/${checkoutId}`;
}
function inboxPrefixCollidesWithHealth(inboxPrefix) {
  const prefix = inboxPrefix.replace(/^\/+/, "");
  return prefix.startsWith(HEALTH_BRANCH_PREFIX) || HEALTH_BRANCH_PREFIX.startsWith(prefix);
}
function isHealthBranch(remoteBranch) {
  const branch = remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
  return branch.startsWith(HEALTH_BRANCH_PREFIX);
}
function parseHealthRecord(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return;
  const record = raw;
  const status = record.status === "failed" ? "failed" : record.status === "ok" ? "ok" : undefined;
  if (!status || typeof record.updatedAt !== "string")
    return;
  return {
    schema: typeof record.schema === "number" ? record.schema : 0,
    machine: typeof record.machine === "string" ? record.machine : "unknown",
    root: typeof record.root === "string" ? record.root : "",
    peer: typeof record.peer === "string" && record.peer ? record.peer : undefined,
    inbox: typeof record.inbox === "string" ? record.inbox : "",
    version: typeof record.version === "string" ? record.version : "",
    status,
    updatedAt: record.updatedAt,
    lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : undefined,
    lastFailureAt: typeof record.lastFailureAt === "string" ? record.lastFailureAt : undefined,
    consecutiveFailures: typeof record.consecutiveFailures === "number" && Number.isFinite(record.consecutiveFailures) ? record.consecutiveFailures : 0,
    stage: typeof record.stage === "string" ? record.stage : undefined,
    message: typeof record.message === "string" ? record.message : undefined
  };
}
function serializeHealthRecord(record) {
  return `${JSON.stringify(record, null, 2)}
`;
}
function nextHealthRecord(previous, identity, outcome, now) {
  const base = {
    schema: HEALTH_SCHEMA,
    ...identity,
    status: outcome.status,
    updatedAt: now,
    lastSuccessAt: previous?.lastSuccessAt,
    lastFailureAt: previous?.lastFailureAt,
    consecutiveFailures: 0
  };
  if (outcome.status === "ok")
    return { ...base, lastSuccessAt: now };
  return {
    ...base,
    lastFailureAt: now,
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    stage: outcome.stage,
    message: redactText(outcome.message).trim().slice(-MESSAGE_LIMIT)
  };
}
function shouldPublishHealth(previous, next, now = Date.now()) {
  if (!previous)
    return true;
  if (next.status === "failed" || previous.status !== next.status)
    return true;
  const last = Date.parse(previous.updatedAt);
  if (!Number.isFinite(last))
    return true;
  return now - last >= HEALTH_HEARTBEAT_MS || last > now;
}
function classifyHealthState(record, now = Date.now(), staleAfterMs = HEALTH_STALE_AFTER_MS) {
  if (record.status === "failed")
    return "failed";
  const updated = Date.parse(record.updatedAt);
  if (!Number.isFinite(updated))
    return "stale";
  return now - updated > staleAfterMs ? "stale" : "ok";
}
function summarizeHealthStates(states) {
  const counts = { ok: 0, failed: 0, stale: 0 };
  for (const state of states)
    counts[state] += 1;
  const parts = [];
  if (counts.ok)
    parts.push(`${counts.ok} ok`);
  if (counts.failed)
    parts.push(`${counts.failed} failed`);
  if (counts.stale)
    parts.push(`${counts.stale} stale`);
  return parts.join(", ") || "none";
}
var HEALTH_BRANCH_PREFIX = "sidecar-health/", HEALTH_FILE = "health.json", HEALTH_SCHEMA = 1, HEALTH_STALE_AFTER_MS, HEALTH_HEARTBEAT_MS, MESSAGE_LIMIT = 500;
var init_health = __esm(() => {
  init_redaction();
  HEALTH_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  HEALTH_HEARTBEAT_MS = 60 * 60 * 1000;
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/lib/constants.js
var require_constants = __commonJS((exports, module) => {
  var WIN_SLASH = "\\\\/";
  var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
  var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
  var DOT_LITERAL = "\\.";
  var PLUS_LITERAL = "\\+";
  var QMARK_LITERAL = "\\?";
  var SLASH_LITERAL = "\\/";
  var ONE_CHAR = "(?=.)";
  var QMARK = "[^/]";
  var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
  var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
  var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
  var NO_DOT = `(?!${DOT_LITERAL})`;
  var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
  var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
  var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
  var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
  var STAR = `${QMARK}*?`;
  var SEP = "/";
  var POSIX_CHARS = {
    DOT_LITERAL,
    PLUS_LITERAL,
    QMARK_LITERAL,
    SLASH_LITERAL,
    ONE_CHAR,
    QMARK,
    END_ANCHOR,
    DOTS_SLASH,
    NO_DOT,
    NO_DOTS,
    NO_DOT_SLASH,
    NO_DOTS_SLASH,
    QMARK_NO_DOT,
    STAR,
    START_ANCHOR,
    SEP
  };
  var WINDOWS_CHARS = {
    ...POSIX_CHARS,
    SLASH_LITERAL: `[${WIN_SLASH}]`,
    QMARK: WIN_NO_SLASH,
    STAR: `${WIN_NO_SLASH}*?`,
    DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
    NO_DOT: `(?!${DOT_LITERAL})`,
    NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
    NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
    START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
    END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
    SEP: "\\"
  };
  var POSIX_REGEX_SOURCE = {
    __proto__: null,
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    ascii: "\\x00-\\x7F",
    blank: " \\t",
    cntrl: "\\x00-\\x1F\\x7F",
    digit: "0-9",
    graph: "\\x21-\\x7E",
    lower: "a-z",
    print: "\\x20-\\x7E ",
    punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
    space: " \\t\\r\\n\\v\\f",
    upper: "A-Z",
    word: "A-Za-z0-9_",
    xdigit: "A-Fa-f0-9"
  };
  module.exports = {
    DEFAULT_MAX_EXTGLOB_RECURSION,
    MAX_LENGTH: 1024 * 64,
    POSIX_REGEX_SOURCE,
    REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
    REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
    REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
    REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
    REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
    REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
    REPLACEMENTS: {
      __proto__: null,
      "***": "*",
      "**/**": "**",
      "**/**/**": "**"
    },
    CHAR_0: 48,
    CHAR_9: 57,
    CHAR_UPPERCASE_A: 65,
    CHAR_LOWERCASE_A: 97,
    CHAR_UPPERCASE_Z: 90,
    CHAR_LOWERCASE_Z: 122,
    CHAR_LEFT_PARENTHESES: 40,
    CHAR_RIGHT_PARENTHESES: 41,
    CHAR_ASTERISK: 42,
    CHAR_AMPERSAND: 38,
    CHAR_AT: 64,
    CHAR_BACKWARD_SLASH: 92,
    CHAR_CARRIAGE_RETURN: 13,
    CHAR_CIRCUMFLEX_ACCENT: 94,
    CHAR_COLON: 58,
    CHAR_COMMA: 44,
    CHAR_DOT: 46,
    CHAR_DOUBLE_QUOTE: 34,
    CHAR_EQUAL: 61,
    CHAR_EXCLAMATION_MARK: 33,
    CHAR_FORM_FEED: 12,
    CHAR_FORWARD_SLASH: 47,
    CHAR_GRAVE_ACCENT: 96,
    CHAR_HASH: 35,
    CHAR_HYPHEN_MINUS: 45,
    CHAR_LEFT_ANGLE_BRACKET: 60,
    CHAR_LEFT_CURLY_BRACE: 123,
    CHAR_LEFT_SQUARE_BRACKET: 91,
    CHAR_LINE_FEED: 10,
    CHAR_NO_BREAK_SPACE: 160,
    CHAR_PERCENT: 37,
    CHAR_PLUS: 43,
    CHAR_QUESTION_MARK: 63,
    CHAR_RIGHT_ANGLE_BRACKET: 62,
    CHAR_RIGHT_CURLY_BRACE: 125,
    CHAR_RIGHT_SQUARE_BRACKET: 93,
    CHAR_SEMICOLON: 59,
    CHAR_SINGLE_QUOTE: 39,
    CHAR_SPACE: 32,
    CHAR_TAB: 9,
    CHAR_UNDERSCORE: 95,
    CHAR_VERTICAL_LINE: 124,
    CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
    extglobChars(chars) {
      return {
        "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
        "?": { type: "qmark", open: "(?:", close: ")?" },
        "+": { type: "plus", open: "(?:", close: ")+" },
        "*": { type: "star", open: "(?:", close: ")*" },
        "@": { type: "at", open: "(?:", close: ")" }
      };
    },
    globChars(win32) {
      return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
    }
  };
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/lib/utils.js
var require_utils = __commonJS((exports) => {
  var {
    REGEX_BACKSLASH,
    REGEX_REMOVE_BACKSLASH,
    REGEX_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_GLOBAL
  } = require_constants();
  exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
  exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
  exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
  exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
  exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
  exports.isWindows = () => {
    if (typeof navigator !== "undefined" && navigator.platform) {
      const platform = navigator.platform.toLowerCase();
      return platform === "win32" || platform === "windows";
    }
    if (typeof process !== "undefined" && process.platform) {
      return process.platform === "win32";
    }
    return false;
  };
  exports.removeBackslashes = (str) => {
    return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
      return match === "\\" ? "" : match;
    });
  };
  exports.escapeLast = (input, char, lastIdx) => {
    const idx = input.lastIndexOf(char, lastIdx);
    if (idx === -1)
      return input;
    if (input[idx - 1] === "\\")
      return exports.escapeLast(input, char, idx - 1);
    return `${input.slice(0, idx)}\\${input.slice(idx)}`;
  };
  exports.removePrefix = (input, state = {}) => {
    let output = input;
    if (output.startsWith("./")) {
      output = output.slice(2);
      state.prefix = "./";
    }
    return output;
  };
  exports.wrapOutput = (input, state = {}, options = {}) => {
    const prepend = options.contains ? "" : "^";
    const append = options.contains ? "" : "$";
    let output = `${prepend}(?:${input})${append}`;
    if (state.negated === true) {
      output = `(?:^(?!${output}).*$)`;
    }
    return output;
  };
  exports.basename = (path4, { windows } = {}) => {
    const segs = path4.split(windows ? /[\\/]/ : "/");
    const last = segs[segs.length - 1];
    if (last === "") {
      return segs[segs.length - 2];
    }
    return last;
  };
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS((exports, module) => {
  var utils = require_utils();
  var {
    CHAR_ASTERISK,
    CHAR_AT,
    CHAR_BACKWARD_SLASH,
    CHAR_COMMA,
    CHAR_DOT,
    CHAR_EXCLAMATION_MARK,
    CHAR_FORWARD_SLASH,
    CHAR_LEFT_CURLY_BRACE,
    CHAR_LEFT_PARENTHESES,
    CHAR_LEFT_SQUARE_BRACKET,
    CHAR_PLUS,
    CHAR_QUESTION_MARK,
    CHAR_RIGHT_CURLY_BRACE,
    CHAR_RIGHT_PARENTHESES,
    CHAR_RIGHT_SQUARE_BRACKET
  } = require_constants();
  var isPathSeparator = (code2) => {
    return code2 === CHAR_FORWARD_SLASH || code2 === CHAR_BACKWARD_SLASH;
  };
  var depth = (token) => {
    if (token.isPrefix !== true) {
      token.depth = token.isGlobstar ? Infinity : 1;
    }
  };
  var scan = (input, options) => {
    const opts = options || {};
    const length = input.length - 1;
    const scanToEnd = opts.parts === true || opts.scanToEnd === true;
    const slashes = [];
    const tokens = [];
    const parts = [];
    let str = input;
    let index = -1;
    let start = 0;
    let lastIndex = 0;
    let isBrace = false;
    let isBracket = false;
    let isGlob = false;
    let isExtglob = false;
    let isGlobstar = false;
    let braceEscaped = false;
    let backslashes = false;
    let negated = false;
    let negatedExtglob = false;
    let finished = false;
    let braces = 0;
    let prev;
    let code2;
    let token = { value: "", depth: 0, isGlob: false };
    const eos = () => index >= length;
    const peek = () => str.charCodeAt(index + 1);
    const advance = () => {
      prev = code2;
      return str.charCodeAt(++index);
    };
    while (index < length) {
      code2 = advance();
      let next;
      if (code2 === CHAR_BACKWARD_SLASH) {
        backslashes = token.backslashes = true;
        code2 = advance();
        if (code2 === CHAR_LEFT_CURLY_BRACE) {
          braceEscaped = true;
        }
        continue;
      }
      if (braceEscaped === true || code2 === CHAR_LEFT_CURLY_BRACE) {
        braces++;
        while (eos() !== true && (code2 = advance())) {
          if (code2 === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (code2 === CHAR_LEFT_CURLY_BRACE) {
            braces++;
            continue;
          }
          if (braceEscaped !== true && code2 === CHAR_DOT && (code2 = advance()) === CHAR_DOT) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (braceEscaped !== true && code2 === CHAR_COMMA) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (code2 === CHAR_RIGHT_CURLY_BRACE) {
            braces--;
            if (braces === 0) {
              braceEscaped = false;
              isBrace = token.isBrace = true;
              finished = true;
              break;
            }
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code2 === CHAR_FORWARD_SLASH) {
        slashes.push(index);
        tokens.push(token);
        token = { value: "", depth: 0, isGlob: false };
        if (finished === true)
          continue;
        if (prev === CHAR_DOT && index === start + 1) {
          start += 2;
          continue;
        }
        lastIndex = index + 1;
        continue;
      }
      if (opts.noext !== true) {
        const isExtglobChar = code2 === CHAR_PLUS || code2 === CHAR_AT || code2 === CHAR_ASTERISK || code2 === CHAR_QUESTION_MARK || code2 === CHAR_EXCLAMATION_MARK;
        if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          isExtglob = token.isExtglob = true;
          finished = true;
          if (code2 === CHAR_EXCLAMATION_MARK && index === start) {
            negatedExtglob = true;
          }
          if (scanToEnd === true) {
            while (eos() !== true && (code2 = advance())) {
              if (code2 === CHAR_BACKWARD_SLASH) {
                backslashes = token.backslashes = true;
                code2 = advance();
                continue;
              }
              if (code2 === CHAR_RIGHT_PARENTHESES) {
                isGlob = token.isGlob = true;
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
      }
      if (code2 === CHAR_ASTERISK) {
        if (prev === CHAR_ASTERISK)
          isGlobstar = token.isGlobstar = true;
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code2 === CHAR_QUESTION_MARK) {
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code2 === CHAR_LEFT_SQUARE_BRACKET) {
        while (eos() !== true && (next = advance())) {
          if (next === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (next === CHAR_RIGHT_SQUARE_BRACKET) {
            isBracket = token.isBracket = true;
            isGlob = token.isGlob = true;
            finished = true;
            break;
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (opts.nonegate !== true && code2 === CHAR_EXCLAMATION_MARK && index === start) {
        negated = token.negated = true;
        start++;
        continue;
      }
      if (opts.noparen !== true && code2 === CHAR_LEFT_PARENTHESES) {
        isGlob = token.isGlob = true;
        if (scanToEnd === true) {
          while (eos() !== true && (code2 = advance())) {
            if (code2 === CHAR_LEFT_PARENTHESES) {
              backslashes = token.backslashes = true;
              code2 = advance();
              continue;
            }
            if (code2 === CHAR_RIGHT_PARENTHESES) {
              finished = true;
              break;
            }
          }
          continue;
        }
        break;
      }
      if (isGlob === true) {
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
    }
    if (opts.noext === true) {
      isExtglob = false;
      isGlob = false;
    }
    let base = str;
    let prefix = "";
    let glob = "";
    if (start > 0) {
      prefix = str.slice(0, start);
      str = str.slice(start);
      lastIndex -= start;
    }
    if (base && isGlob === true && lastIndex > 0) {
      base = str.slice(0, lastIndex);
      glob = str.slice(lastIndex);
    } else if (isGlob === true) {
      base = "";
      glob = str;
    } else {
      base = str;
    }
    if (base && base !== "" && base !== "/" && base !== str) {
      if (isPathSeparator(base.charCodeAt(base.length - 1))) {
        base = base.slice(0, -1);
      }
    }
    if (opts.unescape === true) {
      if (glob)
        glob = utils.removeBackslashes(glob);
      if (base && backslashes === true) {
        base = utils.removeBackslashes(base);
      }
    }
    const state = {
      prefix,
      input,
      start,
      base,
      glob,
      isBrace,
      isBracket,
      isGlob,
      isExtglob,
      isGlobstar,
      negated,
      negatedExtglob
    };
    if (opts.tokens === true) {
      state.maxDepth = 0;
      if (!isPathSeparator(code2)) {
        tokens.push(token);
      }
      state.tokens = tokens;
    }
    if (opts.parts === true || opts.tokens === true) {
      let prevIndex;
      for (let idx = 0;idx < slashes.length; idx++) {
        const n = prevIndex ? prevIndex + 1 : start;
        const i = slashes[idx];
        const value = input.slice(n, i);
        if (opts.tokens) {
          if (idx === 0 && start !== 0) {
            tokens[idx].isPrefix = true;
            tokens[idx].value = prefix;
          } else {
            tokens[idx].value = value;
          }
          depth(tokens[idx]);
          state.maxDepth += tokens[idx].depth;
        }
        if (idx !== 0 || value !== "") {
          parts.push(value);
        }
        prevIndex = i;
      }
      if (prevIndex && prevIndex + 1 < input.length) {
        const value = input.slice(prevIndex + 1);
        parts.push(value);
        if (opts.tokens) {
          tokens[tokens.length - 1].value = value;
          depth(tokens[tokens.length - 1]);
          state.maxDepth += tokens[tokens.length - 1].depth;
        }
      }
      state.slashes = slashes;
      state.parts = parts;
    }
    return state;
  };
  module.exports = scan;
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/lib/parse.js
var require_parse = __commonJS((exports, module) => {
  var constants = require_constants();
  var utils = require_utils();
  var {
    MAX_LENGTH,
    POSIX_REGEX_SOURCE,
    REGEX_NON_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_BACKREF,
    REPLACEMENTS
  } = constants;
  var expandRange = (args, options) => {
    if (typeof options.expandRange === "function") {
      return options.expandRange(...args, options);
    }
    args.sort();
    const value = `[${args.join("-")}]`;
    try {
      new RegExp(value);
    } catch (ex) {
      return args.map((v) => utils.escapeRegex(v)).join("..");
    }
    return value;
  };
  var syntaxError = (type, char) => {
    return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
  };
  var splitTopLevel = (input) => {
    const parts = [];
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let value = "";
    let escaped = false;
    for (const ch of input) {
      if (escaped === true) {
        value += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        value += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        value += ch;
        continue;
      }
      if (quote === 0) {
        if (ch === "[") {
          bracket++;
        } else if (ch === "]" && bracket > 0) {
          bracket--;
        } else if (bracket === 0) {
          if (ch === "(") {
            paren++;
          } else if (ch === ")" && paren > 0) {
            paren--;
          } else if (ch === "|" && paren === 0) {
            parts.push(value);
            value = "";
            continue;
          }
        }
      }
      value += ch;
    }
    parts.push(value);
    return parts;
  };
  var isPlainBranch = (branch) => {
    let escaped = false;
    for (const ch of branch) {
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (/[?*+@!()[\]{}]/.test(ch)) {
        return false;
      }
    }
    return true;
  };
  var normalizeSimpleBranch = (branch) => {
    let value = branch.trim();
    let changed = true;
    while (changed === true) {
      changed = false;
      if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
        value = value.slice(2, -1);
        changed = true;
      }
    }
    if (!isPlainBranch(value)) {
      return;
    }
    return value.replace(/\\(.)/g, "$1");
  };
  var hasRepeatedCharPrefixOverlap = (branches) => {
    const values = branches.map(normalizeSimpleBranch).filter(Boolean);
    for (let i = 0;i < values.length; i++) {
      for (let j = i + 1;j < values.length; j++) {
        const a = values[i];
        const b = values[j];
        const char = a[0];
        if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
          continue;
        }
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return true;
        }
      }
    }
    return false;
  };
  var parseRepeatedExtglob = (pattern, requireEnd = true) => {
    if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
      return;
    }
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let escaped = false;
    for (let i = 1;i < pattern.length; i++) {
      const ch = pattern[i];
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        continue;
      }
      if (quote === 1) {
        continue;
      }
      if (ch === "[") {
        bracket++;
        continue;
      }
      if (ch === "]" && bracket > 0) {
        bracket--;
        continue;
      }
      if (bracket > 0) {
        continue;
      }
      if (ch === "(") {
        paren++;
        continue;
      }
      if (ch === ")") {
        paren--;
        if (paren === 0) {
          if (requireEnd === true && i !== pattern.length - 1) {
            return;
          }
          return {
            type: pattern[0],
            body: pattern.slice(2, i),
            end: i
          };
        }
      }
    }
  };
  var buildCharClassStar = (chars) => {
    const source = chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`;
    return `${source}*`;
  };
  var getStarExtglobSequenceChars = (pattern) => {
    let index = 0;
    const chars = [];
    while (index < pattern.length) {
      const match = parseRepeatedExtglob(pattern.slice(index), false);
      if (!match || match.type !== "*") {
        return;
      }
      const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
      if (branches.length !== 1) {
        return;
      }
      const branch = normalizeSimpleBranch(branches[0]);
      if (!branch || branch.length !== 1) {
        return;
      }
      chars.push(branch);
      index += match.end + 1;
    }
    if (chars.length < 1) {
      return;
    }
    return chars;
  };
  var repeatedExtglobRecursion = (pattern) => {
    let depth = 0;
    let value = pattern.trim();
    let match = parseRepeatedExtglob(value);
    while (match) {
      depth++;
      value = match.body.trim();
      match = parseRepeatedExtglob(value);
    }
    return depth;
  };
  var analyzeRepeatedExtglob = (body, options) => {
    if (options.maxExtglobRecursion === false) {
      return { risky: false };
    }
    const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
    const branches = splitTopLevel(body).map((branch) => branch.trim());
    if (branches.length > 1) {
      if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
        return { risky: true };
      }
    }
    const safeChars = [];
    let sawStarSequence = false;
    let combinable = true;
    for (const branch of branches) {
      const chars = getStarExtglobSequenceChars(branch);
      if (chars) {
        sawStarSequence = true;
        safeChars.push(...chars);
        continue;
      }
      const literal = normalizeSimpleBranch(branch);
      if (literal && literal.length === 1) {
        safeChars.push(literal);
        continue;
      }
      combinable = false;
      if (repeatedExtglobRecursion(branch) > max) {
        return { risky: true };
      }
    }
    if (sawStarSequence) {
      return combinable ? { risky: true, safeOutput: buildCharClassStar([...new Set(safeChars)]) } : { risky: true };
    }
    return { risky: false };
  };
  var parse2 = (input, options) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected a string");
    }
    input = REPLACEMENTS[input] || input;
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    let len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    const bos = { type: "bos", value: "", output: opts.prepend || "" };
    const tokens = [bos];
    const capture = opts.capture ? "" : "?:";
    const PLATFORM_CHARS = constants.globChars(opts.windows);
    const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
    const {
      DOT_LITERAL,
      PLUS_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR
    } = PLATFORM_CHARS;
    const globstar = (opts2) => {
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const nodot = opts.dot ? "" : NO_DOT;
    const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
    let star = opts.bash === true ? globstar(opts) : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    if (typeof opts.noext === "boolean") {
      opts.noextglob = opts.noext;
    }
    const state = {
      input,
      index: -1,
      start: 0,
      dot: opts.dot === true,
      consumed: "",
      output: "",
      prefix: "",
      backtrack: false,
      negated: false,
      brackets: 0,
      braces: 0,
      parens: 0,
      quotes: 0,
      globstar: false,
      tokens
    };
    input = utils.removePrefix(input, state);
    len = input.length;
    const extglobs = [];
    const braces = [];
    const stack = [];
    let prev = bos;
    let value;
    const eos = () => state.index === len - 1;
    const peek = state.peek = (n = 1) => input[state.index + n];
    const advance = state.advance = () => input[++state.index] || "";
    const remaining = () => input.slice(state.index + 1);
    const consume = (value2 = "", num = 0) => {
      state.consumed += value2;
      state.index += num;
    };
    const append = (token) => {
      state.output += token.output != null ? token.output : token.value;
      consume(token.value);
    };
    const negate = () => {
      let count = 1;
      while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
        advance();
        state.start++;
        count++;
      }
      if (count % 2 === 0) {
        return false;
      }
      state.negated = true;
      state.start++;
      return true;
    };
    const increment = (type) => {
      state[type]++;
      stack.push(type);
    };
    const decrement = (type) => {
      state[type]--;
      stack.pop();
    };
    const push = (tok) => {
      if (prev.type === "globstar") {
        const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
        const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
        if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "star";
          prev.value = "*";
          prev.output = star;
          state.output += prev.output;
        }
      }
      if (extglobs.length && tok.type !== "paren") {
        extglobs[extglobs.length - 1].inner += tok.value;
      }
      if (tok.value || tok.output)
        append(tok);
      if (prev && prev.type === "text" && tok.type === "text") {
        prev.output = (prev.output || prev.value) + tok.value;
        prev.value += tok.value;
        return;
      }
      tok.prev = prev;
      tokens.push(tok);
      prev = tok;
    };
    const extglobOpen = (type, value2) => {
      const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
      token.prev = prev;
      token.parens = state.parens;
      token.output = state.output;
      token.startIndex = state.index;
      token.tokensIndex = tokens.length;
      const output = (opts.capture ? "(" : "") + token.open;
      increment("parens");
      push({ type, value: value2, output: state.output ? "" : ONE_CHAR });
      push({ type: "paren", extglob: true, value: advance(), output });
      extglobs.push(token);
    };
    const extglobClose = (token) => {
      const literal = input.slice(token.startIndex, state.index + 1);
      const body = input.slice(token.startIndex + 2, state.index);
      const analysis = analyzeRepeatedExtglob(body, opts);
      if ((token.type === "plus" || token.type === "star") && analysis.risky) {
        const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : undefined;
        const open = tokens[token.tokensIndex];
        open.type = "text";
        open.value = literal;
        open.output = safeOutput || utils.escapeRegex(literal);
        for (let i = token.tokensIndex + 1;i < tokens.length; i++) {
          tokens[i].value = "";
          tokens[i].output = "";
          delete tokens[i].suffix;
        }
        state.output = token.output + open.output;
        state.backtrack = true;
        push({ type: "paren", extglob: true, value, output: "" });
        decrement("parens");
        return;
      }
      let output = token.close + (opts.capture ? ")" : "");
      let rest;
      if (token.type === "negate") {
        let extglobStar = star;
        if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
          extglobStar = globstar(opts);
        }
        if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
          output = token.close = `)$))${extglobStar}`;
        }
        if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
          const expression = parse2(rest, { ...options, fastpaths: false }).output;
          output = token.close = `)${expression})${extglobStar})`;
        }
        if (token.prev.type === "bos") {
          state.negatedExtglob = true;
        }
      }
      push({ type: "paren", extglob: true, value, output });
      decrement("parens");
    };
    if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
      let backslashes = false;
      let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
        if (first === "\\") {
          backslashes = true;
          return m;
        }
        if (first === "?") {
          if (esc) {
            return esc + first + (rest ? QMARK.repeat(rest.length) : "");
          }
          if (index === 0) {
            return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
          }
          return QMARK.repeat(chars.length);
        }
        if (first === ".") {
          return DOT_LITERAL.repeat(chars.length);
        }
        if (first === "*") {
          if (esc) {
            return esc + first + (rest ? star : "");
          }
          return star;
        }
        return esc ? m : `\\${m}`;
      });
      if (backslashes === true) {
        if (opts.unescape === true) {
          output = output.replace(/\\/g, "");
        } else {
          output = output.replace(/\\+/g, (m) => {
            return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
          });
        }
      }
      if (output === input && opts.contains === true) {
        state.output = input;
        return state;
      }
      state.output = utils.wrapOutput(output, state, options);
      return state;
    }
    while (!eos()) {
      value = advance();
      if (value === "\x00") {
        continue;
      }
      if (value === "\\") {
        const next = peek();
        if (next === "/" && opts.bash !== true) {
          continue;
        }
        if (next === "." || next === ";") {
          continue;
        }
        if (!next) {
          value += "\\";
          push({ type: "text", value });
          continue;
        }
        const match = /^\\+/.exec(remaining());
        let slashes = 0;
        if (match && match[0].length > 2) {
          slashes = match[0].length;
          state.index += slashes;
          if (slashes % 2 !== 0) {
            value += "\\";
          }
        }
        if (opts.unescape === true) {
          value = advance();
        } else {
          value += advance();
        }
        if (state.brackets === 0) {
          push({ type: "text", value });
          continue;
        }
      }
      if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
        if (opts.posix !== false && value === ":") {
          const inner = prev.value.slice(1);
          if (inner.includes("[")) {
            prev.posix = true;
            if (inner.includes(":")) {
              const idx = prev.value.lastIndexOf("[");
              const pre = prev.value.slice(0, idx);
              const rest2 = prev.value.slice(idx + 2);
              const posix = POSIX_REGEX_SOURCE[rest2];
              if (posix) {
                prev.value = pre + posix;
                state.backtrack = true;
                advance();
                if (!bos.output && tokens.indexOf(prev) === 1) {
                  bos.output = ONE_CHAR;
                }
                continue;
              }
            }
          }
        }
        if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
          value = `\\${value}`;
        }
        if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
          value = `\\${value}`;
        }
        if (opts.posix === true && value === "!" && prev.value === "[") {
          value = "^";
        }
        prev.value += value;
        append({ value });
        continue;
      }
      if (state.quotes === 1 && value !== '"') {
        value = utils.escapeRegex(value);
        prev.value += value;
        append({ value });
        continue;
      }
      if (value === '"') {
        state.quotes = state.quotes === 1 ? 0 : 1;
        if (opts.keepQuotes === true) {
          push({ type: "text", value });
        }
        continue;
      }
      if (value === "(") {
        increment("parens");
        push({ type: "paren", value });
        continue;
      }
      if (value === ")") {
        if (state.parens === 0 && opts.strictBrackets === true) {
          throw new SyntaxError(syntaxError("opening", "("));
        }
        const extglob = extglobs[extglobs.length - 1];
        if (extglob && state.parens === extglob.parens + 1) {
          extglobClose(extglobs.pop());
          continue;
        }
        push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
        decrement("parens");
        continue;
      }
      if (value === "[") {
        if (opts.nobracket === true || !remaining().includes("]")) {
          if (opts.nobracket !== true && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("closing", "]"));
          }
          value = `\\${value}`;
        } else {
          increment("brackets");
        }
        push({ type: "bracket", value });
        continue;
      }
      if (value === "]") {
        if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        if (state.brackets === 0) {
          if (opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "["));
          }
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        decrement("brackets");
        const prevValue = prev.value.slice(1);
        if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
          value = `/${value}`;
        }
        prev.value += value;
        append({ value });
        if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
          continue;
        }
        const escaped = utils.escapeRegex(prev.value);
        state.output = state.output.slice(0, -prev.value.length);
        if (opts.literalBrackets === true) {
          state.output += escaped;
          prev.value = escaped;
          continue;
        }
        prev.value = `(${capture}${escaped}|${prev.value})`;
        state.output += prev.value;
        continue;
      }
      if (value === "{" && opts.nobrace !== true) {
        increment("braces");
        const open = {
          type: "brace",
          value,
          output: "(",
          outputIndex: state.output.length,
          tokensIndex: state.tokens.length
        };
        braces.push(open);
        push(open);
        continue;
      }
      if (value === "}") {
        const brace = braces[braces.length - 1];
        if (opts.nobrace === true || !brace) {
          push({ type: "text", value, output: value });
          continue;
        }
        let output = ")";
        if (brace.dots === true) {
          const arr = tokens.slice();
          const range = [];
          for (let i = arr.length - 1;i >= 0; i--) {
            tokens.pop();
            if (arr[i].type === "brace") {
              break;
            }
            if (arr[i].type !== "dots") {
              range.unshift(arr[i].value);
            }
          }
          output = expandRange(range, opts);
          state.backtrack = true;
        }
        if (brace.comma !== true && brace.dots !== true) {
          const out = state.output.slice(0, brace.outputIndex);
          const toks = state.tokens.slice(brace.tokensIndex);
          brace.value = brace.output = "\\{";
          value = output = "\\}";
          state.output = out;
          for (const t of toks) {
            state.output += t.output || t.value;
          }
        }
        push({ type: "brace", value, output });
        decrement("braces");
        braces.pop();
        continue;
      }
      if (value === "|") {
        if (extglobs.length > 0) {
          extglobs[extglobs.length - 1].conditions++;
        }
        push({ type: "text", value });
        continue;
      }
      if (value === ",") {
        let output = value;
        const brace = braces[braces.length - 1];
        if (brace && stack[stack.length - 1] === "braces") {
          brace.comma = true;
          output = "|";
        }
        push({ type: "comma", value, output });
        continue;
      }
      if (value === "/") {
        if (prev.type === "dot" && state.index === state.start + 1) {
          state.start = state.index + 1;
          state.consumed = "";
          state.output = "";
          tokens.pop();
          prev = bos;
          continue;
        }
        push({ type: "slash", value, output: SLASH_LITERAL });
        continue;
      }
      if (value === ".") {
        if (state.braces > 0 && prev.type === "dot") {
          if (prev.value === ".")
            prev.output = DOT_LITERAL;
          const brace = braces[braces.length - 1];
          prev.type = "dots";
          prev.output += value;
          prev.value += value;
          brace.dots = true;
          continue;
        }
        if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
          push({ type: "text", value, output: DOT_LITERAL });
          continue;
        }
        push({ type: "dot", value, output: DOT_LITERAL });
        continue;
      }
      if (value === "?") {
        const isGroup = prev && prev.value === "(";
        if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("qmark", value);
          continue;
        }
        if (prev && prev.type === "paren") {
          const next = peek();
          let output = value;
          if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
            output = `\\${value}`;
          }
          push({ type: "text", value, output });
          continue;
        }
        if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
          push({ type: "qmark", value, output: QMARK_NO_DOT });
          continue;
        }
        push({ type: "qmark", value, output: QMARK });
        continue;
      }
      if (value === "!") {
        if (opts.noextglob !== true && peek() === "(") {
          if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
            extglobOpen("negate", value);
            continue;
          }
        }
        if (opts.nonegate !== true && state.index === 0) {
          negate();
          continue;
        }
      }
      if (value === "+") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("plus", value);
          continue;
        }
        if (prev && prev.value === "(" || opts.regex === false) {
          push({ type: "plus", value, output: PLUS_LITERAL });
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
          push({ type: "plus", value });
          continue;
        }
        push({ type: "plus", value: PLUS_LITERAL });
        continue;
      }
      if (value === "@") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          push({ type: "at", extglob: true, value, output: "" });
          continue;
        }
        push({ type: "text", value });
        continue;
      }
      if (value !== "*") {
        if (value === "$" || value === "^") {
          value = `\\${value}`;
        }
        const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
        if (match) {
          value += match[0];
          state.index += match[0].length;
        }
        push({ type: "text", value });
        continue;
      }
      if (prev && (prev.type === "globstar" || prev.star === true)) {
        prev.type = "star";
        prev.star = true;
        prev.value += value;
        prev.output = star;
        state.backtrack = true;
        state.globstar = true;
        consume(value);
        continue;
      }
      let rest = remaining();
      if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
        extglobOpen("star", value);
        continue;
      }
      if (prev.type === "star") {
        if (opts.noglobstar === true) {
          consume(value);
          continue;
        }
        const prior = prev.prev;
        const before = prior.prev;
        const isStart = prior.type === "slash" || prior.type === "bos";
        const afterStar = before && (before.type === "star" || before.type === "globstar");
        if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
          push({ type: "star", value, output: "" });
          continue;
        }
        const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
        const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
        if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
          push({ type: "star", value, output: "" });
          continue;
        }
        while (rest.slice(0, 3) === "/**") {
          const after = input[state.index + 4];
          if (after && after !== "/") {
            break;
          }
          rest = rest.slice(3);
          consume("/**", 3);
        }
        if (prior.type === "bos" && eos()) {
          prev.type = "globstar";
          prev.value += value;
          prev.output = globstar(opts);
          state.output = prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
          state.output = state.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
          prev.value += value;
          state.globstar = true;
          state.output += prior.output + prev.output;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
          const end = rest[1] !== undefined ? "|$" : "";
          state.output = state.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
          prev.value += value;
          state.output += prior.output + prev.output;
          state.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        if (prior.type === "bos" && rest[0] === "/") {
          prev.type = "globstar";
          prev.value += value;
          prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
          state.output = prev.output;
          state.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        state.output = state.output.slice(0, -prev.output.length);
        prev.type = "globstar";
        prev.output = globstar(opts);
        prev.value += value;
        state.output += prev.output;
        state.globstar = true;
        consume(value);
        continue;
      }
      const token = { type: "star", value, output: star };
      if (opts.bash === true) {
        token.output = ".*?";
        if (prev.type === "bos" || prev.type === "slash") {
          token.output = nodot + token.output;
        }
        push(token);
        continue;
      }
      if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
        token.output = value;
        push(token);
        continue;
      }
      if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
        if (prev.type === "dot") {
          state.output += NO_DOT_SLASH;
          prev.output += NO_DOT_SLASH;
        } else if (opts.dot === true) {
          state.output += NO_DOTS_SLASH;
          prev.output += NO_DOTS_SLASH;
        } else {
          state.output += nodot;
          prev.output += nodot;
        }
        if (peek() !== "*") {
          state.output += ONE_CHAR;
          prev.output += ONE_CHAR;
        }
      }
      push(token);
    }
    while (state.brackets > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", "]"));
      state.output = utils.escapeLast(state.output, "[");
      decrement("brackets");
    }
    while (state.parens > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", ")"));
      state.output = utils.escapeLast(state.output, "(");
      decrement("parens");
    }
    while (state.braces > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", "}"));
      state.output = utils.escapeLast(state.output, "{");
      decrement("braces");
    }
    if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
      push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
    }
    if (state.backtrack === true) {
      state.output = "";
      for (const token of state.tokens) {
        state.output += token.output != null ? token.output : token.value;
        if (token.suffix) {
          state.output += token.suffix;
        }
      }
    }
    return state;
  };
  parse2.fastpaths = (input, options) => {
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    const len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    input = REPLACEMENTS[input] || input;
    const {
      DOT_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOTS_SLASH,
      STAR,
      START_ANCHOR
    } = constants.globChars(opts.windows);
    const nodot = opts.dot ? NO_DOTS : NO_DOT;
    const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
    const capture = opts.capture ? "" : "?:";
    const state = { negated: false, prefix: "" };
    let star = opts.bash === true ? ".*?" : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    const globstar = (opts2) => {
      if (opts2.noglobstar === true)
        return star;
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const create = (str) => {
      switch (str) {
        case "*":
          return `${nodot}${ONE_CHAR}${star}`;
        case ".*":
          return `${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*.*":
          return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*/*":
          return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
        case "**":
          return nodot + globstar(opts);
        case "**/*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
        case "**/*.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "**/.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
        default: {
          const match = /^(.*?)\.(\w+)$/.exec(str);
          if (!match)
            return;
          const source2 = create(match[1]);
          if (!source2)
            return;
          return source2 + DOT_LITERAL + match[2];
        }
      }
    };
    const output = utils.removePrefix(input, state);
    let source = create(output);
    if (source && opts.strictSlashes !== true) {
      source += `${SLASH_LITERAL}?`;
    }
    return source;
  };
  module.exports = parse2;
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS((exports, module) => {
  var scan = require_scan();
  var parse2 = require_parse();
  var utils = require_utils();
  var constants = require_constants();
  var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
  var picomatch = (glob, options, returnState = false) => {
    if (Array.isArray(glob)) {
      const fns = glob.map((input) => picomatch(input, options, returnState));
      const arrayMatcher = (str) => {
        for (const isMatch of fns) {
          const state2 = isMatch(str);
          if (state2)
            return state2;
        }
        return false;
      };
      return arrayMatcher;
    }
    const isState = isObject(glob) && glob.tokens && glob.input;
    if (glob === "" || typeof glob !== "string" && !isState) {
      throw new TypeError("Expected pattern to be a non-empty string");
    }
    const opts = options || {};
    const posix = opts.windows;
    const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
    const state = regex.state;
    delete regex.state;
    let isIgnored = () => false;
    if (opts.ignore) {
      const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
      isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
    }
    const matcher = (input, returnObject = false) => {
      const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
      const result = { glob, state, regex, posix, input, output, match, isMatch };
      if (typeof opts.onResult === "function") {
        opts.onResult(result);
      }
      if (isMatch === false) {
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (isIgnored(input)) {
        if (typeof opts.onIgnore === "function") {
          opts.onIgnore(result);
        }
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (typeof opts.onMatch === "function") {
        opts.onMatch(result);
      }
      return returnObject ? result : true;
    };
    if (returnState) {
      matcher.state = state;
    }
    return matcher;
  };
  picomatch.test = (input, regex, options, { glob, posix } = {}) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected input to be a string");
    }
    if (input === "") {
      return { isMatch: false, output: "" };
    }
    const opts = options || {};
    const format = opts.format || (posix ? utils.toPosixSlashes : null);
    let match = input === glob;
    let output = match && format ? format(input) : input;
    if (match === false) {
      output = format ? format(input) : input;
      match = output === glob;
    }
    if (match === false || opts.capture === true) {
      if (opts.matchBase === true || opts.basename === true) {
        match = picomatch.matchBase(input, regex, options, posix);
      } else {
        match = regex.exec(output);
      }
    }
    return { isMatch: Boolean(match), match, output };
  };
  picomatch.matchBase = (input, glob, options, posix = options && options.windows) => {
    const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
    return regex.test(utils.basename(input, { windows: posix }));
  };
  picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
  picomatch.parse = (pattern, options) => {
    if (Array.isArray(pattern))
      return pattern.map((p) => picomatch.parse(p, options));
    return parse2(pattern, { ...options, fastpaths: false });
  };
  picomatch.scan = (input, options) => scan(input, options);
  picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
    if (returnOutput === true) {
      return state.output;
    }
    const opts = options || {};
    const prepend = opts.contains ? "" : "^";
    const append = opts.contains ? "" : "$";
    let source = `${prepend}(?:${state.output})${append}`;
    if (state && state.negated === true) {
      source = `^(?!${source}).*$`;
    }
    const regex = picomatch.toRegex(source, options);
    if (returnState === true) {
      regex.state = state;
    }
    return regex;
  };
  picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
    if (!input || typeof input !== "string") {
      throw new TypeError("Expected a non-empty string");
    }
    let parsed = { negated: false, fastpaths: true };
    if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
      parsed.output = parse2.fastpaths(input, options);
    }
    if (!parsed.output) {
      parsed = parse2(input, options);
    }
    return picomatch.compileRe(parsed, options, returnOutput, returnState);
  };
  picomatch.toRegex = (source, options) => {
    try {
      const opts = options || {};
      return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
    } catch (err) {
      if (options && options.debug === true)
        throw err;
      return /$^/;
    }
  };
  picomatch.constants = constants;
  module.exports = picomatch;
});

// ../../node_modules/.bun/picomatch@4.0.5/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS((exports, module) => {
  var pico = require_picomatch();
  var utils = require_utils();
  function picomatch(glob, options, returnState = false) {
    if (options && (options.windows === null || options.windows === undefined)) {
      options = { ...options, windows: utils.isWindows() };
    }
    return pico(glob, options, returnState);
  }
  Object.assign(picomatch, pico);
  module.exports = picomatch;
});

// src/rules.ts
import crypto from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
function peerRulesFileName(name) {
  return name === "default" ? ".sidecar-rules" : `.sidecar-rules.${name}`;
}
function peerRulesPath(root, name) {
  return path4.join(root, peerRulesFileName(name));
}
function readRules(filePath) {
  let text;
  try {
    text = fs4.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        if (!fs4.lstatSync(filePath, { throwIfNoEntry: false }))
          return Object.freeze([]);
      } catch {}
    }
    throw new SidecarError(`could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let values;
  try {
    values = parse(text);
  } catch (error) {
    throw new SidecarError(`${filePath} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  rejectUnknownKeys(values, ["rules"], filePath);
  if (values.rules === undefined)
    return Object.freeze([]);
  if (!Array.isArray(values.rules))
    throw new SidecarError(`${filePath}: rules must be an array of [[rules]] tables`);
  return Object.freeze(values.rules.map((value, index) => {
    const source = `${filePath}: rule ${index + 1}`;
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
      throw new SidecarError(`${source} must be a table`);
    }
    const record = value;
    rejectUnknownKeys(record, ["glob", "resolve", "redaction"], source);
    if (typeof record.glob !== "string" || record.glob.length === 0) {
      throw new SidecarError(`${source}: glob must be a nonempty string`);
    }
    if (!isRelativePath(record.glob) || record.glob.includes("\\") || record.glob.includes("\x00")) {
      throw new SidecarError(`${source}: glob must be checkout-relative, use / separators, and contain no .. segments`);
    }
    if (record.resolve !== undefined && record.resolve !== "fork" && record.resolve !== "lww") {
      throw new SidecarError(`${source}: resolve must be fork or lww`);
    }
    if (record.redaction !== undefined && !REDACTION_MODES.includes(record.redaction)) {
      throw new SidecarError(`${source}: redaction must be one of ${REDACTION_MODES.join(", ")}`);
    }
    if (record.resolve === undefined && record.redaction === undefined) {
      throw new SidecarError(`${source}: set at least one policy (resolve or redaction)`);
    }
    const rule = Object.freeze({
      glob: record.glob,
      ...record.resolve === undefined ? {} : { resolve: record.resolve },
      ...record.redaction === undefined ? {} : { redaction: record.redaction }
    });
    try {
      matchers.set(rule, import_picomatch.default(rule.glob, globOptions));
    } catch (error) {
      throw new SidecarError(`${source}: invalid glob ${JSON.stringify(rule.glob)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return rule;
  }));
}
function rejectUnknownKeys(record, allowed, source) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      throw new SidecarError(`${source}: unknown key ${JSON.stringify(key)}`);
  }
}
function isRelativePath(value) {
  return !path4.posix.isAbsolute(value) && !path4.win32.isAbsolute(value) && !/^[a-z]:/i.test(value) && !value.split("/").includes("..");
}
function resolveFileRules(rules, relativePath, defaults) {
  const result = { ...defaults };
  if (!isRelativePath(relativePath))
    throw new SidecarError(`rules require a checkout-relative path: ${relativePath}`);
  for (const rule of rules ?? []) {
    let matches = matchers.get(rule);
    if (!matches) {
      matches = import_picomatch.default(rule.glob, globOptions);
      matchers.set(rule, matches);
    }
    if (!matches(relativePath))
      continue;
    if (rule.resolve !== undefined)
      result.resolve = rule.resolve;
    if (rule.redaction !== undefined)
      result.redaction = rule.redaction;
  }
  return result;
}
function rulesFingerprint(rules) {
  const canonical = (rules ?? []).map(({ glob, resolve, redaction }) => ({ glob, resolve, redaction }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function rulesMayRedact(rules, defaultMode) {
  return defaultMode !== "none" || (rules ?? []).some((rule) => rule.redaction !== undefined && rule.redaction !== "none");
}
var import_picomatch, matchers, globOptions;
var init_rules = __esm(() => {
  init_dist();
  init_redaction();
  init_util();
  import_picomatch = __toESM(require_picomatch2(), 1);
  matchers = new WeakMap;
  globOptions = { dot: true, nonegate: true, noextglob: true, strictBrackets: true, windows: false };
});

// src/config.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path5 from "node:path";
function validatePeerName(name) {
  if (name === DEFAULT_PEER)
    return;
  if (!PEER_NAME.test(name)) {
    throw new SidecarError(`invalid peer name ${JSON.stringify(name)}; use lowercase letters, digits, and hyphens, starting with a letter or digit`);
  }
  if (RESERVED_PEER_SUFFIXES.has(name)) {
    throw new SidecarError(`peer name ${JSON.stringify(name)} is reserved: .sidecar.${name} reads as a copy of .sidecar, not a peer`);
  }
}
function peerFileName(name) {
  return name === DEFAULT_PEER ? ".sidecar" : `.sidecar.${name}`;
}
function peerConfigPath(root, name) {
  return path5.join(root, peerFileName(name));
}
function peerNameOf(fileName) {
  if (fileName === ".sidecar")
    return DEFAULT_PEER;
  if (!fileName.startsWith(".sidecar."))
    return;
  const name = fileName.slice(".sidecar.".length);
  if (name === DEFAULT_PEER || !PEER_NAME.test(name) || RESERVED_PEER_SUFFIXES.has(name))
    return;
  return name;
}
function listPeerNames(root) {
  let entries;
  try {
    entries = fs5.readdirSync(root);
  } catch {
    return [];
  }
  return entries.map(peerNameOf).filter((name) => name !== undefined).sort((left, right) => left === DEFAULT_PEER ? -1 : right === DEFAULT_PEER ? 1 : left.localeCompare(right));
}
function loadPeer(root, name, options = {}) {
  const configPath = peerConfigPath(root, name);
  return { root, name, configPath, config: readConfig(configPath, options) };
}
function selectedPeer(parsed) {
  return parsed.values.get("--peer") ?? process.env[PEER_ENV] ?? undefined;
}
function loadPeers(selection, options = {}) {
  const root = findConfigRoot(process.cwd());
  const names = listPeerNames(root);
  if (selection) {
    validatePeerName(selection);
    if (!names.includes(selection)) {
      throw new SidecarError(`no ${peerFileName(selection)} in ${root}; peers here: ${names.join(", ")}`);
    }
    return [loadPeer(root, selection, options)];
  }
  const peers = names.map((name) => loadPeer(root, name, options));
  ensureDistinctCheckouts(peers);
  return peers;
}
function ensureDistinctCheckouts(peers) {
  const checkoutOwners = new Map;
  const remoteOwners = new Map;
  for (const peer of peers) {
    const checkout = realpathOr(resolveSidecarPath(peer.root, peer.config));
    const checkoutOwner = checkoutOwners.get(checkout);
    if (checkoutOwner !== undefined) {
      throw new SidecarError(`peers ${checkoutOwner} and ${peer.name} both use the checkout ${checkout}; give each its own --path`);
    }
    checkoutOwners.set(checkout, peer.name);
    const remote = sameRemoteKey(peer.config.remote);
    const remoteOwner = remoteOwners.get(remote);
    if (remoteOwner !== undefined) {
      throw new SidecarError(`peers ${remoteOwner} and ${peer.name} both sync to ${peer.config.remote}; give each its own remote`);
    }
    remoteOwners.set(remote, peer.name);
  }
}
function sameRemoteKey(remote) {
  return remote.trim().replace(/\/+$/, "").replace(/\.git$/, "");
}
function findConfigRoot(start) {
  const root = findConfigRootOptional(start);
  if (root)
    return root;
  throw new SidecarError("could not find .sidecar");
}
function findConfigRootOptional(start) {
  let current = path5.resolve(start);
  while (true) {
    if (listPeerNames(current).length)
      return current;
    const parent = path5.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function writeConfig(configPath, config) {
  const text = [
    `version = ${config.version}`,
    `remote = ${JSON.stringify(config.remote)}`,
    `path = ${JSON.stringify(config.path)}`,
    `branch = ${JSON.stringify(config.branch)}`,
    `inbox = ${JSON.stringify(config.inbox)}`,
    `redaction = ${JSON.stringify(config.redaction ?? DEFAULT_REDACTION_MODE)}`,
    `resolve = ${JSON.stringify(config.resolve ?? DEFAULT_RESOLVE)}`,
    ...config.debounce === undefined ? [] : [`debounce = ${config.debounce}`],
    ...config.interval === undefined ? [] : [`interval = ${config.interval}`],
    ""
  ].join(`
`);
  fs5.writeFileSync(configPath, text, "utf8");
}
function readConfig(configPath, options = {}) {
  let values;
  try {
    const parsed = parse(fs5.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SidecarError(`${configPath} must contain a TOML table`);
    }
    values = parsed;
  } catch (error) {
    if (error instanceof SidecarError)
      throw error;
    throw new SidecarError(`${configPath} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const remote = optionalStringConfigValue(configPath, values, "remote");
  if (!remote)
    throw new SidecarError(`${configPath} is missing remote`);
  const peer = peerNameOf(path5.basename(configPath)) ?? DEFAULT_PEER;
  const rulesPath = peerRulesPath(path5.dirname(configPath), peer);
  const config = {
    peer,
    remote,
    version: numberConfigValue(configPath, values, "version", 1),
    path: stringConfigValue(configPath, values, "path", DEFAULT_PATH),
    branch: stringConfigValue(configPath, values, "branch", DEFAULT_BRANCH),
    inbox: stringConfigValue(configPath, values, "inbox", DEFAULT_INBOX),
    redaction: redactionModeConfigValue(stringConfigValue(configPath, values, "redaction", DEFAULT_REDACTION_MODE), configPath),
    resolve: resolveModeConfigValue(stringConfigValue(configPath, values, "resolve", DEFAULT_RESOLVE), configPath),
    debounce: durationConfigValue(values.debounce, `${configPath} debounce`),
    interval: durationConfigValue(values.interval, `${configPath} interval`),
    rules: options.loadRules === false ? undefined : readRules(rulesPath),
    rulesPath
  };
  validateRemote(config.remote);
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  if (peer !== DEFAULT_PEER && isStandalone(config)) {
    throw new SidecarError(`${configPath}: a peer cannot be standalone (path = "."); only .sidecar can`);
  }
  return config;
}
function redactionModeConfigValue(value, source) {
  if (REDACTION_MODES.includes(value))
    return value;
  throw new SidecarError(`${source}: invalid redaction mode ${JSON.stringify(value)}; expected one of ${REDACTION_MODES.join(", ")}`);
}
function durationConfigValue(value, source) {
  if (value === undefined)
    return;
  const seconds = parseDuration(value);
  if (seconds === undefined) {
    throw new SidecarError(`${source}: invalid duration ${JSON.stringify(value)}; use seconds, or a number with an s, m, or h suffix like "10m"`);
  }
  return seconds;
}
function resolveModeConfigValue(value, source) {
  if (RESOLVE_MODES.includes(value))
    return value;
  throw new SidecarError(`${source}: invalid resolve mode ${JSON.stringify(value)}; expected one of ${RESOLVE_MODES.join(", ")}`);
}
function stringConfigValue(configPath, values, key, fallback) {
  const value = values[key] ?? fallback;
  if (typeof value !== "string")
    throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}
function optionalStringConfigValue(configPath, values, key) {
  const value = values[key];
  if (value === undefined)
    return;
  if (typeof value !== "string")
    throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}
function numberConfigValue(configPath, values, key, fallback) {
  const value = values[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SidecarError(`${configPath} ${key} must be an integer`);
  }
  return value;
}
function validateBranch(branch) {
  let valid = branchValidity.get(branch);
  if (valid === undefined) {
    valid = gitRaw(["check-ref-format", "--branch", branch], { check: false }).status === 0;
    branchValidity.set(branch, valid);
  }
  if (!valid)
    throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
}
function validateRemote(remote) {
  const allowedScheme = /^(https?|ssh|git|file):\/\//i;
  const scpLike = /^[A-Za-z0-9._~-]+@[A-Za-z0-9._-]+:/;
  const ok = remote.length > 0 && !remote.startsWith("-") && (allowedScheme.test(remote) || scpLike.test(remote) || path5.isAbsolute(remote));
  if (!ok) {
    throw new SidecarError(`unsupported sidecar remote ${JSON.stringify(remote)}; use an https://, ssh://, git://, or file:// URL, user@host:path, or an absolute path`);
  }
}
function validateInboxTemplate(template) {
  const prefix = inboxBranchPrefix(template);
  if (template.includes("{") && !prefix.endsWith("/")) {
    throw new SidecarError("inbox template must place variables under a static branch namespace, like sidecar-inbox/{user}/{random}");
  }
  if (inboxPrefixCollidesWithHealth(prefix)) {
    throw new SidecarError(`inbox template must not use the ${HEALTH_BRANCH_PREFIX} namespace, which sidecar reserves for health branches`);
  }
}
function resolveSidecarPath(root, config) {
  return path5.resolve(root, config.path);
}
function isStandalone(config) {
  return isStandalonePath(config.path);
}
function isStandalonePath(sidecarPath) {
  return path5.normalize(sidecarPath).replace(/[/\\]+$/, "") === ".";
}
function pathIsRepoRoot(root, candidate) {
  const resolved = path5.resolve(root, candidate);
  if (resolved === path5.resolve(root))
    return true;
  try {
    return fs5.realpathSync(resolved) === fs5.realpathSync(root);
  } catch {
    return false;
  }
}
function requireSidecarCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    throw new SidecarError(`missing sidecar checkout at ${sidecarPath}; run \`sidecar clone\``);
  }
  return sidecarPath;
}
function expandInbox(config, repo) {
  validateInboxTemplate(config.inbox);
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
  const idPath = path5.join(gitDirectory, "sidecar-id");
  if (fs5.existsSync(idPath)) {
    const existing = slug(fs5.readFileSync(idPath, "utf8"));
    if (existing)
      return existing;
  }
  const id = crypto2.randomBytes(6).toString("hex");
  fs5.writeFileSync(idPath, `${id}
`, { encoding: "utf8", mode: 384 });
  return id;
}
function inboxPrefix(config) {
  return inboxBranchPrefix(config.inbox);
}
function remoteBranchName(remoteBranch) {
  return remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
}
function matchesInboxPrefix(prefix, branch) {
  return prefix.endsWith("/") ? branch.startsWith(prefix) : branch === prefix;
}
function inboxBranchPrefix(template) {
  const variableIndex = template.indexOf("{");
  if (variableIndex === -1)
    return template.replace(/^\/+|\/+$/g, "");
  const staticPrefix = template.slice(0, variableIndex).replace(/^\/+/, "");
  const slashIndex = staticPrefix.lastIndexOf("/");
  return slashIndex === -1 ? staticPrefix : staticPrefix.slice(0, slashIndex + 1);
}
var DEFAULT_PATH = "sidecar", DEFAULT_BRANCH = "main", DEFAULT_INBOX = "sidecar-inbox/{user}/{random}", branchValidity, DEFAULT_PEER = "default", PEER_ENV = "SIDECAR_PEER", PEER_NAME, RESERVED_PEER_SUFFIXES, RESOLVE_MODES, DEFAULT_RESOLVE = "fork";
var init_config = __esm(() => {
  init_dist();
  init_util();
  init_git();
  init_health();
  init_redaction();
  init_rules();
  branchValidity = new Map;
  PEER_NAME = /^[a-z0-9][a-z0-9-]*$/;
  RESERVED_PEER_SUFFIXES = new Set(["swp", "swo", "swx", "bak", "orig", "rej", "tmp", "old", "example", "sample", "lock"]);
  RESOLVE_MODES = ["fork", "lww"];
});

// src/state.ts
import crypto3 from "node:crypto";
import fs6 from "node:fs";
import os3 from "node:os";
import path6 from "node:path";
function sidecarStateDir() {
  if (process.env[STATE_DIR_ENV])
    return path6.resolve(process.env[STATE_DIR_ENV]);
  if (process.platform === "darwin")
    return path6.join(os3.homedir(), "Library", "Application Support", "sidecar");
  if (process.platform === "win32") {
    return path6.join(process.env.APPDATA || path6.join(os3.homedir(), "AppData", "Roaming"), "sidecar");
  }
  return path6.join(process.env.XDG_STATE_HOME || path6.join(os3.homedir(), ".local", "state"), "sidecar");
}
function instancesPath() {
  return path6.join(sidecarStateDir(), "instances.json");
}
function sidecarLogPath() {
  return path6.join(sidecarStateDir(), "sidecar.log");
}
function settingsPath() {
  return path6.join(sidecarStateDir(), "settings.json");
}
function ensureStateDir() {
  fs6.mkdirSync(sidecarStateDir(), { recursive: true });
}
function readSettings() {
  const filePath = settingsPath();
  if (!fs6.existsSync(filePath))
    return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs6.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object")
      return { ...DEFAULT_SETTINGS };
    const record = raw;
    return {
      daemonEnabled: typeof record.daemonEnabled === "boolean" ? record.daemonEnabled : true,
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
      lastUpdateCheckAt: typeof record.lastUpdateCheckAt === "string" ? record.lastUpdateCheckAt : undefined,
      installSource: INSTALL_SOURCES.has(record.installSource) ? record.installSource : undefined
    };
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    });
    return { ...DEFAULT_SETTINGS };
  }
}
function writeSettings(settings) {
  ensureStateDir();
  const record = {
    daemonEnabled: settings.daemonEnabled,
    autoUpdate: settings.autoUpdate
  };
  if (settings.lastUpdateCheckAt)
    record.lastUpdateCheckAt = settings.lastUpdateCheckAt;
  if (settings.installSource)
    record.installSource = settings.installSource;
  fs6.writeFileSync(settingsPath(), `${JSON.stringify(record, null, 2)}
`, "utf8");
}
function isSidecarInstance(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return typeof record.root === "string" && typeof record.configPath === "string" && typeof record.sidecarPath === "string" && typeof record.remote === "string" && typeof record.branch === "string" && typeof record.inbox === "string" && typeof record.registeredAt === "string" && typeof record.updatedAt === "string";
}
function readInstances() {
  const filePath = instancesPath();
  if (!fs6.existsSync(filePath))
    return [];
  try {
    const raw = JSON.parse(fs6.readFileSync(filePath, "utf8"));
    if (!Array.isArray(raw))
      return [];
    return raw.filter(isSidecarInstance);
  } catch (error) {
    logSidecarEvent("failure", {
      command: "instances",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    });
    return [];
  }
}
function updateInstances(update) {
  const release = acquireRegistryLock();
  try {
    const instances = readInstances();
    const next = update(instances);
    if (next === instances)
      return;
    const temporary = `${instancesPath()}.${crypto3.randomUUID()}.tmp`;
    try {
      fs6.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}
`, "utf8");
      fs6.renameSync(temporary, instancesPath());
    } finally {
      fs6.rmSync(temporary, { force: true });
    }
  } finally {
    release();
  }
}
function acquireRegistryLock() {
  ensureStateDir();
  const lockDir = path6.join(sidecarStateDir(), "instances.lock");
  const prepared = fs6.mkdtempSync(path6.join(sidecarStateDir(), ".instances-lock-"));
  const owner = `${process.pid}-${crypto3.randomUUID()}`;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 1e4;
  let acquired = false;
  try {
    fs6.writeFileSync(path6.join(prepared, owner), "", "utf8");
    while (true) {
      try {
        fs6.renameSync(prepared, lockDir);
        acquired = true;
        return () => removeRegistryLockOwner(lockDir, owner);
      } catch (error) {
        const code2 = error.code;
        if (code2 !== "EEXIST" && code2 !== "ENOTEMPTY" && code2 !== "EPERM" && code2 !== "EACCES")
          throw error;
      }
      reapRegistryLock(lockDir);
      if (Date.now() >= deadline) {
        throw new SidecarError(`timed out waiting for the instance registry lock: ${lockDir}`);
      }
      Atomics.wait(sleeper, 0, 0, 10);
    }
  } finally {
    if (!acquired)
      fs6.rmSync(prepared, { recursive: true, force: true });
  }
}
function removeRegistryLockOwner(lockDir, owner) {
  try {
    fs6.unlinkSync(path6.join(lockDir, owner));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
  }
  removeEmptyRegistryLock(lockDir);
}
function removeEmptyRegistryLock(lockDir) {
  try {
    fs6.rmdirSync(lockDir);
  } catch (error) {
    const code2 = error.code;
    if (code2 !== "ENOENT" && code2 !== "ENOTEMPTY" && code2 !== "EEXIST")
      throw error;
  }
}
function reapRegistryLock(lockDir) {
  let owners;
  try {
    owners = fs6.readdirSync(lockDir);
  } catch (error) {
    if (error.code === "ENOENT")
      return;
    throw error;
  }
  if (owners.length === 0)
    removeEmptyRegistryLock(lockDir);
  for (const owner of owners) {
    const pid = Number(owner.split("-", 1)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0)
      continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH")
        removeRegistryLockOwner(lockDir, owner);
    }
  }
}
function instancePeer(instance) {
  return peerNameOf(path6.basename(instance.configPath)) ?? DEFAULT_PEER;
}
function sameConfigPath(left, right) {
  return path6.basename(left) === path6.basename(right) && realpathOr(path6.dirname(left)) === realpathOr(path6.dirname(right));
}
function unregisterInstance(configPath) {
  updateInstances((instances) => {
    const remaining = instances.filter((instance) => !sameConfigPath(instance.configPath, configPath));
    return remaining.length === instances.length ? instances : remaining;
  });
}
function registerCurrentInstance(root, config, options) {
  if (!shouldUseGlobalRegistry())
    return;
  const sidecarPath = resolveSidecarPath(root, config);
  const configPath = peerConfigPath(root, config.peer);
  const inbox = hasGitMetadata(sidecarPath) ? expandInbox(config, sidecarPath) : expandInbox(config);
  updateInstances((existing) => {
    const previous = existing.find((instance2) => sameConfigPath(instance2.configPath, configPath));
    const timestamp = nowIso();
    const instance = {
      root,
      configPath,
      sidecarPath,
      remote: config.remote,
      branch: config.branch,
      inbox,
      registeredAt: previous?.registeredAt ?? timestamp,
      updatedAt: timestamp,
      lastSyncAt: options.lastSyncAt ?? previous?.lastSyncAt
    };
    return [instance, ...existing.filter((entry) => !sameConfigPath(entry.configPath, configPath))].sort((left, right) => left.root.localeCompare(right.root) || left.configPath.localeCompare(right.configPath));
  });
  logSidecarEvent(options.event, {
    root,
    ...config.peer === DEFAULT_PEER ? {} : { peer: config.peer },
    sidecarPath,
    remote: config.remote,
    inbox
  });
}
function listInstanceStatuses() {
  return readInstances().map((instance) => instanceStatus(instance));
}
function instanceStatus(instance) {
  let config = "ok";
  if (!fs6.existsSync(instance.configPath)) {
    config = "missing";
  } else {
    try {
      readConfig(instance.configPath);
    } catch {
      config = "invalid";
    }
  }
  const checkout = hasGitMetadata(instance.sidecarPath) ? "present" : "missing";
  let dirty = "unknown";
  let currentBranch = "";
  if (checkout === "present") {
    const branch = git(instance.sidecarPath, ["branch", "--show-current"], { check: false });
    if (branch.status === 0)
      currentBranch = branch.stdout.trim();
    const status = git(instance.sidecarPath, ["status", "--porcelain"], { check: false });
    if (status.status === 0)
      dirty = status.stdout.trim() ? "yes" : "no";
  }
  return {
    ...instance,
    config,
    checkout,
    dirty,
    currentBranch
  };
}
function redactLogValue(value) {
  if (typeof value === "string")
    return redactText(value);
  if (Array.isArray(value))
    return value.map(redactLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactLogValue(entry)]));
  }
  return value;
}
function logSidecarEvent(event, fields = {}) {
  try {
    ensureStateDir();
    const logPath = sidecarLogPath();
    try {
      if (fs6.statSync(logPath).size > LOG_ROTATE_BYTES) {
        fs6.renameSync(logPath, `${logPath}.1`);
      }
    } catch {}
    const record = {
      timestamp: nowIso(),
      event,
      ...redactLogValue(fields)
    };
    fs6.appendFileSync(logPath, `${JSON.stringify(record)}
`, "utf8");
  } catch {}
}
function syncLockDir(root, peer) {
  const family = familyPrimaryRoot(root) ?? root;
  const key = crypto3.createHash("sha256").update(`${realpathOr(family)}\x00${peer}`).digest("hex").slice(0, 16);
  const label = peer === DEFAULT_PEER ? slug(path6.basename(family)) : `${slug(path6.basename(family))}-${peer}`;
  return path6.join(sidecarStateDir(), "locks", `${label}-${key}`);
}
function acquireSyncLock(root, peer) {
  const lockDir = syncLockDir(root, peer);
  fs6.mkdirSync(path6.dirname(lockDir), { recursive: true });
  for (let attempt = 0;attempt < 2; attempt++) {
    try {
      fs6.mkdirSync(lockDir);
      fs6.writeFileSync(path6.join(lockDir, "pid"), String(process.pid), "utf8");
      return () => fs6.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (!syncLockIsStale(lockDir))
        return;
      fs6.rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return;
}
function acquireSyncLockOrThrow(root, peer) {
  const release = acquireSyncLock(root, peer);
  if (release)
    return release;
  throw new SidecarError("another sidecar sync is already running; try again once it finishes");
}
function withSyncLock(root, peer, onBusy, fn) {
  const releaseLock = onBusy === "skip" ? acquireSyncLock(root, peer) : acquireSyncLockOrThrow(root, peer);
  if (!releaseLock) {
    console.log("another sidecar sync is already running; skipping this soft sync");
    return false;
  }
  try {
    fn();
    return true;
  } finally {
    releaseLock();
  }
}
function syncLockIsStale(lockDir) {
  let pid;
  try {
    pid = Number(fs6.readFileSync(path6.join(lockDir, "pid"), "utf8").trim());
  } catch {
    try {
      return Date.now() - fs6.statSync(lockDir).mtimeMs > 10 * 60 * 1000;
    } catch {
      return true;
    }
  }
  if (!Number.isInteger(pid) || pid <= 0)
    return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code !== "EPERM";
  }
}
var STATE_DIR_ENV = "SIDECAR_STATE_DIR", DEFAULT_SETTINGS, LOG_ROTATE_BYTES;
var init_state = __esm(() => {
  init_util();
  init_git();
  init_install();
  init_config();
  init_redaction();
  DEFAULT_SETTINGS = { daemonEnabled: true, autoUpdate: true };
  LOG_ROTATE_BYTES = 5 * 1024 * 1024;
});

// src/service.ts
import fs7 from "node:fs";
import os4 from "node:os";
import path7 from "node:path";
import { spawn, spawnSync as spawnSync3 } from "node:child_process";
function daemonLaunchAgentPath() {
  if (process.platform !== "darwin")
    return;
  return path7.join(os4.homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}
function daemonServicePath() {
  if (process.platform === "darwin")
    return daemonLaunchAgentPath();
  if (process.platform === "linux") {
    const configDir = process.env.XDG_CONFIG_HOME || path7.join(os4.homedir(), ".config");
    return path7.join(configDir, "systemd", "user", `${DAEMON_LABEL}.service`);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path7.join(os4.homedir(), "AppData", "Roaming");
    return path7.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "sidecar-daemon.vbs");
  }
  return;
}
function daemonPidPath() {
  return path7.join(sidecarStateDir(), "daemon.pid");
}
function readDaemonPid() {
  try {
    const pid = Number(fs7.readFileSync(daemonPidPath(), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return;
  }
}
function pidIsSidecarDaemon(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM")
      return false;
  }
  if (process.platform === "win32")
    return true;
  const result = spawnSync3("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0)
    return false;
  const command = (result.stdout ?? "").trim();
  return command.includes("daemon") && /sidecar|cli\.js/.test(command);
}
function isDaemonRunning() {
  const pid = readDaemonPid();
  return pid !== undefined && pidIsSidecarDaemon(pid);
}
function daemonServiceFileContents(invocation) {
  if (process.platform === "darwin")
    return daemonPlist(invocation);
  if (process.platform === "linux")
    return daemonSystemdUnit(invocation);
  return daemonWindowsStartupScript(invocation);
}
function daemonServiceStatus() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  const message = process.platform === "linux" && !findExecutableOnPath("systemctl") ? "systemd unavailable; run `sidecar daemon run` manually" : undefined;
  return {
    available: true,
    installed: fs7.existsSync(servicePath),
    running: isDaemonRunning(),
    path: servicePath,
    message
  };
}
function installDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: servicePath, message: "root install skipped" };
  }
  fs7.mkdirSync(sidecarStateDir(), { recursive: true });
  fs7.mkdirSync(path7.dirname(servicePath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs7.writeFileSync(servicePath, daemonServiceFileContents(invocation), "utf8");
  if (process.platform === "darwin") {
    const domain = launchctlDomain();
    spawnSync3("launchctl", ["bootout", domain, servicePath], { stdio: "ignore" });
    const bootstrap = spawnSync3("launchctl", ["bootstrap", domain, servicePath], { encoding: "utf8" });
    if (bootstrap.status !== 0) {
      return {
        available: true,
        installed: true,
        running: false,
        path: servicePath,
        message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed"
      };
    }
    spawnSync3("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    spawnSync3("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    return daemonServiceStatus();
  }
  if (process.platform === "linux") {
    if (!findExecutableOnPath("systemctl")) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: "systemd unavailable; run `sidecar daemon run` manually"
      };
    }
    spawnSync3("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const enable = spawnSync3("systemctl", ["--user", "enable", "--now", `${DAEMON_LABEL}.service`], {
      encoding: "utf8"
    });
    spawnSync3("systemctl", ["--user", "restart", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
    if (enable.status !== 0) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: enable.stderr.trim() || enable.stdout.trim() || "systemctl enable failed"
      };
    }
    return daemonServiceStatus();
  }
  stopDaemonProcess();
  startDetachedDaemon(invocation);
  return daemonServiceStatus();
}
function stopDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (process.platform === "darwin") {
    spawnSync3("launchctl", ["bootout", launchctlDomain(), servicePath], { stdio: "ignore" });
  } else if (process.platform === "linux" && findExecutableOnPath("systemctl")) {
    spawnSync3("systemctl", ["--user", "disable", "--now", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
  } else if (process.platform === "win32" && fs7.existsSync(servicePath)) {
    fs7.rmSync(servicePath, { force: true });
  }
  stopDaemonProcess();
  return { available: true, installed: fs7.existsSync(servicePath), running: false, path: servicePath };
}
function stopDaemonProcess() {
  const pid = readDaemonPid();
  if (!pid || pid === process.pid)
    return;
  if (!pidIsSidecarDaemon(pid)) {
    fs7.rmSync(daemonPidPath(), { force: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}
function startDetachedDaemon(invocation = currentExecutableInvocation()) {
  const child = spawn(invocation[0], invocation.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1" }
  });
  child.unref();
}
function ensureDaemonServiceFile() {
  if (process.env[SKIP_SERVICE_ENV] === "1")
    return;
  const servicePath = daemonServicePath();
  if (!servicePath || fs7.existsSync(servicePath))
    return;
  try {
    fs7.mkdirSync(path7.dirname(servicePath), { recursive: true });
    fs7.writeFileSync(servicePath, daemonServiceFileContents(currentExecutableInvocation()), "utf8");
    logSidecarEvent("daemon-service-heal", { path: servicePath });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not restore service file: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}
function daemonServiceLabel(service) {
  if (!service.available)
    return "unavailable";
  if (!service.installed)
    return "uninstalled";
  return service.running ? "running" : "stopped";
}
function launchctlDomain() {
  const uid = typeof process.getuid === "function" ? process.getuid() : os4.userInfo().uid;
  return `gui/${uid}`;
}
function currentExecutableInvocation() {
  return [process.execPath, currentExecutablePath(), "daemon", "run"];
}
function currentExecutableStamp(programArguments) {
  const executable = programArguments[1];
  if (!executable)
    return "unknown";
  try {
    const stat = fs7.statSync(executable);
    return `${executable}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return executable;
  }
}
function daemonPlist(programArguments) {
  return plist({
    Label: DAEMON_LABEL,
    ProgramArguments: programArguments,
    RunAtLoad: true,
    KeepAlive: true,
    StandardOutPath: path7.join(sidecarStateDir(), "daemon.out.log"),
    StandardErrorPath: path7.join(sidecarStateDir(), "daemon.err.log"),
    EnvironmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      SIDECAR_DAEMON_EXECUTABLE: currentExecutableStamp(programArguments)
    }
  });
}
function daemonSystemdUnit(programArguments) {
  const execStart = programArguments.map((part) => `"${part.replaceAll('"', "\\\"")}"`).join(" ");
  return [
    "[Unit]",
    "Description=sidecar background sync daemon",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=always",
    "RestartSec=10",
    `Environment="PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}"`,
    `Environment="SIDECAR_DAEMON_EXECUTABLE=${currentExecutableStamp(programArguments)}"`,
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join(`
`);
}
function daemonWindowsStartupScript(programArguments) {
  const command = programArguments.map((part) => `""${part}""`).join(" ");
  return `CreateObject("WScript.Shell").Run "${command}", 0, False\r
`;
}
function plist(value) {
  const body = Object.entries(value).map(([key, item]) => `  <key>${escapeXml(key)}</key>
${plistValue(item, 2)}`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}
function plistValue(value, indent) {
  const pad = " ".repeat(indent);
  if (typeof value === "string")
    return `${pad}<string>${escapeXml(value)}</string>
`;
  if (typeof value === "boolean")
    return `${pad}<${value ? "true" : "false"}/>
`;
  if (Array.isArray(value)) {
    return `${pad}<array>
${value.map((item) => plistValue(item, indent + 2)).join("")}${pad}</array>
`;
  }
  if (value && typeof value === "object") {
    return `${pad}<dict>
${Object.entries(value).map(([key, item]) => `${" ".repeat(indent + 2)}<key>${escapeXml(key)}</key>
${plistValue(item, indent + 2)}`).join("")}${pad}</dict>
`;
  }
  return `${pad}<string></string>
`;
}
function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
var SKIP_SERVICE_ENV = "SIDECAR_SKIP_SERVICE", DAEMON_LABEL = "com.anteprojector.sidecar";
var init_service = __esm(() => {
  init_util();
  init_install();
  init_state();
});

// src/sync.ts
import crypto4 from "node:crypto";
import fs8 from "node:fs";
import os5 from "node:os";
import path8 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function syncProject(root, config, options) {
  const stage = (name) => options.onStage?.(name);
  stage("checkout");
  const sidecarPath = options.remote ? ensureSidecarCheckout(root, config) : requireSidecarCheckout(root, config);
  if (!options.remote && !hasAnyCommit(sidecarPath)) {
    throw new SidecarError(`local sync requires an initialized sidecar checkout at ${sidecarPath}; run \`sidecar sync\` first`);
  }
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureRedactionFilter(sidecarPath, config.redaction, config);
  ensureInboxBranch(sidecarPath, config, inbox);
  stage("snapshot");
  if (options.snapshot) {
    snapshot(sidecarPath, root, inbox, options.message, config.redaction, config);
  }
  const siblings = siblingCheckouts(sidecarPath, config);
  if (siblings.length || !options.remote) {
    stage("merge-local");
    mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: false, remote: false });
    stage("settle");
    settleCheckouts(sidecarPath, config, inbox, siblings);
  }
  if (!options.remote)
    return;
  stage("push-inbox");
  syncBranchBeforePush(sidecarPath, inbox, config);
  pushBranch(sidecarPath, inbox);
  stage("merge");
  mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: true, remote: true });
  stage("settle-remote");
  settleCheckouts(sidecarPath, config, inbox, siblings);
}
function settleCheckouts(sidecarPath, config, inbox, siblings) {
  refreshInboxFromMain(sidecarPath, config, inbox);
  let settled = 0;
  for (const sibling of siblings) {
    try {
      if (isDirty(sibling))
        continue;
      if (git(sibling, ["merge", "--ff-only", config.branch], { check: false }).status === 0)
        settled += 1;
    } catch (error) {
      logSidecarEvent("settle-skip", {
        sidecarPath: sibling,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (settled)
    logSidecarEvent("settle", { sidecarPath, siblings: settled });
}
function siblingCheckouts(sidecarPath, config) {
  const result = git(sidecarPath, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0)
    return [];
  const self = realpathOr(sidecarPath);
  const prefix = inboxPrefix(config);
  const siblings = [];
  let checkout = "";
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      checkout = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      const branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      if (checkout && realpathOr(checkout) !== self && matchesInboxPrefix(prefix, branch)) {
        siblings.push(checkout);
      }
    }
  }
  return siblings;
}
function healthBranchFor(sidecarPath) {
  return healthBranch(slug(currentUser()), checkoutRandom(sidecarPath));
}
function reportSyncHealth(root, config, outcome) {
  try {
    const sidecarPath = resolveSidecarPath(root, config);
    if (!hasGitMetadata(sidecarPath))
      return;
    const branch = healthBranchFor(sidecarPath);
    const previous = readHealthRecordAt(sidecarPath, `origin/${branch}`);
    const identity = {
      machine: `${currentUser()}@${currentHost()}`,
      root,
      peer: config.peer === DEFAULT_PEER ? undefined : config.peer,
      inbox: expandInbox(config, sidecarPath),
      version: packageVersion()
    };
    const record = nextHealthRecord(previous, identity, outcome, nowIso());
    if (!shouldPublishHealth(previous, record))
      return;
    publishHealthRecord(sidecarPath, branch, record);
    logSidecarEvent("health", {
      branch,
      status: record.status,
      stage: record.stage,
      consecutiveFailures: record.consecutiveFailures
    });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "health",
      root,
      message: `could not publish health: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}
function publishHealthRecord(sidecarPath, branch, record) {
  const blob = git(sidecarPath, ["hash-object", "-w", "--stdin"], {
    input: serializeHealthRecord(record)
  }).stdout.trim();
  const tree = git(sidecarPath, ["mktree"], {
    input: `100644 blob ${blob}	${HEALTH_FILE}
`
  }).stdout.trim();
  const commit = git(sidecarPath, [
    "-c",
    `user.name=${currentUser()}`,
    "-c",
    `user.email=${slug(currentUser())}@${slug(currentHost())}.local`,
    "commit-tree",
    tree,
    "-m",
    `health: ${record.status} — ${record.machine}`
  ]).stdout.trim();
  git(sidecarPath, ["push", "--force", "origin", `${commit}:refs/heads/${branch}`]);
}
function readHealthRecordAt(sidecarPath, ref) {
  const result = git(sidecarPath, ["show", `${ref}:${HEALTH_FILE}`], { check: false });
  if (result.status !== 0)
    return;
  return parseHealthRecord(result.stdout);
}
function readFleetHealth(sidecarPath) {
  const self = healthBranchFor(sidecarPath);
  const refs = git(sidecarPath, ["branch", "-r", "--format=%(refname:short)"]).stdout.split(/\r?\n/).map((ref) => ref.trim()).filter((ref) => ref && ref !== "origin/HEAD" && isHealthBranch(ref));
  const entries = [];
  for (const ref of refs) {
    const record = readHealthRecordAt(sidecarPath, ref);
    if (!record)
      continue;
    const branch = remoteBranchName(ref);
    entries.push({ branch, self: branch === self, state: classifyHealthState(record), record });
  }
  const rank = { failed: 0, stale: 1, ok: 2 };
  return entries.sort((left, right) => rank[left.state] - rank[right.state] || left.record.machine.localeCompare(right.record.machine) || left.branch.localeCompare(right.branch));
}
function mergeInboxBranches(sidecarPath, config, options) {
  ensureClean(sidecarPath);
  ensureCommitIdentity(sidecarPath);
  if (options.remote)
    fetch(sidecarPath, false);
  if (!hasPendingInboxWork(sidecarPath, config)) {
    if (options.push && !mainMatchesRemote(sidecarPath, config)) {
      const push = git(sidecarPath, ["push", "origin", `refs/heads/${config.branch}:refs/heads/${config.branch}`], {
        check: false
      });
      if (push.status === 0) {
        console.log(`pushed ${config.branch}`);
        return 0;
      }
      console.log(`push of ${config.branch} was rejected; refetching and retrying`);
    } else {
      console.log("no inbox branches to merge");
      return 0;
    }
  }
  if (!hasAnyCommit(sidecarPath)) {
    return mergeInboxBranchesAt(sidecarPath, config, options);
  }
  if (git(sidecarPath, ["branch", "--show-current"]).stdout.trim() === config.branch) {
    ensureInboxBranch(sidecarPath, config, expandInbox(config, sidecarPath));
  }
  const scratch = path8.join(os5.tmpdir(), `sidecar-merge-${crypto4.createHash("sha1").update(sidecarPath).digest("hex").slice(0, 12)}`);
  const worktree = path8.join(scratch, "checkout");
  git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
  fs8.rmSync(scratch, { recursive: true, force: true });
  git(sidecarPath, ["worktree", "prune", "--expire", "now"], { check: false });
  try {
    git(sidecarPath, ["worktree", "add", "--detach", worktree]);
    ensureRedactionFilter(worktree, config.redaction, config);
    return mergeInboxBranchesAt(worktree, config, options);
  } finally {
    git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
    fs8.rmSync(scratch, { recursive: true, force: true });
  }
}
function mainMatchesRemote(repo, config) {
  const localRef = `refs/heads/${config.branch}`;
  const remoteRef = `refs/remotes/origin/${config.branch}`;
  const refs = new Map(git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", localRef, remoteRef]).stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(" ", 2)));
  const local = refs.get(localRef);
  const remote = refs.get(remoteRef);
  return local !== undefined && local === remote;
}
function hasPendingInboxWork(repo, config) {
  const main = `refs/heads/${config.branch}`;
  return pendingInboxBranches(repo, config).some((branch) => !isAncestor(repo, branch, main));
}
function mergeInboxBranchesAt(sidecarPath, config, options) {
  const maxAttempts = 3;
  for (let attempt = 1;; attempt += 1) {
    if (attempt > 1)
      fetch(sidecarPath, false);
    ensureMainBranch(sidecarPath, config);
    const inboxBranches = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"));
    const mainOwedToRemote = options.push && !mainMatchesRemote(sidecarPath, config);
    if (!inboxBranches.length && !mainOwedToRemote && attempt === 1) {
      console.log("no inbox branches to merge");
      return 0;
    }
    const merged = [];
    for (const remoteBranch of inboxBranches) {
      console.log(`merging ${paint("brand", remoteBranch)}`);
      if (mergeInboxBranch(sidecarPath, config, remoteBranch, options))
        merged.push(remoteBranch);
    }
    if (options.push) {
      const push = git(sidecarPath, ["push", "-u", "origin", `HEAD:refs/heads/${config.branch}`], { check: false });
      if (push.status !== 0) {
        if (attempt >= maxAttempts) {
          throw new SidecarError(push.stderr.trim() || `could not push ${config.branch}`);
        }
        console.log(`push of ${config.branch} was rejected; refetching and retrying`);
        continue;
      }
      console.log(`pushed ${config.branch}`);
    }
    console.log(`merged ${merged.length} inbox branch(es)`);
    return merged.length;
  }
}
function mergeInboxBranch(repo, config, remoteBranch, options) {
  if (isAncestor(repo, remoteBranch, "HEAD"))
    return false;
  try {
    const result = git(repo, ["merge", "--no-ff", "--no-commit", "-Xno-renames", remoteBranch], { check: false });
    if (result.status !== 0 && !hasUnmergedPaths(repo)) {
      throw new SidecarError(result.stderr.trim() || `merge failed for ${remoteBranch}`);
    }
    resolveMergeConflicts(repo, config, remoteBranch, options);
    return true;
  } catch (error) {
    try {
      git(repo, ["merge", "--abort"], { check: false });
    } catch {}
    throw error;
  }
}
function resolveMergeConflicts(repo, config, remoteBranch, options) {
  const paths = Object.keys(unmergedPaths(repo));
  const forkPaths = paths.filter((filePath) => resolveFileRules(config.rules, filePath, {
    resolve: config.resolve,
    redaction: config.redaction
  }).resolve === "fork");
  if (forkPaths.length && !options.forkFiles) {
    git(repo, ["merge", "--abort"], { check: false });
    throw new SidecarError(`merge conflict in ${remoteBranch}; rerun with --fork-files`);
  }
  const lwwEnabled = config.resolve === "lww" || config.rules?.some((rule) => rule.resolve === "lww");
  const writes = lwwEnabled ? mergeWrittenPaths(repo, remoteBranch) : undefined;
  const lwwPaths = writes ? [...new Set([...paths, ...writes.ours, ...writes.theirs])].filter((filePath) => resolveFileRules(config.rules, filePath, { resolve: config.resolve, redaction: config.redaction }).resolve === "lww") : [];
  const written = lwwPaths.length ? resolveLastWriterWins(repo, config.branch, remoteBranch, lwwPaths, writes) : [];
  if (forkPaths.length)
    forkConflicts(repo, remoteBranch, forkPaths);
  if (hasUnmergedPaths(repo))
    throw new SidecarError("per-path resolution did not clear all unmerged paths");
  const suffix = forkPaths.length ? " with forked conflict files" : lwwPaths.length ? ", last writer wins" : "";
  git(repo, ["commit", "-m", [`Merge ${remoteBranch}${suffix}`, ...written].join(`

`)]);
}
function mergeWrittenPaths(repo, remoteBranch) {
  const base = git(repo, ["merge-base", "HEAD", remoteBranch]).stdout.trim();
  if (!base)
    throw new SidecarError(`could not find common history with ${remoteBranch}`);
  const paths = (ref) => new Set(git(repo, ["log", "--format=", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent", `${base}..${ref}`]).stdout.split("\x00").filter(Boolean));
  return { base, ours: paths("HEAD"), theirs: paths(remoteBranch) };
}
function familySidecarCheckout(root, config) {
  const primary = familyPrimaryRoot(root);
  if (!primary)
    return;
  let primaryConfig;
  try {
    primaryConfig = readConfig(peerConfigPath(primary, config.peer));
  } catch {
    return;
  }
  if (primaryConfig.remote !== config.remote)
    return;
  const primaryPath = resolveSidecarPath(primary, primaryConfig);
  if (path8.resolve(primaryPath) === path8.resolve(primary))
    return;
  if (!hasGitMetadata(primaryPath))
    cloneOrUpdate(primary, primaryConfig, true);
  return hasGitMetadata(primaryPath) ? primaryPath : undefined;
}
function repairLinkedCheckout(root, config, sidecarPath) {
  if (git(sidecarPath, ["rev-parse", "--git-dir"], { check: false }).status === 0)
    return;
  const primaryPath = familySidecarCheckout(root, config);
  if (primaryPath && git(primaryPath, ["worktree", "repair", sidecarPath], { check: false }).status === 0) {
    logSidecarEvent("checkout-repair", { root, sidecarPath });
    return;
  }
  throw new SidecarError(`sidecar checkout at ${sidecarPath} is not a usable Git checkout; if this repo moved, repair it there first (\`git worktree repair\`), or delete the checkout and run \`sidecar clone\``);
}
function checkoutIsUnlinkedFromFamily(root, config, sidecarPath) {
  if (isStandalone(config))
    return false;
  try {
    if (!fs8.statSync(path8.join(sidecarPath, ".git")).isDirectory())
      return false;
  } catch {
    return false;
  }
  const primary = familyPrimaryRoot(root);
  if (!primary)
    return false;
  try {
    const primaryConfig = readConfig(peerConfigPath(primary, config.peer));
    return primaryConfig.remote === config.remote;
  } catch {
    return false;
  }
}
function cloneOrUpdate(root, config, bootstrapMain, options) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (fs8.existsSync(sidecarPath) && !hasGitMetadata(sidecarPath)) {
    if (fs8.readdirSync(sidecarPath).length) {
      throw new SidecarError(`${sidecarPath} exists and is not an empty Git repo`);
    }
    fs8.rmdirSync(sidecarPath);
  }
  if (!fs8.existsSync(sidecarPath)) {
    const primaryPath = familySidecarCheckout(root, config);
    if (primaryPath)
      git(primaryPath, ["worktree", "add", "--detach", sidecarPath]);
    else
      gitRaw(["clone", "--", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      if (!isStandalone(config)) {
        throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
      }
      console.log(`using origin ${paint("brand", existing.stdout.trim())} ${paint("quiet", `(.sidecar says ${config.remote})`)}`);
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }
  if (options?.checkoutId) {
    fs8.writeFileSync(path8.join(gitDir(sidecarPath), "sidecar-id"), `${options.checkoutId}
`, {
      encoding: "utf8",
      mode: 384
    });
  }
  ensureCommitIdentity(sidecarPath);
  ensureRedactionFilter(sidecarPath, config.redaction, config);
  if (bootstrapMain)
    bootstrapMainBranch(sidecarPath, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${paint("brand", sidecarPath)}`);
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
  if (isStandalone(config)) {
    git(repo, ["commit", "--allow-empty", "-m", "Initialize sidecar"]);
    pushBranch(repo, config.branch);
    return;
  }
  fs8.writeFileSync(path8.join(repo, "README.md"), `# Sidecar

Scratch space for a code repository: plans, notes, and agent context.
This is a plain git repo you own — read it, edit it, clone it anywhere.
Kept in sync by [sidecar](https://github.com/anteprojector/sidecar).
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
  if (!remoteRefExists(repo, config.branch))
    return;
  const remoteBranch = `origin/${config.branch}`;
  const [localOnly, remoteOnly] = git(repo, ["rev-list", "--left-right", "--count", `HEAD...${remoteBranch}`]).stdout.trim().split(/\s+/).map(Number);
  if (remoteOnly === 0)
    return;
  if (localOnly === 0) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }
  const tip = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const discarded = `refs/sidecar-discarded/${config.branch}/${utcTimestamp()}-${tip}`;
  git(repo, ["update-ref", discarded, "HEAD"], { check: false });
  console.log(`${config.branch} diverged from ${remoteBranch}; old tip kept at ${paint("brand", discarded)}`);
  git(repo, ["reset", "--hard", remoteBranch]);
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
  if (isStandalone(config) && hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
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
function ensureSidecarCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    cloneOrUpdate(root, config, true);
  } else {
    repairLinkedCheckout(root, config, sidecarPath);
  }
  return requireSidecarCheckout(root, config);
}
function snapshot(repo, mainRoot, inbox, message = "sidecar snapshot", redactionMode = DEFAULT_REDACTION_MODE, policy) {
  if (fs8.existsSync(path8.join(gitDir(repo), "MERGE_HEAD"))) {
    throw new SidecarError("cannot snapshot an unfinished merge; resolve or abort it before syncing");
  }
  const rewired = ensureRedactionFilter(repo, redactionMode, policy);
  const revisionPath = path8.join(gitDir(repo), "sidecar-redaction-revision");
  const revision = `${REDACTION_FILTER_REVISION}:${redactionMode}:${rulesFingerprint(policy?.rules)}`;
  let appliedRevision = "";
  try {
    appliedRevision = fs8.readFileSync(revisionPath, "utf8");
  } catch {}
  git(repo, ["add", "-A"]);
  if ((rewired || appliedRevision !== revision) && hasAnyCommit(repo)) {
    git(repo, ["add", "--renormalize", "."]);
  }
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    fs8.writeFileSync(revisionPath, revision, "utf8");
    console.log("no sidecar changes to snapshot");
    return false;
  }
  const staged = git(repo, ["diff", "--cached", "--name-only", "-z", "--diff-filter=d"]).stdout.split("\x00").filter(Boolean);
  const source = `${currentUser()}@${currentHost()}`;
  const body = [message, "", `source: ${source}`];
  if (path8.resolve(repo) !== path8.resolve(mainRoot)) {
    const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
    body.push(`main-head: ${mainHead.status === 0 ? mainHead.stdout.trim() : "unborn"}`);
  }
  body.push(`inbox: ${inbox}`);
  body.push(...writtenTrailers(repo, staged));
  git(repo, ["commit", "-m", body.join(`
`)]);
  fs8.writeFileSync(revisionPath, revision, "utf8");
  console.log(`committed sidecar snapshot to ${paint("brand", inbox)}`);
  reportRedactions(repo, staged, redactionMode, policy?.rules);
  return true;
}
function writtenTrailers(repo, staged) {
  if (staged.length > WRITTEN_TRAILER_LIMIT)
    return [];
  const trailers = [];
  for (const relPath of staged) {
    if (relPath.includes(`
`))
      continue;
    try {
      const seconds = Math.floor(fs8.lstatSync(path8.join(repo, relPath)).mtimeMs / 1000);
      if (seconds > 0)
        trailers.push(`${WRITTEN_TRAILER} ${seconds} ${relPath}`);
    } catch {}
  }
  return trailers;
}
function reportRedactions(repo, staged, mode, rules) {
  let files = 0;
  let items = 0;
  for (const relPath of staged) {
    const delta = fileRedactionDelta(path8.join(repo, relPath), mode, { rules, relativePath: relPath });
    if (!delta)
      continue;
    files += 1;
    items += delta.items;
  }
  if (!files)
    return;
  console.log(`redacted ${items} item(s) in ${files} file(s); review with \`sidecar redactions\``);
  logSidecarEvent("redaction", { files, items });
}
function fileRedactionDelta(filePath, mode, policy) {
  let data;
  try {
    data = fs8.readFileSync(filePath);
  } catch {
    return;
  }
  const text = decodeUtf8Text(data);
  if (text === undefined)
    return;
  const effectiveMode = policy ? resolveFileRules(policy.rules, policy.relativePath, { resolve: "fork", redaction: mode }).redaction : mode;
  const redacted = redactText(text, effectiveMode);
  if (redacted === text)
    return;
  const items = Math.max(1, countRedactionPlaceholders(redacted) - countRedactionPlaceholders(text));
  return { text, redacted, items };
}
function checkoutRedactionPolicy(repo) {
  const policyPath = path8.join(gitDir(repo), REDACTION_POLICY_FILE);
  let bound;
  try {
    bound = JSON.parse(fs8.readFileSync(policyPath, "utf8"));
  } catch {
    throw new SidecarError("missing or invalid checkout redaction policy; run `sidecar sync`");
  }
  if (!bound || typeof bound !== "object" || typeof bound.fingerprint !== "string" || bound.rulesPath !== undefined && (typeof bound.rulesPath !== "string" || !path8.isAbsolute(bound.rulesPath))) {
    throw new SidecarError("invalid checkout redaction policy; run `sidecar sync`");
  }
  const mode = redactionModeConfigValue(bound.mode, "checkout redaction mode");
  const rules = bound.rulesPath ? readRules(bound.rulesPath) : [];
  if (rulesFingerprint(rules) !== bound.fingerprint) {
    throw new SidecarError("sidecar rules changed during this operation; run `sidecar sync` to apply them");
  }
  return { mode, rules };
}
function ensureRedactionFilter(repo, mode = DEFAULT_REDACTION_MODE, policy) {
  const fingerprint = rulesFingerprint(policy?.rules);
  if (policy?.rules?.length && !policy.rulesPath) {
    throw new SidecarError("path redaction rules require an explicit host rules file");
  }
  const rulesPath = policy?.rulesPath ? path8.resolve(policy.rulesPath) : undefined;
  if (rulesPath && rulesFingerprint(readRules(rulesPath)) !== fingerprint) {
    throw new SidecarError("sidecar rules changed during this operation; run `sidecar sync` to apply them");
  }
  const policyPath = path8.join(gitDir(repo), REDACTION_POLICY_FILE);
  const bound = JSON.stringify({ mode, rulesPath, fingerprint });
  let previous = "";
  try {
    previous = fs8.readFileSync(policyPath, "utf8");
  } catch {}
  const policyChanged = previous !== bound;
  if (policyChanged)
    fs8.writeFileSync(policyPath, bound, { encoding: "utf8", mode: 384 });
  const command = `${filterCommandQuote(process.execPath)} ${filterCommandQuote(redactCliPath())} redact --checkout-policy --path %f`;
  const wanted = [
    [`filter.${REDACTION_FILTER_NAME}.clean`, command],
    [`filter.${REDACTION_FILTER_NAME}.revision`, REDACTION_FILTER_REVISION],
    [`filter.${REDACTION_FILTER_NAME}.smudge`, "cat"],
    [`filter.${REDACTION_FILTER_NAME}.required`, "true"]
  ];
  const attributesPath = path8.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;
  const configured = git(repo, ["config", "--get-regexp", `^filter\\.${REDACTION_FILTER_NAME}\\.`], {
    check: false
  });
  const current = new Map(configured.stdout.split(`
`).filter(Boolean).map((entry) => {
    const space = entry.indexOf(" ");
    return [entry.slice(0, space), entry.slice(space + 1)];
  }));
  const configOk = wanted.every(([key, value]) => current.get(key) === value);
  let attributes = "";
  try {
    attributes = fs8.readFileSync(attributesPath, "utf8");
  } catch {}
  const attributesOk = attributes.split(/\r?\n/).includes(line);
  if (configOk && attributesOk)
    return policyChanged;
  for (const [key, value] of wanted) {
    git(repo, ["config", key, value]);
  }
  if (!attributesOk) {
    fs8.mkdirSync(path8.dirname(attributesPath), { recursive: true });
    fs8.appendFileSync(attributesPath, attributes && !attributes.endsWith(`
`) ? `
${line}
` : `${line}
`, "utf8");
  }
  return true;
}
function removeRedactionFilter(repo) {
  git(repo, ["config", "--remove-section", `filter.${REDACTION_FILTER_NAME}`], { check: false });
  fs8.rmSync(path8.join(gitDir(repo), "sidecar-redaction-revision"), { force: true });
  fs8.rmSync(path8.join(gitDir(repo), REDACTION_POLICY_FILE), { force: true });
  const attributesPath = path8.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;
  let contents;
  try {
    contents = fs8.readFileSync(attributesPath, "utf8");
  } catch {
    return;
  }
  const lines = contents.split(/\r?\n/);
  const kept = lines.filter((entry) => entry !== line);
  if (kept.length === lines.length)
    return;
  if (kept.every((entry) => !entry.trim())) {
    fs8.rmSync(attributesPath, { force: true });
  } else {
    fs8.writeFileSync(attributesPath, `${kept.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function redactCliPath() {
  const self = fileURLToPath2(import.meta.url);
  return self.endsWith(".ts") ? path8.join(path8.dirname(self), "..", "dist", "cli.js") : self;
}
function filterCommandQuote(value) {
  return `"${value.replace(/([\\"$`])/g, "\\$1")}"`;
}
function redactBuffer(data, mode) {
  const text = decodeUtf8Text(data);
  if (text === undefined)
    return data;
  const redacted = redactText(text, mode);
  return redacted === text ? data : Buffer.from(redacted, "utf8");
}
function decodeUtf8Text(data) {
  if (data.includes(0))
    return;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return;
  }
}
function syncBranchBeforePush(repo, branch, config) {
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
  mergeInboxBranch(repo, { ...config, branch }, remoteBranch, { forkFiles: true });
}
function refreshInboxFromMain(repo, config, inbox) {
  if (!branchExists(repo, inbox) || !branchExists(repo, config.branch))
    return;
  ensureClean(repo);
  git(repo, ["switch", inbox]);
  const result = git(repo, ["merge", "--ff-only", config.branch], { check: false });
  if (result.status !== 0) {
    throw new SidecarError(result.stderr.trim() || `could not fast-forward ${inbox} to ${config.branch}`);
  }
}
function pushBranch(repo, branch) {
  git(repo, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  console.log(`pushed ${paint("brand", branch)}`);
}
function forkConflicts(repo, remoteBranch, selectedPaths) {
  const conflicts = selectConflictPaths(unmergedEntries(repo), selectedPaths);
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
  const prepared = Object.entries(conflicts).sort(([left], [right]) => left.localeCompare(right)).map(([conflictPath, stages]) => ({
    conflictPath,
    stages,
    blobs: Object.fromEntries([2, 3].filter((stage) => stages[stage]).map((stage) => {
      const entry = stages[stage];
      if (!["100644", "100755", "120000"].includes(entry.mode)) {
        throw new SidecarError(`cannot fork unsupported mode ${entry.mode} for ${conflictPath}`);
      }
      const blob = showStage(repo, stage, conflictPath);
      if (blob === undefined)
        throw new SidecarError(`could not read conflict stage ${stage} for ${conflictPath}`);
      return [stage, blob];
    }))
  }));
  for (const { conflictPath, stages, blobs } of prepared) {
    const versions = [];
    for (const [stage, label] of [
      [2, "main"],
      [3, branchLabel]
    ]) {
      const blob = blobs[stage];
      if (blob === undefined)
        continue;
      const { oid, mode } = stages[stage];
      const outPath = forkPath(conflictPath, label, oid);
      const fullOut = path8.join(repo, outPath);
      fs8.mkdirSync(path8.dirname(fullOut), { recursive: true });
      fs8.rmSync(fullOut, { force: true });
      if (mode === "120000")
        fs8.symlinkSync(blob.toString("utf8"), fullOut);
      else {
        fs8.writeFileSync(fullOut, blob);
        fs8.chmodSync(fullOut, mode === "100755" ? 493 : 420);
      }
      git(repo, ["add", "--", `:(literal)${outPath}`]);
      versions.push({
        stage,
        label,
        oid,
        path: outPath,
        sha256: crypto4.createHash("sha256").update(blob).digest("hex")
      });
    }
    git(repo, ["rm", "-f", "--", `:(literal)${conflictPath}`]);
    manifest.paths.push({ path: conflictPath, versions });
  }
  const manifestDir = path8.join(repo, ".sidecar-conflicts");
  fs8.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path8.join(manifestDir, `${timestamp}-${manifestLabel}-fork-files.json`);
  fs8.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  git(repo, ["add", "--", `:(literal)${path8.relative(repo, manifestPath)}`]);
  if (Object.keys(selectConflictPaths(unmergedPaths(repo), selectedPaths)).length) {
    throw new SidecarError("fork-files did not clear all unmerged paths");
  }
}
function resolveLastWriterWins(repo, canonicalBranch, remoteBranch, selectedPaths = Object.keys(unmergedPaths(repo)), writes = mergeWrittenPaths(repo, remoteBranch)) {
  const timestamp = utcTimestamp();
  const branch = remoteBranchName(remoteBranch) || remoteBranch;
  const manifest = { timestamp, resolved_by: "lww", source_branch: branch, paths: [] };
  const selections = [...new Set(selectedPaths)].sort().map((filePath) => {
    const ours = treeEntry(repo, "HEAD", filePath);
    const theirs = treeEntry(repo, remoteBranch, filePath);
    const oursWrite = lastWriteEvent(repo, "HEAD", filePath);
    const theirsWrite = lastWriteEvent(repo, remoteBranch, filePath);
    const baseWrite = lastWriteEvent(repo, writes.base, filePath);
    const oursAt = oursWrite.time;
    const theirsAt = theirsWrite.time;
    const oursChanged = oursWrite.source !== baseWrite.source;
    const theirsChanged = theirsWrite.source !== baseWrite.source;
    const incoming = oursChanged !== theirsChanged ? theirsChanged : theirsAt > oursAt || theirsAt === oursAt && entryKey(theirs) > entryKey(ours);
    return { filePath, ours, theirs, incoming, winner: incoming ? theirs : ours, write: incoming ? theirsWrite : oursWrite };
  });
  const selected = new Set(selections.map((entry) => entry.filePath));
  const indexed = new Set(git(repo, ["ls-files", "-z"]).stdout.split("\x00").filter(Boolean));
  const present = new Set([
    ...[...indexed].filter((filePath) => !selected.has(filePath)),
    ...selections.filter((entry) => entry.winner).map((entry) => entry.filePath)
  ]);
  for (const filePath of present) {
    for (let parent = path8.posix.dirname(filePath);parent !== "."; parent = path8.posix.dirname(parent)) {
      if (present.has(parent))
        throw new SidecarError(`last-writer-wins selected incompatible file and directory paths: ${parent}, ${filePath}`);
    }
  }
  for (const selection of selections.filter((entry) => !entry.winner)) {
    if (indexed.has(selection.filePath)) {
      git(repo, ["rm", "-f", "--ignore-unmatch", "--", `:(literal)${selection.filePath}`]);
    }
  }
  const written = [];
  for (const { filePath, ours, theirs, incoming, winner, write } of selections) {
    if (winner) {
      git(repo, ["restore", `--source=${incoming ? remoteBranch : "HEAD"}`, "--staged", "--worktree", "--", `:(literal)${filePath}`]);
      git(repo, ["add", "--renormalize", "--", `:(literal)${filePath}`]);
    }
    manifest.paths.push({
      path: filePath,
      kept: incoming ? branch : canonicalBranch,
      kept_at: write.time,
      dropped: incoming ? canonicalBranch : branch,
      dropped_oid: (incoming ? ours : theirs)?.oid ?? null
    });
    written.push(lwwWrittenTrailer(filePath, write));
  }
  const manifestDir = path8.join(repo, ".sidecar-conflicts");
  fs8.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path8.join(manifestDir, `${timestamp}-${fileLabel(branch)}-lww.json`);
  fs8.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  git(repo, ["add", "--", `:(literal)${path8.relative(repo, manifestPath)}`]);
  if (Object.keys(selectConflictPaths(unmergedPaths(repo), selectedPaths)).length) {
    throw new SidecarError("last-writer-wins did not clear all unmerged paths");
  }
  console.log(`selected ${manifest.paths.length} complete file version(s) by last writer`);
  return written;
}
function entryKey(entry) {
  return entry ? `${entry.mode}:${entry.oid}` : "~deleted";
}
function treeEntry(repo, ref, filePath) {
  const records = gitBytes(repo, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", ref, "--", filePath]).stdout.toString("utf8").split("\x00");
  for (const record of records) {
    const separator = record.indexOf("\t");
    if (separator < 0 || record.slice(separator + 1) !== filePath)
      continue;
    const [mode, type, oid] = record.slice(0, separator).split(" ");
    if (type === "tree")
      return;
    if (type !== "blob" || !["100644", "100755", "120000"].includes(mode)) {
      throw new SidecarError(`cannot select unsupported Git entry ${mode} for ${filePath}`);
    }
    return { mode, oid };
  }
  return;
}
function lwwTrailerPrefix(filePath) {
  return `sidecar-lww-${crypto4.createHash("sha256").update(filePath).digest("hex")}:`;
}
function lwwWrittenTrailer(filePath, write) {
  return `${lwwTrailerPrefix(filePath)} ${write.time} ${write.source || "-"}`;
}
function selectConflictPaths(conflicts, selectedPaths) {
  if (!selectedPaths)
    return conflicts;
  const selected = new Set(selectedPaths);
  return Object.fromEntries(Object.entries(conflicts).filter(([filePath]) => selected.has(filePath)));
}
function lastWriteEvent(repo, ref, filePath) {
  const format = "--format=%H%n%ct%n%B";
  const result = git(repo, ["log", "--first-parent", "-1", format, ref, "--", `:(literal)${filePath}`]);
  const [writeCommit = "", committed = "", ...body] = result.stdout.split(`
`);
  const prefix = lwwTrailerPrefix(filePath);
  const metadata = git(repo, ["log", "--first-parent", "-1", "--fixed-strings", `--grep=${prefix}`, format, ref]);
  const [metadataCommit = "", , ...metadataBody] = metadata.stdout.split(`
`);
  if (metadataCommit && (!writeCommit || isAncestor(repo, writeCommit, metadataCommit))) {
    const carried2 = recordedLwwEvent(metadataBody, prefix);
    if (carried2 !== undefined)
      return carried2;
  }
  const carried = recordedLwwEvent(body, prefix);
  if (carried !== undefined)
    return carried;
  const suffix = ` ${filePath}`;
  for (const line of body) {
    if (!line.startsWith(WRITTEN_TRAILER) || !line.endsWith(suffix))
      continue;
    const seconds = Number(line.slice(WRITTEN_TRAILER.length, -suffix.length).trim());
    if (Number.isInteger(seconds) && seconds > 0)
      return { time: seconds, source: writeCommit };
  }
  return { time: Number(committed.trim()) || 0, source: writeCommit };
}
function recordedLwwEvent(body, prefix) {
  const line = body.find((entry) => entry.startsWith(`${prefix} `));
  if (!line)
    return;
  const [timestamp, source] = line.slice(prefix.length).trim().split(/\s+/);
  const time = Number(timestamp);
  return Number.isInteger(time) && time >= 0 && source ? { time, source: source === "-" ? "" : source } : undefined;
}
function forkPath(conflictPath, label, oid) {
  const parsed = path8.parse(conflictPath);
  const shortOid = oid ? oid.slice(0, 7) : "missing";
  const safeLabel = fileLabel(label);
  const forkName = parsed.ext ? `${parsed.name}.conflict.${safeLabel}.${shortOid}${parsed.ext}` : `${parsed.name}.conflict.${safeLabel}.${shortOid}`;
  return path8.join(parsed.dir, forkName);
}
function fileLabel(value) {
  return slug(value).replaceAll("/", "-");
}
function unmergedEntries(repo) {
  const result = gitBytes(repo, ["ls-files", "-u", "-z"]);
  let output;
  try {
    output = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  } catch {
    throw new SidecarError("cannot resolve conflict paths that are not valid UTF-8");
  }
  const paths = Object.create(null);
  for (const record of output.split("\x00")) {
    if (!record)
      continue;
    const separator = record.indexOf("\t");
    const meta = record.slice(0, separator);
    const rawPath = record.slice(separator + 1);
    const [mode, oid, stageText] = meta.split(" ");
    const stage = Number(stageText);
    if (separator < 0 || !rawPath || !mode || !oid || ![1, 2, 3].includes(stage)) {
      throw new SidecarError("invalid unmerged index entry");
    }
    paths[rawPath] ??= {};
    paths[rawPath][stage] = { mode, oid };
  }
  return paths;
}
function unmergedPaths(repo) {
  return Object.fromEntries(Object.entries(unmergedEntries(repo)).map(([filePath, stages]) => [
    filePath,
    Object.fromEntries(Object.entries(stages).map(([stage, entry]) => [stage, entry.oid]))
  ]));
}
function hasUnmergedPaths(repo) {
  return Object.keys(unmergedPaths(repo)).length > 0;
}
function showStage(repo, stage, conflictPath) {
  const result = gitBytes(repo, ["show", `:${stage}:${conflictPath}`], { check: false });
  return result.status === 0 ? result.stdout : undefined;
}
function pendingInboxBranches(repo, config) {
  const prefix = inboxPrefix(config);
  const refs = git(repo, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads/",
    "refs/remotes/origin/"
  ]).stdout.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean);
  const local = refs.filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice("refs/heads/".length)).filter((branch) => matchesInboxPrefix(prefix, branch));
  const claimed = new Set(local);
  const remote = refs.filter((ref) => ref.startsWith("refs/remotes/origin/")).map((ref) => ref.slice("refs/remotes/".length)).filter((ref) => {
    const branch = remoteBranchName(ref);
    return ref !== "origin/HEAD" && matchesInboxPrefix(prefix, branch) && !claimed.has(branch);
  });
  return [...local, ...remote].sort();
}
var SOFT_SYNC_ENV = "SIDECAR_SYNC_SOFT", LOCAL_SYNC_ENV = "SIDECAR_SYNC_LOCAL", WRITTEN_TRAILER = "written:", WRITTEN_TRAILER_LIMIT = 500, REDACTION_FILTER_NAME = "sidecar-redact", REDACTION_FILTER_REVISION = "2", REDACTION_POLICY_FILE = "sidecar-redaction-policy";
var init_sync = __esm(() => {
  init_color();
  init_util();
  init_git();
  init_install();
  init_config();
  init_state();
  init_rules();
  init_health();
  init_redaction();
});

// src/ui.ts
import fs9 from "node:fs";
function announcePeer(peer, peers) {
  const index = peers.indexOf(peer);
  if (index > 0)
    console.log("");
  if (peers.length > 1 || peer.name !== DEFAULT_PEER) {
    console.log(`${paint("label", "peer:")} ${paint("brand", peer.name)}`);
  }
}
function labelLine(width, label, value, role, indent = "") {
  const padded = `${label}:`.padEnd(width);
  console.log(`${indent}${paint("label", padded)} ${role ? paint(role, value) : value}`);
}
function formatTimestampPair(iso) {
  const relative = formatRelativeTime(iso);
  const absolute = formatLocalTimestamp(iso);
  if (!relative || !absolute)
    return iso;
  return `${relative} ${paint("quiet", `(${absolute})`)}`;
}
function formatRelativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then))
    return;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45)
    return "just now";
  const scales = [
    [60, "minute", 60],
    [3600, "hour", 24],
    [86400, "day", 14],
    [604800, "week", 9],
    [2592000, "month", 18],
    [31536000, "year", Number.POSITIVE_INFINITY]
  ];
  for (const [size, unit, limit] of scales) {
    const count = Math.max(1, Math.floor(seconds / size));
    if (count < limit)
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "a very long time ago";
}
function formatLocalTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function promptYesNo(question) {
  if (!process.stdin.isTTY)
    return false;
  const answer = promptLine(`${question} ${paint("quiet", "[Y/n]")} `).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}
function promptYesNoDefaultNo(question) {
  if (!process.stdin.isTTY)
    return false;
  const answer = promptLine(`${question} ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}
function promptLine(prompt) {
  fs9.writeSync(1, prompt);
  const fd = fs9.openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(1);
    while (true) {
      const bytesRead = fs9.readSync(fd, buffer, 0, 1, null);
      if (bytesRead === 0)
        break;
      const char = buffer.toString("utf8", 0, bytesRead);
      if (char === `
` || char === "\r")
        break;
      chunks.push(char);
    }
    return chunks.join("").trim();
  } finally {
    fs9.closeSync(fd);
  }
}
var init_ui = __esm(() => {
  init_color();
  init_config();
});

// src/cmd-init.ts
import fs10 from "node:fs";
import path9 from "node:path";
import { spawnSync as spawnSync4 } from "node:child_process";
function cmdDeinit(args) {
  const parsed = parseOptions(args, { boolean: new Set(["--yes", "-y"]), value: new Set(["--peer"]) });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar deinit [--yes] [--peer name]");
  const root = findConfigRootOptional(process.cwd()) ?? gitToplevelOptional(process.cwd());
  if (!root) {
    console.error("sidecar: warning: no .sidecar config or Git repository found; nothing to remove");
    return 0;
  }
  const names = listPeerNames(root);
  const requested = parsed.values.get("--peer");
  if (requested !== undefined)
    validatePeerName(requested);
  if (requested === undefined && names.length > 1) {
    throw new SidecarError(`this repo has several sidecar peers (${names.join(", ")}); name the one to remove with --peer`);
  }
  const name = requested ?? names[0] ?? DEFAULT_PEER;
  const configFile = peerFileName(name);
  const configPath = peerConfigPath(root, name);
  const leftovers = [];
  let config;
  if (fs10.existsSync(configPath)) {
    try {
      config = readConfig(configPath);
    } catch {
      leftovers.push(`could not read ${configPath}, so its checkout and ignore entries were left in place`);
    }
  } else {
    leftovers.push(`no ${configFile} config found; a leftover checkout or ignore entries may remain`);
  }
  const checkoutPath = config && !isStandalone(config) ? resolveSidecarPath(root, config) : undefined;
  if (checkoutPath) {
    assertDeinitTarget(root, checkoutPath);
    console.log(`deinit deletes ${paint("brand", checkoutPath)}, including all unpushed changes.`);
  } else {
    console.log(`deinit removes Sidecar configuration from ${paint("repo", root)}; the repo is kept.`);
  }
  if (!parsed.flags.has("--yes") && !parsed.flags.has("-y") && !promptYesNoDefaultNo("continue?")) {
    console.log("nothing changed; use --yes to confirm without a terminal");
    return 0;
  }
  withSyncLock(root, name, "throw", () => {
    if (config && isStandalone(config)) {
      const leftover = releaseStandaloneCheckout(root, config);
      if (leftover)
        leftovers.push(leftover);
    } else if (!config && name === DEFAULT_PEER) {
      removeRedactionFilter(root);
    }
    if (config && checkoutPath) {
      assertDeinitTarget(root, checkoutPath);
      removeCheckout(checkoutPath);
      const ignoreEntry = ignoreEntryForSidecarPath(root, config.path);
      if (ignoreEntry) {
        removeIgnoreEntry(path9.join(root, ".gitignore"), ignoreEntry);
        removeZedInclusion(root, ignoreEntry);
      }
    }
    fs10.rmSync(configPath, { force: true });
    fs10.rmSync(peerRulesPath(root, name), { force: true });
    unregisterInstance(configPath);
  });
  console.log(`removed sidecar from ${paint("repo", root)}${name === DEFAULT_PEER ? "" : ` (peer ${paint("brand", name)})`}`);
  if (leftovers.length) {
    for (const leftover of leftovers) {
      console.error(`sidecar: warning: ${leftover}`);
    }
    console.error("sidecar: deinit could not fully complete; to finish removal, ask your agent to scrub any remaining traces of sidecar");
  }
  return 0;
}
function assertDeinitTarget(root, checkoutPath) {
  const target = realpathOr(checkoutPath);
  const host = realpathOr(root);
  const hostFromTarget = path9.relative(target, host);
  const parts = path9.relative(host, target).split(path9.sep);
  const containsHost = !path9.isAbsolute(hostFromTarget) && hostFromTarget.split(path9.sep)[0] !== "..";
  if (containsHost || parts.includes(".git") || parts.includes(".jj")) {
    throw new SidecarError(`refusing to delete ${checkoutPath}, which contains the host repo or its VCS metadata`);
  }
}
function releaseStandaloneCheckout(root, config) {
  removeRedactionFilter(root);
  const current = git(root, ["branch", "--show-current"], { check: false }).stdout.trim();
  if (current === config.branch)
    return;
  if (rulesMayRedact(config.rules, config.redaction)) {
    return `the repo is still on ${current || "a detached HEAD"}: switching to ${config.branch} would replace local files with their redacted pushed contents`;
  }
  if (git(root, ["switch", config.branch], { check: false }).status === 0) {
    console.log(`switched back to ${config.branch}`);
    return;
  }
  return `could not switch to ${config.branch}; the repo is still on ${current || "a detached HEAD"}`;
}
function removeCheckout(checkoutPath) {
  try {
    if (fs10.statSync(path9.join(checkoutPath, ".git")).isFile()) {
      git(checkoutPath, ["worktree", "remove", "--force", checkoutPath], { check: false });
    }
  } catch {}
  fs10.rmSync(checkoutPath, { recursive: true, force: true });
}
function cmdInit(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main", "--local-install", "--ignored"]),
    value: new Set(["--path", "--branch", "--inbox", "--redaction", "--resolve", "--debounce", "--interval", "--peer"])
  });
  if (parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init [remote] [--peer name] [--path sidecar] [--branch main] [--inbox template] [--redaction mode] [--resolve fork|lww] [--debounce 10m] [--interval 1h] [--ignored]");
  }
  const remote = parsed.positional[0];
  const requestedPeer = parsed.values.get("--peer");
  if (requestedPeer !== undefined)
    validatePeerName(requestedPeer);
  const root = (remote ? undefined : findConfigRootOptional(process.cwd())) ?? initRoot(remote, parsed);
  const declared = listPeerNames(root);
  const names = remote || requestedPeer !== undefined ? [requestedPeer ?? DEFAULT_PEER] : declared.length ? declared : [DEFAULT_PEER];
  const peers = names.map((name) => configurePeer(root, name, remote, parsed));
  offerLocalInstall(root, peers.some((peer) => isStandalone(peer.config)), parsed.flags.has("--local-install"));
  for (const peer of peers) {
    if (peers.length > 1)
      announcePeer(peer, peers);
    if (!parsed.flags.has("--no-clone")) {
      cloneOrUpdate(root, peer.config, !parsed.flags.has("--no-bootstrap-main"));
    }
    registerCurrentInstance(root, peer.config, { event: "init" });
  }
  const globalSidecar = ensureGlobalSidecar();
  if (globalSidecar) {
    if (!shouldUseGlobalRegistry()) {
      registerInstallWithGlobalSidecar(globalSidecar, root);
      warnIfGlobalPredatesPeers(globalSidecar, peers);
    }
    ensureDaemonSetup(globalSidecar);
  }
  for (const { config } of peers) {
    if (isStandalone(config) && !parsed.flags.has("--no-clone")) {
      const synced = withSyncLock(root, config.peer, "skip", () => {
        syncProject(root, config, { snapshot: true, remote: true });
      });
      if (synced)
        registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
    }
  }
  return 0;
}
function configurePeer(root, name, remote, parsed) {
  const configPath = peerConfigPath(root, name);
  let reuse = !remote && fs10.existsSync(configPath);
  if (remote && fs10.existsSync(configPath)) {
    const existing = readConfig(configPath);
    const unchanged = existing.remote === remote && existing.path === getValue(parsed, "--path", existing.path) && existing.branch === getValue(parsed, "--branch", existing.branch) && existing.inbox === getValue(parsed, "--inbox", existing.inbox) && existing.redaction === getValue(parsed, "--redaction", existing.redaction) && existing.resolve === getValue(parsed, "--resolve", existing.resolve) && existing.debounce === durationConfigValue(parsed.values.get("--debounce") ?? existing.debounce, "--debounce") && existing.interval === durationConfigValue(parsed.values.get("--interval") ?? existing.interval, "--interval");
    reuse = unchanged || !promptOverwriteConfig(configPath, existing.remote, remote);
  }
  const config = reuse ? readConfig(configPath) : buildInitConfig(root, name, remote, parsed);
  if (!reuse) {
    config.rulesPath = peerRulesPath(root, name);
    config.rules = readRules(config.rulesPath);
  }
  if (parsed.flags.has("--ignored")) {
    if (isStandalone(config)) {
      throw new SidecarError("--ignored cannot apply to a standalone sidecar: its .sidecar is part of the tree it syncs");
    }
    for (const file of [peerFileName(name), peerRulesFileName(name)]) {
      if (isGitTracked(root, file)) {
        throw new SidecarError(`${file} is tracked by git; \`git rm --cached ${file}\` before ignoring it`);
      }
    }
  }
  if (!reuse) {
    validateRemote(config.remote);
    validateBranch(config.branch);
    validateInboxTemplate(config.inbox);
    ensureDistinctCheckouts([
      ...listPeerNames(root).filter((other) => other !== name).map((other) => loadPeer(root, other)),
      { root, name, configPath, config }
    ]);
    writeConfig(configPath, config);
  }
  console.log(`${reuse ? "using" : "wrote"} ${paint("brand", configPath)}`);
  if (isStandalone(config)) {
    console.log(`standalone: ${paint("repo", root)} is the sidecar`);
  } else {
    if (parsed.flags.has("--ignored"))
      excludePeerFile(root, name);
    printCheckoutVisibility(root, config);
  }
  return { root, name, configPath, config };
}
function excludePeerFile(root, name) {
  const configFile = peerFileName(name);
  const exclude = gitExcludePath(root);
  if (!exclude) {
    throw new SidecarError(`--ignored needs a git exclude file, and ${root} has none; ignore ${configFile} in your own VCS config`);
  }
  const rulesFile = peerRulesFileName(name);
  ensureIgnoreLine(exclude, `/${configFile}`);
  ensureIgnoreLine(exclude, `/${rulesFile}`);
  console.log(`ignored ${configFile} and ${rulesFile} via .git/info/exclude`);
}
function initRoot(remote, parsed) {
  const cwd = process.cwd();
  const toplevel = gitToplevelOptional(cwd);
  const here = parsed.values.has("--path") && pathIsRepoRoot(cwd, getValue(parsed, "--path", DEFAULT_PATH));
  if (!here || toplevel && pathIsRepoRoot(cwd, toplevel))
    return gitToplevel(cwd);
  if (!remote) {
    throw new SidecarError(`${cwd} is not a Git repository; to make it its own sidecar, name the remote it should sync to: sidecar init <remote> --path .`);
  }
  gitRaw(["init", "-q", "-b", getValue(parsed, "--branch", DEFAULT_BRANCH), cwd]);
  console.log(`initialized ${paint("repo", cwd)} as a Git repository`);
  return cwd;
}
function buildInitConfig(root, name, remote, parsed) {
  const defaultPath = name === DEFAULT_PEER ? DEFAULT_PATH : name;
  const rawPath = parsed.values.has("--path") ? getValue(parsed, "--path", defaultPath) : promptSidecarPath(root, name, defaultPath);
  const sidecarPath = pathIsRepoRoot(root, rawPath) ? "." : rawPath;
  const standalone = isStandalonePath(sidecarPath);
  if (standalone && name !== DEFAULT_PEER) {
    throw new SidecarError(`a peer cannot be standalone: only .sidecar can point at the repo itself, not ${peerFileName(name)}`);
  }
  return {
    peer: name,
    remote: remote ?? (standalone ? standaloneRemote(root) : promptRemote(root)),
    version: 1,
    path: sidecarPath,
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX),
    redaction: parsed.values.has("--redaction") ? redactionModeConfigValue(getValue(parsed, "--redaction", DEFAULT_REDACTION_MODE), "--redaction") : promptRedactionMode(),
    resolve: parsed.values.has("--resolve") ? resolveModeConfigValue(getValue(parsed, "--resolve", DEFAULT_RESOLVE), "--resolve") : DEFAULT_RESOLVE,
    debounce: durationConfigValue(parsed.values.get("--debounce"), "--debounce"),
    interval: durationConfigValue(parsed.values.get("--interval"), "--interval")
  };
}
function printCheckoutVisibility(root, config) {
  const exclude = isGitIgnored(root, peerFileName(config.peer)) ? gitExcludePath(root) : undefined;
  if (exclude) {
    const rulesFile = peerRulesFileName(config.peer);
    if (isGitTracked(root, rulesFile)) {
      throw new SidecarError(`${rulesFile} is tracked by git; remove it from the index before using an ignored peer`);
    }
    ensureIgnoreLine(exclude, `/${rulesFile}`);
  }
  const ignoreEntry = ignoreEntryForSidecarPath(root, config.path);
  if (!ignoreEntry) {
    console.log(`sidecar path outside repo; not updating .gitignore`);
    return;
  }
  ensureIgnoreEntry(exclude ?? path9.join(root, ".gitignore"), ignoreEntry);
  const name = ignoreEntry.replace(/\/+$/, "");
  console.log(`ignored ${name}/ via ${exclude ? ".git/info/exclude" : ".gitignore"}`);
  if (hasZedInclusion(root, ignoreEntry)) {
    console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
  } else if (promptYesNo(`include ${name}/ in Zed file search via .zed/settings.json?`)) {
    if (ensureZedInclusion(root, ignoreEntry)) {
      console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
    } else {
      console.log(`could not parse .zed/settings.json; add "${name}/**" to file_scan_inclusions manually`);
    }
  }
}
function offerLocalInstall(root, standalone, forced) {
  const manifestPath = path9.join(root, "package.json");
  if (!fs10.existsSync(manifestPath)) {
    if (forced)
      throw new SidecarError("--local-install requires a package.json");
    return;
  }
  if (projectDependsOnSidecar(root))
    return;
  let source;
  let manifest;
  try {
    source = fs10.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    manifest = parsed;
  } catch {
    console.error(`sidecar: warning: could not parse ${manifestPath}; add ${PACKAGE_NAME} to devDependencies manually so fresh clones self-register on install`);
    return;
  }
  if (!forced && !promptYesNo(`add ${PACKAGE_NAME} to devDependencies so fresh clones self-register on install?`)) {
    return;
  }
  manifest.devDependencies = {
    ...manifest.devDependencies,
    [PACKAGE_NAME]: `^${packageVersion()}`
  };
  const managers = detectPackageManagers(root);
  if (managers.has("bun")) {
    manifest.trustedDependencies = withEntry(manifest.trustedDependencies, PACKAGE_NAME);
  }
  if (managers.has("pnpm")) {
    const pnpm = { ...manifest.pnpm };
    pnpm.onlyBuiltDependencies = withEntry(pnpm.onlyBuiltDependencies, PACKAGE_NAME);
    manifest.pnpm = pnpm;
  }
  const indent = /^([ \t]+)"/m.exec(source)?.[1] ?? "  ";
  fs10.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indent)}
`);
  console.log(`added ${paint("brand", PACKAGE_NAME)} to devDependencies; run your package manager's install to pin it`);
  if (managers.has("bun")) {
    console.log("trusted its postinstall via trustedDependencies (bun blocks lifecycle scripts by default)");
  }
  if (managers.has("pnpm")) {
    console.log("trusted its postinstall via pnpm.onlyBuiltDependencies (pnpm blocks lifecycle scripts by default)");
  }
  if (!managers.size) {
    console.error(`sidecar: warning: no lockfile found, so the package manager is unknown — bun and pnpm block postinstall scripts by default; if this repo uses one of them, add the trust entry manually`);
  }
  if (standalone && git(root, ["check-ignore", "-q", "node_modules"], { check: false }).status !== 0) {
    console.error("sidecar: warning: node_modules is not gitignored; add it before installing or the next sync will snapshot the whole dependency tree");
  }
}
function withEntry(value, entry) {
  const entries = Array.isArray(value) ? value : [];
  return entries.includes(entry) ? entries : [...entries, entry];
}
function detectPackageManagers(root) {
  const lockfiles = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"]
  ];
  return new Set(lockfiles.filter(([file]) => fs10.existsSync(path9.join(root, file))).map(([, manager]) => manager));
}
function ensureDaemonSetup(globalSidecar) {
  if (process.env[SKIP_SERVICE_ENV] === "1")
    return;
  if (!readSettings().daemonEnabled)
    return;
  const service = daemonServiceStatus();
  if (!service.available || service.installed && service.running)
    return;
  const result = spawnSync4(globalSidecar, ["daemon", "enable"], {
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV]: "1",
      [GLOBAL_EXEC_ENV]: "1"
    }
  });
  if (result.status !== 0) {
    console.log(`could not enable the sync daemon: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}; run \`sidecar daemon enable\` manually`);
    return;
  }
  console.log("enabled the sidecar daemon for background sync");
}
function ensureGlobalSidecar() {
  const installHint = `install with \`npm install -g ${PACKAGE_SPEC}\``;
  const globalSidecar = findGlobalSidecarExecutable();
  if (!globalSidecar) {
    if (!process.stdin.isTTY) {
      console.log(`no global sidecar found; ${installHint} to enable daemon auto sync`);
      return;
    }
    if (promptYesNo("no global sidecar found; install it now for daemon auto sync?")) {
      installGlobalSidecar();
      return findGlobalSidecarExecutable();
    }
    return;
  }
  const globalVersion = globalSidecarVersion(globalSidecar);
  const currentVersion = packageVersion();
  if (globalVersion && compareVersions(globalVersion, currentVersion) >= 0)
    return globalSidecar;
  const state = globalVersion ? `v${globalVersion}` : "an unknown version";
  if (!process.stdin.isTTY) {
    console.log(`global sidecar is ${state} (current v${currentVersion}); ${installHint.replace("install with", "update with")}`);
    return globalSidecar;
  }
  if (promptYesNo(`global sidecar is ${state} (current v${currentVersion}); update it now?`)) {
    installGlobalSidecar();
    return findGlobalSidecarExecutable() ?? globalSidecar;
  }
  return globalSidecar;
}
function warnIfGlobalPredatesPeers(executable, peers) {
  if (!peers.some((peer) => peer.name !== DEFAULT_PEER))
    return;
  const version = globalSidecarVersion(executable);
  if (version && compareVersions(version, packageVersion()) >= 0)
    return;
  console.error(`sidecar: warning: the global sidecar (${version ? `v${version}` : "unknown version"}) predates peers; its daemon syncs only .sidecar until it is updated`);
}
function registerInstallWithGlobalSidecar(executable, root) {
  const result = spawnSync4(executable, ["register-install"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV]: "1",
      [GLOBAL_EXEC_ENV]: "1"
    }
  });
  if (result.status !== 0) {
    throw new SidecarError(`global sidecar registration failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`);
  }
}
function installGlobalSidecar() {
  const bun = findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun");
  const command = bun ? [bun, "add", "-g", PACKAGE_SPEC] : ["npm", "install", "-g", PACKAGE_SPEC];
  console.log(`running ${command.join(" ")}`);
  const result = spawnSync4(command[0], command.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    throw new SidecarError(`global sidecar install failed; run \`${command.join(" ")}\` manually`);
  }
  writeSettings({ ...readSettings(), installSource: bun ? "bun" : "npm" });
}
function cmdClone(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main", "--if-missing"]),
    value: new Set(["--peer"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar clone [--if-missing] [--no-bootstrap-main] [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    const { root, config } = peer;
    if (parsed.flags.has("--if-missing")) {
      const sidecarPath = resolveSidecarPath(root, config);
      if (fs10.existsSync(sidecarPath) && hasGitMetadata(sidecarPath))
        continue;
    }
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
    registerCurrentInstance(root, config, { event: "clone" });
  }
  return 0;
}
function promptSidecarPath(root, name, defaultPath) {
  if (!process.stdin.isTTY)
    return defaultPath;
  if (name === DEFAULT_PEER) {
    console.log(`sidecar keeps its files in a directory inside this repo — "." makes this repo itself the sidecar.`);
  } else {
    console.log(`peer ${paint("brand", name)} keeps its files in a directory inside this repo.`);
  }
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const answer = promptLine(`sidecar path ${paint("quiet", `[${defaultPath}]`)}: `) || defaultPath;
    if (!isStandalonePath(answer))
      return answer;
    if (name !== DEFAULT_PEER) {
      console.log(`a peer cannot be the repo itself; only .sidecar can`);
      continue;
    }
    console.log(`standalone mode makes ${paint("repo", root)} itself the sidecar:`);
    console.log("  sidecar owns this repo's branches, commits every change, and syncs it to its own remote.");
    console.log("  your own commits still work; leave branch management to sidecar.");
    if (promptYesNoDefaultNo("use standalone mode?"))
      return ".";
  }
  console.log(`keeping the default (${defaultPath})`);
  return defaultPath;
}
function standaloneRemote(root) {
  const origin = git(root, ["remote", "get-url", "origin"], { check: false });
  const remote = origin.status === 0 ? origin.stdout.trim() : "";
  if (!remote) {
    throw new SidecarError("standalone mode syncs this repo to its own origin, but it has none; add one with `git remote add origin <url>`, or name a remote with `sidecar init <remote> --path .`");
  }
  validateRemote(remote);
  console.log(`standalone remote: ${paint("brand", remote)} ${paint("quiet", "(this repo's origin)")}`);
  return remote;
}
function promptRemote(root) {
  if (!process.stdin.isTTY) {
    throw new SidecarError("remote URL is required when no .sidecar config exists");
  }
  console.log("sidecar stores its files in a separate git repo that you own — any empty repo works.");
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const remote = promptLine(`sidecar remote URL ${paint("quiet", "(leave blank to create one with gh)")}: `);
    if (!remote)
      return createRemoteWithGh(root);
    try {
      validateRemote(remote);
      return remote;
    } catch (error) {
      console.log(error instanceof SidecarError ? `sidecar: ${error.message}` : String(error));
    }
  }
  throw new SidecarError("no valid remote URL provided");
}
function promptRedactionMode() {
  if (!process.stdin.isTTY)
    return DEFAULT_REDACTION_MODE;
  console.log("redaction rewrites sensitive values out of pushed content; your local files are never touched.");
  const describe = (mode, text) => `  ${mode.padEnd(11)}  ${text}${mode === DEFAULT_REDACTION_MODE ? ` ${paint("quiet", "(recommended)")}` : ""}`;
  console.log(describe("secrets+pii", "redact API keys, tokens, emails, and other PII"));
  console.log(describe("secrets", "redact API keys and tokens only"));
  console.log(describe("none", "push content verbatim"));
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const answer = promptLine(`redaction mode ${paint("quiet", `[${DEFAULT_REDACTION_MODE}]`)}: `).toLowerCase();
    if (!answer)
      return DEFAULT_REDACTION_MODE;
    if (REDACTION_MODES.includes(answer))
      return answer;
    console.log(`invalid redaction mode; expected one of ${REDACTION_MODES.join(", ")}`);
  }
  console.log(`keeping the default (${DEFAULT_REDACTION_MODE})`);
  return DEFAULT_REDACTION_MODE;
}
function createRemoteWithGh(root) {
  const gh = findExecutableOnPath(process.platform === "win32" ? "gh.exe" : "gh");
  if (!gh) {
    throw new SidecarError("gh not found on PATH; install the GitHub CLI (https://cli.github.com) or rerun with `sidecar init <remote>`");
  }
  const origin = git(root, ["remote", "get-url", "origin"], { check: false }).stdout.trim() || undefined;
  const parsedOrigin = origin ? parseGitHubRemote(origin) : undefined;
  const owner = parsedOrigin?.owner ?? ghLogin(gh);
  const baseName = parsedOrigin?.repo ?? path9.basename(root);
  const suggested = owner ? `${owner}/${baseName}-sidecar` : `${baseName}-sidecar`;
  const answer = promptLine(`repository to create ${paint("quiet", `[${suggested}]`)}: `) || suggested;
  const fullName = answer.includes("/") ? answer : owner ? `${owner}/${answer}` : undefined;
  if (!fullName) {
    throw new SidecarError("could not determine the repository owner; enter it as owner/name");
  }
  console.log(`running gh repo create ${fullName} --private`);
  const create = spawnSync4(gh, ["repo", "create", fullName, "--private"], { stdio: "inherit" });
  if (create.status !== 0) {
    throw new SidecarError("gh repo create failed; create the repo yourself and rerun `sidecar init <remote>`");
  }
  const ssh = origin ? origin.startsWith("git@") || origin.startsWith("ssh://") : ghGitProtocol(gh) === "ssh";
  return ssh ? `git@github.com:${fullName}.git` : `https://github.com/${fullName}.git`;
}
function parseGitHubRemote(url) {
  const match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ?? /^(?:https|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!match)
    return;
  return { owner: match[1], repo: match[2] };
}
function ghLogin(gh) {
  const result = spawnSync4(gh, ["api", "user", "-q", ".login"], { encoding: "utf8" });
  if (result.status !== 0)
    return;
  const login = result.stdout.trim();
  return login || undefined;
}
function ghGitProtocol(gh) {
  const result = spawnSync4(gh, ["config", "get", "git_protocol"], { encoding: "utf8" });
  if (result.status !== 0)
    return "https";
  return result.stdout.trim() || "https";
}
function promptOverwriteConfig(configPath, existingRemote, newRemote) {
  if (!process.stdin.isTTY) {
    throw new SidecarError(`${configPath} already exists (remote ${existingRemote}); delete it to reinitialize with ${newRemote}`);
  }
  console.log(`${configPath} already exists (remote ${existingRemote})`);
  const answer = promptLine(`overwrite it with the new settings? ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}
function ensureIgnoreEntry(ignorePath, sidecarPath) {
  ensureIgnoreLine(ignorePath, `/${sidecarPath.replace(/^\/+|\/+$/g, "")}/`);
}
function removeIgnoreEntry(ignorePath, sidecarPath) {
  removeIgnoreLine(ignorePath, `/${sidecarPath.replace(/^\/+|\/+$/g, "")}/`);
}
function ensureIgnoreLine(ignorePath, entry) {
  const lines = fs10.existsSync(ignorePath) ? fs10.readFileSync(ignorePath, "utf8").split(/\r?\n/) : [];
  if (lines.includes(entry))
    return;
  while (lines.length && lines[lines.length - 1] === "")
    lines.pop();
  lines.push(entry);
  fs10.mkdirSync(path9.dirname(ignorePath), { recursive: true });
  fs10.writeFileSync(ignorePath, `${lines.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
}
function removeIgnoreLine(ignorePath, entry) {
  if (!fs10.existsSync(ignorePath))
    return;
  const lines = fs10.readFileSync(ignorePath, "utf8").split(/\r?\n/);
  const kept = lines.filter((line) => line !== entry);
  if (kept.length === lines.length)
    return;
  if (kept.every((line) => !line.trim())) {
    fs10.rmSync(ignorePath);
  } else {
    fs10.writeFileSync(ignorePath, `${kept.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function hasZedInclusion(root, sidecarPath) {
  const settingsPath2 = path9.join(root, ".zed", "settings.json");
  if (!fs10.existsSync(settingsPath2))
    return false;
  try {
    const parsed = JSON.parse(fs10.readFileSync(settingsPath2, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return false;
    const inclusions = parsed.file_scan_inclusions;
    return Array.isArray(inclusions) && inclusions.includes(zedInclusionGlob(sidecarPath));
  } catch {
    return false;
  }
}
function zedInclusionGlob(sidecarPath) {
  return `${sidecarPath.replace(/^\/+|\/+$/g, "")}/**`;
}
function ensureZedInclusion(root, sidecarPath) {
  const glob = zedInclusionGlob(sidecarPath);
  const settingsPath2 = path9.join(root, ".zed", "settings.json");
  let settings = {};
  if (fs10.existsSync(settingsPath2)) {
    try {
      const parsed = JSON.parse(fs10.readFileSync(settingsPath2, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return false;
      settings = parsed;
    } catch {
      return false;
    }
  }
  const inclusions = Array.isArray(settings.file_scan_inclusions) ? settings.file_scan_inclusions : [".env*"];
  if (!inclusions.includes(glob)) {
    inclusions.push(glob);
    settings.file_scan_inclusions = inclusions;
    fs10.mkdirSync(path9.dirname(settingsPath2), { recursive: true });
    fs10.writeFileSync(settingsPath2, `${JSON.stringify(settings, null, 2)}
`, "utf8");
  }
  return true;
}
function removeZedInclusion(root, sidecarPath) {
  const settingsPath2 = path9.join(root, ".zed", "settings.json");
  if (!fs10.existsSync(settingsPath2))
    return;
  try {
    const settings = JSON.parse(fs10.readFileSync(settingsPath2, "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      return;
    const inclusions = settings.file_scan_inclusions;
    if (!Array.isArray(inclusions))
      return;
    const glob = zedInclusionGlob(sidecarPath);
    const remaining = inclusions.filter((entry) => entry !== glob);
    if (remaining.length === inclusions.length)
      return;
    if (remaining.length) {
      settings.file_scan_inclusions = remaining;
    } else {
      delete settings.file_scan_inclusions;
    }
    fs10.writeFileSync(settingsPath2, `${JSON.stringify(settings, null, 2)}
`, "utf8");
  } catch {
    console.error(`sidecar: warning: could not safely remove the Zed inclusion from ${settingsPath2}`);
  }
}
function ignoreEntryForSidecarPath(root, sidecarPath) {
  const resolvedRoot = path9.resolve(root);
  const resolvedSidecarPath = path9.resolve(root, sidecarPath);
  const relative = path9.relative(resolvedRoot, resolvedSidecarPath);
  if (!relative || relative.startsWith("..") || path9.isAbsolute(relative))
    return;
  return relative;
}
var init_cmd_init = __esm(() => {
  init_color();
  init_util();
  init_git();
  init_install();
  init_config();
  init_state();
  init_service();
  init_sync();
  init_ui();
  init_redaction();
  init_rules();
});

// src/cmd-refresh.ts
import fs11 from "node:fs";
import path10 from "node:path";
function worktreeHoldingBranch(repo, branch) {
  const result = git(repo, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0)
    return;
  let current;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree "))
      current = line.slice("worktree ".length).trim();
    else if (line === `branch refs/heads/${branch}`)
      return current;
  }
  return;
}
function checkoutIsOwnRepo(sidecarPath) {
  const top = git(sidecarPath, ["rev-parse", "--show-toplevel"], { check: false });
  if (top.status !== 0)
    return false;
  return realpathOr(top.stdout.trim()) === realpathOr(sidecarPath);
}
function unpushedCommits(sidecarPath) {
  if (!hasAnyCommit(sidecarPath))
    return 0;
  const counted = git(sidecarPath, ["rev-list", "--count", "HEAD", "--not", "--remotes=origin"], {
    check: false
  });
  return counted.status === 0 ? Number(counted.stdout.trim()) || 0 : 0;
}
function dependentWorktrees(sidecarPath) {
  try {
    if (!fs11.statSync(path10.join(sidecarPath, ".git")).isDirectory())
      return [];
  } catch {
    return [];
  }
  const result = git(sidecarPath, ["worktree", "list", "--porcelain"], { check: false });
  if (result.status !== 0)
    return [];
  const self = realpathOr(sidecarPath);
  return result.stdout.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length).trim()).filter((entry) => entry && realpathOr(entry) !== self);
}
function existingCheckoutId(sidecarPath) {
  const candidates = [];
  const reported = git(sidecarPath, ["rev-parse", "--git-dir"], { check: false });
  if (reported.status === 0)
    candidates.push(path10.resolve(sidecarPath, reported.stdout.trim()));
  candidates.push(path10.join(sidecarPath, ".git"));
  for (const candidate of candidates) {
    try {
      const id = slug(fs11.readFileSync(path10.join(candidate, "sidecar-id"), "utf8"));
      if (id)
        return id;
    } catch {}
  }
  return;
}
function refreshCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (isStandalone(config)) {
    throw new SidecarError("refusing to delete a standalone sidecar, which is the repo itself");
  }
  const relative = path10.relative(root, sidecarPath);
  if (!relative || relative.startsWith("..") || path10.isAbsolute(relative)) {
    throw new SidecarError(`refusing to delete ${sidecarPath}, which is not inside ${root}`);
  }
  const checkoutId = existingCheckoutId(sidecarPath);
  fs11.rmSync(sidecarPath, { recursive: true, force: true });
  const family = familySidecarCheckout(root, config);
  if (family) {
    git(family, ["worktree", "prune", "--expire", "now"], { check: false });
    fetch(family, true, false);
  }
  cloneOrUpdate(root, config, true, { checkoutId });
  logSidecarEvent("checkout-refresh", { root, sidecarPath, checkoutId: checkoutId ?? null });
}
function refreshStandaloneCheckout(root, config, resetInbox) {
  ensureCommitIdentity(root);
  ensureRedactionFilter(root, config.redaction, config);
  fetch(root, true, false);
  if (rulesMayRedact(config.rules, config.redaction)) {
    logSidecarEvent("checkout-refresh", { root, standalone: true, settled: false });
    return `left ${config.branch} and the inbox branch untouched: settling them means switching branches, which under redaction would replace local files with their redacted pushed contents`;
  }
  ensureMainBranch(root, config);
  const inbox = expandInbox(config, root);
  if (resetInbox && branchExists(root, inbox) && branchExists(root, config.branch)) {
    const tip = git(root, ["rev-parse", "--short", inbox]).stdout.trim();
    const discarded = `refs/sidecar-discarded/${inbox}/${utcTimestamp()}-${tip}`;
    git(root, ["update-ref", discarded, inbox], { check: false });
    git(root, ["branch", "-f", inbox, config.branch]);
    console.log(`reset ${paint("brand", inbox)} to ${config.branch}; old tip kept at ${paint("brand", discarded)}`);
  }
  ensureInboxBranch(root, config, inbox);
  logSidecarEvent("checkout-refresh", { root, standalone: true, settled: true, resetInbox });
  return;
}
function cmdRefresh(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--force", "--yes", "-y"]),
    value: new Set(["--peer"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar refresh [--force] [--yes] [--peer name]");
  const selection = selectedPeer(parsed);
  const peers = loadPeers(selection);
  if (!selection && peers.length > 1) {
    const names = peers.map((peer) => peer.name).join(", ");
    throw new SidecarError(`this repo has several sidecar peers (${names}); name the one to refresh with --peer`);
  }
  announcePeer(peers[0], peers);
  refreshPeer(peers[0], parsed);
  return 0;
}
function refreshPeer({ root, config, name }, parsed) {
  const force = parsed.flags.has("--force");
  const standalone = isStandalone(config);
  const sidecarPath = requireSidecarCheckout(root, config);
  const readable = checkoutIsOwnRepo(sidecarPath);
  if (!readable && standalone) {
    throw new SidecarError(`${sidecarPath} is not a readable Git repository, and in standalone mode that repo is your own — sidecar will not rebuild it`);
  }
  if (!readable && !force) {
    throw new SidecarError(`${sidecarPath} is not a readable Git repository, so what it still holds cannot be checked; \`sidecar refresh --force\` replaces it anyway`);
  }
  let inbox;
  if (readable) {
    inbox = expandInbox(config, sidecarPath);
    fetch(sidecarPath, true, false);
    const unpushed = unpushedCommits(sidecarPath);
    const dirtyFiles = git(sidecarPath, ["status", "--porcelain"], { check: false }).stdout.split(`
`).filter(Boolean).length;
    if ((unpushed || dirtyFiles) && !force) {
      const held = [
        unpushed ? `${unpushed} commit(s) the remote has not seen` : "",
        dirtyFiles ? `${dirtyFiles} uncommitted file(s)` : ""
      ].filter(Boolean);
      throw new SidecarError(`this checkout still holds ${held.join(" and ")}; run \`sidecar sync\` to push them, then refresh — or \`sidecar refresh --force\` to discard them`);
    }
  }
  if (standalone) {
    console.log(`${paint("repo", root)} is its own sidecar, so refresh does not rebuild it.`);
    console.log(!rulesMayRedact(config.rules, config.redaction) ? `it rewires the redaction filter and settles ${config.branch} onto ${paint("brand", `origin/${config.branch}`)}${force ? `, then resets the inbox branch to ${config.branch}` : ""}.` : `it rewires the redaction filter and, because redaction is on, leaves your branches where they are.`);
  } else {
    const dependents = dependentWorktrees(sidecarPath);
    if (dependents.length && !force) {
      throw new SidecarError(`${dependents.length} other checkout(s) share this one's Git store (${dependents.join(", ")}); refresh those working copies instead, or \`sidecar refresh --force\` to replace this one and leave them to be refreshed too`);
    }
    const family = familySidecarCheckout(root, config);
    const holder = inbox && family ? worktreeHoldingBranch(family, inbox) : undefined;
    if (holder && realpathOr(holder) !== realpathOr(sidecarPath)) {
      throw new SidecarError(`${inbox} is already checked out at ${holder}; give this working copy its own inbox (a {random} in the .sidecar inbox template) before refreshing`);
    }
    console.log(`refresh deletes ${paint("brand", sidecarPath)} and clones it again from ${paint("brand", config.remote)}, ${paint("attn", "discarding anything not pushed")}.`);
    if (family)
      console.log(`the rebuilt checkout will share this repo family's Git store.`);
  }
  const confirmed = parsed.flags.has("--yes") || parsed.flags.has("-y") || promptYesNoDefaultNo("continue?");
  if (!confirmed) {
    console.log("nothing changed");
    return;
  }
  let declined;
  withSyncLock(root, name, "throw", () => {
    if (readable && !force && isDirty(sidecarPath)) {
      throw new SidecarError("the sidecar checkout changed while waiting for confirmation; rerun refresh");
    }
    if (standalone)
      declined = refreshStandaloneCheckout(root, config, force);
    else
      refreshCheckout(root, config);
  });
  registerCurrentInstance(root, config, { event: "refresh" });
  console.log(`refreshed sidecar at ${paint("brand", sidecarPath)}`);
  if (declined)
    console.error(`sidecar: ${declined}`);
}
var init_cmd_refresh = __esm(() => {
  init_color();
  init_util();
  init_git();
  init_config();
  init_state();
  init_sync();
  init_ui();
  init_rules();
});

// src/cmd-status.ts
import fs12 from "node:fs";
function statusLine(label, value, role) {
  labelLine(STATUS_LABEL_WIDTH, label, value, role);
}
function cmdStatus(args) {
  const parsed = parseOptions(args, { boolean: new Set(["--json"]), value: new Set(["--peer"]) });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar status [--json] [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify(peers.map(statusPayload), null, 2));
    return 0;
  }
  for (const peer of peers) {
    announcePeer(peer, peers);
    printPeerStatus(peer);
  }
  return 0;
}
function printPeerStatus({ root, config, configPath }) {
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
    statusLine("checkout", "missing — run `sidecar init`", "bad");
    printDaemonLine();
    printLastSyncLine(configPath);
    return;
  }
  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  statusLine("checkout", "present");
  if (!branch)
    statusLine("branch", "(detached)", "attn");
  else if (branch === inbox)
    statusLine("branch", branch);
  else
    statusLine("branch", `${branch} — not the inbox branch; sync will switch back`, "attn");
  statusLine("dirty", dirty ? "yes" : "no", dirty ? "attn" : "quiet");
  if (checkoutIsUnlinkedFromFamily(root, config, sidecarPath)) {
    statusLine("family", "independent clone — syncs via the remote; `sidecar refresh` links it", "attn");
  }
  printDaemonLine();
  printLastSyncLine(configPath);
  const pending = pendingStatusInboxBranches(sidecarPath, config);
  if (pending.length) {
    statusLine("pending inbox", String(pending.length), "attn");
    for (const branchName of pending)
      console.log(`  ${paint("brand", branchName)}`);
  } else {
    statusLine("pending inbox", "none", "quiet");
  }
}
function statusPayload({ root, name, config, configPath }) {
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
    pendingInbox: checkoutPresent ? pendingStatusInboxBranches(sidecarPath, config) : undefined
  };
}
function pendingStatusInboxBranches(sidecarPath, config) {
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch) ? `origin/${config.branch}` : branchExists(sidecarPath, config.branch) ? config.branch : "HEAD";
  return pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base));
}
function daemonHealth() {
  if (!shouldUseGlobalRegistry()) {
    if (!findGlobalSidecarExecutable()) {
      return { text: `no global install — nothing syncs; \`npm install -g ${PACKAGE_SPEC}\``, role: "bad" };
    }
    return { text: "owned by the global install", role: "quiet" };
  }
  const service = daemonServiceStatus();
  if (!service.available)
    return { text: service.message ?? "unavailable", role: "quiet" };
  if (service.running)
    return { text: "running", role: "ok" };
  if (!readSettings().daemonEnabled)
    return { text: "disabled", role: "attn" };
  if (!service.installed)
    return { text: "not installed — run `sidecar daemon enable`", role: "bad" };
  return { text: "stopped", role: "bad" };
}
function printDaemonLine() {
  const health = daemonHealth();
  statusLine("daemon", health.text, health.role);
}
function printLastSyncLine(configPath) {
  const lastSyncAt = readInstances().find((instance) => instance.configPath === configPath)?.lastSyncAt;
  if (!lastSyncAt) {
    statusLine("last sync", "never", "quiet");
    return;
  }
  statusLine("last sync", formatTimestampPair(lastSyncAt));
}
function cmdHealth(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json", "--no-fetch"]),
    value: new Set(["--peer"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar health [--json] [--no-fetch] [--peer name]");
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
function fleetHealthEntries({ root, config }, refresh) {
  const sidecarPath = requireSidecarCheckout(root, config);
  if (refresh)
    fetch(sidecarPath, true, false);
  return readFleetHealth(sidecarPath);
}
function printPeerHealth(peer, refresh) {
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
  const line = (label, value, role) => labelLine(width, label, value, role, "  ");
  for (const { record, state, self } of entries) {
    console.log("");
    console.log(`${paint("repo", record.machine)}${self ? paint("quiet", "  (this checkout)") : ""}`);
    const status = healthStatusLine(state, record);
    line("status", status.text, status.role);
    if (record.message)
      line("detail", record.message);
    if (record.consecutiveFailures > 1)
      line("failures", `${record.consecutiveFailures} in a row`, "attn");
    if (record.root)
      line("checkout", record.root);
    if (record.peer)
      line("peer", record.peer);
    if (record.inbox)
      line("inbox", record.inbox);
    line("reported", formatTimestampPair(record.updatedAt));
    if (record.lastSuccessAt && record.lastSuccessAt !== record.updatedAt) {
      line("last ok", formatTimestampPair(record.lastSuccessAt));
    } else if (!record.lastSuccessAt) {
      line("last ok", "never", "attn");
    }
    if (record.version)
      line("version", record.version, "quiet");
  }
}
function healthStatusLine(state, record) {
  if (state === "failed") {
    return { text: record.stage ? `failed at ${record.stage}` : "failed", role: "bad" };
  }
  if (state === "stale") {
    const age = formatRelativeTime(record.updatedAt) ?? record.updatedAt;
    return { text: `stale — last reported ${age}`, role: "attn" };
  }
  return { text: "ok", role: "ok" };
}
function cmdInstances(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar instances [--json]");
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
  const width = "checkout:".length;
  const line = (label, value, role) => labelLine(width, label, value, role, "  ");
  for (const status of statuses) {
    console.log("");
    console.log(paint("repo", status.root));
    const peer = instancePeer(status);
    if (peer !== DEFAULT_PEER)
      line("peer", peer, "brand");
    line("sidecar", status.sidecarPath, "brand");
    line("remote", status.remote, "brand");
    line("branch", status.currentBranch || "(unknown)");
    line("config", status.config, status.config === "ok" ? undefined : "bad");
    line("checkout", status.checkout, status.checkout === "present" ? undefined : "bad");
    line("dirty", status.dirty, status.dirty === "yes" ? "attn" : "quiet");
    line("updated", formatTimestampPair(status.updatedAt));
    if (status.lastSyncAt)
      line("synced", formatTimestampPair(status.lastSyncAt));
  }
  return 0;
}
function cmdTail(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set(["-n", "--lines"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar tail [-f|--follow] [-n|--lines count]");
  const rawLines = getValue(parsed, "--lines", getValue(parsed, "-n", "50"));
  const lines = Number.parseInt(rawLines, 10);
  if (!Number.isFinite(lines) || lines < 1 || String(lines) !== rawLines) {
    throw new SidecarError("--lines requires a positive integer");
  }
  const filePath = sidecarLogPath();
  if (!fs12.existsSync(filePath)) {
    if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
      followLog(filePath, 0);
      return 0;
    }
    return 0;
  }
  const stat = fs12.statSync(filePath);
  if (stat.size > 0) {
    process.stdout.write(lastLines(fs12.readFileSync(filePath, "utf8"), lines));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}
function lastLines(content, count) {
  const trimmed = content.endsWith(`
`) ? content.slice(0, -1) : content;
  if (!trimmed)
    return "";
  return `${trimmed.split(`
`).slice(-count).join(`
`)}
`;
}
function followLog(filePath, startOffset) {
  let offset = startOffset;
  while (true) {
    sleep(1000);
    let stat;
    try {
      stat = fs12.statSync(filePath);
    } catch {
      offset = 0;
      continue;
    }
    if (stat.size < offset)
      offset = 0;
    if (stat.size <= offset)
      continue;
    const fd = fs12.openSync(filePath, "r");
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs12.readSync(fd, buffer, 0, length, offset);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
        offset += bytesRead;
      }
    } finally {
      fs12.closeSync(fd);
    }
  }
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
var STATUS_LABEL_WIDTH;
var init_cmd_status = __esm(() => {
  init_color();
  init_util();
  init_git();
  init_install();
  init_config();
  init_state();
  init_service();
  init_sync();
  init_ui();
  init_health();
  STATUS_LABEL_WIDTH = "pending inbox:".length;
});

// ../../node_modules/.bun/ignore@7.0.8/node_modules/ignore/index.js
var require_ignore = __commonJS((exports, module) => {
  function makeArray(subject) {
    return Array.isArray(subject) ? subject : [subject];
  }
  var UNDEFINED = undefined;
  var EMPTY = "";
  var SPACE = " ";
  var ESCAPE = "\\";
  var REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
  var REGEX_TEST_BLANK_LINE = /^ +$/;
  var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
  var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
  var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
  var REGEX_SPLITALL_CRLF = /\r?\n/g;
  var DOUBLE_SLASH = "//";
  var SLASH_CODE = 47;
  var DOT_CODE = 46;
  var SLASH = "/";
  var TMP_KEY_IGNORE = "node-ignore";
  if (typeof Symbol !== "undefined") {
    TMP_KEY_IGNORE = Symbol.for("node-ignore");
  }
  var KEY_IGNORE = TMP_KEY_IGNORE;
  var define = (object, key, value) => {
    Object.defineProperty(object, key, { value });
    return value;
  };
  var RETURN_FALSE = () => false;
  var cleanRangeBackSlash = (slashes) => {
    const { length } = slashes;
    return slashes.slice(0, length - length % 2);
  };
  var POSIX_CLASSES = {
    alnum: "0-9A-Za-z",
    alpha: "A-Za-z",
    blank: " \\t",
    cntrl: "\\x00-\\x1f\\x7f",
    digit: "0-9",
    graph: "!-.0-~",
    lower: "a-z",
    print: " -.0-~",
    punct: "!-.:-@\\[-`{-~",
    space: " \\t\\n\\r",
    upper: "A-Z",
    xdigit: "0-9A-Fa-f"
  };
  var CLASS_MEMBERS_TO_ESCAPE = "\\]^-[";
  var escapeMember = (char) => CLASS_MEMBERS_TO_ESCAPE.indexOf(char) < 0 ? char : ESCAPE + char;
  var NON_SLASH = "(?!\\/)";
  var classSource = (negated, body) => {
    if (negated) {
      return `[^\\/${body}]`;
    }
    const source = `[${body}]`;
    return new RegExp(source).test("/") ? NON_SLASH + source : source;
  };
  var scanBracket = (pattern, start) => {
    const { length } = pattern;
    let index = start + 1;
    let negated = EMPTY;
    const lead = pattern[index];
    if (lead === "!" || lead === "^") {
      negated = "^";
      index++;
    }
    let body = EMPTY;
    let prev = EMPTY;
    for (;; ) {
      const char = pattern[index];
      if (char === UNDEFINED) {
        return null;
      }
      if (char === ESCAPE) {
        const escaped = pattern[index + 1];
        if (escaped === UNDEFINED) {
          return null;
        }
        body += escapeMember(escaped);
        prev = escaped;
        index++;
      } else if (char === "-" && prev && index + 1 < length && pattern[index + 1] !== "]") {
        index++;
        let to = pattern[index];
        if (to === ESCAPE) {
          to = pattern[index += 1];
        }
        if (prev <= to) {
          body += `-${escapeMember(to)}`;
        }
        prev = EMPTY;
      } else if (char === "[" && pattern[index + 1] === ":") {
        const nameStart = index + 2;
        let end = nameStart;
        while (end < length && pattern[end] !== "]") {
          end++;
        }
        if (end === length) {
          return null;
        }
        if (end > nameStart && pattern[end - 1] === ":") {
          const expanded = POSIX_CLASSES[pattern.slice(nameStart, end - 1)];
          if (expanded === UNDEFINED) {
            return null;
          }
          body += expanded;
          prev = EMPTY;
          index = end;
        } else {
          body += escapeMember("[");
          prev = "[";
          index = nameStart - 2;
        }
      } else {
        body += escapeMember(char);
        prev = char;
      }
      index++;
      if (pattern[index] === "]") {
        return {
          end: index,
          source: classSource(negated, body)
        };
      }
    }
  };
  var NEVER_MATCH = "[]";
  var PLACEHOLDER = "\x00";
  var REGEX_RESTORE_PLACEHOLDER = new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g");
  var TRAILING_WILDCARD = "";
  var extractBrackets = (pattern) => {
    const sources = [];
    const hold = (source) => `${PLACEHOLDER}${sources.push(source) - 1}${PLACEHOLDER}`;
    const { length } = pattern;
    let out = EMPTY;
    let index = 0;
    while (index < length) {
      const char = pattern[index];
      if (char === ESCAPE) {
        const escaped = pattern[index + 1];
        if (escaped === "*" || escaped === "[" || escaped === SPACE || escaped === ESCAPE) {
          out += pattern.slice(index, index + 2);
        } else {
          out += hold(REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped);
        }
        index += 2;
      } else if (char === PLACEHOLDER) {
        out += hold(`[${PLACEHOLDER}]`);
        index++;
      } else if (char === "[") {
        const scanned = scanBracket(pattern, index);
        if (scanned === null) {
          out += hold(NEVER_MATCH);
          index = length;
        } else {
          out += hold(scanned.source);
          index = scanned.end + 1;
        }
      } else {
        out += char;
        index++;
      }
    }
    return {
      source: out,
      sources
    };
  };
  var DIRECT = null;
  var REGEX_INNER_SLASH = /\/(?!$)/;
  var REPLACERS = [
    [
      /^\uFEFF/,
      () => EMPTY,
      "\uFEFF"
    ],
    [
      /[\r\n]+$/,
      () => EMPTY
    ],
    [
      /((?:\\\\)*?)(\\? +)$/,
      (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
    ],
    [
      /(\\+?) /g,
      (_, m1) => {
        const { length } = m1;
        return m1.slice(0, length - length % 2) + SPACE;
      }
    ],
    [
      /[\\$.|*+(){^]/g,
      (match) => `\\${match}`
    ],
    [
      /(?!\\)\?/g,
      () => "[^/]",
      "?"
    ],
    [
      /^\//,
      () => "^",
      SLASH
    ],
    [
      /\//g,
      () => "\\/",
      SLASH
    ],
    [
      /^\^*(?:\\\*\\\*\\\/)+/,
      () => "^(?:.*\\/)?",
      "*"
    ],
    [
      DIRECT,
      (source, pattern) => {
        if (!source || source[0] === "^") {
          return source;
        }
        const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
        return anchor + source;
      }
    ],
    [
      /\\\/\\\*\\\*(?=\\\/|$)/g,
      (_, index, str) => index + 6 < str.length ? str.slice(index + 6) === "\\/" ? "(?:\\/[^\\/]+)+" : "(?:\\/[^\\/]+)*" : "\\/.+",
      "*"
    ],
    [
      /(^|[^\\]+)(\\\*)+(?=.+)/g,
      (_, p1, p2) => {
        const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
        return p1 + unescaped;
      },
      "*"
    ],
    [
      /(^|[^\\])((?:\\\\)*)\\\*$/,
      (match, p1, p2) => p2.length / 2 % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match,
      "*"
    ],
    [
      /\\\\\\(?=[$.|*+(){^])/g,
      () => ESCAPE,
      ESCAPE + ESCAPE
    ],
    [
      /\\\\/g,
      () => ESCAPE,
      ESCAPE + ESCAPE
    ],
    [
      /\\\[([^\]/]*?)(\\*)($|\])/g,
      (match, range, endEscape, close) => `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`,
      "["
    ],
    [
      DIRECT,
      (source) => {
        const last = source[source.length - 1];
        if (!last || last === TRAILING_WILDCARD) {
          return source;
        }
        return last === SLASH ? `${source}$` : `${source}(?=$|\\/$)`;
      }
    ]
  ];
  var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
  var MODE_IGNORE = "regex";
  var MODE_CHECK_IGNORE = "checkRegex";
  var UNDERSCORE = "_";
  var TRAILING_WILD_CARD_REPLACERS = {
    [MODE_IGNORE](_, p1) {
      const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
      return `${prefix}(?=$|\\/$)`;
    },
    [MODE_CHECK_IGNORE](_, p1) {
      const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
      return `${prefix}(?=$|\\/$)`;
    }
  };
  var WILDCARD = "[^\\/]*";
  var pinWildcards = (source) => {
    if (source.indexOf(WILDCARD) < 0) {
      return source;
    }
    const tokens = [];
    const { length } = source;
    let index = 0;
    while (index < length) {
      const char = source[index];
      if (source.startsWith(WILDCARD, index)) {
        tokens.push({ wildcard: true });
        index += WILDCARD.length;
      } else if (char === "[") {
        let end = index + 1;
        if (source[end] === "^") {
          end++;
        }
        if (source[end] === "]") {
          end++;
        }
        while (end < length && source[end] !== "]") {
          end += source[end] === ESCAPE ? 2 : 1;
        }
        end++;
        tokens.push({ single: source.slice(index, end) });
        index = end;
      } else if (char === ESCAPE) {
        tokens.push({ single: source.slice(index, index + 2) });
        index += 2;
      } else if (char === "(") {
        let depth = 0;
        let end = index;
        do {
          if (source[end] === ESCAPE) {
            end++;
          } else if (source[end] === "(") {
            depth++;
          } else if (source[end] === ")") {
            depth--;
          }
          end++;
        } while (end < length && depth > 0);
        if ("*+?".indexOf(source[end]) >= 0) {
          end++;
        }
        tokens.push({ boundary: source.slice(index, end) });
        index = end;
      } else if (char === "^" || char === "$") {
        tokens.push({ boundary: char });
        index++;
      } else {
        tokens.push({ single: char });
        index++;
      }
    }
    let out = EMPTY;
    let run = [];
    const flush = () => {
      let lastWildcard;
      run.forEach((token, at) => {
        if (token.wildcard) {
          lastWildcard = at;
        }
      });
      run.forEach((token, at) => {
        if (!token.wildcard) {
          out += token.single;
          return;
        }
        out += at === lastWildcard ? WILDCARD : `(?:(?!${run[at + 1].single})[^\\/])*`;
      });
      run = [];
    };
    tokens.forEach((token) => {
      if (token.boundary === undefined) {
        run.push(token);
        return;
      }
      flush();
      out += token.boundary;
    });
    flush();
    return out;
  };
  var makeRegexPrefix = (pattern) => {
    const { source, sources } = extractBrackets(pattern);
    const replaced = REPLACERS.reduce((prev, [matcher, replacer, required]) => {
      if (matcher === DIRECT) {
        return replacer(prev, pattern);
      }
      if (required !== UNDEFINED && prev.indexOf(required) < 0) {
        return prev;
      }
      return matcher.test(prev) ? prev.replace(matcher, replacer.bind(pattern)) : prev;
    }, source);
    return sources.length ? replaced.replace(REGEX_RESTORE_PLACEHOLDER, (match, index) => sources[index]) : replaced;
  };
  var matchesBasename = (body) => {
    const index = body.indexOf(SLASH);
    return index < 0 || index === body.length - 1;
  };
  var basenameOf = (path11) => {
    const end = path11.length - 1;
    const index = path11.lastIndexOf(SLASH, path11[end] === SLASH ? end - 1 : end);
    return index < 0 ? path11 : path11.slice(index + 1);
  };
  var parentOf = (path11) => {
    if (path11.charCodeAt(0) === SLASH_CODE || path11.indexOf(DOUBLE_SLASH) >= 0) {
      const slices = path11.split(SLASH).filter(Boolean);
      slices.pop();
      return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
    }
    const end = path11.length - 1;
    const cut = path11.lastIndexOf(SLASH, path11.charCodeAt(end) === SLASH_CODE ? end - 1 : end);
    return cut < 0 ? EMPTY : path11.slice(0, cut + 1);
  };
  var isString = (subject) => typeof subject === "string";
  var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
  var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);

  class IgnoreRule {
    constructor(pattern, mark, body, ignoreCase, negative, prefix) {
      this.pattern = pattern;
      this.mark = mark;
      this.negative = negative;
      define(this, "body", body);
      define(this, "ignoreCase", ignoreCase);
      define(this, "regexPrefix", prefix);
    }
    get _basenameOnly() {
      return define(this, "_basenameOnly", matchesBasename(this.body));
    }
    get regex() {
      const key = UNDERSCORE + MODE_IGNORE;
      if (this[key]) {
        return this[key];
      }
      return this._make(MODE_IGNORE, key);
    }
    get checkRegex() {
      const key = UNDERSCORE + MODE_CHECK_IGNORE;
      if (this[key]) {
        return this[key];
      }
      return this._make(MODE_CHECK_IGNORE, key);
    }
    _make(mode, key) {
      const str = pinWildcards(this.regexPrefix.replace(REGEX_REPLACE_TRAILING_WILDCARD, TRAILING_WILD_CARD_REPLACERS[mode]));
      const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
      return define(this, key, regex);
    }
  }
  var createRule = ({
    pattern,
    mark
  }, ignoreCase) => {
    let negative = false;
    let body = pattern;
    if (body.indexOf("!") === 0) {
      negative = true;
      body = body.substr(1);
    }
    body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
    const regexPrefix = makeRegexPrefix(body);
    return new IgnoreRule(pattern, mark, body, ignoreCase, negative, regexPrefix);
  };

  class RuleManager {
    constructor(ignoreCase) {
      this._ignoreCase = ignoreCase;
      this._rules = [];
      this._basenameCount = 0;
    }
    _add(pattern) {
      if (pattern && pattern[KEY_IGNORE]) {
        this._rules = this._rules.concat(pattern._rules._rules);
        this._basenameCount += pattern._rules._basenameCount;
        this._added = true;
        return;
      }
      if (isString(pattern)) {
        pattern = {
          pattern
        };
      }
      if (checkPattern(pattern.pattern)) {
        const rule = createRule(pattern, this._ignoreCase);
        this._added = true;
        this._rules.push(rule);
        if (matchesBasename(rule.body)) {
          this._basenameCount++;
        }
      }
    }
    add(pattern) {
      this._added = false;
      makeArray(isString(pattern) ? splitPattern(pattern) : pattern).forEach(this._add, this);
      return this._added;
    }
    test(path11, checkUnignored, mode) {
      let ignored = false;
      let unignored = false;
      let matchedRule;
      const rules = this._rules;
      const { length } = rules;
      const shortcut = this._basenameCount * 2 >= length;
      const basename = shortcut ? basenameOf(path11) : path11;
      for (let index = 0;index < length; index++) {
        const rule = rules[index];
        const { negative } = rule;
        const skip = unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored;
        if (!skip && rule[mode].test(shortcut && rule._basenameOnly ? basename : path11)) {
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        }
      }
      const ret = {
        ignored,
        unignored
      };
      if (matchedRule) {
        ret.rule = matchedRule;
      }
      return ret;
    }
  }
  var throwError = (message, Ctor) => {
    throw new Ctor(message);
  };
  var checkPath = (path11, originalPath, doThrow) => {
    if (!isString(path11)) {
      return doThrow(`path must be a string, but got \`${originalPath}\``, TypeError);
    }
    if (!path11) {
      return doThrow(`path must not be empty`, TypeError);
    }
    if (checkPath.isNotRelative(path11)) {
      const r = "`path.relative()`d";
      return doThrow(`path should be a ${r} string, but got "${originalPath}"`, RangeError);
    }
    return true;
  };
  var isNotRelative = (path11) => {
    const first = path11.charCodeAt(0);
    if (first === SLASH_CODE) {
      return true;
    }
    if (first !== DOT_CODE) {
      return false;
    }
    if (path11.length === 1) {
      return true;
    }
    const second = path11.charCodeAt(1);
    if (second === SLASH_CODE) {
      return true;
    }
    if (second !== DOT_CODE) {
      return false;
    }
    return path11.length === 2 || path11.charCodeAt(2) === SLASH_CODE;
  };
  checkPath.isNotRelative = isNotRelative;
  checkPath.convert = (p) => p;

  class Ignore {
    constructor({
      ignorecase = true,
      ignoreCase = ignorecase,
      allowRelativePaths = false
    } = {}) {
      define(this, KEY_IGNORE, true);
      this._rules = new RuleManager(ignoreCase);
      this._strictPathCheck = !allowRelativePaths;
      this._initCache();
    }
    _initCache() {
      this._ignoreCache = Object.create(null);
      this._testCache = Object.create(null);
    }
    add(pattern) {
      if (this._rules.add(pattern)) {
        this._initCache();
      }
      return this;
    }
    addPattern(pattern) {
      return this.add(pattern);
    }
    _test(originalPath, cache, checkUnignored) {
      const path11 = originalPath && checkPath.convert(originalPath);
      checkPath(path11, originalPath, this._strictPathCheck ? throwError : RETURN_FALSE);
      return this._t(path11, cache, checkUnignored);
    }
    checkIgnore(path11) {
      if (path11.charCodeAt(path11.length - 1) !== SLASH_CODE) {
        return this.test(path11);
      }
      const parentPath = parentOf(path11);
      if (parentPath) {
        const parent = this._t(parentPath, this._testCache, true);
        if (parent.ignored) {
          return parent;
        }
      }
      return this._rules.test(path11, false, MODE_CHECK_IGNORE);
    }
    _t(path11, cache, checkUnignored) {
      if (path11 in cache) {
        return cache[path11];
      }
      const parentPath = parentOf(path11);
      const parent = parentPath ? this._t(parentPath, cache, checkUnignored) : UNDEFINED;
      return cache[path11] = parent && parent.ignored ? parent : this._rules.test(path11, checkUnignored, MODE_IGNORE);
    }
    ignores(path11) {
      return this._test(path11, this._ignoreCache, false).ignored;
    }
    createFilter() {
      return (path11) => !this.ignores(path11);
    }
    filter(paths) {
      return makeArray(paths).filter(this.createFilter());
    }
    test(path11) {
      return this._test(path11, this._testCache, true);
    }
  }
  var factory = (options) => new Ignore(options);
  var isPathValid = (path11) => checkPath(path11 && checkPath.convert(path11), path11, RETURN_FALSE);
  var setupWindows = () => {
    const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
    checkPath.convert = makePosix;
    const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
    checkPath.isNotRelative = (path11) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path11) || isNotRelative(path11);
  };
  if (typeof process !== "undefined" && process.platform === "win32") {
    setupWindows();
  }
  module.exports = factory;
  factory.default = factory;
  module.exports.isPathValid = isPathValid;
  define(module.exports, Symbol.for("setupWindows"), setupWindows);
});

// src/daemon.ts
var exports_daemon = {};
__export(exports_daemon, {
  watchIgnoreMatcher: () => watchIgnoreMatcher,
  selectWatchTargets: () => selectWatchTargets,
  scheduleFor: () => scheduleFor,
  runDaemonLoop: () => runDaemonLoop,
  refreshWatchers: () => refreshWatchers,
  compileGitignoreMatcher: () => compileGitignoreMatcher,
  checkAndInstallUpdate: () => checkAndInstallUpdate,
  WATCH_LIMIT: () => WATCH_LIMIT
});
import fs13 from "node:fs";
import path11 from "node:path";
import { spawn as spawn2 } from "node:child_process";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function peerRoot(key) {
  return path11.dirname(key);
}
function peerName(key) {
  return peerNameOf(path11.basename(key)) ?? DEFAULT_PEER;
}
function peerFields(key) {
  const peer = peerName(key);
  return peer === DEFAULT_PEER ? { root: peerRoot(key) } : { root: peerRoot(key), peer };
}
function scheduleFor(configPath, defaults) {
  try {
    const config = readConfig(configPath);
    return {
      debounceSeconds: config.debounce ?? defaults.debounceSeconds,
      intervalSeconds: Math.max(config.interval ?? defaults.intervalSeconds, defaults.intervalSeconds)
    };
  } catch {
    return { debounceSeconds: defaults.debounceSeconds, intervalSeconds: defaults.intervalSeconds };
  }
}
async function runDaemonLoop(options) {
  const state = {
    options,
    syncing: new Set,
    syncingFamilies: new Set,
    lastRemoteSyncAt: new Map,
    remoteTimers: new Map,
    pendingTimers: new Map,
    trailingPending: new Set,
    failures: new Map,
    skipUntilCycle: new Map,
    misses: new Map,
    watchers: new Map,
    cycleCount: 0,
    lastWatchCount: -1,
    refreshing: false,
    refreshPending: false,
    staleNotified: false
  };
  console.log(`sidecar daemon polling every ${options.intervalSeconds}s`);
  logSidecarEvent("daemon-start", {
    intervalSeconds: options.intervalSeconds,
    debounceSeconds: options.debounceSeconds,
    once: options.once,
    pid: process.pid
  });
  if (options.once) {
    await runCycle(state);
    return 0;
  }
  await acquireDaemonPid();
  installShutdownHandlers();
  await watchRegistry(state);
  const bootVersion = packageVersion();
  while (true) {
    maybeAdoptNewerInstall(state, bootVersion);
    await runCycle(state);
    ensureDaemonServiceFile();
    await refreshWatchers(state);
    await maybeAutoUpdate();
    await delay(options.intervalSeconds * 1000);
  }
}
function maybeAdoptNewerInstall(state, bootVersion) {
  const diskVersion = packageVersion();
  if (diskVersion !== bootVersion) {
    logSidecarEvent("daemon-stale", { running: bootVersion, installed: diskVersion, reason: "in-place-update" });
    restartAfterUpdate();
    return;
  }
  const onPath = findGlobalSidecarExecutable();
  if (!onPath)
    return;
  if (realpathOr2(onPath) === realpathOr2(currentCliPath()))
    return;
  const pathVersion = globalSidecarVersion(onPath);
  if (!pathVersion || pathVersion === diskVersion)
    return;
  if (process.stdout.isTTY) {
    if (!state.staleNotified) {
      state.staleNotified = true;
      console.log(`sidecar v${pathVersion} is installed at ${onPath}; run \`sidecar daemon restart\` to switch to it`);
    }
    return;
  }
  logSidecarEvent("daemon-stale", {
    running: diskVersion,
    installed: pathVersion,
    executable: onPath,
    reason: "new-install"
  });
  const child = spawn2(onPath, ["daemon", "restart"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV2]: "1", [GLOBAL_EXEC_ENV2]: "1" }
  });
  child.unref();
}
async function runCycle(state) {
  const settings = readSettings();
  if (!settings.daemonEnabled) {
    logSidecarEvent("daemon-skip", { reason: "daemon-disabled" });
    return;
  }
  state.cycleCount += 1;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const instance of readInstances()) {
    const key = instance.configPath;
    if (!fs13.existsSync(instance.configPath)) {
      const misses = (state.misses.get(key) ?? 0) + 1;
      state.misses.set(key, misses);
      if (misses >= PRUNE_AFTER_MISSES) {
        pruneInstance(key);
        state.misses.delete(key);
      } else {
        logSidecarEvent("daemon-skip", { ...peerFields(key), reason: "config-missing", misses });
      }
      skipped += 1;
      continue;
    }
    state.misses.delete(key);
    if (state.cycleCount < (state.skipUntilCycle.get(key) ?? 0)) {
      skipped += 1;
      continue;
    }
    const last = state.lastRemoteSyncAt.get(key);
    const slackMs = (scheduleFor(key, state.options).intervalSeconds - state.options.intervalSeconds) * 1000;
    if (last !== undefined && slackMs > 0 && Date.now() - last < slackMs) {
      skipped += 1;
      continue;
    }
    if (await syncInstance(state, key, "cycle")) {
      synced += 1;
    } else {
      failed += 1;
    }
  }
  logSidecarEvent("daemon-cycle", { synced, failed, skipped });
}
function pruneInstance(key) {
  unregisterInstance(key);
  logSidecarEvent("daemon-prune", { ...peerFields(key), reason: "config-missing" });
}
async function syncInstance(state, key, trigger, options = {}) {
  if (state.syncing.has(key))
    return false;
  const root = peerRoot(key);
  const peer = peerName(key);
  const family = `${realpathOr2(familyPrimaryRoot(root) ?? root)}\x00${peer}`;
  if (state.syncingFamilies.has(family)) {
    logSidecarEvent("daemon-defer", { ...peerFields(key), trigger, reason: "family-busy" });
    state.trailingPending.add(key);
    if (!state.pendingTimers.has(key))
      openTrailingWindow(state, key, SETTLE_WINDOW_MS);
    if (!options.localOnly)
      armRemoteSync(state, key);
    return false;
  }
  state.syncing.add(key);
  state.syncingFamilies.add(family);
  if (!options.localOnly) {
    state.lastRemoteSyncAt.set(key, Date.now());
    clearTimeout(state.remoteTimers.get(key));
    state.remoteTimers.delete(key);
  }
  let succeeded = false;
  try {
    const localCli = localSidecarCliPath(root);
    const cli = localCli ?? currentCliPath();
    logSidecarEvent("daemon-sync-start", { ...peerFields(key), trigger, local: Boolean(localCli), localOnly: Boolean(options.localOnly) });
    const result = await runChild(process.execPath, [cli, "sync"], {
      cwd: root,
      env: {
        ...process.env,
        [SKIP_LOCAL_EXEC_ENV2]: "1",
        [GLOBAL_EXEC_ENV2]: "1",
        [SOFT_SYNC_ENV]: "1",
        [PEER_ENV]: peer,
        ...options.localOnly ? { [LOCAL_SYNC_ENV]: "1" } : {}
      },
      timeoutMs: SYNC_TIMEOUT_MS
    });
    if (result.status === 0) {
      state.failures.delete(key);
      state.skipUntilCycle.delete(key);
      logSidecarEvent("daemon-sync", { ...peerFields(key), trigger, local: Boolean(localCli) });
      succeeded = true;
    } else {
      const failures = (state.failures.get(key) ?? 0) + 1;
      state.failures.set(key, failures);
      state.skipUntilCycle.set(key, state.cycleCount + Math.min(2 ** (failures - 1), MAX_BACKOFF_CYCLES));
      logSidecarEvent("failure", {
        command: "daemon",
        ...peerFields(key),
        trigger,
        message: result.timedOut ? "sync timed out" : result.output.trim().slice(-500) || `sync exited ${result.status}`
      });
    }
  } finally {
    state.syncing.delete(key);
    state.syncingFamilies.delete(family);
    if (options.localOnly)
      armRemoteSync(state, key);
  }
  if (succeeded)
    await followUpTrailingSync(state, key);
  else
    state.trailingPending.delete(key);
  return succeeded;
}
async function followUpTrailingSync(state, key) {
  if (!state.trailingPending.delete(key))
    return;
  await syncIfDirty(state, key, "watch-followup");
}
async function syncIfDirty(state, key, trigger) {
  if (!await checkoutIsDirty(key))
    return;
  syncInstance(state, key, trigger, { localOnly: !remoteIsDue(state, key) });
}
async function checkoutIsDirty(key) {
  const sidecarPath = readInstances().find((instance) => instance.configPath === key)?.sidecarPath;
  if (!sidecarPath || !fs13.existsSync(sidecarPath))
    return false;
  const result = await runChild("git", ["-C", sidecarPath, "status", "--porcelain"], { timeoutMs: 30000 });
  return result.status === 0 && Boolean(result.stdout.trim());
}
function localSidecarCliPath(root) {
  if (!projectDependsOnSidecar(root))
    return;
  const candidate = path11.join(root, "node_modules", PACKAGE_NAME, "dist", "cli.js");
  if (!isFile(candidate))
    return;
  const localVersion = installedPackageVersion(root);
  if (localVersion === undefined || compareVersions(localVersion, packageVersion()) <= 0)
    return;
  return candidate;
}
function currentCliPath() {
  return process.argv[1] || fileURLToPath3(import.meta.url);
}
function selectWatchTargets(instances, limit = WATCH_LIMIT) {
  return [...instances].filter((instance) => fs13.existsSync(instance.configPath) && fs13.existsSync(instance.sidecarPath)).sort((left, right) => instanceRecency(right) - instanceRecency(left)).slice(0, limit);
}
function instanceRecency(instance) {
  const time = Date.parse(instance.lastSyncAt ?? instance.updatedAt ?? instance.registeredAt);
  return Number.isFinite(time) ? time : 0;
}
async function loadChokidar() {
  if (chokidarModule !== undefined)
    return chokidarModule;
  try {
    chokidarModule = await import("chokidar");
  } catch (error) {
    chokidarModule = null;
    logSidecarEvent("daemon-watch-unavailable", {
      message: error instanceof Error ? error.message : String(error)
    });
    console.log("file watching unavailable; relying on interval sync");
  }
  return chokidarModule;
}
async function refreshWatchers(state) {
  if (state.refreshing) {
    state.refreshPending = true;
    return;
  }
  state.refreshing = true;
  state.refreshPending = false;
  try {
    const chokidar = await loadChokidar();
    if (!chokidar)
      return;
    const targets = new Map(selectWatchTargets(readInstances()).map((instance) => [instance.configPath, instance.sidecarPath]));
    for (const [key, watcher] of [...state.watchers]) {
      if (targets.has(key))
        continue;
      state.watchers.delete(key);
      await watcher.close().catch(() => {
        return;
      });
    }
    for (const [key, sidecarPath] of targets) {
      if (state.watchers.has(key))
        continue;
      try {
        const watcher = chokidar.watch(sidecarPath, {
          ignored: watchIgnoreMatcher(sidecarPath),
          ignoreInitial: true,
          persistent: true
        });
        watcher.on("all", (...args) => {
          scheduleWatchSync(state, key);
          const changedPath = typeof args[1] === "string" ? path11.resolve(args[1]) : "";
          if (changedPath !== path11.join(path11.resolve(sidecarPath), ".gitignore"))
            return;
          if (state.watchers.get(key) !== watcher)
            return;
          state.watchers.delete(key);
          watcher.close().catch(() => {
            return;
          }).then(() => refreshWatchers(state));
        });
        watcher.on("error", (error) => {
          logSidecarEvent("failure", {
            command: "daemon",
            ...peerFields(key),
            message: `watcher error: ${error instanceof Error ? error.message : String(error)}`
          });
        });
        state.watchers.set(key, watcher);
      } catch (error) {
        logSidecarEvent("failure", {
          command: "daemon",
          ...peerFields(key),
          message: `could not watch ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
    if (state.watchers.size !== state.lastWatchCount) {
      state.lastWatchCount = state.watchers.size;
      logSidecarEvent("daemon-watch", { watching: state.watchers.size });
    }
  } finally {
    state.refreshing = false;
    if (state.refreshPending)
      await refreshWatchers(state);
  }
}
function scheduleWatchSync(state, key) {
  if (state.syncing.has(key)) {
    state.trailingPending.add(key);
    return;
  }
  if (state.pendingTimers.has(key)) {
    state.trailingPending.add(key);
    return;
  }
  beginWatchSync(state, key);
}
async function beginWatchSync(state, key) {
  if (state.syncing.has(key) || state.pendingTimers.has(key))
    return;
  const dirty = await checkoutIsDirty(key);
  if (state.syncing.has(key) || state.pendingTimers.has(key))
    return;
  openTrailingWindow(state, key, SETTLE_WINDOW_MS);
  if (dirty)
    syncInstance(state, key, "watch", { localOnly: !remoteIsDue(state, key) });
  else
    state.trailingPending.add(key);
}
function armRemoteSync(state, key) {
  if (state.remoteTimers.has(key))
    return;
  const elapsed = Date.now() - (state.lastRemoteSyncAt.get(key) ?? 0);
  const timer = setTimeout(() => {
    state.remoteTimers.delete(key);
    syncInstance(state, key, "remote-due");
  }, Math.max(SETTLE_WINDOW_MS, scheduleFor(key, state.options).debounceSeconds * 1000 - elapsed));
  state.remoteTimers.set(key, timer);
}
function remoteIsDue(state, key) {
  const last = state.lastRemoteSyncAt.get(key) ?? 0;
  return Date.now() - last >= scheduleFor(key, state.options).debounceSeconds * 1000;
}
function openTrailingWindow(state, key, delayMs) {
  logSidecarEvent("daemon-watch-debounce", { ...peerFields(key), windowSeconds: Math.round(delayMs / 1000) });
  const timer = setTimeout(() => {
    state.pendingTimers.delete(key);
    if (!state.trailingPending.delete(key))
      return;
    if (state.syncing.has(key)) {
      state.trailingPending.add(key);
      return;
    }
    syncIfDirty(state, key, "watch-trailing");
  }, delayMs);
  state.pendingTimers.set(key, timer);
}
async function watchRegistry(state) {
  const chokidar = await loadChokidar();
  if (!chokidar)
    return;
  try {
    const watcher = chokidar.watch(sidecarStateDir(), { ignoreInitial: true, depth: 0 });
    watcher.on("all", (...args) => {
      const filePath = typeof args[1] === "string" ? args[1] : "";
      if (path11.basename(filePath) !== "instances.json")
        return;
      if (state.registryTimer)
        return;
      state.registryTimer = setTimeout(() => {
        state.registryTimer = undefined;
        refreshWatchers(state);
      }, 5000);
    });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not watch registry: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}
function compileGitignoreMatcher(lines) {
  const rules = import_ignore.default({ ignorecase: false }).add(lines);
  return (relativePath) => {
    const normalized = relativePath.split(path11.sep).join("/");
    if (!import_ignore.default.isPathValid(normalized))
      return false;
    return rules.ignores(normalized);
  };
}
function watchIgnoreMatcher(sidecarPath) {
  let gitignore;
  try {
    const ignoreFile = path11.join(sidecarPath, ".gitignore");
    if (fs13.existsSync(ignoreFile)) {
      gitignore = compileGitignoreMatcher(fs13.readFileSync(ignoreFile, "utf8").split(`
`));
    }
  } catch {}
  const root = path11.resolve(sidecarPath);
  return (candidate, stats) => {
    const relative = path11.relative(root, candidate);
    if (!relative)
      return false;
    const normalized = relative.split(path11.sep).join("/");
    if (normalized === ".." || normalized.startsWith("../") || path11.isAbsolute(relative))
      return true;
    if (normalized === ".git" || normalized.startsWith(".git/"))
      return true;
    if (normalized === ".gitignore")
      return false;
    if (!stats)
      return false;
    return gitignore ? gitignore(normalized + (stats.isDirectory() ? "/" : "")) : false;
  };
}
async function checkAndInstallUpdate() {
  const current = packageVersion();
  const npm = findExecutableOnPath(process.platform === "win32" ? "npm.cmd" : "npm");
  if (!npm)
    return { status: "skipped", current, message: "npm not found on PATH" };
  const view = await runChild(npm, ["view", PACKAGE_NAME, "version"], { timeoutMs: 60000 });
  const latest = view.stdout.trim();
  if (view.status !== 0 || !/^\d+\.\d+\.\d+$/.test(latest)) {
    return {
      status: "failed",
      current,
      message: `version check failed: ${(latest || view.output.trim()).slice(-200)}`
    };
  }
  if (compareVersions(latest, current) <= 0) {
    return { status: "current", current, latest };
  }
  const source = readSettings().installSource;
  const usesBun = source ? source === "bun" : isInsidePath2(realpathOr2(currentCliPath()), realpathOr2(bunGlobalRoot()));
  const bun = usesBun ? findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun") : undefined;
  const installer = bun ?? npm;
  const args = bun ? ["add", "-g", `${PACKAGE_NAME}@${latest}`] : ["install", "-g", `${PACKAGE_NAME}@${latest}`];
  const install = await runChild(installer, args, { timeoutMs: 300000 });
  if (install.status !== 0) {
    return {
      status: "failed",
      current,
      latest,
      message: `install of ${latest} failed: ${install.output.trim().slice(-500)}`
    };
  }
  return { status: "updated", current, latest };
}
async function maybeAutoUpdate() {
  if (process.env[SKIP_UPDATE_ENV] === "1")
    return;
  const settings = readSettings();
  if (!settings.autoUpdate)
    return;
  const last = settings.lastUpdateCheckAt ? Date.parse(settings.lastUpdateCheckAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_INTERVAL_MS)
    return;
  writeSettings({ ...settings, lastUpdateCheckAt: new Date().toISOString() });
  const result = await checkAndInstallUpdate();
  if (result.status === "updated") {
    logSidecarEvent("daemon-update", { from: result.current, to: result.latest });
    ensureDaemonServiceFile();
    restartAfterUpdate();
    return;
  }
  if (result.status === "current") {
    logSidecarEvent("daemon-update-check", { current: result.current, latest: result.latest });
    return;
  }
  logSidecarEvent("daemon-update-skip", { reason: result.status, message: result.message });
}
function restartAfterUpdate() {
  if (process.stdout.isTTY) {
    console.log("sidecar updated; restart this daemon to pick up the new version");
    return;
  }
  removeOwnPidFile();
  if (process.platform === "win32")
    startDetachedDaemon();
  process.exit(0);
}
async function acquireDaemonPid() {
  const pidPath = daemonPidPath();
  fs13.mkdirSync(path11.dirname(pidPath), { recursive: true });
  while (true) {
    try {
      fs13.writeFileSync(pidPath, `${process.pid}
`, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
    }
    const holder = readPid(pidPath);
    if (holder === process.pid)
      return;
    if (holder && pidIsSidecarDaemon(holder)) {
      logSidecarEvent("daemon-wait", { holder });
      await delay(30000);
      continue;
    }
    logSidecarEvent("daemon-pid-heal", { holder: holder ?? null });
    fs13.rmSync(pidPath, { force: true });
  }
}
function installShutdownHandlers() {
  const shutdown = () => {
    removeOwnPidFile();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", removeOwnPidFile);
}
function removeOwnPidFile() {
  try {
    if (readPid(daemonPidPath()) === process.pid)
      fs13.rmSync(daemonPidPath(), { force: true });
  } catch {}
}
function readPid(pidPath) {
  try {
    const pid = Number(fs13.readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return;
  }
}
function runChild(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn2(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let output = "";
    let stdout = "";
    let timedOut = false;
    const append = (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-8192);
    };
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-8192);
      append(chunk);
    });
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: output || String(error), stdout, timedOut });
    });
    child.on("close", (code2) => {
      clearTimeout(timer);
      resolve({ status: code2 ?? 1, output, stdout, timedOut });
    });
  });
}
function isFile(filePath) {
  try {
    return fs13.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function realpathOr2(filePath) {
  try {
    return fs13.realpathSync(filePath);
  } catch {
    return path11.resolve(filePath);
  }
}
function isInsidePath2(child, parent) {
  const relative = path11.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path11.isAbsolute(relative);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var import_ignore, SKIP_LOCAL_EXEC_ENV2 = "SIDECAR_SKIP_LOCAL_EXEC", GLOBAL_EXEC_ENV2 = "SIDECAR_GLOBAL_EXEC", SKIP_UPDATE_ENV = "SIDECAR_SKIP_UPDATE", WATCH_LIMIT = 100, SYNC_TIMEOUT_MS, UPDATE_CHECK_INTERVAL_MS, PRUNE_AFTER_MISSES = 3, SETTLE_WINDOW_MS = 5000, MAX_BACKOFF_CYCLES = 6, chokidarModule;
var init_daemon = __esm(() => {
  init_cli();
  import_ignore = __toESM(require_ignore(), 1);
  SYNC_TIMEOUT_MS = 10 * 60 * 1000;
  UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
});

// src/cmd-daemon.ts
function requireGlobalRegistry() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
}
function cmdDaemon(args) {
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("daemon commands must run from a globally installed sidecar, not a project-local dependency");
  }
  const [action, ...rest] = args;
  if (action === "status") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon status");
    return cmdDaemonStatus();
  }
  if (action === "enable") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon enable");
    return cmdDaemonEnable();
  }
  if (action === "disable") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon disable");
    return cmdDaemonDisable();
  }
  if (action === "restart") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon restart");
    return cmdDaemonRestart();
  }
  if (action === "autoupdate") {
    return cmdDaemonAutoUpdate(rest);
  }
  if (action === "run") {
    return cmdDaemonRun(rest);
  }
  if (!action || action.startsWith("-")) {
    return cmdDaemonRun(args);
  }
  throw new SidecarError("usage: sidecar daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]");
}
function cmdDaemonAutoUpdate(args) {
  const [value, ...rest] = args;
  if (rest.length || value !== "on" && value !== "off") {
    throw new SidecarError("usage: sidecar daemon autoupdate on|off");
  }
  requireGlobalRegistry();
  writeSettings({ ...readSettings(), autoUpdate: value === "on" });
  console.log(`autoupdate: ${value}`);
  return 0;
}
function daemonLine(label, value, role) {
  labelLine(DAEMON_LABEL_WIDTH, label, value, role);
}
function printDaemonBlock(service, enabled) {
  daemonLine("daemon", enabled ? "enabled" : "disabled", enabled ? "ok" : "attn");
  printServiceLines(service, enabled);
  daemonLine("settings", settingsPath(), "quiet");
}
function printServiceLines(service, enabled) {
  const role = service.running ? "ok" : !service.available ? "quiet" : enabled && service.installed ? "bad" : "quiet";
  daemonLine("service", daemonServiceLabel(service), role);
  if (service.path)
    daemonLine("agent", service.path, "quiet");
  if (service.message)
    daemonLine("detail", service.message);
}
function cmdDaemonStatus() {
  requireGlobalRegistry();
  const settings = readSettings();
  const service = daemonServiceStatus();
  daemonLine("daemon", settings.daemonEnabled ? "enabled" : "disabled", settings.daemonEnabled ? "ok" : "attn");
  daemonLine("update", settings.autoUpdate ? "auto" : "manual");
  printServiceLines(service, settings.daemonEnabled);
  daemonLine("settings", settingsPath(), "quiet");
  daemonLine("log", sidecarLogPath(), "quiet");
  return 0;
}
function cmdDaemonEnable() {
  requireGlobalRegistry();
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  printDaemonBlock(service, true);
  return 0;
}
function cmdDaemonDisable() {
  requireGlobalRegistry();
  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  printDaemonBlock(service, false);
  return 0;
}
function cmdDaemonRestart() {
  requireGlobalRegistry();
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  printDaemonBlock(service, true);
  return 0;
}
async function cmdDaemonRun(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval", "--debounce"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  requireGlobalRegistry();
  const intervalSeconds = Number(getValue(parsed, "--interval", "600"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }
  const debounceSeconds = Number(getValue(parsed, "--debounce", "60"));
  if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0) {
    throw new SidecarError("--debounce must be >= 0");
  }
  const { runDaemonLoop: runDaemonLoop2 } = await Promise.resolve().then(() => (init_daemon(), exports_daemon));
  return runDaemonLoop2({
    once: parsed.flags.has("--once"),
    intervalSeconds,
    debounceSeconds
  });
}
async function cmdUpdate(args) {
  if (args.length)
    throw new SidecarError("usage: sidecar update");
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("update must run from a globally installed sidecar; update local installs with your package manager");
  }
  console.log(`checking npm for ${PACKAGE_NAME} updates...`);
  const { checkAndInstallUpdate: checkAndInstallUpdate2 } = await Promise.resolve().then(() => (init_daemon(), exports_daemon));
  const result = await checkAndInstallUpdate2();
  logSidecarEvent("manual-update", { ...result });
  if (result.status === "current") {
    console.log(`sidecar v${result.current} is up to date`);
    return 0;
  }
  if (result.status !== "updated") {
    throw new SidecarError(result.message ?? `update ${result.status}`);
  }
  console.log(`updated sidecar v${result.current} -> v${result.latest}`);
  const service = installDaemonService();
  printServiceLines(service, readSettings().daemonEnabled);
  return 0;
}
function cmdSetInstallSource(args) {
  const parsed = parseOptions(args, { boolean: new Set(["--if-unset"]), value: new Set });
  const [source, ...extra] = parsed.positional;
  if (!source || extra.length || !INSTALL_SOURCES.has(source)) {
    throw new SidecarError("usage: sidecar set-install-source npm|bun|curl [--if-unset]");
  }
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("set-install-source must run from a globally installed sidecar");
  }
  const settings = readSettings();
  if (parsed.flags.has("--if-unset") && settings.installSource) {
    console.log(`install source: ${settings.installSource} (kept)`);
    return 0;
  }
  writeSettings({ ...settings, installSource: source });
  console.log(`install source: ${source}`);
  return 0;
}
function cmdRegisterInstall(args) {
  if (args.length)
    throw new SidecarError("usage: sidecar register-install");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("install registration requires a global sidecar executable");
  }
  for (const { root, config } of loadPeers(undefined)) {
    registerCurrentInstance(root, config, { event: "install-register" });
  }
  return 0;
}
var DAEMON_LABEL_WIDTH;
var init_cmd_daemon = __esm(() => {
  init_util();
  init_install();
  init_config();
  init_state();
  init_service();
  init_ui();
  DAEMON_LABEL_WIDTH = "settings:".length;
});

// src/cmd-sync.ts
import fs14 from "node:fs";
import os6 from "node:os";
import path12 from "node:path";
function cmdSnapshot(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--push"]),
    value: new Set(["-m", "--message", "--peer"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar snapshot [--push] [-m message] [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    const { root, config } = peer;
    const sidecarPath = requireSidecarCheckout(root, config);
    withSyncLock(root, peer.name, "throw", () => {
      const inbox = expandInbox(config, sidecarPath);
      ensureCommitIdentity(sidecarPath);
      ensureRedactionFilter(sidecarPath, config.redaction, config);
      ensureInboxBranch(sidecarPath, config, inbox);
      const committed = snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined, config.redaction, config);
      if (committed && parsed.flags.has("--push")) {
        syncBranchBeforePush(sidecarPath, inbox, config);
        pushBranch(sidecarPath, inbox);
      }
    });
  }
  return 0;
}
function cmdSync(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot", "--soft", "--local"]),
    value: new Set(["-m", "--message", "--peer"])
  });
  if (parsed.positional.length) {
    throw new SidecarError("usage: sidecar sync [--local] [--no-snapshot] [--soft] [-m message] [--peer name]");
  }
  const peers = loadPeers(selectedPeer(parsed), { loadRules: false });
  const failed = [];
  for (const peer of peers) {
    announcePeer(peer, peers);
    try {
      if (peer.config.rulesPath)
        peer.config.rules = readRules(peer.config.rulesPath);
      syncPeer(peer, parsed);
    } catch (error) {
      if (peers.length === 1)
        throw error;
      failed.push(peer.name);
      console.error(`sidecar: ${peer.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed.length) {
    throw new SidecarError(`${failed.length} of ${peers.length} peers failed to sync: ${failed.join(", ")}`);
  }
  return 0;
}
function syncPeer(peer, parsed) {
  const { root, config } = peer;
  const soft = parsed.flags.has("--soft") || process.env[SOFT_SYNC_ENV] === "1";
  const remote = !parsed.flags.has("--local") && process.env[LOCAL_SYNC_ENV] !== "1";
  let stage = "start";
  let synced;
  try {
    synced = withSyncLock(root, peer.name, soft ? "skip" : "throw", () => {
      syncProject(root, config, {
        snapshot: !parsed.flags.has("--no-snapshot"),
        remote,
        message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined,
        onStage: (name) => {
          stage = name;
        }
      });
      registerCurrentInstance(root, config, remote ? { event: "sync", lastSyncAt: nowIso() } : { event: "sync-local" });
    });
  } catch (error) {
    if (remote)
      reportSyncHealth(root, config, {
        status: "failed",
        stage,
        message: error instanceof Error ? error.message : String(error)
      });
    throw error;
  }
  if (synced) {
    if (remote)
      reportSyncHealth(root, config, { status: "ok" });
    if (!soft) {
      const sidecarPath = resolveSidecarPath(root, config);
      if (checkoutIsUnlinkedFromFamily(root, config, sidecarPath)) {
        console.log("sidecar: this checkout is an independent clone, so it settles with its siblings through the remote; `sidecar refresh` links it to the one this repo family shares");
      }
    }
  }
}
function cmdMerge(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--no-push"]),
    value: new Set(["--peer"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push] [--peer name]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
  }
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    const { root, config } = peer;
    const sidecarPath = requireSidecarCheckout(root, config);
    withSyncLock(root, peer.name, "throw", () => {
      ensureRedactionFilter(sidecarPath, config.redaction, config);
      mergeInboxBranches(sidecarPath, config, {
        forkFiles: parsed.flags.has("--fork-files"),
        push: !parsed.flags.has("--no-push"),
        remote: true
      });
    });
  }
  return 0;
}
function cmdRedactions(args) {
  const parsed = parseOptions(args, { boolean: new Set, value: new Set(["--peer"]) });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar redactions [--peer name]");
  const peers = loadPeers(selectedPeer(parsed));
  for (const peer of peers) {
    announcePeer(peer, peers);
    printPeerRedactions(peer);
  }
  return 0;
}
function printPeerRedactions({ root, config }) {
  const sidecarPath = requireSidecarCheckout(root, config);
  const files = [
    ...new Set(git(sidecarPath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).stdout.split("\x00").filter(Boolean))
  ];
  let shown = 0;
  let items = 0;
  for (const relPath of files) {
    const delta = fileRedactionDelta(path12.join(sidecarPath, relPath), config.redaction, { rules: config.rules, relativePath: relPath });
    if (!delta)
      continue;
    if (shown)
      console.log("");
    console.log(`${relPath}:`);
    printRedactionDiff(delta.text, delta.redacted);
    shown += 1;
    items += delta.items;
  }
  if (!shown) {
    console.log(`no redactions pending (default: ${config.redaction}; path rules applied)`);
    return;
  }
  console.log(`
${items} redaction(s) in ${shown} file(s) will be pushed this way (default: ${config.redaction}; path rules applied).`);
  console.log("local files are untouched; redaction is controlled by the peer's configuration and rules");
}
function printRedactionDiff(original, redacted) {
  const scratch = fs14.mkdtempSync(path12.join(os6.tmpdir(), "sidecar-redactions-"));
  try {
    const localPath = path12.join(scratch, "local");
    const pushedPath = path12.join(scratch, "pushed");
    fs14.writeFileSync(localPath, original, "utf8");
    fs14.writeFileSync(pushedPath, redacted, "utf8");
    const color = colorLevel() > 0 ? ["--color"] : [];
    const diff = gitRaw(["diff", "--no-index", ...color, "--", localPath, pushedPath], { check: false });
    const lines = diff.stdout.split(`
`);
    const firstHunk = lines.findIndex((line) => stripColor(line).startsWith("@@"));
    const body = firstHunk === -1 ? "" : lines.slice(firstHunk).join(`
`).trimEnd();
    if (body)
      console.log(body);
  } finally {
    fs14.rmSync(scratch, { recursive: true, force: true });
  }
}
function cmdRedact(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--checkout-policy"]),
    value: new Set(["--mode", "--rules", "--path"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar redact [--mode mode] [--rules file --path path]");
  const checkoutPolicy = parsed.flags.has("--checkout-policy");
  if (checkoutPolicy && (parsed.values.has("--mode") || parsed.values.has("--rules"))) {
    throw new SidecarError("--checkout-policy cannot be combined with --mode or --rules");
  }
  const mode = redactionModeConfigValue(getValue(parsed, "--mode", DEFAULT_REDACTION_MODE), "--mode");
  const rulesPath = parsed.values.get("--rules");
  const effective = checkoutPolicy ? checkoutRedactionPolicy(process.cwd()) : { mode, rules: rulesPath ? readRules(path12.resolve(rulesPath)) : [] };
  const relativePath = parsed.values.get("--path");
  if ((checkoutPolicy || rulesPath) && !relativePath)
    throw new SidecarError("redaction rules require --path");
  const effectiveMode = relativePath ? resolveFileRules(effective.rules, relativePath, { resolve: "fork", redaction: effective.mode }).redaction : effective.mode;
  const output = redactBuffer(fs14.readFileSync(0), effectiveMode);
  let offset = 0;
  while (offset < output.length) {
    offset += fs14.writeSync(1, output, offset, output.length - offset);
  }
  return 0;
}
var init_cmd_sync = __esm(() => {
  init_color();
  init_util();
  init_git();
  init_config();
  init_state();
  init_sync();
  init_redaction();
  init_rules();
  init_ui();
});

// src/commands.ts
function run(argv) {
  const [command, ...rest] = argv;
  if (!command) {
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
    throw new SidecarError(`unknown command ${JSON.stringify(command)}${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`);
  }
  return entry.run(rest);
}
function closestCommand(input) {
  let best;
  for (const command of KNOWN_COMMANDS) {
    const distance = editDistance(input.toLowerCase(), command);
    if (!best || distance < best.distance)
      best = { command, distance };
  }
  return best && best.distance <= 2 ? best.command : undefined;
}
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1;i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1;j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
function printUsage(target) {
  const write = target === "stdout" ? console.log : console.error;
  const level = colorLevel(target === "stdout" ? process.stdout : process.stderr);
  const header = (text) => paint("label", text, level);
  const sections = Object.keys(SECTION_TITLES).map((section) => {
    const entries = COMMANDS.filter((command) => command.section === section).flatMap((command) => [
      command.summary ? `  ${command.usage}`.padEnd(USAGE_NOTE_COLUMN) + command.summary : `  ${command.usage}`,
      ...(command.notes ?? []).map((note) => " ".repeat(USAGE_NOTE_COLUMN) + note)
    ]);
    return `${header(SECTION_TITLES[section])}
${entries.join(`
`)}`;
  });
  write(`usage: sidecar <command> [options]

${sections.join(`

`)}`);
}
var COMMANDS, SECTION_TITLES, KNOWN_COMMANDS, USAGE_NOTE_COLUMN = 27;
var init_commands = __esm(() => {
  init_color();
  init_util();
  init_install();
  init_cmd_init();
  init_cmd_refresh();
  init_cmd_status();
  init_cmd_daemon();
  init_cmd_sync();
  COMMANDS = [
    {
      name: "init",
      run: cmdInit,
      section: "common",
      usage: "init [remote] [--peer name] [--path sidecar|.] [--branch main] [--inbox template] [--redaction none|secrets|secrets+pii] [--resolve fork|lww] [--debounce 10m] [--interval 1h] [--ignored] [--local-install]",
      notes: [
        "--path . makes this repo itself the sidecar (standalone)",
        "--peer name adds a second sidecar as .sidecar.name; --ignored keeps it out of the tree",
        "--local-install adds the devDependency so fresh clones self-register"
      ]
    },
    { name: "status", run: cmdStatus, section: "common", usage: "status [--json] [--peer name]" },
    {
      name: "health",
      run: cmdHealth,
      section: "common",
      usage: "health [--json] [--no-fetch] [--peer name]",
      notes: ["how every machine sharing this sidecar is syncing"]
    },
    {
      name: "redactions",
      run: cmdRedactions,
      section: "common",
      usage: "redactions [--peer name]",
      summary: "preview what redaction rewrites before content is pushed"
    },
    {
      name: "sync",
      run: cmdSync,
      section: "sync",
      usage: "sync [--local] [--no-snapshot] [--soft] [-m message] [--peer name]",
      notes: [
        "--local settles this machine's checkouts without touching the remote",
        "every command acts on all of a repo's peers unless --peer names one"
      ]
    },
    {
      name: "daemon",
      run: cmdDaemon,
      section: "sync",
      usage: "daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]"
    },
    { name: "instances", run: cmdInstances, section: "sync", usage: "instances [--json]" },
    { name: "tail", run: cmdTail, section: "sync", usage: "tail [-f|--follow] [-n|--lines count]" },
    { name: "update", run: cmdUpdate, section: "sync", usage: "update" },
    { name: "clone", run: cmdClone, section: "advanced", usage: "clone [--if-missing] [--peer name]" },
    {
      name: "refresh",
      run: cmdRefresh,
      section: "advanced",
      usage: "refresh [--force] [--yes] [--peer name]",
      notes: [
        "delete the sidecar checkout and clone it again",
        "discards anything unpushed; refuses until `sidecar sync` has run"
      ]
    },
    { name: "deinit", run: cmdDeinit, section: "advanced", usage: "deinit [--yes] [--peer name]" },
    { name: "snapshot", run: cmdSnapshot, section: "advanced", usage: "snapshot [--push] [-m message] [--peer name]" },
    { name: "merge", run: cmdMerge, section: "advanced", usage: "merge [--fork-files] [--no-push] [--peer name]" },
    {
      name: "redact",
      run: cmdRedact,
      section: "advanced",
      usage: "redact",
      summary: "git clean filter: stdin -> redacted stdout"
    },
    { name: "register-install", run: cmdRegisterInstall, section: "advanced", usage: "register-install" },
    {
      name: "set-install-source",
      run: cmdSetInstallSource,
      section: "advanced",
      usage: "set-install-source npm|bun|curl [--if-unset]"
    }
  ];
  SECTION_TITLES = {
    common: "common:",
    sync: "sync & daemon:",
    advanced: "advanced (mostly run for you by init, git, and the daemon):"
  };
  KNOWN_COMMANDS = [...COMMANDS.map((command) => command.name), "version", "help"];
});

// src/cli.ts
async function main(argv = process.argv.slice(2)) {
  try {
    const status = await run(argv);
    const command = argv[0];
    if (command && command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (error instanceof SidecarError) {
      console.error(`${paint("bad", "sidecar:", colorLevel(process.stderr))} ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.error("sidecar: stopped");
      return 130;
    }
    throw error;
  }
}
var init_cli = __esm(() => {
  init_color();
  init_util();
  init_install();
  init_state();
  init_commands();
  init_util();
  init_git();
  init_install();
  init_config();
  init_rules();
  init_state();
  init_service();
  init_ui();
  init_sync();
  init_commands();
  init_cmd_init();
  init_cmd_refresh();
  init_cmd_status();
  init_cmd_daemon();
  init_cmd_sync();
});

// src/bin.ts
init_cli();
import fs15 from "node:fs";
import path13 from "node:path";
import { spawnSync as spawnSync5 } from "node:child_process";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var SKIP_LOCAL_EXEC_ENV3 = "SIDECAR_SKIP_LOCAL_EXEC";
var GLOBAL_EXEC_ENV3 = "SIDECAR_GLOBAL_EXEC";
var PACKAGE_NAME2 = "sidecarsync";
var GLOBAL_ONLY_COMMANDS = new Set(["daemon", "deinit", "register-install", "set-install-source", "update"]);
if (process.argv[2] !== "redact" && !process.env[SKIP_LOCAL_EXEC_ENV3]) {
  const local = findLocalInstall(process.cwd(), fileURLToPath4(import.meta.url));
  if (local) {
    process.env[GLOBAL_EXEC_ENV3] = "1";
    if (local.newer && !GLOBAL_ONLY_COMMANDS.has(process.argv[2])) {
      const result = spawnSync5(process.execPath, [local.executable, ...process.argv.slice(2)], {
        stdio: "inherit",
        env: {
          ...process.env,
          [SKIP_LOCAL_EXEC_ENV3]: "1",
          [GLOBAL_EXEC_ENV3]: "1"
        }
      });
      if (result.signal) {
        process.kill(process.pid, result.signal);
      }
      process.exit(result.status ?? 1);
    }
  }
}
process.exit(await main());
function findLocalInstall(start, self) {
  let current = path13.resolve(start);
  while (true) {
    if (projectDependsOnSidecar2(current)) {
      const candidate = path13.join(current, "node_modules", PACKAGE_NAME2, "dist", "cli.js");
      if (isFile2(candidate) && !sameFile(candidate, self)) {
        return { executable: candidate, newer: localIsNewer(current) };
      }
    }
    const parent = path13.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function localIsNewer(projectRoot) {
  const localVersion = installedPackageVersion(projectRoot);
  return localVersion !== undefined && compareVersions(localVersion, packageVersion()) > 0;
}
function projectDependsOnSidecar2(projectRoot) {
  const manifestPath = path13.join(projectRoot, "package.json");
  if (!isFile2(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs15.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME2] || manifest.devDependencies?.[PACKAGE_NAME2] || manifest.optionalDependencies?.[PACKAGE_NAME2] || manifest.peerDependencies?.[PACKAGE_NAME2]);
  } catch {
    return false;
  }
}
function isFile2(filePath) {
  try {
    return fs15.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function sameFile(first, second) {
  try {
    return fs15.realpathSync(first) === fs15.realpathSync(second);
  } catch {
    return false;
  }
}
