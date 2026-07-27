import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../../kit';

// The daemon, made visible: a hand-drawn arc from one machine's badge to the
// other's, timed so the arrowhead lands as the badge flips to "synced". Each
// layout supplies its own path.
export const SketchArrow: React.FC<{
  from: number;
  to: number;
  d: string;
  len: number;
  w: number;
  h: number;
}> = ({from, to, d, len, w, h}) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const opacity = interpolate(frame, [from, from + 8, to - 16, to], [0, 1, 1, 0]);
  const draw = interpolate(frame, [from, from + 27], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div style={{position: 'absolute', inset: 0, opacity, pointerEvents: 'none'}}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path
          d={d}
          stroke={theme.accent}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={draw * len}
        />
      </svg>
    </div>
  );
};

// The closing thesis: the README tree, then the tagline. `scale` fits it to
// the square and tall canvases.
export const DiagramCard: React.FC<{scale?: number}> = ({scale: s = 1}) => (
  <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 70 * s}}>
    <div
      style={{
        fontFamily: theme.mono,
        fontSize: 40 * s,
        lineHeight: 1.8,
        background: theme.wash,
        border: `2px solid ${theme.rule}`,
        borderRadius: 18,
        padding: `${44 * s}px ${60 * s}px`,
        whiteSpace: 'pre',
      }}
    >
      <div style={{color: theme.repo}}>your-repo/</div>
      <div>
        <span style={{color: theme.repo}}>├─ .sidecar</span>
        <span style={{color: theme.faint}}>{'   # committed config'}</span>
      </div>
      <div>
        <span style={{color: theme.accent}}>└─ sidecar/</span>
        <span style={{color: theme.faint}}>{'   # gitignored, shared, auto-synced, no merge conflicts'}</span>
      </div>
    </div>
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 92 * s,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: theme.ink,
      }}
    >
      and it&rsquo;s all <span style={{color: theme.accent}}>just git</span>
    </div>
  </AbsoluteFill>
);
