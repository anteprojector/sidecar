import {Config} from '@remotion/cli/config';

// The package is organised as kit/ + projects/, so the entry point sits at the
// root rather than Remotion's default src/index.ts.
Config.setEntryPoint('./entry.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
