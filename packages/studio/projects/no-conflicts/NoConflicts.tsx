import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Caption, EndCard, HandNote, Terminal, theme, type Line} from '../../kit';
import {BranchGraph} from './BranchGraph';
import {beats, captions, ci, laptop, macMini} from './timeline';

// Three panes across the top. The Terminal chrome is tuned for a full-width
// pane, so each is rendered at its natural size and scaled down — that keeps
// this project from having to reach into the shared kit.
const NAT_W = 860;
const NAT_H = 690;
const SCALE = 0.68;
const PANE_W = NAT_W * SCALE;
const GAP = 30;
const PANE_TOP = 56;
const LEFT_X = (1920 - (PANE_W * 3 + GAP * 2)) / 2;
const GRAPH_TOP = 578;

const panes: {machine: string; lines: Line[]}[] = [
  {machine: 'laptop', lines: laptop},
  {machine: 'mac-mini', lines: macMini},
  {machine: 'ci', lines: ci},
];

export const NoConflicts: React.FC = () => {
  const frame = useCurrentFrame();

  const stageOut = interpolate(frame, beats.panesOut, [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const endFade = interpolate(frame, beats.endFade, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const graphIn = interpolate(frame, beats.graphIn, [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      <div style={{opacity: stageOut}}>
        {panes.map((pane, i) => {
          const paneIn = interpolate(frame, [beats.panesIn[0] + i * 6, beats.panesIn[1] + i * 6], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          return (
            <div
              key={pane.machine}
              style={{
                position: 'absolute',
                top: PANE_TOP,
                left: LEFT_X + i * (PANE_W + GAP),
                width: PANE_W,
                height: NAT_H * SCALE,
                opacity: paneIn,
                transform: `translateY(${(1 - paneIn) * 24}px)`,
              }}
            >
              <div style={{transform: `scale(${SCALE})`, transformOrigin: 'top left'}}>
                <Terminal
                  machine={pane.machine}
                  path="~/dev/your-repo"
                  lines={pane.lines}
                  syncPulseAt={beats.syncPulse}
                  width={NAT_W}
                  height={NAT_H}
                />
              </div>
            </div>
          );
        })}

        <div
          style={{
            position: 'absolute',
            top: GRAPH_TOP,
            left: 0,
            opacity: graphIn,
            transform: `translateY(${(1 - graphIn) * 18}px)`,
          }}
        >
          <BranchGraph />
        </div>

        {/* Sits in the band between the panes and the graph — the bottom of the
            frame belongs to the caption. */}
        <HandNote {...beats.handNote} left={1180} top={540} size={40} rotate={-2}>
          no “plan (conflicted copy 3).md”
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
