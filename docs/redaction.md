# Redaction

A sidecar auto-pushes scratchpad files to a shared remote, and scratchpads
are exactly where pasted API keys, connection strings, and personal data end
up. Redaction strips those before they leave the machine — without touching
your local files.

## How it works

Redaction runs as a git *clean filter* in the sidecar checkout: content is
rewritten as it is staged, so the commits and the remote only ever contain
redacted text, while the working tree keeps your original. Matches are
replaced with placeholders like `<API_KEY>`, `<TOKEN>`, `<SECRET>`,
`<EMAIL>`:

```
local file:    OPENAI_API_KEY=sk-abc123...
pushed file:   OPENAI_API_KEY=<API_KEY>
```

The filter is `required`, so it fails closed: if it can't run, staging
errors instead of silently pushing cleartext. Binary and non-UTF-8 files
pass through untouched.

What it catches: known token formats (OpenAI, Anthropic, GitHub, AWS, Slack,
JWTs), PEM private key blocks, `Authorization` headers, URL credentials
(`postgres://user:secret@host`), assignments to sensitive-looking keys
(`password`, `*_TOKEN`, `api_key`, ...), and — depending on the mode below —
emails, phone numbers, SSNs, and credit card numbers.

## Reviewing what gets redacted

Pattern-based detection has false positives, so redaction is never silent:

- Every sync that redacted something says so:
  `redacted 2 item(s) in 1 file(s); review with `sidecar redactions`...`
- `sidecar redactions` shows a per-file diff of your local content against
  what is (or will be) pushed. It is recomputed on demand from your working
  files, so it is always exact and current.
- A `redaction` event with counts (never content) lands in the machine log
  (`sidecar tail`).

## Opting a file out

Put the marker `sidecar:no-redact` on its own line near the top of the file
(within the first 30 lines, typically as a comment):

```markdown
<!-- sidecar:no-redact -->
```

That file is pushed verbatim. Because your local original was never
modified, adding the pragma to a file that was being redacted *heals* it:
the next sync pushes the true content. Prose that merely mentions the
marker mid-sentence does not trigger it — it must start its own line.

## Modes

Set `redaction` in `.sidecar` (or `sidecar init --redaction <mode>`):

| mode | effect |
|---|---|
| `secrets+pii` | everything above — credentials *and* emails, phone numbers, SSNs, card numbers |
| `secrets` | credentials only; PII passes through — most false positives live in the PII rules, so this is the default |
| `none` | no redaction at all; files are pushed exactly as written |

Changing the mode re-runs every tracked file through the filter on the next
sync, so the whole tree converges to the new mode — `none → secrets+pii`
re-redacts everything, `secrets+pii → none` re-commits your originals.

The mode governs your files. Two things sidecar generates about itself are
always redacted at the `secrets` level whatever the mode says: the machine-level
log (`sidecar tail`) and the failure messages in a
[health heartbeat](commands.md#fleet-health). Both quote git verbatim, and git
quotes remote URLs — which carry tokens. Turning redaction off is a decision
about your notes, not an instruction to publish your own credentials.

## Limits worth knowing

- **Redaction is one-way, and multi-machine syncs deliver redacted text.**
  The secret never leaves the machine that wrote it, so when *another*
  machine edits the same file, the version that syncs back to you contains
  the placeholders, replacing your local original. Files you only edit from
  one machine are never affected. Keep real secrets out of files you edit
  from multiple machines — or opt those files out.
- **Anything already pushed is in the remote's history.** Switching to a
  stricter mode redacts future pushes; it cannot rewrite what an earlier
  mode already published.
- **Pattern matching isn't understanding.** A secret inside an odd format
  (a quoted string under a non-sensitive key, a YAML block scalar, an
  unquoted value with spaces) can slip through. Treat redaction as a strong
  safety net for a private remote, not as permission to paste production
  credentials into a scratchpad.
