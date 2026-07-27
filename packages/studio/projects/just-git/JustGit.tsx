import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, HandNote, Terminal, theme} from '../../kit';
import {Browser} from './Browser';
import {beats, captions, laptop} from './timeline';

const PANE_W = 880;
const PANE_H = 700;
const GAP = 50;
const LEFT_X = (1920 - (PANE_W * 2 + GAP)) / 2;
const PANE_TOP = 130;

export const JustGit: React.FC = () => {
  const frame = useCurrentFrame();

  const termIn = interpolate(frame, beats.termIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const browserIn = interpolate(frame, beats.browserIn, [0, 1], {
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
        <div
          style={{
            position: 'absolute',
            top: PANE_TOP,
            left: LEFT_X,
            opacity: termIn,
            transform: `translateY(${(1 - termIn) * 20}px)`,
          }}
        >
          <Terminal
            machine="laptop"
            path="~/dev/your-repo/sidecar"
            lines={laptop}
            width={PANE_W}
            height={PANE_H}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            top: PANE_TOP,
            left: LEFT_X + PANE_W + GAP,
            opacity: browserIn,
            transform: `translateX(${(1 - browserIn) * 50}px)`,
          }}
        >
          <Browser
            url="github.com/you/your-notes"
            width={PANE_W}
            height={PANE_H}
            rowsFrom={beats.browserIn[1]}
          />
        </div>

        <HandNote {...beats.handNote} left={1210} top={880} size={46} rotate={-2}>
          clone it, hook it,
          <br />
          build on it — it’s yours
        </HandNote>

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
