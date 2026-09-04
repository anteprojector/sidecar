import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const entry = vi.hoisted(() => ({ main: vi.fn(), spawn: vi.fn() }));
vi.mock("../src/cli.js", () => ({
  main: entry.main,
  installedPackageVersion: () => "999.0.0",
  packageVersion: () => "1.4.0",
  compareVersions: () => 1,
}));
vi.mock("node:child_process", () => ({ spawnSync: entry.spawn }));

let root: string;
let originalArgv: string[];
beforeEach(() => {
  vi.resetModules();
  entry.main.mockReset().mockResolvedValue(0);
  entry.spawn.mockReset().mockReturnValue({ status: 17, signal: null });
  originalArgv = process.argv;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-entry-unit-"));
  const local = path.join(root, "node_modules", "sidecarsync", "dist");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { sidecarsync: "999.0.0" } }));
  fs.writeFileSync(path.join(local, "cli.js"), "throw new Error('synced executable must never run');");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(process, "exit").mockImplementation((code) => { throw Object.assign(new Error("exit"), { code }); });
  vi.stubEnv("SIDECAR_SKIP_LOCAL_EXEC", "");
  vi.stubEnv("SIDECAR_GLOBAL_EXEC", "");
});
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

test("the clean filter never delegates to a newer package inside synced content", async () => {
  process.argv = [process.execPath, "/installed/sidecar/cli.js", "redact", "--checkout-policy", "--path", "notes.md"];
  // Evaluate only the entrypoint dispatcher; main, subprocess execution, and
  // exit are mocked, so this never runs the real CLI or another executable.
  await expect(import("../src/bin.js")).rejects.toMatchObject({ code: 0 });
  expect(entry.main).toHaveBeenCalledOnce();
  expect(entry.spawn).not.toHaveBeenCalled();
});

test("ordinary commands still delegate to a newer project package", async () => {
  process.argv = [process.execPath, "/installed/sidecar/cli.js", "sync"];
  await expect(import("../src/bin.js")).rejects.toMatchObject({ code: 17 });
  expect(entry.main).not.toHaveBeenCalled();
  expect(entry.spawn).toHaveBeenCalledWith(process.execPath,
    [path.join(root, "node_modules", "sidecarsync", "dist", "cli.js"), "sync"],
    expect.objectContaining({ env: expect.objectContaining({ SIDECAR_SKIP_LOCAL_EXEC: "1" }) }));
});
