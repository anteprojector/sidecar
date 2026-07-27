import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../../kit';
import {ALARM_AT, healthyAges, staleAges} from './timeline';

// One machine in the fleet. A healthy tile breathes on a slow loop; a quiet one
// simply stops breathing, and only much later goes red.
export const MachineTile: React.FC<{
  name: string;
  goesQuietAt?: number;
  /** Offsets the breathing loop so the tiles don't pulse in lockstep. */
  phase: number;
  width: number;
  height: number;
}> = ({name, goesQuietAt, phase, width, height}) => {
  const frame = useCurrentFrame();
  const quiet = goesQuietAt !== undefined && frame >= goesQuietAt;
  const alarmed = quiet && frame >= ALARM_AT;

  // Breathing: a 60-frame loop, frozen at the moment the machine goes quiet.
  const beatFrame = quiet ? goesQuietAt! : frame;
  const breathe = (Math.sin(((beatFrame + phase) / 60) * Math.PI * 2) + 1) / 2;

  const dot = alarmed ? theme.bad : quiet ? theme.faint : theme.ok;
  const age = quiet ? staleAge(frame) : healthyAges[Math.floor((frame + phase) / 34) % healthyAges.length];

  // The red tile gets a slow throb of its own once it's flagged.
  const alarmGlow = alarmed
    ? interpolate(frame, [ALARM_AT, ALARM_AT + 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  return (
    <div
      style={{
        width,
        height,
        background: theme.wash,
        border: `2px solid ${alarmed ? theme.bad : theme.rule}`,
        borderRadius: 18,
        padding: '26px 30px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        fontFamily: theme.mono,
        boxShadow: alarmGlow > 0 ? `0 0 ${34 * alarmGlow}px rgba(255, 107, 94, 0.28)` : 'none',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            background: dot,
            boxShadow: quiet ? 'none' : `0 0 ${8 + breathe * 16}px ${theme.ok}`,
            opacity: quiet ? 1 : 0.55 + breathe * 0.45,
          }}
        />
        <span style={{color: theme.ink, fontSize: 32, fontWeight: 600}}>{name}</span>
      </div>

      <div style={{color: theme.faint, fontSize: 24}}>last sync</div>
      <div style={{color: alarmed ? theme.bad : quiet ? theme.muted : theme.ok, fontSize: 30}}>
        {age}
      </div>

      <Sparkline quiet={quiet} quietAt={goesQuietAt} phase={phase} />
    </div>
  );
};

const staleAge = (frame: number) => {
  let text = staleAges[0].text;
  for (const step of staleAges) if (frame >= step.from) text = step.text;
  return text;
};

// A row of sync ticks. It keeps filling while the machine is healthy and simply
// stops advancing when it goes quiet — the gap is the tell.
const Sparkline: React.FC<{quiet: boolean; quietAt?: number; phase: number}> = ({
  quiet,
  quietAt,
  phase,
}) => {
  const frame = useCurrentFrame();
  const BARS = 14;
  const upTo = quiet && quietAt !== undefined ? quietAt : frame;
  const filled = Math.floor(((upTo + phase) / 12) % (BARS + 1));

  return (
    <div style={{display: 'flex', gap: 7, marginTop: 'auto', alignItems: 'flex-end'}}>
      {Array.from({length: BARS}, (_, i) => {
        const on = i <= filled;
        return (
          <div
            key={i}
            style={{
              width: 12,
              height: on ? 26 : 10,
              borderRadius: 3,
              background: on ? (quiet ? theme.rule : theme.ok) : theme.rule,
              opacity: on ? (quiet ? 0.7 : 0.85) : 0.45,
            }}
          />
        );
      })}
    </div>
  );
};
