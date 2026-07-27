---
name: refresh-brand-assets
description: Regenerate the social preview card (og.png) and other generated brand art after changing user-facing copy, the package name, the palette, or the logo. Use whenever the install command, tagline, or site URL changes — a text-only edit leaves these images stale, and greps cannot see it.
---

# Refreshing generated brand assets

Some of this repo's user-facing text is **baked into images**. Editing the
source copy is only half the change; the rendered asset keeps showing the old
wording until it is re-rendered. `grep` cannot catch this, because by then the
words are pixels.

This bit once: the v0.9.0 rename to `sidecarsync` updated every markdown and
HTML file, and `og.png` still told every Slack and Twitter unfurl to
`npm i -g @projectors/sidecar`. Unfurl caches hold that for weeks.

## What is generated, and from what

| Asset | Source | Regenerate with |
| --- | --- | --- |
| `packages/marketing/site/assets/og.png` | `packages/marketing/scripts/og-card.html` | `bun run --cwd packages/marketing og:render` |
| `packages/marketing/site/assets/favicon.{png,svg}` | `scripts/make-favicon.py` | `bun run --cwd packages/marketing favicon` |
| `packages/marketing/branding/readme-hero.svg` | `scripts/make-readme-hero-*.{py,mjs}` | `bun run --cwd packages/marketing readme-hero` |
| `packages/sidecar/dist/cli.js` | `packages/sidecar/src/**` | `bun run build` (CI diffs this) |

Only `og.png` carries text today. The logo, hero, and favicon are pure vector
art with no text elements, so copy changes never affect them — but a palette
or logo change does.

## When to re-render og.png

Any change to the install command (**including a package rename**), the
tagline, the site URL, the wordmark, or the yellow colorway. The card draws
its own copy from `og-card.html`, so if you edited that file, re-render.

## How

```sh
bun run --cwd packages/marketing og:render
```

That is `scripts/make-og.mjs`. It boots the repo's own static server, drives
an installed Chrome headlessly over the DevTools protocol, and writes the PNG.
Zero dependencies — no Playwright, no Puppeteer, no rasterizer in the tree.

Then confirm the result by **looking at it** (read the PNG as an image), not
by trusting the exit code. Check the install command, wordmark, and URL.

If Chrome is somewhere unusual: `CHROME=/path/to/chrome bun run --cwd packages/marketing og:render`.

## Why the script looks roundabout

Two constraints, both load-bearing — don't "simplify" them away:

- **It serves over http rather than opening `file://`.** The card draws
  `logo.svg` into the canvas; from `file://` that taints the canvas and
  `toDataURL` throws a SecurityError.
- **It reads `canvas.toDataURL`, not a screenshot.** The output is the
  canvas's own 1200x630 bitmap, independent of viewport or display scaling.
  A `--screenshot` flag would capture the dark page chrome around the card.

## The guard rails it gives you

`og-card.html` places every element against two columns and calls `fits()`,
which warns when text overruns the art column. `make-og.mjs` relays those
warnings, **exits non-zero, and refuses to write the file** — so an overlong
install command fails the render instead of shipping a card with the text
sitting on top of the motorcycle. It also asserts the PNG is really 1200x630.

A failed render leaves the previous `og.png` untouched, so a broken run can
never degrade what is already committed.

## Design iteration

To tune the layout by eye, serve it and use the page's Download button:

```sh
bun run --cwd packages/marketing og
# http://127.0.0.1:4330/scripts/og-card.html
```

Keep the yellow colorway — it is the site's default theme and matches the
favicon and README hero, so a shared link matches the page it opens.
