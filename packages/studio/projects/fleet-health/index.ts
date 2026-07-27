import type {CompositionSpec} from '../../kit';
import {FleetHealth} from './FleetHealth';
import {DURATION} from './timeline';

export const compositions: CompositionSpec[] = [
  {id: 'FleetHealth', component: FleetHealth, durationInFrames: DURATION},
];
