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

### Cadence

The daemon's `--debounce` (60 s) and `--interval` (10 min) are defaults. A
repo that wants a different rhythm says so in its committed `.sidecar`, so
every machine syncing it agrees:

```toml
debounce = "10m"   # least time between remote round trips once edits land
interval = "1h"    # most time between round trips while the repo is quiet
```

Seconds, or a number with an `s`, `m`, or `h` suffix; `sidecar init
--debounce 10m --interval 1h` writes them. Local settling between sibling
checkouts is unaffected: it stays at the seconds-scale window. The daemon's
own cycle is the floor on `interval`, since a repo is only looked at when the
daemon polls, and the round trip lands at the first poll inside the last
cycle of the interval, so an hour means an hour at most — never an hour plus
a cycle. A directory written continuously by another program — a build
cache, an agent's state — is the usual reason: one round trip an hour says
everything a commit every minute would, at a hundredth of the history.

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

### Conflicts

`resolve` in `.sidecar` (or `sidecar init --resolve <mode>`) says what a
merge does with a file both machines edited:

| mode | effect |
|---|---|
| `fork` | the default: every version is kept as a separate file beside the original's path, `notes/plan.conflict.main.abc1234.md` and `notes/plan.conflict.sidecar-inbox-zack-79ff.def5678.md`, with a manifest under `.sidecar-conflicts/` naming them. Nothing is lost; someone folds the forks back by hand. |
| `lww` | last writer wins, per path: the side that wrote the file more recently keeps it, and a manifest under `.sidecar-conflicts/` names the dropped version's oid when it had one (still reachable through the merge's second parent). A dropped deletion records `null`. A side that deleted the path wins by deleting it; a tie goes to the incoming branch. |

"More recently" means the file's own change time, not the commit's: every
snapshot records when each file it commits last changed, so a write that sat
in a debounce window for ten minutes before its snapshot still counts from
the moment it happened. A deletion has no file to ask and counts from its
commit, as does a snapshot of more than a few hundred paths or a commit made
by hand. The times are compared across machines, so their clocks need to
roughly agree.

`lww` is for a tree that has one writer at a time — a machine-setup repo you
edit from one laptop and then another, a directory a single daemon writes —
where a conflict means two machines briefly overlapped and the newer state is
the one that matters. Under one writer no merge ever conflicts, so the mode
only decides what happens when that rule is broken. `fork` is for notes several
people edit at once, where every version may be wanted.

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
[`sidecar refresh`](commands.md#sidecar-refresh---force---yes---peer-name) rebuilds one as a
linked worktree when you ask. Nothing converts a checkout on its own — rewriting
a directory of your notes is not something an install hook should decide to do.

A per-family lock (per-repo, when nothing shares the clone; per peer, since
peers share nothing) serializes syncs, and the two kinds of sync react differently
to finding it held. A manual `sidecar sync` (or `sidecar snapshot`) is a
demand: it fails immediately with "another sidecar sync is already running" —
rerun it once the other sync finishes. A daemon-triggered sync is a soft
request (`sidecar sync --soft`): it silently no-ops, because the watcher or
the next interval will simply request again. A lock left behind by a crashed
sync is detected by pid (or, failing that, by a ten-minute age limit) and
stolen automatically. `last sync` in `sidecar status` is only stamped by a
sync that actually ran.

## Peers: several sidecars in one repo

`.sidecar` is the default peer. Every `.sidecar.<name>` beside it is another
sidecar, with its own remote, checkout, and settings:

```text
your-repo/
  |-- .sidecar            # committed: the team's scratchpad
  |-- .sidecar.private    # gitignored: yours alone
  |-- sidecar/            # the default peer's checkout
  |-- private/            # the private peer's checkout, named after it
```

```sh
sidecar init git@github.com:you/your-repo-private.git --peer private --ignored
```

Peers never interact. Each is registered, watched, locked, and synced on its
own, so one can be committed for the whole team while another is ignored and
known only to this clone, and one can run `resolve = "lww"` at an hourly
cadence for a directory an agent writes continuously while the other forks
conflicts and syncs by the minute. That independence is the reason peers are
separate files rather than sections of one: a single committed file cannot be
half ignored.

Naming: a peer's name is lowercase letters, digits, and hyphens, and its
checkout defaults to a directory of the same name. `--peer default` names
`.sidecar` itself. A dot after `sidecar` always means a peer; a hyphen, as in
`.sidecar-conflicts/`, always means something sidecar writes. The suffixes an
editor or a backup would leave — `.sidecar.swp`, `.sidecar.bak`, and the
like — are never read as peers.

Every command acts on all of a repo's peers unless `--peer` names one;
`sidecar status` prints a section per peer, `sidecar sync` syncs each in turn
and reports every failure before exiting. `sidecar deinit` and
`sidecar refresh` are the exceptions: each deletes a checkout, so with more
than one peer declared they do nothing until `--peer` says which. A bare `sidecar init` in a fresh clone joins every peer the repo
declares, which is what a clone needs; a remote or a `--peer` names one.

`--ignored` keeps a peer out of the tree: its config file and its checkout
go in `.git/info/exclude`, git's ignore file that never leaves the machine,
rather than the committed `.gitignore`. Every clone that wants the peer runs
the same init, since nothing in the repo records it. That also means an
ignored peer is per working copy: a git worktree or jj workspace of the
repo does not contain the untracked config, so the peer does not exist
there until it is declared there too. Peers the repo commits link across
working copies like any sidecar — each peer to the matching peer's clone at
the primary.

Only `.sidecar` can be [standalone](standalone.md): the repo can be one
thing, and a peer pointed at `.` is refused.
