import type { WebAccountKind, WebModule, WebPage } from '@shared/api';

// Which addresses the view of a web account may load. Everything else leaves the app.

// Outlook on the web, for work and school accounts and for personal ones.
const OUTLOOK_HOSTS = new Set([
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.cloud.microsoft',
  'outlook.live.com',
]);

// Microsoft's own sign-in pages, including the ones for a second factor.
const SIGN_IN_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.windows.net',
  'login.live.com',
  'account.live.com',
  'mysignins.microsoft.com',
  'account.activedirectory.windowsazure.com',
  'device.login.microsoftonline.com',
]);

export type WebUrlKind =
  | 'outlook'
  | 'signIn'
  // A sign-in page of the user's own organization that the user allowed for this account.
  | 'allowed'
  // A web address that belongs into the system browser.
  | 'external'
  // Not a web address at all.
  | 'refused';

export function classifyWebUrl(address: string, allowedHosts: readonly string[] = []): WebUrlKind {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'refused';
  }
  if (url.protocol === 'http:' || url.protocol === 'mailto:') return 'external';
  if (url.protocol !== 'https:') return 'refused';
  // An address with a user name in it is a classic way to disguise where it leads.
  if (url.username || url.password) return 'external';

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (OUTLOOK_HOSTS.has(host)) return 'outlook';
  if (SIGN_IN_HOSTS.has(host)) return 'signIn';
  if (allowedHosts.includes(host)) return 'allowed';
  return 'external';
}

export function mayLoadInWebView(address: string, allowedHosts: readonly string[] = []): boolean {
  const kind = classifyWebUrl(address, allowedHosts);
  return kind === 'outlook' || kind === 'signIn' || kind === 'allowed';
}

// Many organizations sign their people in on a server of their own. Microsoft's sign-in page
// sends the user there, so this is the one moment where an unknown address may be a sign-in page.
// The user is asked before it is loaded.
export function isSignInHandOff(from: string, to: string): boolean {
  if (classifyWebUrl(from) !== 'signIn' || classifyWebUrl(to) !== 'external') return false;
  // Microsoft's own pages, like its privacy statement, are never an organization's sign-in.
  return /^https:/i.test(to) && !/(^|\.)microsoft\.com$/.test(hostOf(to));
}

export function hostOf(address: string): string {
  try {
    return new URL(address).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

const PATHS: Record<WebPage, string> = {
  mail: '/mail/',
  calendar: '/calendar/',
  people: '/people/',
  // The address of the appearance page itself opens an empty page, this one a filled one.
  settings: '/mail/options/general',
};

// A page of Outlook on the web. A view that already shows Outlook stays on its host, because
// Microsoft serves work accounts from several of them.
export function pageUrl(page: WebPage, kind: WebAccountKind, current = ''): string {
  const host =
    classifyWebUrl(current) === 'outlook'
      ? hostOf(current)
      : kind === 'personal'
        ? 'outlook.live.com'
        : 'outlook.office.com';
  return `https://${host}${PATHS[page]}`;
}

// Where the view of an account starts. The address is only a hint for the sign-in page.
export function startUrl(email: string, kind: WebAccountKind): string {
  const hint = /^[^\s@]+@[^\s@]+$/.test(email) ? `?login_hint=${encodeURIComponent(email)}` : '';
  return pageUrl('mail', kind) + hint;
}

// The module an address of Outlook on the web belongs to. Settings count as mail.
export function moduleOf(address: string): WebModule | undefined {
  if (classifyWebUrl(address) !== 'outlook') return undefined;
  const path = new URL(address).pathname.toLowerCase();
  if (/^\/calendar(\/|$)/.test(path)) return 'calendar';
  if (/^\/people(\/|$)/.test(path)) return 'people';
  return 'mail';
}

// Outlook on the web brings its own app bar, launcher and logo. The app shows its own bar next
// to the page, so these are hidden. Only the look changes: nothing is read from the page, and
// when Microsoft renames these parts they simply show again.
export const OUTLOOK_STYLE =
  '#LeftRail, #owaAppLauncherBtn_container, #owaBranding_container { display: none !important; }';

// Web apps look at the browser's name to decide what they offer. The view is the Chromium it
// says it is, without the name of the app and of Electron added to it.
export function plainUserAgent(userAgent: string): string {
  const parts = /^(.*?\(KHTML, like Gecko\)).*?(Chrome\/\S+).*?(Safari\/\S+)\s*$/.exec(userAgent);
  return parts ? `${parts[1]} ${parts[2]} ${parts[3]}` : userAgent;
}
