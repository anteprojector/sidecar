# Per-file rules

Each peer can override its default merge strategy and redaction mode for
matching files. Put a TOML rules file beside that peer's `.sidecar` config:

| Peer | Config | Rules |
|---|---|---|
| Default | `.sidecar` | `.sidecar-rules` |
| Notes | `.sidecar.notes` | `.sidecar-rules.notes` |
| Private | `.sidecar.private` | `.sidecar-rules.private` |

For example, keep both versions of conflicting notes, use last-writer-wins
for generated state, and leave example credentials unchanged:

```toml
[[rules]]
glob = "**/*.md"
resolve = "fork"

[[rules]]
glob = "state/**"
resolve = "lww"

[[rules]]
glob = "examples/**"
redaction = "none"

[[rules]]
glob = "examples/private/**"
redaction = "secrets"
```

Only use `redaction = "none"` for content you intend to publish verbatim.
Inspect the effective redaction with `sidecar redactions --peer <name>`.

## Matching and precedence

Globs are relative to the peer's checkout, not to the rules file. For a peer
whose `path = "notes"`, `state/**` matches files under `notes/state/`.

- `*` matches within one path component: `*.md` matches root Markdown files.
- `**` spans directories: `**/*.md` matches Markdown files at any depth.
- `?`, character classes such as `[0-9]`, and brace alternatives such as
  `*.{md,txt}` are supported.
- Matching is case-sensitive and includes dotfiles. Use `/` separators on
  every platform. Absolute paths and `..` segments are rejected.
- These are positive glob matches, not gitignore rules. A leading `!` has
  no negation meaning; use a later rule to override an earlier one.

Start with the peer's `resolve` and `redaction` settings in its config. Apply
matching rules in file order; later matches override only the properties
they specify. A rule setting `resolve` leaves the effective redaction mode
alone, and vice versa. Peers do not inherit each other's rules.

Each entry requires `glob` and at least one policy:

| Property | Values | Effect |
|---|---|---|
| `resolve` | `fork`, `lww` | Git merge with conflict forks, or whole-file last writer wins |
| `redaction` | `none`, `secrets`, `secrets+pii` | How its content is filtered when staged |

`lww` chooses one complete file version, even when Git could merge edits
cleanly. `fork` retains Git's normal clean merges and preserves conflicting
versions as forks. One merge can use both modes. Manual `sidecar merge`
requires `--fork-files` if any
conflicting path uses `fork`; otherwise it aborts before resolving paths.
See [conflict behavior and LWW semantics](sync.md#conflicts).

## Applying changes

Create or edit the rules file, then run `sidecar sync`, or let the daemon's
next sync apply it. Changes to effective redaction policy reprocess tracked
files on the next snapshot, even if those files were not edited. Deleting
the rules file restores the peer's config defaults; an empty file does the
same. Loosening redaction can therefore publish local originals on the next
snapshot. Earlier commits remain in history.

Malformed TOML, unknown keys, invalid modes, and unreadable rules stop the
affected peer's sync with the file and, where applicable, rule identified. Other peers still
get their turn. A rules-file symlink whose target is missing is an error,
not an absent rules file. If rules change while a snapshot is running, staging stops
instead of mixing policies; the next sync loads the new rules.

`sidecar init --ignored` also excludes the peer's rules file, even before it
exists. Re-running init for an already ignored peer adds that exclusion too.
Tracked rules must be removed from the Git index before making the peer
private. `sidecar deinit --peer <name>` removes that peer's config and rules;
shared ignore entries remain in place for other working copies.

## Who controls policy

In a nested sidecar, the rules live in the host repo beside its config,
outside the checkout that Sidecar syncs. A `.sidecar-rules` file arriving
inside that checkout does not override the host policy. Review host policy
changes through the same process as changes to `.sidecar`.

In [standalone mode](standalone.md), the repo is the sidecar, so its config
and rules are shared along with its content. Every writer whose changes are
synced can change policy, including weakening redaction. Use this mode when
you trust those writers with that authority. Linked worktrees bind to their
own host rules; one working copy's policy does not replace another's.

Initialize each checkout with `sidecar init` before staging files manually.
A worktree created by hand shares Git's required filter but initially has no
local policy binding; staging fails until Sidecar sets up that checkout. It
does not borrow another worktree's policy or silently disable redaction.
