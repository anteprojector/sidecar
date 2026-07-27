import type {CompositionSpec} from '../../kit';
import {NoConflicts} from './NoConflicts';
import {DURATION} from './timeline';

export const compositions: CompositionSpec[] = [
  {id: 'NoConflicts', component: NoConflicts, durationInFrames: DURATION},
];
