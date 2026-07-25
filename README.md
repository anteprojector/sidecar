# sidecar

`sidecar` is the place to store your agent artifacts (or whatever you please). 
It's colocated in your main repo, so your agents have nothing to learn or think about. 
Run one command to sync it, so you have little to learn or think about. 
And its all just git.

```text
your-repo/
+ |-- .sidecar                  # committed config
+ |-- sidecar/                  # gitignored child repo
```

## Usage

`sidecar` requires Node.js 20 or newer and Git.

Add sidecar to a repo
```sh
npm install -g @projectors/sidecar
cd ~/dev/your-repo
sidecar init git@github.com:org/your-repo-sidecar.git
```

Use sidecar in a repo that already has it
```sh
npm install -g @projectors/sidecar
cd ~/dev/your-repo
bun i
```

## Editor search visibility

Because `sidecar/` is gitignored, editors that respect git ignore rules hide it
from file search. `sidecar init` offers to add `sidecar/**` to
`file_scan_inclusions` in `.zed/settings.json` so Zed keeps the files
searchable; commit that file to share it with your team.

VS Code and Cursor have no per-path override. If you want sidecar files
searchable there, set `"search.useIgnoreFiles": false` in
`.vscode/settings.json` — note this makes search ignore *all* git ignore rules,
relying on `search.exclude` patterns instead.

## Global vs Local

When a repo has sidecar as a node dependency, the `sidecar` command always
runs that project-local version, so a repo's pinned sidecar owns its own
behavior. Local sidecar never installs hooks or background sync: it syncs only
on an explicit `sidecar sync`, and its postinstall clones a missing checkout
and registers the repo with the global daemon when one exists. (Older versions
installed git hooks; current versions remove those automatically.)

The global install owns automation. It registers a per-user daemon
(launchd on macOS, a systemd user unit on Linux, a Startup-folder entry on
Windows) that:

- watches up to 100 of the most recently synced registered sidecars with
  chokidar; the first change syncs immediately, and further changes inside a
  60-second quiet window collapse into one trailing sync at its close
  (leading + trailing debounce)
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

Manual `sidecar sync` always runs immediately; a per-repo lock serializes it
against daemon-triggered syncs, so overlapping runs are safe. Daemon commands
always run the global executable, never a project-local copy.

## Useful commands:

```sh
sidecar status             # show checkout, inbox branch, and pending work
sidecar clone              # clone or update the configured sidecar repo
sidecar clone --if-missing # clone only when the checkout is absent
sidecar sync               # snapshot, push, merge, and push canonical state
sidecar merge --fork-files # merge inbox branches and preserve conflicts
sidecar instances          # list known local sidecar checkouts
sidecar daemon restart     # restart the background auto-sync process
sidecar daemon autoupdate off  # keep the global install pinned; on re-enables
sidecar update             # update the global install from npm now
sidecar tail -f            # follow the machine-level sidecar log
```
