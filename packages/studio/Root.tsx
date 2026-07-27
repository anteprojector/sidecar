import React from 'react';
import {Composition} from 'remotion';
import type {CompositionSpec} from './kit';
import './kit/fonts';

// Every project, in the order they should appear in the studio sidebar.
// Adding a video: drop a folder in projects/ and add its import here.
import {compositions as demo} from './projects/demo';
import {compositions as noConflicts} from './projects/no-conflicts';
import {compositions as secretsStayHome} from './projects/secrets-stay-home';
import {compositions as justGit} from './projects/just-git';
import {compositions as fleetHealth} from './projects/fleet-health';

const projects: CompositionSpec[][] = [
  demo,
  noConflicts,
  secretsStayHome,
  justGit,
  fleetHealth,
];

export const RemotionRoot: React.FC = () => (
  <>
    {projects.flat().map((c) => (
      <Composition
        key={c.id}
        id={c.id}
        component={c.component}
        durationInFrames={c.durationInFrames}
        fps={c.fps ?? 30}
        width={c.width ?? 1920}
        height={c.height ?? 1080}
      />
    ))}
  </>
);
