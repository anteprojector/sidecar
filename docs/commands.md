# Commands

Every command and flag the CLI accepts. The most common ones first:

```sh
sidecar init               # set up or join sidecar in a repo; prompts for a
                           # remote, or creates one with gh, when .sidecar is absent
sidecar init <remote>      # set up sidecar non-interactively with a known remote
sidecar deinit             # remove files and configuration created by sidecar init
sidecar status             # show checkout, daemon health, last sync, pending work
sidecar health             # show how every machine sharing this sidecar is syncing
sidecar sync               # snapshot, push, merge, and push canonical state
sidecar snapshot           # commit local changes to the inbox branch, nothing else
sidecar clone              # clone or update the configured sidecar repo
sidecar merge --fork-files # merge inbox branches and preserve conflicts
sidecar redactions         # preview what redaction changes on the next push
sidecar instances          # list known local sidecar checkouts
sidecar daemon status      # report daemon health, service state, settings paths
sidecar daemon restart     # restart the background auto-sync process
sidecar update             # update the global install from npm now
sidecar tail -f            # follow the machine-level sidecar log
sidecar version            # print the installed version
```

## Full reference

### `sidecar init [remote] [options]`

Sets up sidecar in the current repo, or joins an existing `.sidecar` config.
With no config it asks where the checkout should live, then prompts for a
remote URL (or creates one with `gh`); pass the remote to run
non-interactively.

Answering `.` to the path question — or passing `--path .` — makes the repo
itself the sidecar; that init ends with a first sync, so `.sidecar` and any
uncommitted files land on the remote immediately. See
[standalone.md](standalone.md).

| flag | effect |
|---|---|
| `--path <dir>` | where the sidecar checkout lives (default `sidecar`); `.` means standalone |
| `--branch <name>` | canonical branch in the sidecar repo (default `main`) |
| `--inbox <template>` | inbox branch template (default `sidecar-inbox/{user}/{random}`) |
| `--redaction <mode>` | what gets redacted on push: `secrets+pii`, `secrets`, or `none` — defaults to `secrets`; see [redaction.md](redaction.md) |
| `--no-clone` | write config and registration only; skip cloning |
| `--no-bootstrap-main` | don't create the canonical branch on an empty remote |
| `--local-install` | add `sidecarsync` to `devDependencies` (plus the bun/pnpm trust entry) so fresh clones self-register on install |

`init` also adds the checkout to `.gitignore`, registers the repo with the
global daemon, and (interactively) offers to install a missing global sidecar
and to make the checkout searchable in Zed. When the repo has a
`package.json`, it offers to add the `sidecarsync` devDependency —
the package's postinstall is what makes a fresh clone self-register with the
machine's daemon on plain install (see [install.md](install.md)). It never
edits `package.json` without asking. When not attached to a terminal, every
optional prompt defaults to no.

### `sidecar deinit`

Removes Sidecar from the current Git repository: the `.sidecar` config, the
configured checkout, Sidecar-owned `.gitignore`, Git exclude, Zed search, and
daemon registry entries. It preserves unrelated settings and does not touch
`package.json` or installed dependencies. Outside a Git repository it warns,
does nothing, and exits successfully.

In a [standalone](standalone.md) repo there is no checkout to delete, so
`deinit` instead unwires the redaction git filter and switches back to the
canonical branch, leaving the repo intact.

Any step `deinit` cannot complete — an unreadable config, a standalone repo
it won't switch off its inbox branch — is listed in a closing warning so
nothing is left behind silently.

### `sidecar status`

Shows checkout, daemon health, last sync time, and pending inbox branches.
See [Reading `sidecar status`](#reading-sidecar-status) below.

### `sidecar health [--json] [--no-fetch]`

Shows how every machine sharing this sidecar is syncing — not just this one.
Each checkout publishes a heartbeat on every sync, so a laptop that quietly
stopped contributing is visible from any other machine. `--json` prints the
raw records; `--no-fetch` reads the refs already on disk instead of fetching
first. See [Fleet health](#fleet-health) below.

### `sidecar sync [--local] [--no-snapshot] [--soft] [-m|--message <text>]`

Snapshot local changes, settle this machine's other working copies of the
same sidecar, push the inbox branch, merge all inbox branches into the
canonical branch, and push it. `--local` stops after settling — no fetch, no
push, nothing that needs the remote (see
[One machine, many working copies](sync.md#one-machine-many-working-copies)).
`--no-snapshot` syncs without committing
local edits; `-m` sets the snapshot commit message. If another sync (usually
the daemon's) holds the repo's sync lock, `sync` fails immediately with
"another sidecar sync is already running" — rerun it once that sync finishes.
`--soft` makes it a request instead: when the lock is held it silently
no-ops and exits 0. That's what the daemon uses, since its next trigger
retries anyway.

### `sidecar snapshot [--push] [-m|--message <text>]`

Commit local sidecar changes to the inbox branch without merging anything.
`--push` also pushes the inbox branch. Takes the same sync lock as `sync`.

### `sidecar merge [--fork-files] [--no-push]`

Merge remote inbox branches into the canonical branch. A conflict stops the
merge unless `--fork-files` is passed, which keeps every side as separate
forked files. `--no-push` merges locally without pushing.

### `sidecar redactions`

Preview exactly what redaction changes: a per-file diff of local content
against what is pushed, recomputed on demand from the working tree. See
[redaction.md](redaction.md) for modes and the per-file opt-out pragma.

### `sidecar clone [--if-missing]`

Clone the configured sidecar repo (or update an existing checkout). In a repo
with several working copies — git worktrees, jj workspaces — the checkout is
created as a linked worktree of the primary working copy's clone instead of a
second clone. `--if-missing` is a no-op when the checkout already exists.

### `sidecar instances [--json]`

List every sidecar checkout registered on this machine, with config, checkout,
and dirty state. `--json` prints the raw records.

### `sidecar daemon <subcommand>`

Manages the background auto-sync daemon. Only available from a global install.

| subcommand | effect |
|---|---|
| `status` | daemon health, service state, autoupdate setting, file paths |
| `enable` | enable and (re)install the per-user service, start the daemon |
| `disable` | stop the daemon and disable the service |
| `restart` | reinstall the service definition and restart the daemon |
| `autoupdate on\|off` | let the daemon update the global install daily, or pin it |
| `run [--once] [--interval <seconds>] [--debounce <seconds>]` | run the daemon loop in the foreground; `--once` does a single cycle |

### `sidecar update`

Check npm and update the global install now, then refresh the daemon service.

### `sidecar tail [-f|--follow] [-n|--lines <count>]`

Print the machine-level sidecar log (default: last 50 lines). `-f` follows.

### `sidecar version`

Print the installed version (also `--version` / `-v`).

### Plumbing commands

You normally never run these; installers do.

| command | purpose |
|---|---|
| `sidecar set-install-source npm\|bun\|curl [--if-unset]` | record how the global executable was installed so the self-updater uses the matching channel; `--if-unset` keeps an existing record |
| `sidecar register-install` | register the current repo with the global daemon (run by `init` and postinstall) |
| `sidecar redact --mode=<mode>` | the git clean filter (stdin → redacted stdout); wired into the sidecar checkout automatically |

## Reading `sidecar status`

```
main repo:     ~/dev/your-repo
sidecar path:  ~/dev/your-repo/sidecar
remote:        https://github.com/you/your-repo-sidecar.git
main branch:   main
inbox branch:  sidecar-inbox/zack/79ffcdaf92aa
checkout:      present
branch:        sidecar-inbox/zack/79ffcdaf92aa
dirty:         no
daemon:        running
last sync:     4 minutes ago (2026-07-25 11:58)
pending inbox: none
```

Color is spent sparingly, so a healthy sidecar is nearly monochrome and anything
colored is worth reading:

| color | meaning |
|---|---|
| dim | labels, and values that mean "nothing here" (`no`, `none`, `never`) |
| purple | your repo |
| yellow | the sidecar — its checkout path and the remote it syncs with |
| **bold yellow** | something is waiting on you: `dirty: yes`, a pending inbox count, a detached checkout, or a checkout parked off its inbox branch |
| green | `daemon: running` |
| red | the daemon should be running and isn't, or the checkout is missing |

`daemon:` is dim rather than colored when this install can't run one — a
project-local sidecar has no daemon of its own, so it reports `no global install`.
`last sync:` comes from the machine-level instance registry and is never colored
by age: a sidecar only syncs when something changed, so a quiet week is normal.

Color is off automatically when output is not a terminal, so `sidecar status |
grep dirty` stays clean. `NO_COLOR=1` (or `FORCE_COLOR=0`, or `TERM=dumb`) turns
it off on a terminal too, and `FORCE_COLOR=1` keeps it on through a pipe.

## Fleet health

`status` answers "how is this checkout"; `health` answers "how is every machine
sharing this sidecar". A sync can fail for reasons only the failing machine
witnesses — a redaction filter that has gone unrunnable, a remote that rejects
its push, a checkout left mid-rebase — and without this those failures reach
only that machine's local log.

```
remote: https://github.com/you/your-repo-sidecar.git
fleet:  1 ok, 1 failed

zack@stout
  status:   failed at snapshot
  detail:   external filter 'sidecar redact' failed
  failures: 4 in a row
  checkout: ~/dev/your-repo
  inbox:    sidecar-inbox/zack/1c0de4a19b3f
  reported: 9 minutes ago (2026-07-26 11:41)
  last ok:  2 days ago (2026-07-24 08:20)
  version:  0.9.0

zack@fox  (this checkout)
  status:   ok
  checkout: ~/dev/your-repo
  inbox:    sidecar-inbox/zack/79ffcdaf92aa
  reported: just now (2026-07-26 11:50)
  version:  0.9.0
```

Machines are listed worst first, so the one that needs you is at the top. Red is
a machine reporting its own failure; bold yellow is one that has gone quiet.

### How it works

Every sync — successful or not — publishes a single `health.json` to a branch
that checkout alone writes:

```
sidecar-inbox/zack/79ffcdaf92aa    your notes, merged into the canonical branch
sidecar-health/zack/79ffcdaf92aa   this checkout's heartbeat, never merged
```

Three properties come out of that layout:

- **No conflicts.** A checkout writes only its own branch, so two machines
  failing at once never contend. The alert mechanism can't become a source of
  alerts.
- **Your notes stay notes.** The health namespace sits outside the inbox one, so
  `merge` passes over it and nothing appears in your canonical branch or your
  working tree. `health` reads the refs directly.
- **It survives what it reports.** The heartbeat is written with git plumbing —
  no working tree, no index, no branch checkout, and no clean filter. A machine
  whose `git add` fails can still say so.

Each heartbeat is a fresh root commit, force-pushed over the last one: liveness
history has no value worth its unbounded growth, and being a branch's only
writer means a force push can never lose anyone's work.

### Retiring a machine

A checkout that stops syncing keeps its last heartbeat, so a laptop you have
stopped using reads as `stale` indefinitely — correct, but noise once it's
deliberate. Nothing deletes it for you: `deinit` never touches the remote. Drop
the branch by hand when you retire a machine:

```sh
sidecar health --json | grep '"branch"'          # find the one to remove
git -C <sidecar-checkout> push origin --delete sidecar-health/zack/1c0de4a19b3f
```

Deleting it is always safe. A health branch holds one generated file and no
notes, and if that machine ever syncs again it simply republishes.

### Why a heartbeat and not an alert file

Because absence has to mean something. A file that only appears on failure can't
distinguish "everything is fine" from "that machine has been shut for a week" —
and the silent stop is the failure most worth catching. A machine that reports
`ok` on a schedule makes its own silence legible: after 24 hours without a
report it reads as `stale` rather than `ok`.

Healthy machines refresh hourly rather than on every sync, so a repo synced on
the 10-minute daemon cycle doesn't push 144 times a day to say nothing new.
Failures and recoveries publish immediately, whatever the interval.

Failure messages are git's own, which means they can quote a remote URL with a
token in it. They go through [redaction](redaction.md) before they are published,
independently of the repo's redaction mode — the health branch deliberately
bypasses the clean filter, so nothing downstream would catch it.
