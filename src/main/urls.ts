import { join, normalize, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'outlo';
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

// Maps an app:// address to a file below root. Returns null for anything that would leave it.
export function resolveAppFile(root: string, url: string): string | null {
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  const base = normalize(root);
  const file = normalize(join(base, pathname === '/' ? 'index.html' : pathname));
  return file.startsWith(base + sep) ? file : null;
}

// URL.origin is "null" for custom schemes, so compare scheme and host directly.
export function isSameSite(url: string, siteUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(siteUrl);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}
