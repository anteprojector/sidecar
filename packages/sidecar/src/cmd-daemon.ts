// Daemon and install management commands: the daemon subcommands, update,
// register-install, and set-install-source. All of them require the global
// install — a project-local run would manage the wrong state dir.
import { type Role } from "./color.js";
import { SidecarError, getValue, parseOptions } from "./util.js";
import { INSTALL_SOURCES, type InstallSource, PACKAGE_NAME, currentExecutablePath, isProjectLocalPath, shouldUseGlobalRegistry } from "./install.js";
import { loadProject } from "./config.js";
import { logSidecarEvent, readSettings, registerCurrentInstance, settingsPath, sidecarLogPath, writeSettings } from "./state.js";
import { type DaemonServiceStatus, daemonServiceLabel, daemonServiceStatus, installDaemonService, stopDaemonService } from "./service.js";
import { labelLine } from "./ui.js";

function requireGlobalRegistry(): void {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
}

export function cmdDaemon(args: string[]): number | Promise<number> {
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError(
      "daemon commands must run from a globally installed sidecar, not a project-local dependency",
    );
  }
  const [action, ...rest] = args;
  if (action === "status") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon status");
    return cmdDaemonStatus();
  }
  if (action === "enable") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon enable");
    return cmdDaemonEnable();
  }
  if (action === "disable") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon disable");
    return cmdDaemonDisable();
  }
  if (action === "restart") {
    if (rest.length) throw new SidecarError("usage: sidecar daemon restart");
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
  throw new SidecarError(
    "usage: sidecar daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]",
  );
}

function cmdDaemonAutoUpdate(args: string[]): number {
  const [value, ...rest] = args;
  if (rest.length || (value !== "on" && value !== "off")) {
    throw new SidecarError("usage: sidecar daemon autoupdate on|off");
  }
  requireGlobalRegistry();
  writeSettings({ ...readSettings(), autoUpdate: value === "on" });
  console.log(`autoupdate: ${value}`);
  return 0;
}

// "settings:" is the longest label; padding matches the historical layout.
const DAEMON_LABEL_WIDTH = "settings:".length;

function daemonLine(label: string, value: string, role?: Role): void {
  labelLine(DAEMON_LABEL_WIDTH, label, value, role);
}

/**
 * The `daemon`/`service`/`agent`/... block every daemon subcommand prints.
 * `stopped` is only red while the daemon is enabled: after an explicit
 * disable it is the state the user just asked for.
 */
function printDaemonBlock(service: DaemonServiceStatus, enabled: boolean): void {
  daemonLine("daemon", enabled ? "enabled" : "disabled", enabled ? "ok" : "attn");
  printServiceLines(service, enabled);
  daemonLine("settings", settingsPath(), "quiet");
}

function printServiceLines(service: DaemonServiceStatus, enabled: boolean): void {
  const role: Role = service.running
    ? "ok"
    : !service.available
      ? "quiet"
      : enabled && service.installed
        ? "bad"
        : "quiet";
  daemonLine("service", daemonServiceLabel(service), role);
  if (service.path) daemonLine("agent", service.path, "quiet");
  if (service.message) daemonLine("detail", service.message);
}

function cmdDaemonStatus(): number {
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

function cmdDaemonEnable(): number {
  requireGlobalRegistry();

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  printDaemonBlock(service, true);
  return 0;
}

function cmdDaemonDisable(): number {
  requireGlobalRegistry();

  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  printDaemonBlock(service, false);
  return 0;
}

function cmdDaemonRestart(): number {
  requireGlobalRegistry();

  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  printDaemonBlock(service, true);
  return 0;
}

async function cmdDaemonRun(args: string[]): Promise<number> {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval", "--debounce"]),
  });
  if (parsed.positional.length) throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  requireGlobalRegistry();

  const intervalSeconds = Number(getValue(parsed, "--interval", "600"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }
  const debounceSeconds = Number(getValue(parsed, "--debounce", "60"));
  if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0) {
    throw new SidecarError("--debounce must be >= 0");
  }

  const { runDaemonLoop } = await import("./daemon.js");
  return runDaemonLoop({
    once: parsed.flags.has("--once"),
    intervalSeconds,
    debounceSeconds,
  });
}

export async function cmdUpdate(args: string[]): Promise<number> {
  if (args.length) throw new SidecarError("usage: sidecar update");
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("update must run from a globally installed sidecar; update local installs with your package manager");
  }

  console.log(`checking npm for ${PACKAGE_NAME} updates...`);
  const { checkAndInstallUpdate } = await import("./daemon.js");
  const result = await checkAndInstallUpdate();
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

// Records how the global executable got onto this machine (npm, bun, the
// curl script, ...) so update paths can pick the matching channel instead of
// guessing from filesystem layout.
export function cmdSetInstallSource(args: string[]): number {
  const parsed = parseOptions(args, { boolean: new Set(["--if-unset"]), value: new Set() });
  const [source, ...extra] = parsed.positional;
  if (!source || extra.length || !INSTALL_SOURCES.has(source as InstallSource)) {
    throw new SidecarError("usage: sidecar set-install-source npm|bun|curl [--if-unset]");
  }
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("set-install-source must run from a globally installed sidecar");
  }
  const settings = readSettings();
  // --if-unset lets postinstall record the default channel without an npm-run
  // autoupdate clobbering a source (like "curl") that owns the install.
  if (parsed.flags.has("--if-unset") && settings.installSource) {
    console.log(`install source: ${settings.installSource} (kept)`);
    return 0;
  }
  writeSettings({ ...settings, installSource: source as InstallSource });
  console.log(`install source: ${source}`);
  return 0;
}

export function cmdRegisterInstall(args: string[]): number {
  if (args.length) throw new SidecarError("usage: sidecar register-install");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("install registration requires a global sidecar executable");
  }

  const [root, config] = loadProject();
  registerCurrentInstance(root, config, { event: "install-register" });
  return 0;
}
