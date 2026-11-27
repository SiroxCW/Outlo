import { join } from 'node:path';
import { BrowserWindow, nativeTheme } from 'electron';
import icon from '../../resources/icons/256x256.png?asset';
import { rendererUrl } from './renderer-site';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    icon,
    // Matches the page background, so the window does not flash white before the UI is drawn.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadURL(rendererUrl);
  return window;
}
