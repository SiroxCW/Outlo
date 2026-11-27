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
  'messages.get': { params: { id: number }; result: Message | null };
  'messages.search': { params: { query: string; limit: number }; result: MessageSummary[] };

  'messages.setRead': { params: { ids: number[]; isRead: boolean }; result: undefined };
  'messages.setFlagged': { params: { ids: number[]; isFlagged: boolean }; result: undefined };
};

// Events only say what changed. The UI asks again for the data it shows.
export type CoreEvents = {
  'accounts.changed': undefined;
  'folders.changed': undefined;
  'messages.changed': { folderIds: number[] };
};

export type CoreEvent = {
  [Type in keyof CoreEvents]: { type: Type; payload: CoreEvents[Type] };
}[keyof CoreEvents];

export type CoreRequest = <Method extends keyof CoreRequests>(
  method: Method,
  params: CoreRequests[Method]['params'],
) => Promise<CoreRequests[Method]['result']>;

// What the preload script exposes to the UI as window.outlo.
export interface OutloBridge {
  request: CoreRequest;
  subscribe(listener: (event: CoreEvent) => void): () => void;
}

export const MAX_PAGE_SIZE = 500;

export const CORE_PORT_REQUEST = 'core-port-request';
export const CORE_PORT = 'core-port';
