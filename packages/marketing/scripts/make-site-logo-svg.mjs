// Trace the mark to a single-shape SVG for the site.
//
// Unlike the README hero, this one carries no colour of its own. The site paints
// it by masking a themed colour through the shape (see .mark in style.css), so
// the SVG only has to describe where the ink falls and how heavily.
//
// It is still posterized rather than traced flat, because a mask reads alpha and
// fill-opacity *is* alpha: the bands mask the themed colour at 0.4/0.6/0.9 and
// the art's soft shading survives, tinted to whatever --ink currently is. There
// is no pale fill layer here — the enclosed areas stay transparent so the page
// shows through, exactly as the old PNG's alpha did.
//
// potrace is not a dependency of this repo — see make-readme-hero-svg.mjs for
// the scratch-install recipe. Run after make-readme-hero-masks.py:
//
//   node packages/marketing/scripts/make-site-logo-svg.mjs

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRATCH = process.env.POTRACE_DIR ?? '/tmp/trace';
const require = createRequire(join(SCRATCH, 'noop.js'));

let Posterizer;
try {
  ({ Posterizer } = require('potrace'));
} catch {
  console.error(
    `potrace not found in ${SCRATCH}\n` +
      `  mkdir -p ${SCRATCH} && (cd ${SCRATCH} && npm i potrace)`
  );
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DST = join(HERE, '..', 'site', 'assets', 'logo.svg');
const [bx, by, bw, bh] = JSON.parse(readFileSync(join(SCRATCH, 'bbox.json'), 'utf8'));

const STEPS = 4;
const FAINT = 0.15; // below this the band is imperceptible and costs a lot

const posterized = await new Promise((resolve, reject) => {
  const p = new Posterizer({
    steps: STEPS,
    // Black is arbitrary: a mask only reads the alpha, and fill-opacity carries
    // that. It is spelled out rather than left to currentColor, which cannot
    // resolve inside an external file used as a mask.
    color: '#000',
    background: 'transparent',
    turdSize: 2,
    alphaMax: 1,
    optCurve: true,
    optTolerance: 0.2,
  });
  p.loadImage(join(SCRATCH, 'grey.png'), (err) => (err ? reject(err) : resolve(p.getSVG())));
});

const tones = (posterized.match(/<path[^>]*\/>/g) ?? [])
  .filter((p) => {
    const m = p.match(/fill-opacity="([\d.]+)"/);
    return !m || Number(m[1]) >= FAINT;
  })
  // One decimal is far below a pixel at this scale and saves about a third.
  .map((p) => p.replace(/(\d+\.\d)\d+/g, '$1'));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" width="${bw}" height="${bh}">
${tones.join('\n')}
</svg>
`;

writeFileSync(DST, svg);
console.log(`${DST} — ${tones.length} tone bands, ${(svg.length / 1024).toFixed(1)} KB, viewBox ${bx} ${by} ${bw} ${bh}`);
