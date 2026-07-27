import {theme, type Line, type Span} from '../../kit';

export const DURATION = 630; // 21s @ 30fps

// After the first command the sidecar CLI never appears again — that's the
// argument. Everything here is plain git.
export const laptop: Line[] = [
  {at: 18, kind: 'cmd', text: 'cd sidecar && git log --oneline -4', cps: 85},
  {at: 66, kind: 'out', spans: [{text: '9f2c1ab ', color: theme.accent}, {text: 'merge inbox/ci'}]},
  {at: 78, kind: 'out', spans: [{text: '4be07d3 ', color: theme.accent}, {text: 'merge inbox/mac-mini'}]},
  {at: 90, kind: 'out', spans: [{text: 'c81f5e0 ', color: theme.accent}, {text: 'notes: rollback steps'}]},
  {at: 102, kind: 'out', spans: [{text: '2a4d9c7 ', color: theme.accent}, {text: 'notes: legacy auth findings'}]},
  {at: 116, kind: 'gap'},
  {at: 300, kind: 'cmd', text: 'grep -rl "legacy auth" .', cps: 85},
  {at: 344, kind: 'out', spans: [{text: './auth.md', color: theme.accent}]},
  {at: 356, kind: 'out', spans: [{text: './plan.md', color: theme.accent}]},
  {at: 370, kind: 'gap'},
  {at: 396, kind: 'cmd', text: 'git blame -L 4,5 auth.md', cps: 85},
  {at: 442, kind: 'out', spans: [
    {text: '2a4d9c7 ', color: theme.faint},
    {text: '(laptop   ', color: theme.repo},
    {text: '2026-07-24) ', color: theme.faint},
    {text: '- only two callers left'},
  ]},
  {at: 456, kind: 'out', spans: [
    {text: 'c81f5e0 ', color: theme.faint},
    {text: '(mac-mini ', color: theme.repo},
    {text: '2026-07-25) ', color: theme.faint},
    {text: '- safe to delete after v0.10'},
  ]},
];

/** The file listing the browser shows — it's a normal repo on a normal host. */
export const repoFiles: {name: string; note: string; when: string}[] = [
  {name: 'auth.md', note: 'notes: legacy auth findings', when: '2 days ago'},
  {name: 'plan.md', note: 'merge inbox/ci', when: '4 hours ago'},
  {name: 'debug.md', note: 'redact: api-key', when: '4 hours ago'},
  {name: 'README.md', note: 'sidecar init', when: 'last week'},
];

export const captions: {from: number; to: number; spans: Span[]; size?: number}[] = [
  {from: 20, to: 175, spans: [{text: 'the scratchpad is '}, {text: 'a normal git repo', color: theme.accent}]},
  {from: 195, to: 290, spans: [{text: 'read it on '}, {text: 'GitHub', color: theme.accent}]},
  {from: 310, to: 430, spans: [{text: 'grep it, '}, {text: 'blame it', color: theme.accent}]},
  {from: 448, to: 560, size: 68, spans: [{text: 'no database. no account. '}, {text: 'a repo you own.', color: theme.ok}]},
];

export const beats = {
  termIn: [0, 24] as const,
  browserIn: [186, 220] as const,
  handNote: {from: 470, to: 566},
  stageOut: [566, 592] as const,
  endFade: [592, 612] as const,
};
