import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import {
  TITLE_BAR_HEIGHT,
  WINDOW_GET_TITLE_BAR,
  WINDOW_SET_COLORS,
  WINDOW_SET_THEME,
  WINDOW_SET_TITLE_BAR,
  type TitleBarColors,
  type TitleBarStyle,
} from '@shared/api';
import icon from '../../resources/icons/256x256.png?asset';
import { isTrustedSender, rendererUrl } from './renderer-site';
import { readTitleBarStyle, writeTitleBarStyle } from './window-settings';

const COLOR = /^#[0-9a-f]{6}$/i;
const customFrames = new WeakSet<BrowserWindow>();

export function createMainWindow(): BrowserWindow {
  // Electron crashes when it draws window buttons without a display, as in automated tests.
  const headless = app.commandLine.getSwitchValue('ozone-platform') === 'headless';
  const custom = readTitleBarStyle() === 'custom' && !headless;
  const dark = nativeTheme.shouldUseDarkColors;

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    icon,
    // Matches the page background, so the window does not flash white before the UI is drawn.
    backgroundColor: dark ? '#141414' : '#f5f5f5',
    // Hides the system title bar. Electron draws the three window buttons over our own bar.
    ...(custom && {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: {
        color: dark ? '#0a0a0a' : '#ebebeb',
        symbolColor: dark ? '#ffffff' : '#242424',
        height: TITLE_BAR_HEIGHT,
      },
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  if (custom) customFrames.add(window);
  window.once('ready-to-show', () => window.show());
  void window.loadURL(rendererUrl);
  return window;
}

export function handleWindowRequests(): void {
  ipcMain.handle(WINDOW_GET_TITLE_BAR, (event): TitleBarStyle => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && customFrames.has(window) ? 'custom' : 'native';
  });

  ipcMain.handle(WINDOW_SET_TITLE_BAR, (event, style: TitleBarStyle) => {
    if (!isTrustedSender(event) || (style !== 'custom' && style !== 'native')) return;
    if (style === readTitleBarStyle()) return;
    writeTitleBarStyle(style);

    // A window cannot change its frame while it is open, so it is replaced by a new one.
    const old = BrowserWindow.fromWebContents(event.sender);
    const replacement = createMainWindow();
    if (old) {
      replacement.setBounds(old.getBounds());
      old.destroy();
    }
  });

  // Web pages, Outlook on the web among them, learn from this whether to be light or dark.
  ipcMain.on(WINDOW_SET_THEME, (event, theme: unknown) => {
    if (!isTrustedSender(event) || (theme !== 'system' && theme !== 'light' && theme !== 'dark')) {
      return;
    }
    nativeTheme.themeSource = theme;
  });

  ipcMain.on(WINDOW_SET_COLORS, (event, colors: TitleBarColors) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!isTrustedSender(event) || !window || !customFrames.has(window)) return;
    if (!COLOR.test(colors?.background) || !COLOR.test(colors?.symbols)) return;
    window.setTitleBarOverlay({
      color: colors.background,
      symbolColor: colors.symbols,
      height: TITLE_BAR_HEIGHT,
    });
  });
}
