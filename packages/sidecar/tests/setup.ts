// Tests exercise the real CLI, which manages a real launchd/systemd service
// when it can. Force the skip so no test — directly or via a spawned sidecar
// (including a global install found on PATH) — ever touches the developer's
// actual daemon service. Spawned children inherit this via process.env.
process.env.SIDECAR_SKIP_SERVICE = "1";

// Isolate every git invocation — in-process helpers and spawned sidecar
// children alike — from the contributor's global/system git config. Options
// like commit.gpgsign or core.hooksPath would otherwise hang or fail the
// suite on machines that set them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";
// Tiny disposable repositories never benefit from Git's automatic object
// maintenance. Disabling it avoids another process after nearly every commit
// and push while leaving the Git behavior under test unchanged.
process.env.GIT_CONFIG_COUNT = "2";
process.env.GIT_CONFIG_KEY_0 = "gc.auto";
process.env.GIT_CONFIG_VALUE_0 = "0";
process.env.GIT_CONFIG_KEY_1 = "maintenance.auto";
process.env.GIT_CONFIG_VALUE_1 = "false";
process.env.GIT_AUTHOR_NAME = "Test User";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "Test User";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

// The state dir holds the instance registry and the sync locks, so a test that
// takes a lock would otherwise write into the contributor's real one. Tests
// that assert on registry contents still set their own; this is the floor that
// keeps the rest from escaping.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-test-state-"));
process.env.SIDECAR_STATE_DIR = stateDir;
process.on("exit", () => fs.rmSync(stateDir, { recursive: true, force: true }));
