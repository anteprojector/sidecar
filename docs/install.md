# Global vs local installs

Sidecar supports macOS and Linux. Windows is coming soon.

The recommended setup is a single global install (`npm install -g sidecarsync`);
it owns the background daemon that keeps every registered repo in sync (see
[how syncing works](sync.md)). The install
script (`curl -fsSL https://raw.githubusercontent.com/anteprojector/sidecar/main/packages/sidecar/install.sh | sh`)
is equivalent — it runs the npm install for you after checking prerequisites.

Each install path records its source (`npm`, `bun`, or `curl`) in sidecar's
per-user `settings.json`, and the self-updater consults that record to pick
the matching update channel — so future distribution channels keep updating
seamlessly.

A repo can additionally pin sidecar as a node dependency. When a
`package.json` is present, `sidecar init` offers to add `sidecarsync` to
`devDependencies` (`--local-install` says yes non-interactively) — and,
detected from the lockfile, the trust entry bun (`trustedDependencies`) or
pnpm (`pnpm.onlyBuiltDependencies`) needs, since both block lifecycle scripts
by default. With no lockfile, init warns that it can't tell. The payoff is on
the next machine: the package's postinstall clones a missing checkout and
registers the repo with the global daemon, so a fresh clone self-registers on
plain `npm install`/`bun install`. It does this only when a global sidecar is
already installed there — the global install is what owns the daemon, so
without it a cloned checkout would sit there never syncing. With no global
install the postinstall clones nothing and prints how to install one, after
which `sidecar init` sets the repo up. Init never edits `package.json` without asking.

When the dependency is present, the newest install wins: the `sidecar`
command compares the project-local version against its own and runs
whichever is newer, with ties going to the global. The daemon picks the same
way for its scheduled syncs of the repo. Updating the global therefore takes
effect in every repo at once, while a repo whose local copy is ahead of a
stale global still runs its own. Local sidecar never installs hooks or
background sync: it syncs only on an explicit `sidecar sync`. (Older
versions installed git hooks; current versions remove those automatically.)

Daemon commands — and the plumbing commands `set-install-source` and
`register-install` — always run the global executable, never a project-local
copy.

See [uninstall.md](uninstall.md) for removing sidecar and everything it
leaves on the machine, plus troubleshooting.
