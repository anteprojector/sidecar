// The background service wrapper around the daemon: launchd/systemd/Startup
// definitions, install/stop, and pid-file liveness. The daemon loop itself
// lives in daemon.ts; this module only manages how the OS keeps it running.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { findExecutableOnPath } from "./util.js";
import { GLOBAL_EXEC_ENV, SKIP_LOCAL_EXEC_ENV, currentExecutablePath } from "./install.js";
import { logSidecarEvent, sidecarStateDir } from "./state.js";

export const SKIP_SERVICE_ENV = "SIDECAR_SKIP_SERVICE";
const DAEMON_LABEL = "com.anteprojector.sidecar";

export type DaemonServiceStatus = {
  available: boolean;
  installed: boolean;
  running: boolean;
  path?: string;
  message?: string;
};

export function daemonLaunchAgentPath(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  return path.join(os.homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}

export function daemonServicePath(): string | undefined {
  if (process.platform === "darwin") return daemonLaunchAgentPath();
  if (process.platform === "linux") {
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configDir, "systemd", "user", `${DAEMON_LABEL}.service`);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "sidecar-daemon.vbs");
  }
  return undefined;
}

export function daemonPidPath(): string {
  return path.join(sidecarStateDir(), "daemon.pid");
}

export function readDaemonPid(): number | undefined {
  try {
    const pid = Number(fs.readFileSync(daemonPidPath(), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

// A pid file survives crashes and reboots, and the OS can hand the recorded
// pid to an unrelated process. Before trusting or signaling it, confirm the
// process actually looks like a sidecar daemon.
export function pidIsSidecarDaemon(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform === "win32") return true;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const command = (result.stdout ?? "").trim();
  return command.includes("daemon") && /sidecar|cli\.js/.test(command);
}

export function isDaemonRunning(): boolean {
  const pid = readDaemonPid();
  return pid !== undefined && pidIsSidecarDaemon(pid);
}

export function daemonServiceFileContents(invocation: string[]): string {
  if (process.platform === "darwin") return daemonPlist(invocation);
  if (process.platform === "linux") return daemonSystemdUnit(invocation);
  return daemonWindowsStartupScript(invocation);
}

export function daemonServiceStatus(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  const message =
    process.platform === "linux" && !findExecutableOnPath("systemctl")
      ? "systemd unavailable; run `sidecar daemon run` manually"
      : undefined;
  return {
    available: true,
    installed: fs.existsSync(servicePath),
    running: isDaemonRunning(),
    path: servicePath,
    message,
  };
}

export function installDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: servicePath, message: "root install skipped" };
  }

  fs.mkdirSync(sidecarStateDir(), { recursive: true });
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs.writeFileSync(servicePath, daemonServiceFileContents(invocation), "utf8");

  if (process.platform === "darwin") {
    const domain = launchctlDomain();
    spawnSync("launchctl", ["bootout", domain, servicePath], { stdio: "ignore" });
    const bootstrap = spawnSync("launchctl", ["bootstrap", domain, servicePath], { encoding: "utf8" });
    if (bootstrap.status !== 0) {
      return {
        available: true,
        installed: true,
        running: false,
        path: servicePath,
        message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed",
      };
    }
    spawnSync("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    spawnSync("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    return daemonServiceStatus();
  }

  if (process.platform === "linux") {
    if (!findExecutableOnPath("systemctl")) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: "systemd unavailable; run `sidecar daemon run` manually",
      };
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const enable = spawnSync("systemctl", ["--user", "enable", "--now", `${DAEMON_LABEL}.service`], {
      encoding: "utf8",
    });
    spawnSync("systemctl", ["--user", "restart", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
    if (enable.status !== 0) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: enable.stderr.trim() || enable.stdout.trim() || "systemctl enable failed",
      };
    }
    return daemonServiceStatus();
  }

  // Windows: a Startup-folder script needs no elevation, unlike schtasks ONLOGON.
  stopDaemonProcess();
  startDetachedDaemon(invocation);
  return daemonServiceStatus();
}

export function stopDaemonService(): DaemonServiceStatus {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath) return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", launchctlDomain(), servicePath], { stdio: "ignore" });
  } else if (process.platform === "linux" && findExecutableOnPath("systemctl")) {
    spawnSync("systemctl", ["--user", "disable", "--now", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
  } else if (process.platform === "win32" && fs.existsSync(servicePath)) {
    fs.rmSync(servicePath, { force: true });
  }
  stopDaemonProcess();
  return { available: true, installed: fs.existsSync(servicePath), running: false, path: servicePath };
}

function stopDaemonProcess(): void {
  const pid = readDaemonPid();
  if (!pid || pid === process.pid) return;
  if (!pidIsSidecarDaemon(pid)) {
    fs.rmSync(daemonPidPath(), { force: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

export function startDetachedDaemon(invocation: string[] = currentExecutableInvocation()): void {
  const child = spawn(invocation[0], invocation.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1" },
  });
  child.unref();
}

// The daemon calls this each cycle so a deleted service definition comes back
// on its own; activation is left to the next enable/restart or login.
export function ensureDaemonServiceFile(): void {
  if (process.env[SKIP_SERVICE_ENV] === "1") return;
  const servicePath = daemonServicePath();
  if (!servicePath || fs.existsSync(servicePath)) return;
  try {
    fs.mkdirSync(path.dirname(servicePath), { recursive: true });
    fs.writeFileSync(servicePath, daemonServiceFileContents(currentExecutableInvocation()), "utf8");
    logSidecarEvent("daemon-service-heal", { path: servicePath });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not restore service file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function daemonServiceLabel(service: DaemonServiceStatus): string {
  if (!service.available) return "unavailable";
  if (!service.installed) return "uninstalled";
  return service.running ? "running" : "stopped";
}

function launchctlMessage(result: ReturnType<typeof spawnSync>): string | undefined {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stderr || stdout || undefined;
}

function launchctlDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  return `gui/${uid}`;
}

function currentExecutableInvocation(): string[] {
  return [process.execPath, currentExecutablePath(), "daemon", "run"];
}

function currentExecutableStamp(programArguments: string[]): string {
  const executable = programArguments[1];
  if (!executable) return "unknown";
  try {
    const stat = fs.statSync(executable);
    return `${executable}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return executable;
  }
}

function daemonPlist(programArguments: string[]): string {
  return plist({
    Label: DAEMON_LABEL,
    ProgramArguments: programArguments,
    RunAtLoad: true,
    KeepAlive: true,
    StandardOutPath: path.join(sidecarStateDir(), "daemon.out.log"),
    StandardErrorPath: path.join(sidecarStateDir(), "daemon.err.log"),
    EnvironmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      SIDECAR_DAEMON_EXECUTABLE: currentExecutableStamp(programArguments),
    },
  });
}

function daemonSystemdUnit(programArguments: string[]): string {
  const execStart = programArguments.map((part) => `"${part.replaceAll('"', '\\"')}"`).join(" ");
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
    "",
  ].join("\n");
}

function daemonWindowsStartupScript(programArguments: string[]): string {
  // VBScript doubles quotes to escape them; window style 0 keeps it hidden.
  const command = programArguments.map((part) => `""${part}""`).join(" ");
  return `CreateObject("WScript.Shell").Run "${command}", 0, False\r\n`;
}

function plist(value: Record<string, unknown>): string {
  const body = Object.entries(value)
    .map(([key, item]) => `  <key>${escapeXml(key)}</key>\n${plistValue(item, 2)}`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}

function plistValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (typeof value === "string") return `${pad}<string>${escapeXml(value)}</string>\n`;
  if (typeof value === "boolean") return `${pad}<${value ? "true" : "false"}/>\n`;
  if (Array.isArray(value)) {
    return `${pad}<array>\n${value.map((item) => plistValue(item, indent + 2)).join("")}${pad}</array>\n`;
  }
  if (value && typeof value === "object") {
    return `${pad}<dict>\n${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${" ".repeat(indent + 2)}<key>${escapeXml(key)}</key>\n${plistValue(item, indent + 2)}`)
      .join("")}${pad}</dict>\n`;
  }
  return `${pad}<string></string>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
