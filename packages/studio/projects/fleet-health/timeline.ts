import {theme, type Line, type Span} from '../../kit';

export const DURATION = 510; // 17s @ 30fps

/**
 * The fleet. `goesQuietAt` is the frame a machine stops reporting — no error,
 * no popup, it just stops, which is the whole point of the video.
 */
export const machines: {name: string; goesQuietAt?: number}[] = [
  {name: 'laptop'},
  {name: 'mac-mini', goesQuietAt: 96},
  {name: 'ci'},
  {name: 'desktop'},
];

/** What a healthy machine's "last sync" ticks through, cycling. */
export const healthyAges = ['just now', '3s ago', '6s ago', 'just now'];

/** What the quiet one's age climbs through once it stops. */
export const staleAges: {from: number; text: string}[] = [
  {from: 96, text: '4s ago'},
  {from: 130, text: '2m ago'},
  {from: 164, text: '1h ago'},
  {from: 198, text: '3d ago'},
];

/** The frame the quiet machine's dot finally turns red. */
export const ALARM_AT = 198;

export const health: Line[] = [
  {at: 250, kind: 'cmd', text: 'sidecar health', cps: 65},
  {at: 292, kind: 'out', spans: [{text: 'laptop     ', color: theme.ink}, {text: '● ok      ', color: theme.ok}, {text: 'synced just now', color: theme.faint}]},
  {at: 304, kind: 'out', spans: [{text: 'mac-mini   ', color: theme.ink}, {text: '● stale   ', color: theme.bad}, {text: 'last sync 3d ago', color: theme.bad}]},
  {at: 316, kind: 'out', spans: [{text: 'ci         ', color: theme.ink}, {text: '● ok      ', color: theme.ok}, {text: 'synced 6s ago', color: theme.faint}]},
  {at: 328, kind: 'out', spans: [{text: 'desktop    ', color: theme.ink}, {text: '● ok      ', color: theme.ok}, {text: 'synced just now', color: theme.faint}]},
  {at: 342, kind: 'gap'},
  {at: 356, kind: 'out', spans: [{text: '! ', color: theme.bad}, {text: '1 of 4 machines has stopped syncing', color: theme.bad}]},
];

export const captions: {from: number; to: number; spans: Span[]; size?: number}[] = [
  {from: 12, to: 88, spans: [{text: 'four machines, '}, {text: 'all syncing', color: theme.ok}]},
  {from: 108, to: 232, spans: [{text: 'one stops. '}, {text: 'nothing tells you.', color: theme.bad}]},
  {from: 252, to: 370, spans: [{text: 'until you '}, {text: 'ask', color: theme.accent}]},
  {from: 386, to: 462, size: 64, spans: [{text: 'a silent failure is the only kind '}, {text: 'that matters', color: theme.accent}]},
];

export const beats = {
  tilesIn: [0, 24] as const,
  termIn: [238, 266] as const,
  stageOut: [462, 486] as const,
  endFade: [486, 504] as const,
};
