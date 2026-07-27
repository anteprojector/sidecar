import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, HandNote, Terminal, theme} from '../../kit';
import {FileCard} from './FileCard';
import {REDACTED, SECRET, beats, captions, laptop} from './timeline';

const TERM_W = 1180;
const TERM_H = 620;
const CARD_W = 820;
const CARD_H = 430; // just taller than the note — dead space reads as a bug here
const CARD_GAP = 60;
const CARD_LEFT = (1920 - (CARD_W * 2 + CARD_GAP)) / 2;
const CARD_TOP = 250;

export const SecretsStayHome: React.FC = () => {
  const frame = useCurrentFrame();

  const terminalOut = interpolate(frame, beats.terminalOut, [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cardsIn = interpolate(frame, beats.cardsIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const cardsOut = interpolate(frame, beats.cardsOut, [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const endFade = interpolate(frame, beats.endFade, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      <div
        style={{
          position: 'absolute',
          top: 190,
          left: (1920 - TERM_W) / 2,
          opacity: terminalOut,
        }}
      >
        <Terminal
          machine="laptop"
          path="~/dev/your-repo"
          lines={laptop}
          width={TERM_W}
          height={TERM_H}
        />
      </div>

      <div style={{opacity: cardsIn * cardsOut}}>
        <div
          style={{
            position: 'absolute',
            top: CARD_TOP,
            left: CARD_LEFT,
            transform: `translateX(${(1 - cardsIn) * -40}px)`,
          }}
        >
          <FileCard
            label="your file"
            where="sidecar/debug.md"
            accent={theme.repo}
            width={CARD_W}
            height={CARD_H}
            secret={SECRET}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: CARD_TOP,
            left: CARD_LEFT + CARD_W + CARD_GAP,
            transform: `translateX(${(1 - cardsIn) * 40}px)`,
          }}
        >
          <FileCard
            label="what you pushed"
            where="origin/main"
            accent={theme.accent}
            width={CARD_W}
            height={CARD_H}
            secret={SECRET}
            redactedTo={REDACTED}
            redactAt={beats.redactAt}
          />
        </div>

        <HandNote
          {...beats.handNote}
          left={1180}
          top={790}
          size={46}
          color={theme.ok}
          arrow={{
            d: 'M 30 118 C 60 82, 120 52, 196 34 M 196 34 L 166 28 M 196 34 L 172 52',
            w: 220,
            h: 130,
            dx: 40,
            dy: -126,
            len: 320,
          }}
        >
          names, emails and paths too —
          <br />
          one flag away with --pii
        </HandNote>
      </div>

      {captions.map((c, i) => (
        <Caption key={i} from={c.from} to={c.to} spans={c.spans} size={c.size} />
      ))}

      <AbsoluteFill style={{opacity: endFade, pointerEvents: 'none'}}>
        <EndCard />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
