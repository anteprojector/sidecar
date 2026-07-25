<p align="center">
  <img src="https://raw.githubusercontent.com/anteprojector/sidecar/main/packages/marketing/branding/readme-hero.svg" alt="sidecar" width="420" />
</p>

<p align="center">
  <a href="https://anteprojector.github.io/sidecar/">Website</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/commands.md">Commands</a> ·
  <a href="https://www.npmjs.com/package/@projectors/sidecar">npm</a>
</p>

# sidecar

[![npm](https://img.shields.io/npm/v/%40projectors%2Fsidecar)](https://www.npmjs.com/package/@projectors/sidecar)
[![license](https://img.shields.io/npm/l/%40projectors%2Fsidecar)](LICENSE)
[![node](https://img.shields.io/node/v/%40projectors%2Fsidecar)](https://nodejs.org)

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

## Quickstart

Requires Node.js 20+ and git, on macOS or Linux. (Windows isn't supported
yet.)

```sh
npm install -g @projectors/sidecar
cd ~/dev/your-repo
sidecar init
```

That's it. If the repo already has a committed `.sidecar` file, init joins
the existing sidecar. If not, init walks you through it — paste a remote
URL, or leave it blank and init creates a private repo for you with the
GitHub CLI (`gh`).

The daemon takes it from here. `sidecar status` shows what's happening;
`sidecar sync` forces a sync right now.

## Learn more

- [How syncing works](docs/sync.md) — the daemon, inbox branches, conflict-free merging
- [Editor search visibility](docs/editors.md) — making gitignored files searchable
- [Global vs local installs](docs/install.md) — pinning sidecar per-repo
- [All commands](docs/commands.md)

## Inspiration

- [hunk](https://www.hunk.dev/)
- [plannotator](https://github.com/backnotprop/plannotator)
- [jujutsu](https://github.com/jj-vcs/jj)
