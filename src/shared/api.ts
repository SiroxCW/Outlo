// The contract between the UI and the core. The UI sends requests and listens to events.
// Queries read from the local database. Commands change it and are answered with an event.

export interface CoreInfo {
  pid: number;
  startedAt: number;
  nodeVersion: string;
}

export interface Account {
  id: number;
  provider: string;
  email: string;
  displayName: string;
}

export type FolderRole = 'inbox' | 'drafts' | 'sent' | 'deleted' | 'junk' | 'archive' | 'outbox';

export interface Folder {
  id: number;
  accountId: number;
  parentId: number | null;
  name: string;
  role: FolderRole | null;
  isFavorite: boolean;
  totalCount: number;
  unreadCount: number;
}

export interface Address {
  name: string;
  address: string;
}

export type Importance = 'low' | 'normal' | 'high';

export interface MessageSummary {
  id: number;
  accountId: number;
  folderId: number;
  threadId: number | null;
  subject: string;
  preview: string;
  from: Address;
  to: Address[];
  receivedAt: number;
  isRead: boolean;
  isFlagged: boolean;
  isFocused: boolean;
  hasAttachments: boolean;
  importance: Importance;
}

export interface Attachment {
  id: number;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
}

export interface MessageBody {
  contentType: 'html' | 'text';
  content: string;
}

export interface Message extends MessageSummary {
  cc: Address[];
  body: MessageBody | null;
  attachments: Attachment[];
}

export type MessageFilter = 'all' | 'focused' | 'other';

export type SyncState =
  // Headers are still being fetched.
  | 'syncing'
  | 'idle'
  | 'offline'
  // The stored sign-in no longer works. The user has to sign in again.
  | 'signInNeeded'
  // The account exists, but has no mailbox at this provider.
  | 'noMailbox'
  | 'error';

export interface AccountSyncStatus {
  accountId: number;
  state: SyncState;
  // Details for the state 'error'.
  message: string | null;
}

export interface MessagePage {
  total: number;
  offset: number;
  messages: MessageSummary[];
}

export type CoreRequests = {
  'core.info': { params: undefined; result: CoreInfo };

  'accounts.list': { params: undefined; result: Account[] };
  'folders.list': { params: undefined; result: Folder[] };
  'messages.list': {
    params: { folderId: number; filter: MessageFilter; offset: number; limit: number };
    result: MessagePage;
  };
  // Number of messages per time span. The boundaries are timestamps, newest first. The result
  // has one more entry than there are boundaries: newer than the first, between each pair,
  // older than the last.
  'messages.countByTime': {
    params: { folderId: number; filter: MessageFilter; boundaries: number[] };
    result: number[];
  };
  'messages.get': { params: { id: number }; result: Message | null };
  'messages.search': { params: { query: string; limit: number }; result: MessageSummary[] };

  'messages.setRead': { params: { ids: number[]; isRead: boolean }; result: undefined };
  'messages.setFlagged': { params: { ids: number[]; isFlagged: boolean }; result: undefined };

  'sync.status': { params: undefined; result: AccountSyncStatus[] };
  // Checks all accounts for news right away.
  'sync.now': { params: undefined; result: undefined };

  // Settings of the user interface. Keys start with "ui.".
  'settings.get': { params: undefined; result: Record<string, string> };
  'settings.set': { params: { key: string; value: string }; result: undefined };
};

// Events only say what changed. The UI asks again for the data it shows.
export type CoreEvents = {
  'accounts.changed': undefined;
  'folders.changed': undefined;
  'messages.changed': { folderIds: number[] };
  'settings.changed': undefined;
  'sync.changed': AccountSyncStatus[];
};

export type CoreEvent = {
  [Type in keyof CoreEvents]: { type: Type; payload: CoreEvents[Type] };
}[keyof CoreEvents];

export type CoreRequest = <Method extends keyof CoreRequests>(
  method: Method,
  params: CoreRequests[Method]['params'],
) => Promise<CoreRequests[Method]['result']>;

// Requests that only the main process may send to the core, for example after a sign-in.
export type HostRequests = {
  // Adds the account, or returns the existing one if it was added before.
  'accounts.add': {
    params: { provider: 'graph'; remoteId: string; email: string; displayName: string };
    result: { id: number };
  };
  // Deletes the account with all its local data. Returns its ID at the provider.
  'accounts.remove': { params: { id: number }; result: { remoteId: string | null } };
};

export type TokenResult =
  | { status: 'ok'; accessToken: string; expiresAt: number }
  | { status: 'signInNeeded' }
  | { status: 'offline' }
  | { status: 'failed'; message: string };

// What the core asks of the main process. The main process keeps the sign-ins.
export type HostServices = {
  'auth.getToken': { params: { remoteId: string; forceRefresh: boolean }; result: TokenResult };
};

export type AddAccountResult =
  | { status: 'added'; accountId: number }
  | { status: 'cancelled' }
  // The organization of the account does not let its users approve the app themselves.
  | { status: 'blocked'; adminConsentUrl: string }
  | { status: 'failed'; message: string };

// Account functions that need the main process: it runs the sign-in and keeps the secrets.
export interface AccountsBridge {
  addMicrosoft(): Promise<AddAccountResult>;
  cancelAdd(): void;
  remove(accountId: number): Promise<void>;
}

export interface SessionInfo {
  // A demo session works on invented data in a database of its own.
  demo: boolean;
  // False when the system has no keyring, so sign-ins can only be stored weakly protected.
  secureStorage: boolean;
}

export interface SessionBridge {
  getInfo(): Promise<SessionInfo>;
  // Switches between the demo and the real data. The window reloads.
  setDemo(demo: boolean): Promise<void>;
}

export type TitleBarStyle = 'custom' | 'native';

export interface TitleBarColors {
  background: string;
  symbols: string;
}

// Window functions. They are answered by the main process, not by the core.
export interface WindowBridge {
  getTitleBarStyle(): Promise<TitleBarStyle>;
  // Recreates the window, because a window cannot change its frame while it is open.
  setTitleBarStyle(style: TitleBarStyle): Promise<void>;
  setTitleBarColors(colors: TitleBarColors): void;
}

// What the preload script exposes to the UI as window.outlo.
export interface OutloBridge {
  request: CoreRequest;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  window: WindowBridge;
  accounts: AccountsBridge;
  session: SessionBridge;
}

export const MAX_PAGE_SIZE = 500;
export const MAX_TIME_BOUNDARIES = 32;
export const TITLE_BAR_HEIGHT = 48;

export const WINDOW_GET_TITLE_BAR = 'window:get-title-bar';
export const WINDOW_SET_TITLE_BAR = 'window:set-title-bar';
export const WINDOW_SET_COLORS = 'window:set-colors';
export const ACCOUNTS_ADD_MICROSOFT = 'accounts:add-microsoft';
export const ACCOUNTS_CANCEL_ADD = 'accounts:cancel-add';
export const ACCOUNTS_REMOVE = 'accounts:remove';
export const SESSION_GET_INFO = 'session:get-info';
export const SESSION_SET_DEMO = 'session:set-demo';

export const CORE_PORT_REQUEST = 'core-port-request';
export const CORE_PORT = 'core-port';
