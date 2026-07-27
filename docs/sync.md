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

The checkout stays on its inbox branch the whole time: merging happens in a
throwaway linked worktree, so switching to the canonical branch never rewrites
the files you are working in. A checkout found parked somewhere else is moved
back to its inbox branch before the merge, and `sidecar status` flags it.

If two machines merge at once, the loser's push of the canonical branch is
rejected; it refetches, resets local `main` to the remote, and re-merges what
is still pending. That reset is the only destructive step in a sync, so the
discarded tip is parked at `refs/sidecar-discarded/<branch>/<timestamp>-<tip>` first
(local only — it is never pushed or fetched).

Every sync also publishes a one-file heartbeat to `sidecar-health/<user>/<id>`,
a namespace the merge deliberately passes over, so a failure on one machine is
visible from all the others without anything reaching the canonical branch. See
[Fleet health](commands.md#fleet-health).

A per-repo lock serializes syncs, and the two kinds of sync react differently
to finding it held. A manual `sidecar sync` (or `sidecar snapshot`) is a
demand: it fails immediately with "another sidecar sync is already running" —
rerun it once the other sync finishes. A daemon-triggered sync is a soft
request (`sidecar sync --soft`): it silently no-ops, because the watcher or
the next interval will simply request again. A lock left behind by a crashed
sync is detected by pid (or, failing that, by a ten-minute age limit) and
stolen automatically. `last sync` in `sidecar status` is only stamped by a
sync that actually ran.
