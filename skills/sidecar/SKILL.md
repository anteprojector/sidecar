---
name: sidecar
description: Use the sidecarsync CLI to read, update, and synchronize Sidecar notes or state in repos with .sidecar configurations. Covers peer selection, standalone repos, per-file rules, and fork recovery.
---

# Sidecar

Sidecar automatically snapshots and syncs files through per-checkout inbox
branches. A file edit may reach other machines without another command.
Use this skill for Sidecar-managed content; the host code repo keeps its
normal development workflow.

This draft targets the accompanying Sidecar implementation. Use `sidecar
version` and matching release documentation when working with another install;
older builds may lack per-file rules or implement LWW only for Git conflicts.
Do not promise whole-file behavior from a build whose support is unknown.

## Find the intended peer

From the host repo, inspect `.sidecar` and `.sidecar.<name>` configurations.
`path` identifies each peer's checkout; do not assume it is `sidecar/`.
`path = "."` means standalone: the host repo itself is synced.

Use `sidecar status --json` when a remote check is appropriate. Its output is
an array even for one peer; use `peer`, `sidecarPath`, `standalone`, `checkout`,
and `daemon` to orient. Status may fetch. For offline work, read configs and
local files directly. Read an applicable rules file too if the task depends
on merge or redaction policy.

Select the peer from the user's request and repo guidance. When the
destination is ambiguous, clarify before writing. Commands without `--peer`
usually act on every peer; `--peer default` selects `.sidecar` specifically.
An ignored/private peer still syncs to its own remote.

## Read and write

Read the existing notes before adding or updating them. Search the explicit
checkout, including ignored files when necessary: ordinary repo searches may
skip it. Keep searches scoped to that checkout and exclude `.git` metadata.

Edit files directly. Let the daemon handle snapshots and transport. Keep
ordinary Git commits, branch switches, pulls, rebases, and pushes out of the
Sidecar checkout; they can race its daemon. This restriction also covers the
whole repo in standalone mode. Read-only Git inspection is useful for history
and fork recovery. Follow an explicit maintenance task separately.

Choose an explicit sync only when the task needs it:

| Need | Command from the host repo |
|---|---|
| Share with other machines now | `sidecar sync --peer NAME` |
| Settle this machine's linked checkouts only | `sidecar sync --local --peer NAME` |
| Preview redaction | `sidecar redactions --peer NAME` |
| Inspect fleet health without fetching | `sidecar health --no-fetch --peer NAME` |

Local sync requires an initialized checkout and does not confirm remote
publication. Saving suffices for another agent reading this same checkout;
local sync matters for linked checkouts. Sync snapshots all eligible pending
changes in the selected peer, not just files edited for this task. Check the
pending filenames before an explicit publication and describe its actual scope.
A successful remote sync establishes publication to the remote, not receipt by
another machine. If a sync reports a busy lock, allow the active operation to finish before
retrying; do not remove the lock. Report persistent failures with the peer and
error. Do not use `refresh --force`, `deinit`, reset, or clean as routine retries.

## Policy and recovery

Rules are `.sidecar-rules` for the default peer and `.sidecar-rules.NAME` for
named peers, beside their configs. Globs are checkout-relative; later matches
override only specified properties. Peers do not inherit rules from each other.

- `fork`: Git merges clean edits normally. Conflicting versions become fork
  files recorded in `.sidecar-conflicts/`. To resolve one, read the manifest
  and versions, write the intended result at the original path, and remove
  the superseded forks as part of that resolution. Then sync the selected peer.
- `lww`: keep the newest whole file version, including a winning deletion;
  never combine its contents. Use separate paths if concurrent contributions
  must all survive.

Changing policy is distinct from editing notes. A malformed rules file stops
sync; fix it rather than bypassing the filter or disabling redaction. Nested
peers take policy from the host repo, not a rules file inside synced content.
Standalone writers share control of config and rules, including redaction.

## Secrets

Keep secret values in a secret manager or machine-local storage outside the
synced checkout. Sync variable names, instructions, and placeholder examples;
have code read values from its runtime environment. An ignored peer, a private
remote, or an `.env` filename does not keep content on one machine.

Do not paste secrets or environment dumps into notes, logs, or handoffs.
Redaction is a pattern-based safety net, not secret storage, and has no in-file
opt-out marker. Loosening policy can publish unchanged local originals at the
next snapshot. Redaction previews include local text: inspect them locally and
avoid reproducing secret-bearing lines in responses. If a value was published,
redacting later does not remove it from Git history.
