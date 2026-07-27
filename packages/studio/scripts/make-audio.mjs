// Synthesizes the demo's three sound cues as 16-bit mono WAVs. Deterministic,
// no dependencies — re-run after tweaking and re-render.
import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const RATE = 44100;
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(-1, Math.min(1, s)) * 0x7fff, 44 + i * 2));
  return buf;
}

const seconds = (d) => Array.from({length: Math.round(RATE * d)}, (_, i) => i / RATE);
// A 5ms attack ramp keeps the transients from clicking.
const attack = (t) => Math.min(1, t / 0.005);

// The sync chime: C6 + G6, quick decay — one warm tick, not a notification.
const chime = seconds(1).map(
  (t) =>
    attack(t) *
    (0.45 * Math.sin(2 * Math.PI * 1046.5 * t) * Math.exp(-5 * t) +
      0.22 * Math.sin(2 * Math.PI * 1568 * t) * Math.exp(-7 * t))
);

// The arrow whoosh: band-limited noise under a smooth swell. The noise source
// is a tiny seeded LCG so renders are reproducible.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
let lpHi = 0;
let lpLo = 0;
const whoosh = seconds(1).map((t, i, arr) => {
  const white = rand();
  lpHi += 0.22 * (white - lpHi); // keep everything under ~2 kHz
  lpLo += 0.03 * (white - lpLo); // remove the rumble under ~300 Hz
  const env = Math.sin(Math.PI * Math.min(1, i / arr.length)) ** 2;
  return 0.5 * env * (lpHi - lpLo);
});

// The end-card pop: a low G, felt more than heard.
const pop = seconds(0.8).map(
  (t) => attack(t) * 0.55 * Math.sin(2 * Math.PI * 196 * t) * Math.exp(-8 * t)
);

writeFileSync(join(outDir, 'chime.wav'), wav(chime));
writeFileSync(join(outDir, 'whoosh.wav'), wav(whoosh));
writeFileSync(join(outDir, 'pop.wav'), wav(pop));
console.log('wrote chime.wav, whoosh.wav, pop.wav to', outDir);
