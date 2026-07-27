// The shared surface every project builds on. Anything used by two or more
// projects lives here; single-use pieces stay in the project folder that
// needs them.
export {theme} from './theme';
export {fontsReady} from './fonts';
export {Terminal, type Line, type Span} from './Terminal';
export {Caption} from './Caption';
export {HandNote, type Arrow} from './HandNote';
export {EndCard} from './EndCard';
export type {CompositionSpec} from './types';
