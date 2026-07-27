import type {CompositionSpec} from '../../kit';
import {JustGit} from './JustGit';
import {DURATION} from './timeline';

export const compositions: CompositionSpec[] = [
  {id: 'JustGit', component: JustGit, durationInFrames: DURATION},
];
