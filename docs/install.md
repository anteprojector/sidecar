# Global vs local installs

Sidecar supports macOS and Linux. Windows is coming soon.

The recommended setup is a single global install (`npm install -g
@projectors/sidecar`); it owns the background daemon that keeps every
registered repo in sync (see [how syncing works](sync.md)). The install
script (`curl -fsSL https://raw.githubusercontent.com/anteprojector/sidecar/main/packages/sidecar/install.sh | sh`)
is equivalent — it runs the npm install for you after checking prerequisites.

Each install path records its source (`npm`, `bun`, or `curl`) in sidecar's
per-user `settings.json`, and the self-updater consults that record to pick
the matching update channel — so future distribution channels keep updating
seamlessly.

A repo can additionally pin sidecar as a node dependency by adding
`@projectors/sidecar` to its `devDependencies` itself — `sidecar init` never
edits your `package.json`. When the dependency is present, the `sidecar`
command always runs that project-local version, so a repo's pinned sidecar
owns its own behavior; without it, everything (including daemon-scheduled
syncs of the repo) runs the global install. Local sidecar never installs
hooks or background sync: it syncs only on an explicit `sidecar sync`, and
its postinstall clones a missing checkout and registers the repo with the
global daemon when one exists. (Older versions installed git hooks; current
versions remove those automatically.)

Daemon commands — and the plumbing commands `set-install-source` and
`register-install` — always run the global executable, never a project-local
copy.

See [uninstall.md](uninstall.md) for removing sidecar and everything it
leaves on the machine, plus troubleshooting.
