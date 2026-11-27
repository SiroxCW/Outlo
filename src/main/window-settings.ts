import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { TitleBarStyle } from '@shared/api';

// Kept in a file of the main process, because it is needed before the core has started.
const file = () => join(app.getPath('userData'), 'window.json');

export function readTitleBarStyle(): TitleBarStyle {
  try {
    const settings = JSON.parse(readFileSync(file(), 'utf8')) as { titleBar?: unknown };
    return settings.titleBar === 'native' ? 'native' : 'custom';
  } catch {
    return 'custom';
  }
}

export function writeTitleBarStyle(titleBar: TitleBarStyle): void {
  writeFileSync(file(), JSON.stringify({ titleBar }));
}
