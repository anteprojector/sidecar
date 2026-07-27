import type React from 'react';

// What each project exports. Root turns these into <Composition> elements, so
// adding a video is one folder plus one import line — no registration ritual.
export type CompositionSpec = {
  id: string;
  component: React.FC;
  durationInFrames: number;
  /** Defaults to 30. */
  fps?: number;
  /** Defaults to 1920. */
  width?: number;
  /** Defaults to 1080. */
  height?: number;
};
