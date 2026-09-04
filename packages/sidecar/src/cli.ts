// The package's single import surface: bin.ts, daemon.ts, and the tests all
// import from here, and the barrel below keeps that true no matter which
// module a symbol lives in. The implementation is split by domain — see
// CLAUDE.md for the map. When adding an export to any module, nothing extra
// is needed here; `export *` forwards it.
import { colorLevel, paint } from "./color.js";
import { SidecarError } from "./util.js";
import { shouldUseGlobalRegistry } from "./install.js";
import { logSidecarEvent } from "./state.js";
import { run } from "./commands.js";

export * from "./util.js";
export * from "./git.js";
export * from "./install.js";
export * from "./config.js";
export * from "./rules.js";
export * from "./state.js";
export * from "./service.js";
export * from "./ui.js";
export * from "./sync.js";
export * from "./commands.js";
export * from "./cmd-init.js";
export * from "./cmd-refresh.js";
export * from "./cmd-status.js";
export * from "./cmd-daemon.js";
export * from "./cmd-sync.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const status = await run(argv);
    const command = argv[0];
    // The redact clean filter runs once per staged file; logging it would
    // write one event per file on every snapshot.
    if (command && command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error),
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
