import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from './theme';

/** The hand-drawn arc that points the note at whatever it's annotating. */
export type Arrow = {
  /** Path data, arrowhead strokes included. */
  d: string;
  w: number;
  h: number;
  /** Offset from the note's own top-left. */
  dx: number;
  dy: number;
  /** Dash length — set at or above the path length so the draw-on reads clean. */
  len: number;
};

// A handwritten aside: the arrow draws itself, then the words fade up.
export const HandNote: React.FC<{
  from: number;
  to: number;
  left: number;
  top: number;
  rotate?: number;
  size?: number;
  color?: string;
  arrow?: Arrow;
  children: React.ReactNode;
}> = ({from, to, left, top, rotate = -3, size = 54, color = theme.accent, arrow, children}) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const opacity = interpolate(frame, [from, from + 14, to - 14, to], [0, 1, 1, 0]);
  const draw = interpolate(frame, [from + 4, from + 26], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div style={{position: 'absolute', left, top, opacity, transform: `rotate(${rotate}deg)`}}>
      {arrow && (
        <svg
          width={arrow.w}
          height={arrow.h}
          viewBox={`0 0 ${arrow.w} ${arrow.h}`}
          style={{position: 'absolute', left: arrow.dx, top: arrow.dy}}
        >
          <path
            d={arrow.d}
            stroke={color}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={arrow.len}
            strokeDashoffset={draw * arrow.len}
          />
        </svg>
      )}
      <div
        style={{
          fontFamily: theme.hand,
          fontWeight: 600,
          fontSize: size,
          color,
          lineHeight: 1.15,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </div>
  );
};
