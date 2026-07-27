#!/usr/bin/env node
// Renders scripts/og-card.html to site/assets/og.png without a human in the
// loop, so a wording change (a rename, a new tagline) can't leave the social
// preview advertising the old copy. Text greps never catch a stale og.png:
// the install command is pixels by then, and unfurl caches hold it for weeks.
//
//   bun run --cwd packages/marketing og:render
//
// Zero dependencies, like serve-site.mjs: it drives an already-installed
// Chrome over the DevTools protocol (Node 22 ships a global WebSocket) rather
// than pulling a headless browser and a rasterizer into the tree.
//
// Two things force the roundabout shape:
//   - The card must be served over http, not file://. It draws logo.svg into
//     the canvas, and a file:// image taints the canvas, so toDataURL throws.
//   - The bitmap comes from toDataURL, not a screenshot, so the output is the
//     canvas's own 1200x630 pixels regardless of viewport or display scaling.
//
// The card's own layout guards (`fits()`) warn to the console when text
// overruns the art column; those warnings are relayed here and turn into a
// non-zero exit, so an overlong install command fails the render.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = path.join(PKG_DIR, "site", "assets", "og.png");
const CARD_PATH = "/scripts/og-card.html";
const WIDTH = 1200;
const HEIGHT = 630;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = Number(flag("port", 4331));

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const cleanups = [];
let warned = false;

try {
  await main();
} catch (error) {
  console.error(`make-og: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      // Best effort: a failed teardown must not mask a successful render.
    }
  }
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((candidate) => exists(candidate));
  if (!chrome) {
    throw new Error(
      `no Chrome found. Install Google Chrome, or point CHROME at a binary:\n  CHROME=/path/to/chrome bun run --cwd packages/marketing og:render`,
    );
  }

  await serveCard();
  const { ws, send, on } = await launchChrome(chrome);

  const warnings = [];
  on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "warning" && params.type !== "error") return;
    warnings.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${CARD_PATH}` });

  // __ogReady is assigned as the page's script runs, so poll for it rather
  // than assuming navigation has already gotten that far.
  const dataUrl = await send("Runtime.evaluate", {
    expression: `(async () => {
      const started = Date.now();
      while (!window.__ogReady) {
        if (Date.now() - started > 15000) throw new Error("og-card never started drawing");
        await new Promise((r) => setTimeout(r, 25));
      }
      await window.__ogReady;
      return document.getElementById("c").toDataURL("image/png");
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }).then((result) => {
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "the card threw while drawing");
    }
    return result.result.value;
  });

  ws.close();

  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("the card did not produce a PNG");
  }
  const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  assertDimensions(png);

  for (const warning of warnings) {
    warned = true;
    console.warn(`  ! ${warning}`);
  }
  if (warned) {
    throw new Error("the card reported layout warnings; fix the copy or the layout and re-render");
  }

  fs.writeFileSync(OUT_PATH, png);
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)} — ${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)}kB`);
}

// The card pulls the site's real webfonts and logo through relative paths, so
// the server root has to be the package, not site/.
async function serveCard() {
  const server = spawn(
    process.execPath,
    [path.join(PKG_DIR, "scripts", "serve-site.mjs"), "--root", PKG_DIR, "--port", String(PORT), "--no-reload"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  server.stderr.on("data", (chunk) => (stderr += chunk));
  cleanups.push(() => void server.kill());

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`the static server exited: ${stderr.trim() || `code ${server.exitCode}`}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${CARD_PATH}`);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(50);
  }
  throw new Error(`the static server never came up on port ${PORT} (pass --port to pick another)`);
}

async function launchChrome(binary) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-og-"));
  cleanups.push(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

  const chrome = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      // Port 0 lets Chrome pick; it reports the choice in DevToolsActivePort.
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  chrome.stderr.on("data", (chunk) => (stderr += chunk));
  cleanups.push(() => void chrome.kill());

  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  let endpoint;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited: ${stderr.trim() || `code ${chrome.exitCode}`}`);
    }
    if (exists(portFile)) {
      const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
      if (port && wsPath) {
        endpoint = `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
        break;
      }
    }
    await sleep(50);
  }
  if (!endpoint) throw new Error("Chrome never reported a debugging port");

  return connect(endpoint);
}

// A minimal DevTools protocol client: enough to open one tab and talk to it.
async function connect(endpoint) {
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  let sessionId;

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const settle = pending.get(message.id);
      if (!settle) return;
      pending.delete(message.id);
      if (message.error) settle.reject(new Error(`${message.method ?? "CDP"}: ${message.error.message}`));
      else settle.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  ws.addEventListener("close", () => {
    for (const settle of pending.values()) settle.reject(new Error("Chrome closed the connection"));
    pending.clear();
  });

  const raw = (method, params, session) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params ?? {}, ...(session ? { sessionId: session } : {}) }));
    });

  // One tab, attached flat, so every later call can carry the same session.
  const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true }));

  return {
    ws,
    send: (method, params) => raw(method, params, sessionId),
    on: (method, listener) => {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
  };
}

// Guards against a silently resized card: IHDR carries the real dimensions.
function assertDimensions(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`expected a ${WIDTH}x${HEIGHT} card, got ${width}x${height}`);
  }
}

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
