import {theme, type Line, type Span} from '../../kit';

// Three machines append to the same file inside the same second. The whole
// video is one clock, in frames @ 30fps.
export const DURATION = 840; // 28s

const wrote = (file: string): Span[] => [
  {text: '⏺ ', color: theme.accent},
  {text: 'appended to ', color: theme.muted},
  {text: file, color: theme.accent},
];

// The payoff: after the merge, all three panes tail the identical file.
const merged: Line[] = [
  {at: 560, kind: 'gap'},
  {at: 580, kind: 'cmd', text: 'tail -3 sidecar/plan.md', cps: 70},
  {at: 618, kind: 'out', spans: [{text: '- flaky test: retry on 429', color: theme.ok}]},
  {at: 630, kind: 'out', spans: [{text: '- migration: backfill then swap', color: theme.accent}]},
  {at: 642, kind: 'out', spans: [{text: '- rollback: keep v1 tables 30d', color: theme.repo}]},
];

export const laptop: Line[] = [
  {at: 50, kind: 'cmd', text: 'claude -p "note the migration plan"', cps: 95},
  {at: 98, kind: 'out', spans: wrote('sidecar/plan.md')},
  ...merged,
];

export const macMini: Line[] = [
  {at: 62, kind: 'cmd', text: 'claude -p "note the rollback steps"', cps: 95},
  {at: 112, kind: 'out', spans: wrote('sidecar/plan.md')},
  ...merged,
];

export const ci: Line[] = [
  {at: 44, kind: 'cmd', text: 'claude -p "log the flaky test"', cps: 95},
  {at: 88, kind: 'out', spans: wrote('sidecar/plan.md')},
  ...merged,
];

export const captions: {from: number; to: number; spans: Span[]; size?: number}[] = [
  {from: 10, to: 190, size: 72, spans: [{text: 'three machines. '}, {text: 'one file.', color: theme.accent}]},
  {from: 205, to: 385, spans: [{text: 'each writes to its own '}, {text: 'inbox branch', color: theme.accent}]},
  {from: 400, to: 545, spans: [{text: 'sidecar merges them '}, {text: 'for you', color: theme.ok}]},
  {from: 575, to: 745, size: 72, spans: [{text: 'same file. '}, {text: 'zero conflicts.', color: theme.ok}]},
];

// The branch graph, in its own 1920x310 coordinate space.
export const lanes = [
  {name: 'inbox/laptop', color: theme.accent, y: 36},
  {name: 'inbox/mac-mini', color: theme.repo, y: 104},
  {name: 'inbox/ci', color: theme.ok, y: 172},
  {name: 'main', color: theme.ink, y: 262},
];

export const TRACK_X0 = 330;
export const TRACK_X1 = 1810;

/** A machine's commit landing on its own inbox lane. */
export const dots: {lane: number; x: number; at: number}[] = [
  {lane: 2, x: 540, at: 212},
  {lane: 0, x: 560, at: 224},
  {lane: 1, x: 580, at: 236},
];

/** Each inbox branch curving down into main. */
export const merges: {lane: number; x: number; toX: number; at: number}[] = [
  {lane: 2, x: 540, toX: 1120, at: 330},
  {lane: 0, x: 560, toX: 1210, at: 358},
  {lane: 1, x: 580, toX: 1300, at: 386},
];

/** main's own history: a starting commit, then the three merges landing. */
export const mainDots: {x: number; at: number}[] = [
  {x: 400, at: 200},
  {x: 1120, at: 352},
  {x: 1210, at: 380},
  {x: 1300, at: 408},
];

export const beats = {
  panesIn: [0, 26] as const,
  syncPulse: [150],
  graphIn: [196, 226] as const,
  handNote: {from: 640, to: 752},
  panesOut: [762, 790] as const,
  endFade: [790, 812] as const,
};
