# How syncing works

The global install owns automation. It registers a per-user daemon
(launchd on macOS, a systemd user unit on Linux, a Startup-folder entry on
Windows) that:

- watches up to 100 of the most recently synced registered sidecars with
  chokidar. A change syncs within seconds — but most of those syncs stay
  local: they settle this machine's working copies (below) and only make the
  remote round trip once the 60-second debounce since the last one has
  passed, so a burst of edits reaches sibling checkouts almost immediately
  while the remote sees one sync a minute. A save that lands while a sync is
  already running is not lost either: when the sync finishes, the daemon
  checks the checkout and syncs again if that save left uncommitted work
- syncs every registered repo on a 10-minute interval as a backstop — this is
  also the fallback on platforms where file watching is unreliable
- runs each repo's project-local sidecar for the sync when it is newer than
  the daemon, and its own copy otherwise
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

## One machine, many working copies

Working copies of one repo — git worktrees, jj workspaces — share a single
sidecar clone. The working copy that owns the repo's VCS store keeps the
clone; every other one gets a linked worktree of it, each still on its own
inbox branch. Sharing an object store is what makes local sync near-instant:
a sync merges inbox branches and settles this machine's checkouts first,
before anything touches the network, so two agents in sibling worktrees see
each other's notes in seconds even when the remote is unreachable. The
remote round trip runs behind it; `sidecar sync --local` stops before it.

Settling is deliberately timid: only a clean sibling checkout parked on its
inbox branch is fast-forwarded, and one that cannot be settled is left for
its own next sync. When the family cannot be resolved at all — an unreadable
primary, mismatched remotes — a checkout simply gets its own clone, which is
what it would have had anyway.

An independent clone is slower, not broken: it still syncs, it just trades with
its siblings through the remote rather than the store they already share, so
local settling needs the network. Checkouts made before family linking worked
are in exactly that state, as are jj workspaces from before sidecar could
resolve a relative `.jj/repo` pointer. `sidecar status` names them, and
[`sidecar refresh`](commands.md#sidecar-refresh---force---yes) converts one when
you ask. Nothing converts a checkout on its own — rewriting a directory of your
notes is not something an install hook should decide to do.

A per-family lock (per-repo, when nothing shares the clone) serializes
syncs, and the two kinds of sync react differently
to finding it held. A manual `sidecar sync` (or `sidecar snapshot`) is a
demand: it fails immediately with "another sidecar sync is already running" —
rerun it once the other sync finishes. A daemon-triggered sync is a soft
request (`sidecar sync --soft`): it silently no-ops, because the watcher or
the next interval will simply request again. A lock left behind by a crashed
sync is detected by pid (or, failing that, by a ten-minute age limit) and
stolen automatically. `last sync` in `sidecar status` is only stamped by a
sync that actually ran.
