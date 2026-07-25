# How syncing works

The global install owns automation. It registers a per-user daemon
(launchd on macOS, a systemd user unit on Linux, a Startup-folder entry on
Windows) that:

- watches up to 100 of the most recently synced registered sidecars with
  chokidar; the first change syncs immediately, and further changes inside a
  60-second quiet window collapse into one trailing sync at its close
  (leading + trailing debounce). A save that lands while a sync is already
  running is not lost either: when the sync finishes, the daemon checks the
  checkout and immediately syncs again if that save left uncommitted work
- syncs every registered repo on a 10-minute interval as a backstop — this is
  also the fallback on platforms where file watching is unreliable
- runs each repo's project-local sidecar for the sync when one is installed,
  and its own copy otherwise
- checks npm daily and updates itself (`sidecar daemon autoupdate off` to opt
  out, `sidecar update` to trigger it manually)
- self-heals: it re-clones missing checkouts, restores its service definition,
  prunes registrations whose `.sidecar` config is gone, backs off repos that
  keep failing, and steps aside for a newer global install — whether updated
  in place or reinstalled somewhere else on PATH

## Inbox branches and conflict-free merging

Each sync snapshots local changes onto a per-machine inbox branch and pushes
it, then merges all inbox branches into the canonical branch and pushes that.
Because every machine writes only to its own inbox, a sync never stops you to
resolve a conflict: when two machines edited the same file, `sync` keeps every
version as separate forked files instead of blocking. (A manual `sidecar
merge` stops on conflict unless you pass `--fork-files`.)

A per-repo lock serializes manual `sidecar sync` (and `sidecar snapshot`)
against daemon-triggered syncs: if one is already running, the manual command
prints that it is waiting, runs as soon as the lock frees, and gives up with
an error only after ten minutes — the point at which the lock is presumed
stale and gets stolen. `last sync` in `sidecar status` is only stamped by a
sync that actually ran.
