import { app, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { APP_URL, isSameSite } from './urls';

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;

// Where the UI is loaded from: the Vite dev server during development, app:// otherwise.
export const rendererUrl = devServerUrl ?? APP_URL;
export const isDevServer = devServerUrl !== undefined;

export function isRendererUrl(url: string): boolean {
  return isSameSite(url, rendererUrl);
}

// True when a message comes from the top frame of our own UI, not from a frame inside it.
export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return frame !== null && frame === event.sender.mainFrame && isRendererUrl(frame.url);
}
