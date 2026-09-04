<p align="center">
  <img src="https://raw.githubusercontent.com/anteprojector/sidecar/main/packages/marketing/branding/readme-hero.svg" alt="sidecar" width="420" />
</p>

<p align="center">
  <a href="https://anteprojector.github.io/sidecar/">Website</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/commands.md">Commands</a> ·
  <a href="https://www.npmjs.com/package/sidecarsync">npm</a>
</p>

# sidecar

[![CI](https://github.com/anteprojector/sidecar/actions/workflows/ci.yml/badge.svg)](https://github.com/anteprojector/sidecar/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/sidecarsync)](https://www.npmjs.com/package/sidecarsync)
[![license](https://img.shields.io/npm/l/sidecarsync)](LICENSE)
[![node](https://img.shields.io/node/v/sidecarsync)](https://nodejs.org)

Sidecar is a child repo — *not a submodule* — for your repo. Gitignored,
shared, auto-synced, and never a merge conflict: give your agents a
scratchpad that's always up to date.

```text
your-repo/
  |-- .sidecar        # committed config (points at the sidecar remote)
  |-- sidecar/        # gitignored, shared, auto-synced, no merge conflicts
```

Your agents' planning docs, research notes, and context files don't belong
in your code's history. They shouldn't reset when you switch branches or
worktrees, and the latest version is the only one that matters. sidecar
keeps them in a separate git repo that lives *inside* your working tree,
while a background daemon keeps every clone in sync.

- **It's just git.** The scratchpad is a normal repo you own — clone it,
  grep it, read it on GitHub, build your own extensions with git hooks.
- **Zero merge conflicts.** Each machine writes to its own inbox branch;
  sidecar merges them so a sync never stops you to resolve anything.
- **Zero ceremony.** The daemon watches for changes and syncs automatically.
  You never commit, pull, or push it by hand.
- **Found by default.** It lives inside your working tree, so agents and
  tools pick it up with no configuration at all.
- **Secrets stay home.** Pasted API keys and tokens are redacted from pushes
  while your local files stay untouched; PII redaction is one flag away —
  [how redaction works](docs/redaction.md).

## Quickstart

Requires Node.js 20+ and git, on macOS or Linux. (Windows is coming soon.)

```sh
npm install -g sidecarsync
cd ~/dev/your-repo
sidecar init
```

That's it. If the repo already has a committed `.sidecar` file, init joins
the existing sidecar. If not, init walks you through it — pick where the
checkout lives, then paste a remote URL, or leave it blank and init creates
a private repo for you with the GitHub CLI (`gh`).

The daemon takes it from here. `sidecar status` shows what's happening;
`sidecar sync` forces a sync right now. Once a second machine joins,
[`sidecar health`](docs/commands.md#fleet-health) shows whether all of them are
still syncing — a sync can fail on one laptop for reasons the others would
otherwise never hear about.

### Standalone repos

Some repos have no parent — a dotfiles or machine-setup repo you keep on
every machine, that wants auto-sync for its own sake. Answer `.` when init
asks for the checkout path (or pass `--path .`) and the repo becomes its own
sidecar, syncing to its own remote:

```sh
cd ~/dev/setup
sidecar init --path .
```

Sidecar takes over branch management there —
[how standalone works](docs/standalone.md).

### Peers

A repo can carry more than one sidecar. `.sidecar` is the default; every
`.sidecar.<name>` beside it is another, with its own remote and checkout,
and the two never interact — so one can be committed for the team while
another is gitignored and yours alone:

```sh
sidecar init git@github.com:you/your-repo-private.git --peer private --ignored
```

Every command acts on all peers unless `--peer` names one —
[how peers work](docs/sync.md#peers-several-sidecars-in-one-repo).

## Learn more

- [How syncing works](docs/sync.md) — the daemon, inbox branches, conflict-free merging
- [Standalone repos](docs/standalone.md) — a repo that is its own sidecar
- [Peers](docs/sync.md#peers-several-sidecars-in-one-repo) — several sidecars in one repo, one committed and one ignored
- [Redaction](docs/redaction.md) — what's stripped from pushes, reviewing it, opting out
- [Editor search visibility](docs/editors.md) — making gitignored files searchable
- [Global vs local installs](docs/install.md) — the newest install wins
- [All commands](docs/commands.md)
- [Uninstall & troubleshooting](docs/uninstall.md) — removing the daemon, service, and state

## Inspiration

- [hunk](https://www.hunk.dev/)
- [plannotator](https://github.com/backnotprop/plannotator)
- [jujutsu](https://github.com/jj-vcs/jj)
