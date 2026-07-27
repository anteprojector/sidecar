import {theme, type Line, type Span} from '../../kit';

export const DURATION = 630; // 21s @ 30fps

/** The key, in full. Never a real one — this prefix shape is the point. */
export const SECRET = 'sk-ant-api03-7Qx4Lm9vTz2KpR8dWn';
export const REDACTED = '[REDACTED:api-key]';

export const laptop: Line[] = [
  {at: 20, kind: 'cmd', text: 'claude -p "why is the batch job 401ing?"', cps: 90},
  {at: 68, kind: 'out', spans: [{text: '⏺ ', color: theme.faint}, {text: 'reproducing with the staging token …', color: theme.faint}]},
  {at: 108, kind: 'out', spans: [{text: '⏺ ', color: theme.accent}, {text: 'wrote '}, {text: 'sidecar/debug.md', color: theme.accent}]},
  {at: 124, kind: 'gap'},
  {at: 140, kind: 'cmd', text: 'tail -2 sidecar/debug.md', cps: 70},
  {at: 178, kind: 'out', spans: [{text: 'repro: the token the job actually sent was', color: theme.muted}]},
  {at: 190, kind: 'out', spans: [{text: SECRET, color: theme.bad}]},
];

/** The note as it exists in both places, once the split view takes over. */
export const fileLines: {text: string; color?: string}[] = [
  {text: '# batch job 401', color: theme.ink},
  {text: ''},
  {text: '- fails only on the 2am run', color: theme.muted},
  {text: '- repro: the token the job sent was', color: theme.muted},
];

export const captions: {from: number; to: number; spans: Span[]; size?: number}[] = [
  {from: 30, to: 215, spans: [{text: 'your agent pastes a key into a '}, {text: 'note', color: theme.accent}]},
  {from: 300, to: 415, spans: [{text: 'the same line, in '}, {text: 'two places', color: theme.accent}]},
  {from: 430, to: 560, size: 68, spans: [{text: 'your file is untouched. '}, {text: 'the push isn’t.', color: theme.ok}]},
];

export const beats = {
  /** The single terminal hands off to the two file cards. */
  terminalOut: [216, 244] as const,
  cardsIn: [238, 274] as const,
  /** The pushed copy swaps the key for its redaction. */
  redactAt: 336,
  handNote: {from: 452, to: 566},
  cardsOut: [566, 592] as const,
  endFade: [592, 612] as const,
};
