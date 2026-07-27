import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {theme} from './theme';

// The shared sign-off, on the yellow-paper colorway. Every project ends here so
// the install line only has to be right in one place.
export const EndCard: React.FC<{
  title?: string;
  install?: string;
  url?: string;
}> = ({
  title,
  install = 'npm i -g sidecarsync',
  url = 'anteprojector.github.io/sidecar',
}) => (
  <AbsoluteFill
    style={{
      background: theme.paper.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 44,
      fontFamily: theme.sans,
    }}
  >
    <Img src={staticFile('logo.svg')} style={{width: 280}} />
    {title && (
      <div style={{fontSize: 110, fontWeight: 700, color: theme.paper.ink, letterSpacing: '-0.02em'}}>
        {title}
      </div>
    )}
    <div style={{fontFamily: theme.mono, fontSize: 78, fontWeight: 700, color: theme.paper.accent}}>
      {install}
    </div>
    <div style={{fontSize: 40, color: theme.paper.muted}}>{url}</div>
  </AbsoluteFill>
);
