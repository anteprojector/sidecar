# sidecarsync (packages/sidecar)

Git-backed sidecar: every machine snapshots to its own inbox branch on a shared
remote, and a merge sweep folds inboxes into main. `src/cli.ts` is a barrel —
`bin.ts`, `daemon.ts`, and the tests import everything from it, so a symbol's
home module never matters to consumers and new module exports are forwarded
automatically by `export *`.

## Module map (import downward only; no cycles)

- `util.ts` — SidecarError, option parsing, OS/user identity, path/string helpers. Imports nothing internal.
- `git.ts` — every spawn of the git binary; ref/worktree predicates; repo-family election (which working copy owns a shared VCS store).
- `install.ts` — package identity/version, global-vs-project-local detection, finding the global executable.
- `config.ts` — the committed `.sidecar` TOML: read/write/validate, project discovery, standalone detection, inbox branch naming.
- `state.ts` — machine-local state dir: settings.json, instances.json registry, event log, per-family sync lock.
- `service.ts` — OS service wrapper for the daemon (launchd/systemd/Startup), pid liveness. The loop itself is `daemon.ts`.
- `ui.ts` — label/value output rows, human timestamps, blocking TTY prompts.
- `sync.ts` — the engine: snapshot, inbox merge + conflict forking, clone/settle, redaction filter wiring, health heartbeat.
- `cmd-init.ts` / `cmd-status.ts` / `cmd-daemon.ts` / `cmd-sync.ts` — command handlers, thin over the modules above.
- `commands.ts` — the COMMANDS table + dispatch. **Adding a command = one table entry here plus a handler in a cmd-\*.ts**; usage text and typo suggestions derive from the table.
- `bin.ts` — entry point; deliberately self-contained so delegation to a project-local install runs before loading anything else.

## Invariants that are easy to break

- **State split.** Anything shared between machines travels through the git
  remote (branches: main, `sidecar-inbox/<user>/<random>`, `sidecar/health/*`).
  Anything machine-local lives in the state dir. Never mix the two.
- **Old-CLI compatibility.** The daemon drives pinned project-local CLIs that
  may be older than it. New sync behaviors are requested via env vars
  (`SIDECAR_SYNC_SOFT`, `SIDECAR_SYNC_LOCAL`), never new flags — an old CLI
  must ignore the request, not reject an unknown option.
- **Redaction fails closed.** The clean filter is wired with `required=true`,
  so a stale filter command breaks every `git add` in the checkout. That is why
  `ensureRedactionFilter` re-checks on every path and deinit must always unwire
  it. The working tree keeps unredacted originals; only committed blobs are
  redacted — never switch a standalone repo's branch under redaction (it would
  overwrite local files with redacted content).
- **Standalone vs nested.** `path = "."` means the user's repo IS the sidecar.
  Standalone changes nearly every code path: no gitignore wiring, origin is the
  remote, and sidecar must never rewrite the user's working tree.
- **Sync lock.** Per repo family, in the state dir. `withSyncLock(root,
  "throw", ...)` for user-demanded commands, `"skip"` for daemon soft requests
  that will fire again anyway. Never stamp lastSyncAt without holding it.

## Build & test

- `bun run build` bundles `src/bin.ts` into the single committed `dist/cli.js`;
  `import.meta.url` tricks (`redactCliPath`, `packageVersion`) resolve against
  that bundle at runtime, so keep the one-file output.
- `bun run check` typechecks; `bun run test` rebuilds dist then runs vitest —
  integration tests spawn the real `dist/cli.js`, so a stale build fails them.
