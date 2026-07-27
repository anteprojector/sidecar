import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../../kit';
import {repoFiles} from './timeline';

// Browser chrome around a GitHub-ish file listing. The point is only that the
// scratchpad opens in a browser like any other repo, so this stays a sketch —
// enough signal to read as "a repo on a host", no more.
export const Browser: React.FC<{
  url: string;
  width: number;
  height: number;
  /** Rows appear one at a time from this frame. */
  rowsFrom: number;
}> = ({url, width, height, rowsFrom}) => {
  const frame = useCurrentFrame();

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
        fontFamily: theme.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '18px 26px',
          borderBottom: `2px solid ${theme.rule}`,
        }}
      >
        <div style={{display: 'flex', gap: 10}}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{width: 16, height: 16, borderRadius: 8, background: theme.rule}} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            background: theme.bg,
            border: `2px solid ${theme.rule}`,
            borderRadius: 999,
            padding: '8px 22px',
            fontFamily: theme.mono,
            fontSize: 24,
            color: theme.muted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {url}
        </div>
      </div>

      <div style={{padding: '26px 30px'}}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            paddingBottom: 20,
            color: theme.muted,
            fontSize: 26,
          }}
        >
          <span style={{color: theme.accent, fontWeight: 600}}>your-notes</span>
          <span style={{color: theme.faint}}>private</span>
          <span style={{marginLeft: 'auto', fontFamily: theme.mono, color: theme.faint, fontSize: 23}}>
            4 commits
          </span>
        </div>

        {repoFiles.map((f, i) => {
          const at = rowsFrom + i * 7;
          const rowIn = interpolate(frame, [at, at + 12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={f.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '17px 14px',
                borderTop: `2px solid ${theme.rule}`,
                opacity: rowIn,
                transform: `translateY(${(1 - rowIn) * 8}px)`,
              }}
            >
              <span style={{fontFamily: theme.mono, fontSize: 27, color: theme.ink, width: 210}}>
                {f.name}
              </span>
              <span style={{fontSize: 25, color: theme.faint, flex: 1}}>{f.note}</span>
              <span style={{fontSize: 23, color: theme.faint}}>{f.when}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
