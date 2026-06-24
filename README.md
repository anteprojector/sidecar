# sidecar

`sidecar` is a small Git-backed sidecar for repo-local development metadata:
agent plans, scratch artifacts, todo logs, session memory, and other files that
should be captured aggressively without making the main repo noisy.

The model is intentionally simple:

- A main repo commits a `.sidecar` file.
- The sidecar repo is cloned into `./sidecar` and gitignored by the main repo.
- Local changes are committed and pushed to `sidecar-inbox/<user>/<random>`.
- A merge command folds inbox branches into canonical `main`.
- Conflicted files can be forked into explicit per-branch versions with
  `sidecar merge --fork-files`.

## Quick start

```sh
cd ~/dev/my-repo
sidecar init git@github.com:org/my-repo-sidecar.git
sidecar status
sidecar watch
```

When you want to consolidate inbox branches:

```sh
sidecar merge --fork-files
```

## `.sidecar`

The `.sidecar` file is committed in the main repo:

```toml
version = 1
remote = "git@github.com:org/my-repo-sidecar.git"
path = "sidecar"
branch = "main"
inbox = "sidecar-inbox/{user}/{random}"
```

`{user}`, `{host}`, and `{random}` are expanded by the CLI and sanitized for Git
branch names. `{random}` is generated once per sidecar checkout and stored under
the sidecar repo's Git metadata, so multiple clones on the same machine get
separate inbox branches.

## Commands

```sh
sidecar init <remote> [--path sidecar]
sidecar clone
sidecar status
sidecar snapshot [--push]
sidecar push
sidecar watch [--debounce 30] [--interval 2] [--max-interval 300]
sidecar merge [--fork-files] [--no-push]
```

`sidecar push` snapshots local sidecar changes and pushes them to the configured
inbox branch. Before snapshotting, `sidecar` best-effort redacts common secrets
and PII from text files, including API keys, bearer tokens, secret/password
assignments, email addresses, phone numbers, SSNs, and credit-card-looking
values. Binary and non-UTF-8 files are left untouched.

`sidecar watch` polls for file changes. It waits for a quiet period before
snapshotting and pushing, and it also flushes changes after the max interval if
files keep changing.

`sidecar merge --fork-files` handles conflicted files without semantic merging.
For each conflicted path, it writes the conflicting branch versions to files such
as:

```text
notes/plan.conflict.main.abc1234.md
notes/plan.conflict.sidecar-inbox-zack-79ffcdaf92aa.def5678.md
```

The original conflicted path is removed from the merge commit, and a JSON
manifest is written under `.sidecar-conflicts/`.

Merged inbox branches are kept on the remote. Future merges skip branches whose
current tip is already contained in canonical `main`, and merge them again only
when new commits appear.

## LLM resolution

The first implementation keeps LLM resolution out of the default path. The merge
command accepts `--llm` as an explicit marker, but there is no built-in provider
yet. The intended shape is:

```sh
sidecar merge --llm
```

with a configured resolver that proposes a patch, shows the diff, and requires
confirmation before committing.

Until that resolver is wired, use:

```sh
sidecar merge --fork-files
```

and clean up the forked files manually or with a future interactive resolver.

## Development

```sh
npm install
npm test
npm run build
```
