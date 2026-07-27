# Standalone repos

Some repos don't belong to a parent. A dotfiles or machine-setup repo lives on
every machine you own, has no code repo to hang off, and wants exactly what
sidecar gives a scratchpad: auto-sync, no merge conflicts, no ceremony.

Standalone mode points sidecar at such a repo directly. Instead of a child
checkout inside a parent, the repo *is* the sidecar:

```text
~/dev/setup/
  |-- .sidecar       # committed, path = "."
  |-- install.sh     # your files, auto-synced
```

## Setup

```sh
cd ~/dev/setup
sidecar init
```

`init` asks where the checkout should live. Answer `.` and confirm, and the
repo adopts itself. Scripts skip both questions with `--path .`:

```sh
sidecar init --path .
```

The remote is the repo's own `origin` — sidecar doesn't create or ask for a
second repo. If the repo has no origin yet, `init` says so and stops.

`init` finishes with a first sync: the committed `.sidecar` — and anything
else uncommitted, per the snapshot rule below — lands on the remote
immediately instead of waiting for the daemon's next pass.

If the repo has a `package.json`, accept init's offer to add
`sidecarsync` to `devDependencies` (or pass `--local-install`):
fresh clones then self-register with the daemon on plain install, and the
edit rides init's ending sync to every machine. Keep `node_modules`
gitignored — a standalone sync snapshots everything untracked, and init
warns if it isn't.

On every other machine, clone the repo and run `init` with no arguments. The
`.sidecar` config is committed, so there's nothing to answer:

```sh
git clone git@github.com:you/setup.git ~/dev/setup
cd ~/dev/setup && sidecar init
```

## Sidecar owns the branches

This is the one rule standalone asks you to accept. Sidecar keeps the checkout
on a per-machine inbox branch (`sidecar-inbox/{user}/{random}`), snapshots your
changes onto it, and merges every machine's inbox into `main` — which exists on
the remote and in sidecar's own bookkeeping, not as a branch you sit on.

In practice:

- **Your own commits work fine.** Commit on the inbox branch whenever you want
  a real message; those commits flow into `main` like any snapshot. Everything
  uncommitted gets swept into a snapshot commit on the next sync.
- **Don't manage branches by hand.** Switching to `main`, rebasing, or
  committing there fights the daemon. `sidecar status` flags a checkout that
  has wandered off its inbox branch, and the next sync moves it back.
- **`git log` is noisy.** History interleaves your commits with snapshot and
  merge commits from every machine. That's the trade for never resolving a
  conflict.

If you lose a push race on `main`, sidecar resets local `main` to the remote
and re-merges — but it parks the discarded tip under
`refs/sidecar-discarded/main/<timestamp>-<tip>` first, so nothing is
unrecoverable:

```sh
git for-each-ref refs/sidecar-discarded/
```

## Tell your agents

Coding agents reach for git by habit — committing, branching, pushing to
"save" work. In a standalone repo that fights the daemon. Recommended
AGENTS.md snippet:

````markdown
This repo is auto-synced by sidecar: every change is committed, merged
across machines, and pushed automatically. Saving a file is the whole job —
do not commit, push, or switch branches. The checkout lives on a
sidecar-owned `sidecar-inbox/*` branch; manual git mutations race the
daemon, and the next sync reverts them. Read-only git (log, diff, show) is
fine.
````

## Redaction and executed files

A standalone repo's files are the artifact. You clone them onto a new machine
and *run* them, so a redaction false positive doesn't mangle a note — it ships
a broken script, and silently, because the machine that wrote the file still
has the original in its working tree.

The default is `secrets` (credentials only — the PII rules are where most
false positives live), same as everywhere. Review `sidecar redactions` before
trusting any mode with content you execute, or init with `--redaction none`.
See [redaction.md](redaction.md).

## Removing it

```sh
sidecar deinit
```

Nothing deletes the repo — it's yours. `deinit` removes `.sidecar`, unwires the
redaction git filter, unregisters the repo from the daemon, and switches back
to `main`. If redaction was on, it leaves the branch alone and tells you why:
switching would replace your local files with their redacted pushed contents.

You're left with a normal git repo holding a `.sidecar` deletion to commit.

## Known rough edges

- The repo sits on a `sidecar-inbox/...` branch, so GitHub's default-branch
  view, `gh`, and editor branch indicators show something unfamiliar.
- Conflicts fork into files like `install.conflict.main.abc1234.sh` alongside a
  `.sidecar-conflicts/` manifest, in a repo you actually use.
- Sync pushes to `main` automatically. Don't point standalone at a repo with
  branch protection or a CI trigger you care about.
- The daemon's watch filter reads only the top-level `.gitignore`, so a repo
  with nested ignore files watches more than it needs to.
