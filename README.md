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
npm install -g github:anteprojector/sidecar
cd ~/dev/your-repo
sidecar init git@github.com:org/your-repo-sidecar.git
```

Use sidecar in a repo that already has it
```sh
npm install -g github:anteprojector/sidecar
cd ~/dev/your-repo
bun i
```

## Global vs Local
If installed globally, sidecar registers a daemon and will auto sync
If installed locally, sidecar relies on explicit `npx sidecar sync` to trigger sync

## Useful commands:

```sh
sidecar status             # show checkout, inbox branch, and pending work
sidecar clone              # clone the configured sidecar repo if missing
sidecar sync               # snapshot, push, merge, and push canonical state
sidecar merge --fork-files # merge inbox branches and preserve conflicts
sidecar instances          # list known local sidecar checkouts
sidecar daemon restart     # restart the background auto-sync process
sidecar tail -f            # follow the machine-level sidecar log
```
