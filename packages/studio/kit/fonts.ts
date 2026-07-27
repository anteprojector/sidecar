import {staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {cancelRender, continueRender, delayRender} from 'remotion';

export const fontsReady = Promise.all([
  loadFont({
    family: 'Schibsted Grotesk',
    url: staticFile('fonts/schibsted-grotesk.woff2'),
  }),
  loadFont({
    family: 'Caveat',
    url: staticFile('fonts/caveat-600.woff2'),
    weight: '600',
  }),
]);

// Imported for side effect by the root: hold the render until the brand fonts
// are in, so the first frames aren't laid out in a fallback face.
const handle = delayRender('loading brand fonts');
fontsReady.then(() => continueRender(handle)).catch((err) => cancelRender(err));
