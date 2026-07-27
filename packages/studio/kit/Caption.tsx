import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from './theme';
import type {Span} from './Terminal';

// One caption at a time in a fixed bottom band; each fades through.
export const Caption: React.FC<{
  spans: Span[];
  from: number;
  to: number;
  size?: number;
  bottom?: number;
}> = ({spans, from, to, size = 58, bottom = 52}) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const opacity = interpolate(frame, [from, from + 12, to - 12, to], [0, 1, 1, 0]);
  const y = interpolate(frame, [from, from + 12], [14, 0], {
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        textAlign: 'center',
        fontFamily: theme.sans,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: theme.ink,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {spans.map((s, i) => (
        <span key={i} style={{color: s.color ?? theme.ink}}>
          {s.text}
        </span>
      ))}
    </div>
  );
};
