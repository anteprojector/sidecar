import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../../kit';
import {fileLines} from './timeline';

// One copy of the note — the local file or the pushed one. Both render the
// same body; only the last line differs, which is the whole argument.
export const FileCard: React.FC<{
  label: string;
  where: string;
  accent: string;
  width: number;
  height: number;
  /** The key line, and what (if anything) it turns into. */
  secret: string;
  redactedTo?: string;
  redactAt?: number;
}> = ({label, where, accent, width, height, secret, redactedTo, redactAt}) => {
  const frame = useCurrentFrame();
  const swapped = redactAt !== undefined && redactedTo !== undefined && frame >= redactAt;

  // A brief flare on the line as it flips, so the swap is impossible to miss.
  const flare =
    redactAt === undefined
      ? 0
      : interpolate(frame, [redactAt - 4, redactAt + 3, redactAt + 30], [0, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

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
          alignItems: 'baseline',
          gap: 18,
          padding: '22px 30px',
          borderBottom: `2px solid ${theme.rule}`,
        }}
      >
        <span style={{color: accent, fontSize: 28, fontWeight: 600}}>{label}</span>
        <span style={{color: theme.faint, fontSize: 24, marginLeft: 'auto'}}>{where}</span>
      </div>

      <div style={{padding: '30px 34px', fontSize: 28, lineHeight: 1.65}}>
        {fileLines.map((l, i) => (
          <div key={i} style={{color: l.color ?? theme.muted, minHeight: '1em', whiteSpace: 'pre-wrap'}}>
            {l.text}
          </div>
        ))}
        <div
          style={{
            marginTop: 6,
            padding: '6px 10px',
            marginLeft: -10,
            borderRadius: 8,
            background: flare > 0 ? `rgba(61, 220, 132, ${flare * 0.22})` : 'transparent',
            color: swapped ? theme.ok : theme.bad,
            fontWeight: 600,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {swapped ? redactedTo : secret}
        </div>
      </div>
    </div>
  );
};
