import type {CompositionSpec} from '../../kit';
import {Demo} from './Demo';
import {DemoSquare, DemoTall} from './DemoStacked';
import {DURATION} from './timeline';

export const compositions: CompositionSpec[] = [
  {id: 'Demo', component: Demo, durationInFrames: DURATION},
  {id: 'DemoSquare', component: DemoSquare, durationInFrames: DURATION, width: 1080, height: 1080},
  {id: 'DemoTall', component: DemoTall, durationInFrames: DURATION, width: 1080, height: 1920},
];
