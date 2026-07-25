# Commands

Every command and flag the CLI accepts. The most common ones first:

```sh
sidecar init               # set up or join sidecar in a repo; prompts for a
                           # remote, or creates one with gh, when .sidecar is absent
sidecar init <remote>      # set up sidecar non-interactively with a known remote
sidecar deinit             # remove files and configuration created by sidecar init
sidecar status             # show checkout, daemon health, last sync, pending work
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
With no remote and no config it prompts for a remote URL (or creates one with
`gh`); pass the remote to run non-interactively.

| flag | effect |
|---|---|
| `--path <dir>` | where the sidecar checkout lives (default `sidecar`) |
| `--branch <name>` | canonical branch in the sidecar repo (default `main`) |
| `--inbox <template>` | inbox branch template (default `sidecar-inbox/{user}/{random}`) |
| `--redaction <mode>` | what gets redacted on push: `secrets+pii` (default), `secrets`, or `none` — see [redaction.md](redaction.md) |
| `--no-clone` | write config and registration only; skip cloning |
| `--no-bootstrap-main` | don't create the canonical branch on an empty remote |

`init` also adds the checkout to `.gitignore`, registers the repo with the
global daemon, and (interactively) offers to install a missing global sidecar
and to make the checkout searchable in Zed. It never edits your
`package.json`: repos that want a pinned project-local sidecar add the
`@projectors/sidecar` devDependency themselves (see
[install.md](install.md)). When not attached to a terminal, every optional
prompt defaults to no.

### `sidecar deinit`

Removes Sidecar from the current Git repository: the `.sidecar` config, the
configured checkout, Sidecar-owned `.gitignore`, Git exclude, Zed search, and
daemon registry entries. It preserves unrelated settings and does not touch
`package.json` or installed dependencies. Outside a Git repository it warns,
does nothing, and exits successfully.

### `sidecar status`

Shows checkout, daemon health, last sync time, and pending inbox branches.
See [Reading `sidecar status`](#reading-sidecar-status) below.

### `sidecar sync [--no-snapshot] [--soft] [-m|--message <text>]`

Snapshot local changes, push the inbox branch, merge all inbox branches into
the canonical branch, and push it. `--no-snapshot` syncs without committing
local edits; `-m` sets the snapshot commit message. If another sync (usually
the daemon's) holds the repo's sync lock, `sync` fails immediately with
"another sidecar sync is already running" — rerun it once that sync finishes.
`--soft` makes it a request instead: when the lock is held it silently
no-ops and exits 0. That's what the daemon uses, since its next trigger
retries anyway.

### `sidecar snapshot [--push] [-m|--message <text>]`

Commit local sidecar changes to the inbox branch without merging anything.
`--push` also pushes the inbox branch. Takes the same per-repo lock as `sync`.

### `sidecar merge [--fork-files] [--no-push]`

Merge remote inbox branches into the canonical branch. A conflict stops the
merge unless `--fork-files` is passed, which keeps every side as separate
forked files. `--no-push` merges locally without pushing.

### `sidecar redactions`

Preview exactly what redaction changes: a per-file diff of local content
against what is pushed, recomputed on demand from the working tree. See
[redaction.md](redaction.md) for modes and the per-file opt-out pragma.

### `sidecar clone [--if-missing]`

Clone the configured sidecar repo (or update an existing checkout).
`--if-missing` is a no-op when the checkout already exists.

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
branch:        main
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
| **bold yellow** | something is waiting on you: `dirty: yes`, a pending inbox count, a detached checkout |
| green | `daemon: running` |
| red | the daemon should be running and isn't, or the checkout is missing |

`daemon:` is dim rather than colored when this install can't run one — a
project-local sidecar has no daemon of its own, so it reports `no global install`.
`last sync:` comes from the machine-level instance registry and is never colored
by age: a sidecar only syncs when something changed, so a quiet week is normal.

Color is off automatically when output is not a terminal, so `sidecar status |
grep dirty` stays clean. `NO_COLOR=1` (or `FORCE_COLOR=0`, or `TERM=dumb`) turns
it off on a terminal too, and `FORCE_COLOR=1` keeps it on through a pipe.
