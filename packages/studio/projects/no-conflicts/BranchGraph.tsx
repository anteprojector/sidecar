import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../../kit';
import {TRACK_X0, TRACK_X1, dots, lanes, mainDots, merges} from './timeline';

const GRAPH_W = 1920;
const GRAPH_H = 310;

// The inbox branches, drawn the way `git log --graph` would show them: three
// lanes collecting commits at once, then curving down into main. Single-use, so
// it lives with the project rather than in the kit.
export const BranchGraph: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <svg width={GRAPH_W} height={GRAPH_H} viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}>
      {lanes.map((lane, i) => (
        <g key={lane.name}>
          <text
            x={TRACK_X0 - 28}
            y={lane.y + 10}
            textAnchor="end"
            fill={lane.color}
            fontFamily={theme.mono}
            fontSize={28}
            opacity={i === lanes.length - 1 ? 1 : 0.85}
          >
            {lane.name}
          </text>
          <line
            x1={TRACK_X0}
            y1={lane.y}
            x2={TRACK_X1}
            y2={lane.y}
            stroke={lane.color}
            strokeWidth={i === lanes.length - 1 ? 5 : 3}
            opacity={0.22}
          />
        </g>
      ))}

      {merges.map((m, i) => {
        const from = lanes[m.lane];
        const main = lanes[lanes.length - 1];
        const draw = interpolate(frame, [m.at, m.at + 26], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <path
            key={i}
            d={`M ${m.x} ${from.y} C ${m.x + 190} ${from.y}, ${m.toX - 190} ${main.y}, ${m.toX} ${main.y}`}
            stroke={from.color}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={1400}
            strokeDashoffset={draw * 1400}
            opacity={0.9}
          />
        );
      })}

      {dots.map((d, i) => (
        <Commit key={`d${i}`} x={d.x} y={lanes[d.lane].y} at={d.at} color={lanes[d.lane].color} />
      ))}

      {mainDots.map((d, i) => (
        <Commit
          key={`m${i}`}
          x={d.x}
          y={lanes[lanes.length - 1].y}
          at={d.at}
          color={theme.ink}
          r={13}
        />
      ))}
    </svg>
  );
};

// A commit pops in with a brief halo, so the eye catches it landing.
const Commit: React.FC<{x: number; y: number; at: number; color: string; r?: number}> = ({
  x,
  y,
  at,
  color,
  r = 11,
}) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const pop = interpolate(frame, [at, at + 9], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const halo = interpolate(frame, [at, at + 22], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <g>
      <circle cx={x} cy={y} r={r + halo * 22} fill={color} opacity={halo * 0.22} />
      <circle cx={x} cy={y} r={r * pop} fill={color} />
    </g>
  );
};
