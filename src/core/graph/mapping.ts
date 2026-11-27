import type { Address, Importance } from '@shared/api';

// The parts of Graph's answers that the sync reads. Everything can be missing.
export interface GraphFolder {
  id: string;
  displayName?: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
  isHidden?: boolean;
  '@removed'?: unknown;
}

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string;
  from?: GraphRecipient | null;
  sender?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  importance?: string;
  hasAttachments?: boolean;
  inferenceClassification?: string;
  '@removed'?: unknown;
}

export interface GraphPage<Item> {
  value?: Item[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export const MESSAGE_FIELDS = [
  'conversationId',
  'subject',
  'bodyPreview',
  'from',
  'sender',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'isRead',
  'flag',
  'importance',
  'hasAttachments',
  'inferenceClassification',
].join(',');

export const FOLDER_FIELDS =
  'displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount,isHidden';

// The header fields of a message. An answer about a changed message may leave some out.
export interface MessageFields {
  conversationId: string | null;
  subject: string;
  preview: string;
  from: Address;
  to: Address[];
  cc: Address[];
  receivedAt: number;
  isRead: boolean;
  isFlagged: boolean;
  isFocused: boolean;
  hasAttachments: boolean;
  importance: Importance;
}

export interface RemoteMessage {
  remoteId: string;
  // Only what the answer contained. Missing fields keep their stored value.
  fields: Partial<MessageFields>;
}

function toAddress(recipient: GraphRecipient | null | undefined): Address {
  return {
    name: recipient?.emailAddress?.name ?? '',
    address: recipient?.emailAddress?.address ?? '',
  };
}

export function toRemoteMessage(message: GraphMessage): RemoteMessage {
  const fields: Partial<MessageFields> = {};
  if (message.conversationId) fields.conversationId = message.conversationId;
  if (message.subject !== undefined) fields.subject = message.subject ?? '';
  // Previews come with line breaks. In the list they are one line.
  if (message.bodyPreview !== undefined) {
    fields.preview = message.bodyPreview.replace(/\s+/g, ' ').trim();
  }
  if (message.from || message.sender) fields.from = toAddress(message.from ?? message.sender);
  if (message.toRecipients) fields.to = message.toRecipients.map(toAddress);
  if (message.ccRecipients) fields.cc = message.ccRecipients.map(toAddress);
  const time = Date.parse(message.receivedDateTime ?? message.sentDateTime ?? '');
  if (Number.isFinite(time)) fields.receivedAt = time;
  if (message.isRead !== undefined) fields.isRead = message.isRead;
  if (message.flag) fields.isFlagged = message.flag.flagStatus === 'flagged';
  if (message.inferenceClassification) {
    fields.isFocused = message.inferenceClassification !== 'other';
  }
  if (message.hasAttachments !== undefined) fields.hasAttachments = message.hasAttachments;
  if (message.importance) {
    const importance = message.importance.toLowerCase();
    fields.importance = importance === 'high' || importance === 'low' ? importance : 'normal';
  }
  return { remoteId: message.id, fields };
}
