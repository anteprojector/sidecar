import React, {useLayoutEffect, useRef, useState} from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from './theme';

export type Span = {text: string; color?: string};

export type Line =
  | {at: number; kind: 'cmd'; text: string; cps?: number}
  | {at: number; kind: 'out'; spans: Span[]}
  | {at: number; kind: 'gap'};

// How many characters of a command are visible at `frame`.
const typedChars = (line: {at: number; text: string; cps?: number}, frame: number) => {
  const perFrame = (line.cps ?? 60) / 30;
  return Math.max(0, Math.min(line.text.length, Math.floor((frame - line.at) * perFrame)));
};

export const Terminal: React.FC<{
  machine: string;
  path: string;
  lines: Line[];
  syncPulseAt?: number[];
  width: number;
  height: number;
  fontSize?: number;
}> = ({machine, path, lines, syncPulseAt = [], width, height, fontSize = 30}) => {
  const frame = useCurrentFrame();

  // Terminal-style scrollback: when the content outgrows the viewport,
  // translate it up so the newest lines stay in view.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el) setScroll(Math.max(0, el.scrollHeight - el.clientHeight));
  }, [frame]);

  const visible = lines.filter((l) => frame >= l.at);
  const lastCmd = [...visible].reverse().find((l) => l.kind === 'cmd') as
    | Extract<Line, {kind: 'cmd'}>
    | undefined;
  const typing = lastCmd && typedChars(lastCmd, frame) < lastCmd.text.length;

  // The daemon badge: dim "watching", flaring to a bright "synced" pulse.
  const pulse = syncPulseAt
    .map((at) =>
      interpolate(frame, [at, at + 8, at + 120, at + 145], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    )
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <div
      style={{
        width,
        height,
        background: theme.wash,
        border: `2px solid ${theme.rule}`,
        borderRadius: 18,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.mono,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 26px',
          borderBottom: `2px solid ${theme.rule}`,
          fontSize: 26,
        }}
      >
        <div style={{display: 'flex', gap: 10}}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{width: 16, height: 16, borderRadius: 8, background: theme.rule}} />
          ))}
        </div>
        <div style={{color: theme.ink, fontWeight: 600}}>{machine}</div>
        <div style={{color: theme.faint}}>{path}</div>
        <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10}}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: pulse > 0.05 ? theme.ok : theme.faint,
              boxShadow: pulse > 0.05 ? `0 0 ${18 * pulse}px ${theme.ok}` : 'none',
            }}
          />
          <span style={{color: pulse > 0.05 ? theme.ok : theme.faint, fontSize: 24}}>
            {pulse > 0.05 ? 'synced' : 'watching'}
          </span>
        </div>
      </div>
      <div ref={viewportRef} style={{flex: 1, overflow: 'hidden'}}>
        <div style={{padding: '28px 34px', fontSize, lineHeight: 1.62, transform: `translateY(${-scroll}px)`}}>
        {visible.map((line, i) => {
          if (line.kind === 'gap') return <div key={i} style={{height: '0.8em'}} />;
          if (line.kind === 'cmd') {
            const n = typedChars(line, frame);
            const isLast = line === lastCmd;
            return (
              <div key={i} style={{whiteSpace: 'pre-wrap'}}>
                <span style={{color: theme.faint}}>$ </span>
                <span style={{color: theme.ink}}>{line.text.slice(0, n)}</span>
                {isLast && typing && <Cursor />}
              </div>
            );
          }
          const opacity = interpolate(frame, [line.at, line.at + 6], [0, 1], {
            extrapolateRight: 'clamp',
          });
          return (
            <div key={i} style={{opacity, whiteSpace: 'pre-wrap'}}>
              {line.spans.map((s, j) => (
                <span key={j} style={{color: s.color ?? theme.muted}}>
                  {s.text}
                </span>
              ))}
            </div>
          );
        })}
        {!typing && <IdlePrompt blink={frame} />}
        </div>
      </div>
    </div>
  );
};

const Cursor: React.FC = () => (
  <span
    style={{
      display: 'inline-block',
      width: '0.6em',
      height: '1.15em',
      background: theme.accent,
      verticalAlign: 'text-bottom',
    }}
  />
);

const IdlePrompt: React.FC<{blink: number}> = ({blink}) => (
  <div>
    <span style={{color: theme.faint}}>$ </span>
    <span
      style={{
        display: 'inline-block',
        width: '0.6em',
        height: '1.15em',
        background: theme.accent,
        opacity: Math.floor(blink / 18) % 2 === 0 ? 0.9 : 0.15,
        verticalAlign: 'text-bottom',
      }}
    />
  </div>
);
