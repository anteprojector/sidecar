import {theme, type Line, type Span} from '../../kit';

// The beat sheet. Everything here is frames @ 30fps on one shared clock, so a
// re-time is an edit to this file and nothing else. All three layouts (wide,
// square, tall) play this same script.
export const DURATION = 1130; // ~38s @ 30fps

export const laptop: Line[] = [
  {at: 8, kind: 'cmd', text: 'sidecar init'},
  {at: 34, kind: 'out', spans: [{text: '✓ ', color: theme.ok}, {text: 'scratchpad repo created — daemon watching for changes'}]},
  {at: 46, kind: 'gap'},
  {at: 64, kind: 'cmd', text: 'tree -L 2'},
  {at: 92, kind: 'out', spans: [{text: 'your-repo/', color: theme.repo}]},
  {at: 100, kind: 'out', spans: [{text: '├── src/', color: theme.ink}]},
  {at: 108, kind: 'out', spans: [{text: '├── package.json', color: theme.ink}]},
  {at: 116, kind: 'out', spans: [{text: '├── .sidecar', color: theme.repo}, {text: '        committed config', color: theme.faint}]},
  {at: 124, kind: 'out', spans: [{text: '└── sidecar/', color: theme.accent}, {text: '        gitignored', color: theme.faint}]},
  {at: 132, kind: 'out', spans: [{text: '    └── README.md', color: theme.accent}]},
  {at: 146, kind: 'gap'},
  {at: 250, kind: 'cmd', text: 'claude -p "research: can we kill the legacy auth path?"', cps: 80},
  {at: 296, kind: 'out', spans: [{text: '⏺ ', color: theme.faint}, {text: 'reading src/auth/ …', color: theme.faint}]},
  {at: 330, kind: 'out', spans: [{text: '⏺ ', color: theme.accent}, {text: 'wrote '}, {text: 'sidecar/auth.md', color: theme.accent}]},
  {at: 342, kind: 'gap'},
  {at: 390, kind: 'cmd', text: 'git status'},
  {at: 418, kind: 'out', spans: [{text: 'On branch ', color: theme.muted}, {text: 'main', color: theme.repo}]},
  {at: 430, kind: 'out', spans: [{text: 'nothing to commit, working tree clean', color: theme.ok}]},
];

export const macMini: Line[] = [
  {at: 288, kind: 'cmd', text: 'ls sidecar/'},
  {at: 316, kind: 'out', spans: [{text: 'README.md', color: theme.muted}]},
  {at: 328, kind: 'gap'},
  {at: 600, kind: 'cmd', text: 'ls sidecar/'},
  {at: 628, kind: 'out', spans: [{text: 'README.md', color: theme.muted}, {text: '   '}, {text: 'auth.md', color: theme.accent}]},
  {at: 642, kind: 'gap'},
  {at: 712, kind: 'cmd', text: 'claude -p "kill legacy auth based on the findings in @sidecar/auth.md"', cps: 80},
  {at: 772, kind: 'out', spans: [{text: '⏺ ', color: theme.faint}, {text: 'read sidecar/auth.md — two cron callers to remove first', color: theme.faint}]},
  {at: 800, kind: 'out', spans: [{text: '⏺ ', color: theme.accent}, {text: 'removing src/auth/legacy/ …'}]},
];

// `size` is at the wide (1920×1080) scale; the square and tall layouts scale
// it down. Caption 1 starts before frame 0 so the poster frame carries it at
// full opacity.
export const captions: {from: number; to: number; spans: Span[]; size?: number}[] = [
  {from: -12, to: 184, size: 84, spans: [{text: 'put a '}, {text: 'repo', color: theme.accent}, {text: ' in your repo'}]},
  {from: 240, to: 530, spans: [{text: 'a '}, {text: 'scratchpad', color: theme.accent}, {text: ' for your agents'}]},
  {from: 548, to: 688, spans: [{text: 'auto-syncs', color: theme.accent}]},
  {from: 722, to: 845, spans: [{text: 'no PRs, '}, {text: 'no merge conflicts', color: theme.accent}]},
];

// Frames where the staging changes hands, kept next to the script they follow.
export const beats = {
  /** The wide opener narrows into the left pane; the mac-mini slides in from
   *  off-screen, timed so the two never overlap. */
  splitShift: [192, 226] as const,
  splitIn: [208, 248] as const,
  laptopSyncPulse: [340],
  macMiniSyncPulse: [572],
  syncArrow: {from: 546, to: 690},
  handNote: {from: 638, to: 704},
  terminalsOut: [858, 890] as const,
  diagramIn: [890, 918, 996, 1022] as const,
  endFade: [1022, 1046] as const,
  /** The GIF loops; fading the end card to black makes the restart a cut on
   *  black instead of yellow-to-terminal whiplash. */
  blackTail: [1112, 1126] as const,
};
