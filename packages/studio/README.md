# studio

The sidecar videos, rendered with [Remotion](https://remotion.dev).

```text
entry.ts        registerRoot — the single Remotion entry point
Root.tsx        aggregates each project's compositions, nothing else
kit/            the shared surface: theme, fonts, Terminal, Caption, HandNote, EndCard
projects/       one folder per video
public/         shared assets — brand fonts, logo
out/<project>/  renders (gitignored)
```

## Adding a video

Drop a folder in `projects/` and add one import line to `Root.tsx`:

```ts
projects/your-video/
  index.ts      export const compositions: CompositionSpec[]
  YourVideo.tsx staging — layout, transforms, one-off flourishes
  timeline.ts   the beat sheet — script, caption copy, transition frames
  README.md     the concept, as prose you can edit without reading TSX
  public/       only if it needs assets the others don't
```

Then add the render scripts to `package.json`, following the `:demo` trio.

Imports are explicit rather than glob-discovered — Remotion bundles with
rspack, so `import.meta.glob` isn't available, and explicit keeps the wiring
typechecked.

## Where code lives

**`kit/` is for anything two or more projects use.** Single-use pieces stay in
the project folder that needs them — `Demo.tsx`'s `SyncArrow` and `DiagramCard`
are demo-specific and belong there, not in the kit.

**Split the beat sheet from the staging.** `timeline.ts` holds the script,
caption copy, and every frame number a re-time would touch. The component holds
layout and animation. Re-timing a beat should be an edit to one file.

## Own `package.json`?

A project doesn't get one. Remotion has a single entry point per config, and
`staticFile()` resolves against a single `public/`, so splitting means separate
studios, separate installs, and losing the ability to scrub between videos side
by side.

If something genuinely needs its own manifest — a conflicting dep version, or
an artifact that isn't a video (a Satori og-image generator, an interactive
`@remotion/player` embed) — it graduates *out* to `packages/<name>` rather than
nesting here. Root `workspaces` is `packages/*`, so a nested manifest wouldn't
be picked up anyway.

## Commands

```sh
bun run studio        # scrub every composition in the GUI
bun run typecheck
bun run render:demo   # out/demo/demo.mp4
bun run gif:demo      # out/demo/demo.gif
bun run still:demo    # out/demo/still.png
```
