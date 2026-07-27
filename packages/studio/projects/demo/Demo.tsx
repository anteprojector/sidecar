import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, HandNote, Terminal, theme} from '../../kit';
import {beats, captions, laptop, macMini} from './timeline';
import {DiagramCard, SketchArrow} from './Cards';
import {AudioTrack} from './AudioTrack';

const PANE_W = 860;
const PANE_H = 810;
const PANE_TOP = 70;
const GAP = 40;
const LEFT_X = (1920 - PANE_W * 2 - GAP) / 2;
// Beat 1's single hero terminal: wide and short, so the opening caption sits
// high and prominent instead of down in the caption band.
const WIDE_W = 1520;
const WIDE_H = 670;
const WIDE_TOP = 46;

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();

  // Beat 1 plays as one wide centered terminal; it grows into the left pane
  // as the mac-mini slides in from off-screen right.
  const easing = {
    extrapolateLeft: 'clamp' as const,
    extrapolateRight: 'clamp' as const,
    easing: Easing.inOut(Easing.cubic),
  };
  const leftW = interpolate(frame, beats.splitShift, [WIDE_W, PANE_W], easing);
  const leftH = interpolate(frame, beats.splitShift, [WIDE_H, PANE_H], easing);
  const leftTop = interpolate(frame, beats.splitShift, [WIDE_TOP, PANE_TOP], easing);
  const leftX = interpolate(frame, beats.splitShift, [(1920 - WIDE_W) / 2, LEFT_X], easing);
  const rightIn = interpolate(frame, beats.splitIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // The terminals hand off to the closing diagram, then the end card, then a
  // fade to black so the loop restarts cleanly.
  const terminalsOut = interpolate(frame, beats.terminalsOut, [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const diagramIn = interpolate(frame, beats.diagramIn, [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const endFade = interpolate(frame, beats.endFade, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const blackTail = interpolate(frame, beats.blackTail, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      <AudioTrack />
      <div style={{opacity: terminalsOut}}>
        <div style={{position: 'absolute', top: leftTop, left: leftX}}>
          <Terminal
            machine="laptop"
            path="~/dev/your-repo"
            lines={laptop}
            syncPulseAt={beats.laptopSyncPulse}
            width={leftW}
            height={leftH}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: PANE_TOP,
            left: LEFT_X + PANE_W + GAP,
            transform: `translateX(${(1 - rightIn) * 1020}px)`,
          }}
        >
          <Terminal
            machine="mac-mini"
            path="~/dev/your-repo"
            lines={macMini}
            syncPulseAt={beats.macMiniSyncPulse}
            width={PANE_W}
            height={PANE_H}
          />
        </div>

        <SketchArrow
          {...beats.syncArrow}
          d="M 830 92 C 1050 30, 1450 25, 1655 95 M 1655 95 L 1622 96 M 1655 95 L 1630 74"
          len={1000}
          w={1920}
          h={1080}
        />

        <HandNote
          {...beats.handNote}
          left={1240}
          top={545}
          arrow={{
            d: 'M 120 144 C 70 116, 40 68, 32 10 M 32 10 L 18 34 M 32 10 L 56 24',
            w: 140,
            h: 150,
            dx: -10,
            dy: -148,
            len: 280,
          }}
        >
          no pull. no commit.
          <br />
          the daemon did it
        </HandNote>

        {captions.map((c, i) => (
          <Caption
            key={i}
            from={c.from}
            to={c.to}
            spans={c.spans}
            size={c.size}
            bottom={i === 0 ? 130 : undefined}
          />
        ))}
      </div>

      <AbsoluteFill style={{opacity: diagramIn, pointerEvents: 'none'}}>
        <DiagramCard />
      </AbsoluteFill>

      <AbsoluteFill style={{opacity: endFade, pointerEvents: 'none'}}>
        <EndCard />
      </AbsoluteFill>

      <AbsoluteFill style={{background: '#000', opacity: blackTail, pointerEvents: 'none'}} />
    </AbsoluteFill>
  );
};
