import React from 'react';
import {Audio, Sequence, staticFile} from 'remotion';
import {beats} from './timeline';

// The MP4's sound design, in full: a whoosh as the sync arrow draws, one warm
// tick as the badge flips to synced, a low pop for the end card. GIF renders
// simply drop it.
export const AudioTrack: React.FC = () => (
  <>
    <Sequence from={beats.syncArrow.from}>
      <Audio src={staticFile('audio/whoosh.wav')} volume={0.6} />
    </Sequence>
    <Sequence from={beats.macMiniSyncPulse[0]}>
      <Audio src={staticFile('audio/chime.wav')} volume={0.55} />
    </Sequence>
    <Sequence from={beats.endFade[0]}>
      <Audio src={staticFile('audio/pop.wav')} volume={0.5} />
    </Sequence>
  </>
);
