# no-conflicts

28s. The claim people read as marketing until they see the mechanism.

**Thesis:** three machines can write the same file in the same second and
nobody gets interrupted, because each writes to its own inbox branch.

**Beats**

1. Three panes — laptop, mac-mini, ci — all append to `sidecar/plan.md` within
   two seconds of each other.
2. All three badges pulse "synced".
3. A `git log --graph`-style diagram draws underneath: `inbox/laptop`,
   `inbox/mac-mini`, `inbox/ci` each collecting their own commit.
4. The three inbox lanes curve down into `main`, one merge commit each.
5. All three panes `tail -3 sidecar/plan.md` — identical output, all three
   lines present, no conflict markers.
6. Handwritten aside: no `plan (conflicted copy 3).md`.

**Editing:** script, captions, and the whole graph (lane positions, commit
`x`/`at`, merge curves) are data in `timeline.ts`. `BranchGraph.tsx` just draws
what it's told and is single-use, so it lives here rather than in the kit.

**Note:** the panes are rendered at the kit `Terminal`'s natural 860px width
and CSS-scaled to 0.68 — the chrome's type sizes are tuned for a full-width
pane. If `Terminal` ever grows a `fontSize` prop, drop the scale wrapper.
