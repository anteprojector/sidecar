import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SidecarConfig } from "../src/config.js";
import { instancesPath, readInstances, registerCurrentInstance, unregisterInstance } from "../src/state.js";

const config: SidecarConfig = {
  peer: "default", version: 1, path: "sidecar", remote: "example", branch: "main",
  inbox: "sidecar-inbox/test", redaction: "secrets", resolve: "fork",
};
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-registry-"));
  vi.stubEnv("SIDECAR_STATE_DIR", path.join(directory, "state"));
  vi.stubEnv("SIDECAR_GLOBAL_EXEC", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("instance registry", () => {
  test("updates one peer while preserving registration and sync timestamps", () => {
    const root = path.join(directory, "repo");
    registerCurrentInstance(root, config, { event: "sync", lastSyncAt: "2026-09-04T00:00:00Z" });
    const first = readInstances()[0];
    registerCurrentInstance(root, { ...config, remote: "updated" }, { event: "register" });
    expect(readInstances()).toEqual([{ ...first, remote: "updated", updatedAt: expect.any(String) }]);
    unregisterInstance(path.join(root, ".sidecar"));
    expect(readInstances()).toEqual([]);
  });

  test("a failed replacement preserves the old registry and releases its lock", () => {
    registerCurrentInstance(path.join(directory, "first"), config, { event: "register" });
    const before = fs.readFileSync(instancesPath(), "utf8");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === instancesPath()) throw new Error("simulated write failure");
      return rename(from, to);
    });
    expect(() => registerCurrentInstance(path.join(directory, "second"), config, { event: "register" }))
      .toThrow("simulated write failure");
    expect(fs.readFileSync(instancesPath(), "utf8")).toBe(before);
    vi.restoreAllMocks();
    registerCurrentInstance(path.join(directory, "second"), config, { event: "register" });
    expect(readInstances()).toHaveLength(2);
    expect(fs.readdirSync(path.dirname(instancesPath())).sort()).toEqual(["instances.json", "sidecar.log"]);
  });

  test("recovers a lock left behind by an exited process", () => {
    const lock = path.join(path.dirname(instancesPath()), "instances.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "999999-dead-owner"), "");
    const kill = process.kill;
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 999999) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      return kill(pid, signal);
    });
    registerCurrentInstance(path.join(directory, "repo"), config, { event: "register" });
    expect(readInstances()).toHaveLength(1);
    expect(fs.existsSync(lock)).toBe(false);
  });

  test("parallel processes retain every registration while other entries are removed", async () => {
    // Exercise only the registry API, without invoking the CLI or creating Git
    // repositories. A start barrier makes the writers overlap consistently.
    const modulePath = fileURLToPath(new URL("../src/state.ts", import.meta.url));
    const start = path.join(directory, "start");
    const workers = Array.from({ length: 8 }, (_, worker) => {
      const script = `
        import fs from "node:fs";
        import { registerCurrentInstance, unregisterInstance } from ${JSON.stringify(modulePath)};
        const config = ${JSON.stringify(config)};
        fs.writeFileSync(${JSON.stringify(path.join(directory, `ready-${worker}`))}, "");
        while (!fs.existsSync(${JSON.stringify(start)})) await Bun.sleep(5);
        for (let n = 0; n < 8; n++) {
          const root = ${JSON.stringify(path.join(directory, `worker-${worker}-`))} + n;
          registerCurrentInstance(root, config, { event: "register" });
          if (n % 2 === 0) unregisterInstance(root + "/.sidecar");
        }
      `;
      const child = spawn("bun", ["-e", script], { env: process.env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const done = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker exited ${code}`)));
      });
      return { child, done };
    });
    const failures: unknown[] = [];
    const reader = setInterval(() => {
      if (!fs.existsSync(instancesPath())) return;
      try { JSON.parse(fs.readFileSync(instancesPath(), "utf8")); }
      catch (error) { failures.push(error); }
    }, 2);
    try {
      const deadline = Date.now() + 5_000;
      while (fs.readdirSync(directory).filter((name) => name.startsWith("ready-")).length < workers.length) {
        if (Date.now() > deadline) throw new Error("registry workers failed to start");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      fs.writeFileSync(start, "");
      await Promise.all(workers.map(({ done }) => done));
      const instances = readInstances();
      expect(instances).toHaveLength(32);
      expect(new Set(instances.map((instance) => instance.root)).size).toBe(32);
      expect(instances.every((instance) => Number(instance.root.at(-1)) % 2 === 1)).toBe(true);
      expect(failures).toEqual([]);
    } finally {
      clearInterval(reader);
      for (const { child } of workers) if (child.exitCode === null) child.kill();
      await Promise.allSettled(workers.map(({ done }) => done));
    }
  }, 15_000);
});
