import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, Terminal, theme} from '../../kit';
import {MachineTile} from './MachineTile';
import {beats, captions, health, machines} from './timeline';

const TILE_W = 420;
const TILE_H = 260;
const TILE_GAP = 30;
const TILES_LEFT = (1920 - (TILE_W * 4 + TILE_GAP * 3)) / 2;
const TILES_TOP = 96;

const TERM_W = 1200;
const TERM_H = 420;

export const FleetHealth: React.FC = () => {
  const frame = useCurrentFrame();

  const termIn = interpolate(frame, beats.termIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const stageOut = interpolate(frame, beats.stageOut, [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const endFade = interpolate(frame, beats.endFade, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      <div style={{opacity: stageOut}}>
        {machines.map((m, i) => {
          const tileIn = interpolate(frame, [beats.tilesIn[0] + i * 5, beats.tilesIn[1] + i * 5], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          return (
            <div
              key={m.name}
              style={{
                position: 'absolute',
                top: TILES_TOP,
                left: TILES_LEFT + i * (TILE_W + TILE_GAP),
                opacity: tileIn,
                transform: `translateY(${(1 - tileIn) * 20}px)`,
              }}
            >
              <MachineTile
                name={m.name}
                goesQuietAt={m.goesQuietAt}
                phase={i * 17}
                width={TILE_W}
                height={TILE_H}
              />
            </div>
          );
        })}

        <div
          style={{
            position: 'absolute',
            top: 430,
            left: (1920 - TERM_W) / 2,
            opacity: termIn,
            transform: `translateY(${(1 - termIn) * 24}px)`,
          }}
        >
          <Terminal machine="laptop" path="~/dev/your-repo" lines={health} width={TERM_W} height={TERM_H} />
        </div>

        {captions.map((c, i) => (
          <Caption key={i} from={c.from} to={c.to} spans={c.spans} size={c.size} />
        ))}
      </div>

      <AbsoluteFill style={{opacity: endFade, pointerEvents: 'none'}}>
        <EndCard />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
