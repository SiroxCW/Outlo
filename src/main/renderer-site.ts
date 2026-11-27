import { app } from 'electron';
import { APP_URL, isSameSite } from './urls';

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;

// Where the UI is loaded from: the Vite dev server during development, app:// otherwise.
export const rendererUrl = devServerUrl ?? APP_URL;
export const isDevServer = devServerUrl !== undefined;

export function isRendererUrl(url: string): boolean {
  return isSameSite(url, rendererUrl);
}
