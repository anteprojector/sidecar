// Tests exercise the real CLI, which manages a real launchd/systemd service
// when it can. Force the skip so no test — directly or via a spawned sidecar
// (including a global install found on PATH) — ever touches the developer's
// actual daemon service. Spawned children inherit this via process.env.
process.env.SIDECAR_SKIP_SERVICE = "1";

// Isolate every git invocation — in-process helpers and spawned sidecar
// children alike — from the contributor's global/system git config. Options
// like commit.gpgsign or core.hooksPath would otherwise hang or fail the
// suite on machines that set them.
import os from "node:os";

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";
