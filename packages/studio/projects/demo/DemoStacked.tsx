import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, HandNote, Terminal, theme} from '../../kit';
import {beats, captions, laptop, macMini} from './timeline';
import {DiagramCard, SketchArrow} from './Cards';
import {AudioTrack} from './AudioTrack';

// The square (1080×1080) and tall (1080×1920) cuts share this stacked layout:
// laptop on top, mac-mini below, same beat sheet as the wide cut. Only the
// geometry differs, so both are thin configs over one component.
type StackedLayout = {
  w: number;
  h: number;
  paneH: number;
  topY: number;
  botY: number;
  hero: {y: number; h: number};
  captionScale: number;
  captionBottom: number;
  heroCaptionBottom: number;
  arrow: {d: string; len: number};
  note: {left: number; top: number};
  diagramScale: number;
};

const PANE_W = 1000;
const PANE_X = 40;
const FONT = 24;

export const square: StackedLayout = {
  w: 1080,
  h: 1080,
  paneH: 420,
  topY: 36,
  botY: 488,
  hero: {y: 84, h: 580},
  captionScale: 0.7,
  captionBottom: 26,
  heroCaptionBottom: 172,
  arrow: {
    d: 'M 985 115 C 1068 220, 1068 390, 992 502 M 992 502 L 1014 472 M 992 502 L 1021 504',
    len: 560,
  },
  note: {left: 430, top: 875},
  diagramScale: 0.58,
};

export const tall: StackedLayout = {
  w: 1080,
  h: 1920,
  paneH: 560,
  topY: 300,
  botY: 900,
  hero: {y: 430, h: 580},
  captionScale: 0.8,
  captionBottom: 360,
  heroCaptionBottom: 415,
  arrow: {
    d: 'M 985 345 C 1072 530, 1072 710, 995 896 M 995 896 L 1015 864 M 995 896 L 1026 894',
    len: 850,
  },
  note: {left: 430, top: 1245},
  diagramScale: 0.62,
};

export const DemoStacked: React.FC<{layout: StackedLayout}> = ({layout: L}) => {
  const frame = useCurrentFrame();

  const easing = {
    extrapolateLeft: 'clamp' as const,
    extrapolateRight: 'clamp' as const,
    easing: Easing.inOut(Easing.cubic),
  };
  const topH = interpolate(frame, beats.splitShift, [L.hero.h, L.paneH], easing);
  const topY = interpolate(frame, beats.splitShift, [L.hero.y, L.topY], easing);
  const botIn = interpolate(frame, beats.splitIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

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
        <div style={{position: 'absolute', top: topY, left: PANE_X}}>
          <Terminal
            machine="laptop"
            path="~/dev/your-repo"
            lines={laptop}
            syncPulseAt={beats.laptopSyncPulse}
            width={PANE_W}
            height={topH}
            fontSize={FONT}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: L.botY,
            left: PANE_X,
            transform: `translateY(${(1 - botIn) * (L.h - L.botY + 20)}px)`,
          }}
        >
          <Terminal
            machine="mac-mini"
            path="~/dev/your-repo"
            lines={macMini}
            syncPulseAt={beats.macMiniSyncPulse}
            width={PANE_W}
            height={L.paneH}
            fontSize={FONT}
          />
        </div>

        <SketchArrow {...beats.syncArrow} d={L.arrow.d} len={L.arrow.len} w={L.w} h={L.h} />

        <HandNote
          {...beats.handNote}
          left={L.note.left}
          top={L.note.top}
          size={40}
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
            size={(c.size ?? 58) * L.captionScale}
            bottom={i === 0 ? L.heroCaptionBottom : L.captionBottom}
          />
        ))}
      </div>

      <AbsoluteFill style={{opacity: diagramIn, pointerEvents: 'none'}}>
        <DiagramCard scale={L.diagramScale} />
      </AbsoluteFill>

      <AbsoluteFill style={{opacity: endFade, pointerEvents: 'none'}}>
        <EndCard />
      </AbsoluteFill>

      <AbsoluteFill style={{background: '#000', opacity: blackTail, pointerEvents: 'none'}} />
    </AbsoluteFill>
  );
};

export const DemoSquare: React.FC = () => <DemoStacked layout={square} />;
export const DemoTall: React.FC = () => <DemoStacked layout={tall} />;
