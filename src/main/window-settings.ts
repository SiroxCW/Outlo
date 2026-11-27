import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { TitleBarStyle } from '@shared/api';

interface StartSettings {
  titleBar: TitleBarStyle;
  demo: boolean;
}

// Kept in a file of the main process, because it is needed before the core has started.
const file = () => join(app.getPath('userData'), 'window.json');

function read(): StartSettings {
  try {
    const settings = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    return {
      titleBar: settings.titleBar === 'native' ? 'native' : 'custom',
      demo: settings.demo === true,
    };
  } catch {
    return { titleBar: 'custom', demo: false };
  }
}

function write(changes: Partial<StartSettings>): void {
  writeFileSync(file(), JSON.stringify({ ...read(), ...changes }));
}

export const readTitleBarStyle = (): TitleBarStyle => read().titleBar;
export const writeTitleBarStyle = (titleBar: TitleBarStyle): void => write({ titleBar });

// Whether the app was last used with the demo data.
export const readDemoSession = (): boolean => read().demo;
export const writeDemoSession = (demo: boolean): void => write({ demo });
