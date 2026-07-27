# fleet-health

17s. A follow-up clip for people who already have a fleet, not a first-touch
demo — `sidecar health` only makes sense once a second machine exists.

**Thesis:** a sync can fail on one laptop for reasons the other machines would
never hear about. Nothing surfaces that except asking.

**Beats**

1. Four tiles — laptop, mac-mini, ci, desktop — each breathing on its own
   phase, sync ticks filling.
2. mac-mini stops. No error, no popup: the dot just stops pulsing and its tick
   row stops advancing while the others keep going.
3. Its "last sync" climbs — 4s, 2m, 1h, 3d — and only then goes red.
4. `sidecar health` prints the fleet: three ok, one stale, and the count.
5. Close: a silent failure is the only kind that matters.

**Editing:** the fleet, the frame mac-mini goes quiet (`goesQuietAt`), the ages
it climbs through, and the alarm frame are all in `timeline.ts`.
`MachineTile.tsx` is single-use.

**The one detail worth preserving:** the gap between going quiet (frame 96) and
going red (frame 198). If the tile turned red immediately there'd be nothing to
sell — the whole point is the stretch where it looks fine and isn't.
