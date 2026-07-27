import type {CompositionSpec} from '../../kit';
import {SecretsStayHome} from './SecretsStayHome';
import {DURATION} from './timeline';

export const compositions: CompositionSpec[] = [
  {id: 'SecretsStayHome', component: SecretsStayHome, durationInFrames: DURATION},
];
