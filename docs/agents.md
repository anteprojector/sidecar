# Using Sidecar with agents

Sidecar gives agents a shared place for notes, plans, handoffs, and state.
Agents read and edit ordinary files; Sidecar handles snapshots and transport.
Saving a file can publish it through the daemon, so choose the right peer
and content before writing.

The portable [Sidecar skill](../skills/sidecar/SKILL.md) is a first-pass
companion to this guide. Its folder is self-contained so it can be copied
into an agent's supported skills directory. It is not installed automatically.
This draft targets the implementation in this checkout; older published builds
may not support its per-file rules or whole-file LWW behavior. Check the
installed `sidecar version` against the matching release documentation.
The skill describes using Sidecar; this project's own `AGENTS.md` describes
contributing to Sidecar's implementation.

## Give the agent a destination

Keep repo guidance short and specific. For a repo with shared notes and a
private peer, adapt this snippet to its actual names and paths:

```markdown
This repo uses Sidecar for development notes. Read `.sidecar` and any
`.sidecar.<name>` configs to locate the checkouts; use the Sidecar skill when
available. Shared plans and handoffs belong in the default peer. Use the
private peer only when the task calls for it; it still syncs to its remote.
Read the existing notes before editing them. Edit files directly and let
Sidecar handle Git in those checkouts. Use an explicit `--peer` for commands.
Keep secret values out of notes; document environment variable names instead.
The host code repo follows its normal commit and branch workflow.
```

In a standalone repo, replace the last sentence with:

```markdown
This entire repo is managed by Sidecar (`path = "."`). Stay on its inbox
branch and edit files directly. Sidecar handles commits, merges, and pushes;
ordinary tasks should not switch branches, pull, rebase, reset, or clean.
```

Repo instructions should identify the intended audience and existing note
locations. A peer name alone does not establish who can read its remote.

## Discover, then edit

1. Read the nearest host `.sidecar` configurations and repo instructions.
   Each config's `path` locates its checkout. A default path of `sidecar/`
   is a convention, not a requirement; `path = "."` is standalone.
2. Use `sidecar status --json` to inspect the configured peers when a remote
   check is appropriate. JSON is always an array. Status may fetch; reading
   configs and local files is enough for offline discovery.
3. Read relevant existing notes and the peer's rules when policy matters.
   Ignored checkouts can be absent from ordinary searches. Search their
   explicit directory, enabling ignored/hidden files and excluding `.git`.
4. Update the intended files directly. Do not move a note to a different
   peer or change redaction/merge policy just to make an edit easier.

If there is no Sidecar config, the skill does not imply permission to set up
a remote or adopt the repo. Treat setup as its own task. To join an already
configured peer, `sidecar init --peer <name>` initializes its checkout and
registers it with the daemon. Standalone init may immediately snapshot and
push existing uncommitted files; it is not a read-only discovery command.

## Sync only as far as the task needs

The daemon normally handles synchronization. For an immediate handoff to
another machine, run `sidecar sync --peer <name>` and check its result before
claiming it was published. A successful push confirms the remote has the
changes; it does not confirm the other machine has fetched them. To share among linked working copies on the same
machine, use `sidecar sync --local --peer <name>`; it requires an initialized
checkout and does not fetch, push, or advance the last remote sync time.
If the next agent reads this same checkout, saving the file is enough.

A snapshot includes all eligible pending changes in the selected peer,
including edits from before the current task. Inspect the pending filenames
before an explicit publication and do not describe it as publishing only the
files you just edited. Sidecar is not a selective staging workflow.

Commands generally fan out to every peer unless `--peer` selects one.
`--peer default` means `.sidecar`. A busy lock means another sync owns the
checkout: let that operation finish before retrying. Repeated failures need
diagnosis using the reported error, `sidecar status`, `sidecar tail`, or
`sidecar health`; force-refreshing or removing a lock is not routine recovery.

## Choose how concurrent work survives

Use separate files for independent handoffs when possible. A single shared
file becomes a place where concurrent changes must be reconciled.

`fork` allows Git to combine clean edits and preserves conflicting versions
as separate files. A `.sidecar-conflicts/` manifest maps those files back to
the original path. An agent resolving a fork reads the relevant versions,
writes the intended combined result at the original path, and removes the
superseded forks. Keep unrelated forks and the manifest's recovery information.

`lww` means **whole-file last writer wins**: one complete version survives,
even when edits touch different lines. A winning deletion removes the path.
This suits replaceable state with one logical writer; it does not accumulate
multiple agents' contributions. The timestamp and tie rules are documented
in [sync behavior](sync.md#conflicts). Agents should not emulate LWW by
manually overwriting whatever file looks newest in a directory listing.

Defaults live in the peer's config, with per-path overrides in its
[rules file](rules.md). In nested mode those rules belong to the host repo,
outside synced content. In standalone mode all writers whose changes are
accepted can change policy. In-file comments cannot disable redaction.

## Use environment variables without syncing their values

Store real credentials in a secret manager or machine-local storage outside
the synced checkout. Inject them into the process environment through the
project's existing setup. Synced scripts can read the variable:

```js
const token = process.env.SERVICE_API_TOKEN;
if (!token) throw new Error("Set SERVICE_API_TOKEN in your local environment");
```

A synced setup note should name `SERVICE_API_TOKEN`, explain which service
issues it, and describe how to configure it locally. A template can contain
`SERVICE_API_TOKEN=REPLACE_LOCALLY`; it should not contain a working value.
Do not copy `env` output, authenticated URLs, request headers, or secret-manager
output into notes or handoffs. Report whether a value is configured without
printing the value.

An `.env` file is not special to Sidecar. If it is in the synced checkout,
it can be snapshotted. Ignoring an untracked file can keep it out of future
snapshots, but ignoring an already tracked file does not untrack it, and a
private peer still publishes to its own remote. Keeping values outside the
checkout avoids depending on those distinctions.

Redaction is an additional pattern-based filter. It can miss formats, alter
examples, and deliver placeholders to another machine; it is not a credential
distribution mechanism. `sidecar redactions --peer <name>` previews changes
but shows local originals in its diff, so avoid copying that output into
responses without masking values. Changing policy can publish previously
redacted originals without another edit. If a real credential has already
been published, rotate it through its issuer; deleting the note does not
remove the credential from Git history. See [redaction](redaction.md).
