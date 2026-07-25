# Uninstall & troubleshooting

Installing sidecar leaves three things on a machine beyond the package
itself: a per-user background service, a state directory, and per-repo
files. This page lists where each lives and how to remove or debug it.

## What lives where

| thing | macOS | Linux |
|---|---|---|
| daemon service | `~/Library/LaunchAgents/com.anteprojector.sidecar.plist` | `~/.config/systemd/user/com.anteprojector.sidecar.service` |
| state dir (registry, settings, log, daemon pid) | `~/Library/Application Support/sidecar` | `~/.local/state/sidecar` (or `$XDG_STATE_HOME/sidecar`) |
| per-repo | `.sidecar` config, the checkout (default `sidecar/`), a `.gitignore` entry, an optional `.zed/settings.json` inclusion | same |

`sidecar instances` prints the exact registry and log paths on your machine;
`sidecar daemon status` prints the settings path and service state.

## Uninstall

```sh
# 1. Stop the daemon and its service
sidecar daemon disable

# 2. Remove the service definition
rm -f ~/Library/LaunchAgents/com.anteprojector.sidecar.plist        # macOS
rm -f ~/.config/systemd/user/com.anteprojector.sidecar.service      # Linux
systemctl --user daemon-reload                                      # Linux

# 3. Remove the package (whichever installed it; curl installs use npm)
npm uninstall -g @projectors/sidecar
# or: bun remove -g @projectors/sidecar

# 4. Remove machine state
rm -rf "$HOME/Library/Application Support/sidecar"                  # macOS
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/sidecar"              # Linux
```

Per repo, if you want the traces gone too: delete `.sidecar`, the sidecar
checkout directory, its line in `.gitignore`, and the `sidecar/**` entry in
`.zed/settings.json` if you accepted that prompt. The sidecar *remote* repo
is yours and is never touched.

## Troubleshooting

**Where do I look first?** `sidecar status` in the repo, then `sidecar tail
-f` for the machine-level log — every command, sync, and failure lands there
as one JSON line.

**The daemon isn't running.** `sidecar daemon status` shows why: `disabled`
means you (or a script) ran `daemon disable` — re-enable with `sidecar daemon
enable`; `not installed` means the service definition is missing — the same
command reinstalls it. On Linux without systemd there is no service; run
`sidecar daemon run` in a supervisor of your choice.

**"another sidecar sync is already running" won't go away.** Syncs serialize
on `.git/sidecar-sync-lock` in the main repo; the error means something holds
it — usually a daemon sync that is genuinely still working (`sidecar tail -f`
shows it). A lock left by a crashed sync is detected by pid and stolen
automatically, and any lock older than ten minutes is treated as stale, so
this resolves itself; if you're certain no sync is running, removing that
directory is safe.

**Sidecar keeps updating itself and I don't want that.** `sidecar daemon
autoupdate off` pins the global install; `sidecar update` still works
manually.

**I need the daemon to leave a repo alone.** Delete the repo's `.sidecar`
config; the daemon prunes the registration after a few missed cycles. To
stop background sync everywhere, `sidecar daemon disable`.

**Useful environment variables.** `SIDECAR_STATE_DIR` relocates the state
directory (the test suite uses this); `SIDECAR_SKIP_SERVICE=1` prevents any
command from touching the launchd/systemd service.
