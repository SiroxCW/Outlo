import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { handleAccountRequests } from './accounts';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { handleAttachmentRequests } from './attachments';
import { startCore } from './core-process';
import { startLogging, watchContents } from './logging';
import { getMicrosoftToken } from './microsoft/sign-in';
import { hardenSession, hardenWebContents } from './security';
import {
  guardWebAccountContents,
  handleWebAccountRequests,
  isWebAccountContents,
} from './web-accounts';
import { createMainWindow, handleWindowRequests } from './window';
import { readDemoSession } from './window-settings';

// Lower case as usual on Linux, and a folder of its own for development builds.
// --user-data-dir on the command line still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'outlo' : 'outlo-dev'));
}

// Inside a Flatpak the desktop file is named after the app ID. The window needs the same name,
// or the desktop cannot match it to its icon.
if (process.env.FLATPAK_ID) app.setDesktopName(`${process.env.FLATPAK_ID}.desktop`);

// Two running copies would both write to the same mail database.
if (!app.requestSingleInstanceLock()) app.exit();
else startLogging();
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

registerAppScheme();
app.enableSandbox();

// Web accounts run in sessions of their own and follow their own rules.
app.on('web-contents-created', (_event, contents) => {
  if (isWebAccountContents(contents)) {
    guardWebAccountContents(contents);
    watchContents(contents, 'web');
  } else {
    hardenWebContents(contents);
    watchContents(contents, 'window');
  }
});
app.on('window-all-closed', () => app.quit());

void app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  handleAppProtocol();
  // The demo is opened from inside the app, or with --demo for one start.
  startCore({
    demo: app.commandLine.hasSwitch('demo') || readDemoSession(),
    services: {
      'auth.getToken': ({ remoteId, forceRefresh }) => getMicrosoftToken(remoteId, forceRefresh),
    },
  });
  handleWindowRequests();
  handleAccountRequests();
  handleAttachmentRequests();
  handleWebAccountRequests();
  createMainWindow();
});
