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
- `rules.ts` — per-peer `.sidecar-rules` TOML: strict validation, checkout-relative glob matching, ordered policy overrides, fingerprints.
- `state.ts` — machine-local state dir: settings.json, instances.json registry, event log, per-family sync lock.
- `service.ts` — OS service wrapper for the daemon (launchd/systemd/Startup), pid liveness. The loop itself is `daemon.ts`.
- `ui.ts` — label/value output rows, human timestamps, blocking TTY prompts.
- `sync.ts` — the engine: snapshot, inbox merge + conflict forking, clone/settle, redaction filter wiring, health heartbeat.
- `cmd-init.ts` / `cmd-status.ts` / `cmd-daemon.ts` / `cmd-sync.ts` — command handlers, thin over the modules above.
- `cmd-refresh.ts` — the exception to "thin": `sidecar refresh` owns its own engine code, because it is the only path that deletes a checkout and the guards keeping that safe belong next to it rather than beside the clone/settle functions they resemble.
- `commands.ts` — the COMMANDS table + dispatch. **Adding a command = one table entry here plus a handler in a cmd-\*.ts**; usage text and typo suggestions derive from the table.
- `bin.ts` — entry point; resolves which install runs the command (newest wins between global and project-local) before `main()` does any work.

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
- **Policy authority.** Rules sit beside the host peer config, outside a nested
  sidecar's synced checkout. Standalone shares policy with its writers. Never
  discover a nested peer's rules from synced content. Git filter commands are
  shared by worktrees, but their policy bindings live beside each checkout's
  index; never embed one checkout's mode or host rules path in the shared command.
  Reprocess tracked files when effective policy changes, and only mark that
  policy applied after a successful snapshot. Missing bindings fail closed.
- **Standalone vs nested.** `path = "."` means the user's repo IS the sidecar.
  Standalone changes nearly every code path: no gitignore wiring, origin is the
  remote, and sidecar must never rewrite the user's working tree.
- **Sync lock.** Per repo family and peer, in the state dir.
  `withSyncLock(root, peer, "throw", ...)` for user-demanded commands,
  `"skip"` for daemon soft requests that will fire again anyway. Never stamp
  lastSyncAt without holding it.
- **Peers never interact.** `.sidecar` and each `.sidecar.<name>` are
  separate sidecars: the registry, the lock, the daemon's bookkeeping, and
  family linking are all keyed by config path (`instance.configPath`), never
  by root alone. `config.peer` is derived from the file name in `readConfig`
  and is how a `(root, config)` pair knows which file it came from. A command
  fans out over `loadPeers(selectedPeer(parsed))`; the daemon names the peer
  through `SIDECAR_PEER`, an env var like every other request it makes.

## Build & test

- `bun run build` bundles `src/bin.ts` into the single committed `dist/cli.js`;
  `import.meta.url` tricks (`redactCliPath`, `packageVersion`) resolve against
  that bundle at runtime, so keep the one-file output.
- `bun run check` typechecks. `bun run test` is the fast suite and does not
  build or spawn the real CLI. `bun run test:integration` rebuilds `dist` and
  runs the full suite, including real Git repositories, CLI processes, and
  daemon behavior.
