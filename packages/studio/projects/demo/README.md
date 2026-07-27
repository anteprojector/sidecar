# demo

The hero video — 42s, the one the site and README lead with.

**Thesis:** your agents get a scratchpad that follows you across machines
without ever touching your repo's history.

**Beats**

1. `sidecar init` on the laptop; `tree` shows the committed `.sidecar` config
   next to the gitignored `sidecar/` checkout.
2. An agent researches the legacy auth path and writes `sidecar/auth.md`.
3. `git status` on your repo: clean. The note was never yours to commit.
4. The mac-mini pane slides in. `ls sidecar/` — `auth.md` is already there.
   No pull, no commit; the daemon did it.
5. The next agent picks the note straight up and starts deleting code.
6. Close on the README tree and "put a repo in your repo".

**Editing:** the script, the caption copy, and every transition frame live in
`timeline.ts`. `Demo.tsx` is staging only — layout, transforms, and the two
demo-specific flourishes (`SyncArrow`, `DiagramCard`).
