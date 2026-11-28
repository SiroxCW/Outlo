import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron';
import {
  ACCOUNTS_ADD_WEB,
  WEB_HIDE,
  WEB_RELOAD,
  WEB_SHOW,
  type AddAccountResult,
  type ViewBounds,
  type WebAccountKind,
} from '@shared/api';
import { isSafeExternalUrl } from '@shared/links';
import { isDemoSession, requestCore } from './core-process';
import { isTrustedSender } from './renderer-site';
import {
  classifyWebUrl,
  hostOf,
  isSignInHandOff,
  mayLoadInWebView,
  plainUserAgent,
  startUrl,
} from './web-policy';

// An account in web mode shows Outlook on the web in a view of its own. Each account has its
// own session, so two accounts stay signed in side by side and none sees the cookies of another.
// The view has no preload script: the page cannot reach anything of the app.
interface WebAccount {
  accountId: number;
  session: Session;
  view: WebContentsView | undefined;
  email: string;
  kind: WebAccountKind;
}

// The key of an account is its ID at the provider in the database: the kind of account, then a
// random name. The key also names the session.
const kindOf = (key: string): WebAccountKind => (key.startsWith('personal-') ? 'personal' : 'work');

const accounts = new Map<string, WebAccount>();
const bySession = new WeakMap<Session, WebAccount>();
let shown: { account: WebAccount; window: BrowserWindow } | undefined;

// Sign-in servers of the user's own organization that the user allowed, per account.
const hostsFile = () => join(app.getPath('userData'), 'web-accounts.json');
function readAllowedHosts(): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(hostsFile(), 'utf8')) as Record<string, string[]>;
  } catch {
    return {};
  }
}
function writeAllowedHosts(key: string, hosts: string[] | undefined): void {
  const all = readAllowedHosts();
  if (hosts) all[key] = hosts;
  else delete all[key];
  writeFileSync(hostsFile(), JSON.stringify(all), { mode: 0o600 });
}

// The session of an account, set up before anything is loaded in it. The key is a random name
// that is never used again, so a new account can never inherit the cookies of a removed one.
function prepare(key: string, accountId: number, email: string): WebAccount {
  let account = accounts.get(key);
  if (account) return account;

  const webSession = session.fromPartition(`persist:web-${key}`);
  webSession.setUserAgent(plainUserAgent(webSession.getUserAgent()));
  // Outlook may show notifications and write to the clipboard. Nothing else is granted.
  const granted = (origin: string, permission: string) =>
    classifyWebUrl(origin) === 'outlook' &&
    (permission === 'notifications' || permission === 'clipboard-sanitized-write');
  webSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(granted(contents.getURL(), permission)),
  );
  webSession.setPermissionCheckHandler((_contents, permission, origin) =>
    granted(origin, permission),
  );

  account = { accountId, session: webSession, view: undefined, email, kind: kindOf(key) };
  accounts.set(key, account);
  bySession.set(webSession, account);
  return account;
}

export function isWebAccountContents(contents: WebContents): boolean {
  return bySession.has(contents.session);
}

function openOutside(url: string): void {
  if (isSafeExternalUrl(url)) void shell.openExternal(url);
}

// Microsoft's sign-in page wants to continue somewhere else. Only the user can tell whether
// that is the sign-in page of their organization.
async function askForSignInServer(contents: WebContents, key: string, url: string): Promise<void> {
  const host = hostOf(url);
  const window = shown?.window ?? BrowserWindow.getAllWindows()[0];
  if (!host || !window) return;
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Outlo Mail',
    message: `Continue the sign-in at ${host}?`,
    detail:
      'Microsoft is sending you to this address. Allow it here only if it is the sign-in page ' +
      'of your organization. Anything else is better opened in your browser.',
    buttons: ['Cancel', 'Open in browser', 'Allow here'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) openOutside(url);
  if (response !== 2 || contents.isDestroyed()) return;
  writeAllowedHosts(key, [...new Set([...(readAllowedHosts()[key] ?? []), host])]);
  void contents.loadURL(url);
}

// Applied to everything that runs in the session of a web account: the view itself and the
// windows Outlook opens, for example for a message in a window of its own.
export function guardWebAccountContents(contents: WebContents): void {
  const account = bySession.get(contents.session);
  const key = [...accounts].find(([, entry]) => entry === account)?.[0];
  if (!account || !key) return;
  const allowed = () => readAllowedHosts()[key] ?? [];

  const guard = (event: Electron.Event, url: string, isMainFrame: boolean) => {
    // Frames inside Outlook load from many Microsoft addresses. Only the page itself is guarded.
    if (!isMainFrame || mayLoadInWebView(url, allowed())) return;
    event.preventDefault();
    if (isSignInHandOff(contents.getURL(), url)) void askForSignInServer(contents, key, url);
    else openOutside(url);
  };
  contents.on('will-navigate', (event) => guard(event, event.url, event.isMainFrame));
  contents.on('will-redirect', (event) => guard(event, event.url, event.isMainFrame));

  contents.setWindowOpenHandler(({ url }) => {
    // Outlook starts some windows empty and fills them afterwards. The guard above covers
    // where they go next.
    if (url !== 'about:blank' && !mayLoadInWebView(url, allowed())) {
      openOutside(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          session: account.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      },
    };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createView(account: WebAccount): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      session: account.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  void view.webContents.loadURL(startUrl(account.email, account.kind));
  return view;
}

function hide(): void {
  if (!shown) return;
  const { account, window } = shown;
  shown = undefined;
  if (account.view && !window.isDestroyed()) window.contentView.removeChildView(account.view);
}

async function findAccount(accountId: number): Promise<[string, WebAccount] | undefined> {
  const known = [...accounts].find(([, account]) => account.accountId === accountId);
  if (known) return known;
  const stored = await requestCore('accounts.listRemote', { provider: 'web' });
  const entry = stored.find((candidate) => candidate.id === accountId);
  return entry && [entry.remoteId, prepare(entry.remoteId, entry.id, entry.email)];
}

// Closes everything of a web account and deletes what its session stored.
export async function forgetWebAccount(key: string): Promise<void> {
  const account = accounts.get(key) ?? prepare(key, -1, '');
  if (shown?.account === account) hide();
  account.view?.webContents.close();
  accounts.delete(key);
  writeAllowedHosts(key, undefined);
  for (const contents of BrowserWindow.getAllWindows().map((window) => window.webContents)) {
    if (contents.session === account.session) contents.close();
  }
  await account.session.clearStorageData();
  await account.session.clearCache();
  await account.session.clearAuthCache();
}

// Hides and closes all web views, for example when the app switches to the demo.
export function closeWebAccounts(): void {
  hide();
  for (const account of accounts.values()) {
    account.view?.webContents.close();
    account.view = undefined;
  }
}

// Removing an account empties its session, but the folder of the session stays behind until
// the app is closed. Folders that belong to no account are deleted at the next start.
async function removeLeftovers(): Promise<void> {
  // The demo knows no web accounts. Judged from there, every folder would look left over.
  if (isDemoSession()) return;
  const stored = await requestCore('accounts.listRemote', { provider: 'web' });
  const known = new Set(stored.map((entry) => `web-${entry.remoteId}`));
  const directory = join(app.getPath('userData'), 'Partitions');
  for (const name of readdirSync(directory)) {
    if (name.startsWith('web-') && !known.has(name)) {
      rmSync(join(directory, name), { recursive: true, force: true });
    }
  }
}

export function handleWebAccountRequests(): void {
  // Nothing to clean up is the normal case: then the folder does not exist.
  removeLeftovers().catch(() => undefined);

  const addWeb = async (
    event: Electron.IpcMainInvokeEvent,
    email: unknown,
    kind: unknown,
  ): Promise<AddAccountResult> => {
    if (!isTrustedSender(event) || typeof email !== 'string') {
      return { status: 'failed', message: 'Not allowed' };
    }
    if (kind !== 'work' && kind !== 'personal') return { status: 'failed', message: 'Not allowed' };
    if (isDemoSession()) return { status: 'failed', message: 'Leave the demo first' };
    const label = email.trim().slice(0, 320);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)) {
      return { status: 'failed', message: 'This is not an email address' };
    }
    const { id } = await requestCore('accounts.add', {
      provider: 'web',
      remoteId: `${kind}-${randomUUID()}`,
      email: label,
      displayName: label,
    });
    return { status: 'added', accountId: id };
  };
  ipcMain.handle(ACCOUNTS_ADD_WEB, addWeb);

  ipcMain.on(WEB_SHOW, (event, accountId: unknown, bounds: ViewBounds) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!isTrustedSender(event) || !window || typeof accountId !== 'number') return;
    if (isDemoSession()) return;
    const values = [bounds?.x, bounds?.y, bounds?.width, bounds?.height];
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value < 100_000)) return;

    void findAccount(accountId).then((found) => {
      if (!found || window.isDestroyed()) return;
      const [, account] = found;
      // The page is only loaded when the account is opened for the first time.
      account.view ??= createView(account);
      if (shown && (shown.account !== account || shown.window !== window)) hide();
      if (!shown) window.contentView.addChildView(account.view);
      shown = { account, window };
      account.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    });
  });

  ipcMain.on(WEB_HIDE, (event) => {
    if (isTrustedSender(event)) hide();
  });

  ipcMain.on(WEB_RELOAD, (event, accountId: unknown) => {
    if (!isTrustedSender(event) || typeof accountId !== 'number') return;
    const account = [...accounts.values()].find((entry) => entry.accountId === accountId);
    if (!account?.view) return;
    // Back to the start page if the view ended up somewhere else, a plain reload otherwise.
    const contents = account.view.webContents;
    if (classifyWebUrl(contents.getURL()) === 'outlook') contents.reload();
    else void contents.loadURL(startUrl(account.email, account.kind));
  });
}
