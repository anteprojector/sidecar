// Trace the line-art mark to SVG for the README hero.
//
// The PNG hero bakes its fill into pixels, so the background carries whatever
// alpha the source art's near-white left behind — a faint ink film that shows
// as a fringe on GitHub's dark theme. Vector has no alpha channel to be dirty:
// the fill is a shape, the ink is a shape, and the space around them is nothing.
//
// The fill is one traced shape (the region the ink encloses). The art itself is
// posterized into tone bands rather than traced bilevel, because the source has
// real soft shading — the tyre, the seat, the sidecar hatching — that a
// black-or-nothing trace throws away. Colour lives in the two constants below,
// so re-theming is a find-and-replace.
//
// potrace is not a dependency of this repo — the art is static and only needs
// retracing when it changes. Install it in a scratch directory and run:
//
//   mkdir -p /tmp/trace && (cd /tmp/trace && npm i potrace)
//   python3 packages/marketing/scripts/make-readme-hero-masks.py
//   node packages/marketing/scripts/make-readme-hero-svg.mjs
//
// Set POTRACE_DIR to point somewhere other than /tmp/trace.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRATCH = process.env.POTRACE_DIR ?? '/tmp/trace';
const require = createRequire(join(SCRATCH, 'noop.js'));

let Potrace, Posterizer;
try {
  ({ Potrace, Posterizer } = require('potrace'));
} catch {
  console.error(
    `potrace not found in ${SCRATCH}\n` +
      `  mkdir -p ${SCRATCH} && (cd ${SCRATCH} && npm i potrace)`
  );
  process.exit(1);
}

const PALE = '#FFE9A3'; // the site's yellow-paper theme, and the favicon
const INK = '#1A1A1A';

const HERE = dirname(fileURLToPath(import.meta.url));
const DST = join(HERE, '..', 'branding', 'readme-hero.svg');
const [bx, by, bw, bh] = JSON.parse(readFileSync(join(SCRATCH, 'bbox.json'), 'utf8'));

const SHARED = { turdSize: 2, alphaMax: 1, optCurve: true, optTolerance: 0.2 };
// turdSize drops specks below that many px; alphaMax 1 keeps genuine corners
// sharp; optTolerance is how far a merged curve may stray from the pixels.

const STEPS = 4; // tone bands. 3 loses the tyre's shading; 6 trips potrace's
                 // own "may take a long time" warning for minutes of work.
const FAINT = 0.15; // bands under this opacity are imperceptible over the pale
                    // fill, and the faintest one alone was half the file size.

function traceFill(file, fill) {
  return new Promise((resolve, reject) => {
    const p = new Potrace({ threshold: 128, blackOnWhite: true, ...SHARED });
    p.loadImage(file, (err) => (err ? reject(err) : resolve(p.getPathTag(fill))));
  });
}

function tracePosterized(file) {
  return new Promise((resolve, reject) => {
    const p = new Posterizer({
      steps: STEPS,
      color: INK,
      background: 'transparent',
      ...SHARED,
    });
    p.loadImage(file, (err) => (err ? reject(err) : resolve(p.getSVG())));
  });
}

// Fill first, so the tones land on top of it.
const interior = await traceFill(join(SCRATCH, 'interior.png'), PALE);

// The posterizer emits one path per tone, each at the opacity that reproduces
// it. Over the pale fill those composite to the warm greys of the original —
// which is why the shading comes back without a single gradient.
const posterized = await tracePosterized(join(SCRATCH, 'grey.png'));
const tones = (posterized.match(/<path[^>]*\/>/g) ?? [])
  .filter((p) => {
    const m = p.match(/fill-opacity="([\d.]+)"/);
    return !m || Number(m[1]) >= FAINT;
  })
  // potrace emits 3 decimals; at this scale the 2nd and 3rd are far below a
  // pixel and cost about a third of the file.
  .map((p) => p.replace(/(\d+\.\d)\d+/g, '$1'));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" width="${bw}" height="${bh}" role="img" aria-label="sidecar">
<title>sidecar</title>
${interior}
${tones.join('\n')}
</svg>
`;

writeFileSync(DST, svg);
console.log(`${DST} — 1 fill + ${tones.length} tone bands, ${(svg.length / 1024).toFixed(1)} KB, viewBox ${bx} ${by} ${bw} ${bh}`);
