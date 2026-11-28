import type { SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  Account,
  Address,
  Attachment,
  ConversationSummary,
  Draft,
  DraftContent,
  DraftKind,
  Folder,
  FolderRole,
  Importance,
  InlineImage,
  ListEntry,
  ListFilter,
  ListOptions,
  Message,
  MessageBody,
  MessageFilter,
  MessagePage,
  MessageSort,
  MessageSummary,
  ResponseKind,
  SortField,
} from '@shared/api';
import { MAX_CONVERSATION_SIZE } from '@shared/api';
import { transaction, type Database } from '../db/database';
import type { RemoteMessage } from '../graph/mapping';
import {
  buildQuote,
  draftHtml,
  draftPreview,
  responseRecipients,
  responseSubject,
} from './compose';
import { toFtsTerms } from './fts-query';
import { bodyText } from './text';

type Row = Record<string, unknown>;

const IMPORTANCE: Importance[] = ['low', 'normal', 'high'];

// Picture types that are shown inside the text of a message. No SVG: it can carry scripts.
export const INLINE_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|bmp)$/i;

// Changes the user can make to a message. Read and flag set a column, a move sets the folder.
export type OperationKind = 'read' | 'flag' | 'move';
type FieldKind = 'read' | 'flag';
const CHANGE_COLUMNS: Record<FieldKind, string> = { read: 'is_read', flag: 'is_flagged' };
// True or false for read and flag, the provider's ID of a folder for a move.
export type OperationValue = boolean | string;
interface WaitingChange {
  value: OperationValue;
  before: OperationValue;
}
type WaitingChanges = Partial<Record<OperationKind, WaitingChange>>;

const SUMMARY_COLUMNS = `
  m.id, m.account_id, m.folder_id, m.thread_id, m.subject, m.preview, m.from_name,
  m.from_address, m.to_recipients, m.received_at, m.is_read, m.is_flagged, m.is_focused,
  m.has_attachments, m.importance,
  EXISTS (SELECT 1 FROM drafts d WHERE d.message_id = m.id) AS is_draft`;

export interface NewFolder {
  accountId: number;
  parentId: number | null;
  name: string;
  role: FolderRole | null;
  sortOrder: number;
  isFavorite: boolean;
}

export interface NewMessage {
  accountId: number;
  folderId: number;
  threadId: number | null;
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

// A folder as the provider reports it. The list given to saveRemoteFolders is always complete.
export interface RemoteFolder {
  remoteId: string;
  parentRemoteId: string | null;
  name: string;
  role: FolderRole | null;
  sortOrder: number;
  totalCount: number;
  unreadCount: number;
}

export interface SyncFolder {
  id: number;
  remoteId: string;
  role: FolderRole | null;
  syncLink: string | null;
  // 0: nothing waiting, 1: a round from the start is running, 2: a round of changes is running.
  syncPending: number;
  syncRound: number;
}

export interface NewAttachment {
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  remoteId?: string;
  contentId?: string | null;
  // Only for pictures inside the text. They are stored with the message.
  content?: Uint8Array;
}

// A change that waits for the provider.
export interface Operation {
  id: number;
  accountId: number;
  kind: string;
  remoteId: string | null;
  // As stored, so a newer change that came in while this one was on its way can be told apart.
  data: string;
  value: OperationValue;
  // What the provider had before, which comes back here when it refuses the change.
  before: OperationValue;
  attempts: number;
}

// A draft as it goes to the provider.
export interface DraftToSend {
  messageId: number;
  accountId: number;
  remoteId: string | null;
  kind: DraftKind;
  sourceRemoteId: string | null;
  version: number;
  attempts: number;
  subject: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  html: string;
}

// What is needed to fetch an attachment from its provider or to write it to a file.
export interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  accountId: number;
  remoteId: string | null;
  messageRemoteId: string | null;
  content: Uint8Array | null;
}

function toAccount(row: Row): Account {
  return {
    id: row.id as number,
    provider: row.provider as string,
    email: row.email as string,
    displayName: row.display_name as string,
  };
}

function toFolder(row: Row): Folder {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    parentId: row.parent_id as number | null,
    name: row.name as string,
    role: row.role as FolderRole | null,
    isFavorite: row.is_favorite === 1,
    totalCount: row.total_count as number,
    unreadCount: row.unread_count as number,
  };
}

function toSummary(row: Row): MessageSummary {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    folderId: row.folder_id as number,
    threadId: row.thread_id as number | null,
    subject: row.subject as string,
    preview: row.preview as string,
    from: { name: row.from_name as string, address: row.from_address as string },
    to: JSON.parse(row.to_recipients as string) as Address[],
    receivedAt: row.received_at as number,
    isRead: row.is_read === 1,
    isFlagged: row.is_flagged === 1,
    isFocused: row.is_focused === 1,
    hasAttachments: row.has_attachments === 1,
    importance: IMPORTANCE[row.importance as number] ?? 'normal',
    isDraft: row.is_draft === 1,
  };
}

function toOperation(row: Row): Operation {
  const data = JSON.parse(row.data as string) as { value?: unknown; before?: unknown };
  const known = (entry: unknown): OperationValue =>
    typeof entry === 'boolean' || typeof entry === 'string' ? entry : false;
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    kind: row.kind as string,
    remoteId: row.remote_id as string | null,
    data: row.data as string,
    value: known(data.value),
    before: known(data.before),
    attempts: row.attempts as number,
  };
}

function toAttachment(row: Row): Attachment {
  return {
    id: row.id as number,
    name: row.name as string,
    contentType: row.content_type as string,
    size: row.size as number,
    isInline: row.is_inline === 1,
    contentId: row.content_id as string | null,
  };
}

// The conditions of the Filter menu, for the messages table under the given name. "To me" means
// on the To line; a copy (Cc) does not count.
const SHOW: Record<ListFilter, ((table: string) => string) | null> = {
  all: null,
  unread: (table) => `${table}.is_read = 0`,
  flagged: (table) => `${table}.is_flagged = 1`,
  hasFiles: (table) => `${table}.has_attachments = 1`,
  toMe: (table) => `EXISTS (
    SELECT 1 FROM json_each(${table}.to_recipients) r JOIN accounts a ON a.id = ${table}.account_id
    WHERE lower(json_extract(r.value, '$.address')) = lower(a.email))`,
};

// The messages of a conversation as seen from a folder (parameter): Deleted Items and Junk only
// count in their own list. Needs the messages table as m and its folders as f.
const CONVERSATION_SCOPE =
  "(f.role IS NULL OR f.role NOT IN ('deleted', 'junk') OR m.folder_id = ?)";
const MAX_SENDERS = 5;

// What a list sorted by a field is grouped by. The list is ordered by the same expression, so
// the groups and the list agree. Case does not split a group.
export const GROUP_KEYS: Record<Exclude<SortField, 'date'>, string> = {
  from: "(CASE WHEN m.from_name <> '' THEN m.from_name ELSE m.from_address END) COLLATE NOCASE",
  subject: 'm.subject COLLATE NOCASE',
  importance: 'm.importance',
  flag: 'm.is_flagged',
};

function groupsConversations(options: ListOptions): boolean {
  return options.conversations === true && (options.sort?.field ?? 'date') === 'date';
}

// Whether a message of the table under the given name passes the tab and the filter.
function passes(
  table: string,
  filter: MessageFilter,
  options: ListOptions,
): { condition: string; params: SQLInputValue[] } {
  const parts = ['1'];
  const params: SQLInputValue[] = [];
  if (filter !== 'all') parts.push(`${table}.is_focused = ${filter === 'focused' ? 1 : 0}`);
  const condition = SHOW[options.show ?? 'all']?.(table);
  if (condition && options.keepId !== undefined) {
    parts.push(`(${condition} OR ${table}.id = ?)`);
    params.push(options.keepId);
  } else if (condition) {
    parts.push(condition);
  }
  return { condition: parts.join(' AND '), params };
}

// Which messages of a folder a list shows. Only fixed parts of SQL are put together here; every
// value is a parameter.
function listWhere(
  folderId: number,
  filter: MessageFilter,
  options: ListOptions,
): { where: string; params: SQLInputValue[] } {
  const own = passes('m', filter, options);
  const parts = ['m.folder_id = ?', own.condition];
  const params: SQLInputValue[] = [folderId, ...own.params];
  if (groupsConversations(options)) {
    // A conversation shows as its newest message in the folder that passes the filter.
    const newer = passes('n', filter, options);
    parts.push(`(m.thread_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM messages n WHERE n.folder_id = m.folder_id AND n.thread_id = m.thread_id
        AND (n.received_at > m.received_at OR (n.received_at = m.received_at AND n.id > m.id))
        AND ${newer.condition}))`);
    params.push(...newer.params);
  }
  return { where: parts.join(' AND '), params };
}

function orderBy(sort: MessageSort | undefined): string {
  const field = sort?.field ?? 'date';
  const direction = sort?.descending === false ? 'ASC' : 'DESC';
  if (field === 'date') return `m.received_at ${direction}, m.id ${direction}`;
  // Inside a group the newest message comes first, whichever way the groups run.
  return `${GROUP_KEYS[field]} ${direction}, m.received_at DESC, m.id DESC`;
}

function groupValue(field: SortField, value: unknown): string {
  if (field === 'importance') return IMPORTANCE[value as number] ?? 'normal';
  if (field === 'flag') return value === 1 ? 'flagged' : 'unflagged';
  return String(value);
}

// All reads and writes of mail data go through this class. Statements are prepared once.
export class MailStore {
  private readonly statements = new Map<string, StatementSync>();
  // Changes on their way to the provider right now.
  private readonly sending = new Set<number>();

  constructor(private readonly db: Database) {}

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text);
    if (!statement) {
      statement = this.db.prepare(text);
      this.statements.set(text, statement);
    }
    return statement;
  }

  transaction<Result>(run: () => Result): Result {
    return transaction(this.db, run);
  }

  // Queries

  listAccounts(): Account[] {
    return this.sql('SELECT * FROM accounts ORDER BY sort_order, id').all().map(toAccount);
  }

  getAccount(id: number): Account | null {
    const row = this.sql('SELECT * FROM accounts WHERE id = ?').get(id);
    return row ? toAccount(row) : null;
  }

  listFolders(): Folder[] {
    return this.sql('SELECT * FROM folders ORDER BY account_id, sort_order, id')
      .all()
      .map(toFolder);
  }

  listMessages(
    folderId: number,
    filter: MessageFilter,
    offset: number,
    limit: number,
    options: ListOptions = {},
  ): MessagePage {
    const { where, params } = listWhere(folderId, filter, options);
    const grouped = groupsConversations(options);
    // Every conversation with a message that passes has one entry, so counting conversations
    // gives the same number. It is three times faster than asking each message.
    const counted = grouped
      ? listWhere(folderId, filter, { ...options, conversations: false })
      : { where, params };
    const what = grouped ? 'count(DISTINCT coalesce(m.thread_id, -m.id))' : 'count(*)';
    const count = this.sql(`SELECT ${what} AS total FROM messages m WHERE ${counted.where}`).get(
      ...counted.params,
    ) as { total: number };
    const rows = this.sql(
      `SELECT ${SUMMARY_COLUMNS} FROM messages m WHERE ${where}
       ORDER BY ${orderBy(options.sort)} LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);
    const messages = rows.map(toSummary);
    return {
      total: count.total,
      offset,
      messages: grouped ? this.withConversations(folderId, messages) : messages,
    };
  }

  // Adds to each message what the list shows of its conversation.
  private withConversations(folderId: number, messages: MessageSummary[]): ListEntry[] {
    const threadIds = JSON.stringify([
      ...new Set(messages.flatMap((message) => message.threadId ?? [])),
    ]);
    const inThreads = `m.thread_id IN (SELECT value FROM json_each(?)) AND ${CONVERSATION_SCOPE}`;
    const totals = new Map(
      this.sql(
        `SELECT m.thread_id, count(*) AS size, sum(m.folder_id = ? AND m.is_read = 0) AS unread,
           max(m.is_flagged) AS flagged, max(m.has_attachments) AS files,
           max(EXISTS (SELECT 1 FROM drafts d WHERE d.message_id = m.id)) AS drafts
         FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${inThreads}
         GROUP BY m.thread_id`,
      )
        .all(folderId, threadIds, folderId)
        .map((row) => [row.thread_id as number, row]),
    );
    const senders = new Map<number, Address[]>();
    // A draft written here has not been sent by anyone yet.
    const rows = this.sql(
      `SELECT m.thread_id, m.from_name, m.from_address
       FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${inThreads}
         AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.message_id = m.id)
       ORDER BY m.thread_id, m.received_at DESC, m.id DESC`,
    ).all(threadIds, folderId);
    for (const row of rows) {
      const list = senders.get(row.thread_id as number) ?? [];
      const address = row.from_address as string;
      const known = list.some((entry) => entry.address.toLowerCase() === address.toLowerCase());
      if (!known && list.length < MAX_SENDERS)
        list.push({ name: row.from_name as string, address });
      senders.set(row.thread_id as number, list);
    }

    return messages.map((message) => {
      const total = message.threadId === null ? undefined : totals.get(message.threadId);
      const conversation: ConversationSummary = total
        ? {
            size: total.size as number,
            unreadCount: total.unread as number,
            isFlagged: total.flagged === 1,
            hasAttachments: total.files === 1,
            senders: senders.get(message.threadId!) ?? [message.from],
            hasDraft: total.drafts === 1,
          }
        : {
            size: 1,
            unreadCount: message.isRead ? 0 : 1,
            isFlagged: message.isFlagged,
            hasAttachments: message.hasAttachments,
            senders: [message.from],
            hasDraft: message.isDraft,
          };
      return { ...message, conversation };
    });
  }

  // The conversation of a message as seen from the list of a folder, newest first.
  getConversation(messageId: number, folderId: number): MessageSummary[] {
    return this.sql(
      `SELECT ${SUMMARY_COLUMNS} FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ?1 OR (
         m.thread_id = (SELECT thread_id FROM messages WHERE id = ?1)
         AND (f.role IS NULL OR f.role NOT IN ('deleted', 'junk') OR m.folder_id = ?2))
       ORDER BY m.received_at DESC, m.id DESC LIMIT ?3`,
    )
      .all(messageId, folderId, MAX_CONVERSATION_SIZE)
      .map(toSummary);
  }

  countByTime(
    folderId: number,
    filter: MessageFilter,
    boundaries: number[],
    options: ListOptions = {},
  ): number[] {
    const { where, params } = listWhere(folderId, filter, options);
    // One pass over the folder index. Each column counts the messages newer than one boundary.
    const columns = boundaries.map(
      (_, index) => `count(*) FILTER (WHERE m.received_at >= ?) AS c${index}`,
    );
    const row = this.sql(
      `SELECT count(*) AS total, ${['0 AS none', ...columns].join(', ')}
       FROM messages m WHERE ${where}`,
    ).get(...boundaries, ...params) as Record<string, number>;

    const newerThan = boundaries.map((_, index) => row[`c${index}`] ?? 0);
    return [...newerThan, row.total ?? 0].map(
      (count, index) => count - (newerThan[index - 1] ?? 0),
    );
  }

  // The groups of a list that is sorted by anything but date. A list sorted by date is grouped
  // by day in the UI, with countByTime.
  countByGroup(
    folderId: number,
    filter: MessageFilter,
    options: ListOptions = {},
  ): { value: string; count: number }[] {
    const field = options.sort?.field ?? 'date';
    if (field === 'date') return [];
    const { where, params } = listWhere(folderId, filter, options);
    const direction = options.sort?.descending ? 'DESC' : 'ASC';
    return this.sql(
      `SELECT ${GROUP_KEYS[field]} AS value, count(*) AS count FROM messages m WHERE ${where}
       GROUP BY 1 ORDER BY 1 ${direction}`,
    )
      .all(...params)
      .map((row) => ({ value: groupValue(field, row.value), count: row.count as number }));
  }

  getMessage(id: number): Message | null {
    const row = this.sql(
      `SELECT ${SUMMARY_COLUMNS}, m.cc_recipients, b.content_type, b.content
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id WHERE m.id = ?`,
    ).get(id);
    if (!row) return null;

    const body: MessageBody | null =
      row.content === null
        ? null
        : { contentType: row.content_type as 'html' | 'text', content: row.content as string };
    const rows = this.sql(
      `SELECT a.*, c.content FROM attachments a
       LEFT JOIN attachment_contents c ON c.attachment_id = a.id
       WHERE a.message_id = ? ORDER BY a.id`,
    ).all(id);
    const inlineImages: InlineImage[] = [];
    for (const entry of rows) {
      const type = entry.content_type as string;
      if (!entry.content || !entry.content_id || !INLINE_IMAGE_TYPES.test(type)) continue;
      const base64 = Buffer.from(entry.content as Uint8Array).toString('base64');
      inlineImages.push({
        contentId: entry.content_id as string,
        dataUrl: `data:${type.toLowerCase()};base64,${base64}`,
      });
    }
    return {
      ...toSummary(row),
      cc: JSON.parse(row.cc_recipients as string) as Address[],
      body,
      attachments: rows.map(toAttachment),
      inlineImages,
    };
  }

  // Every word has to occur in the message, but each may be in another part: "anna invoice"
  // finds a mail from Anna that mentions the invoice only in its text.
  search(query: string, limit: number): MessageSummary[] {
    const terms = toFtsTerms(query);
    if (terms.length === 0) return [];
    const matches = `m.id IN (
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?
      UNION SELECT rowid FROM message_text_fts WHERE message_text_fts MATCH ?)`;
    return this.sql(
      `SELECT ${SUMMARY_COLUMNS} FROM messages m WHERE ${terms.map(() => matches).join(' AND ')}
       ORDER BY m.received_at DESC, m.id DESC LIMIT ?`,
    )
      .all(...terms.flatMap((term) => [term, term]), limit)
      .map(toSummary);
  }

  // Stored texts in the order of their message IDs, to fill the search index in steps.
  listBodies(afterId: number, limit: number): { messageId: number; body: MessageBody }[] {
    return this.sql(
      `SELECT message_id, content_type, content FROM message_bodies WHERE message_id > ?
       ORDER BY message_id LIMIT ?`,
    )
      .all(afterId, limit)
      .map((row) => ({
        messageId: row.message_id as number,
        body: { contentType: row.content_type as 'html' | 'text', content: row.content as string },
      }));
  }

  // The text of a message as it was received, or null when it is not stored.
  getBodyContent(messageId: number): string | null {
    const row = this.sql('SELECT content FROM message_bodies WHERE message_id = ?').get(messageId);
    return row ? (row.content as string) : null;
  }

  // Where a message comes from. Null for messages without a provider, like demo mail.
  getRemoteMessage(messageId: number): { accountId: number; remoteId: string } | null {
    const row = this.sql(
      'SELECT account_id, remote_id FROM messages WHERE id = ? AND remote_id IS NOT NULL',
    ).get(messageId);
    return row ? { accountId: row.account_id as number, remoteId: row.remote_id as string } : null;
  }

  // The newest messages of an account whose text is not stored yet.
  listMessagesWithoutBody(
    accountId: number,
    since: number,
    limit: number,
  ): { id: number; remoteId: string }[] {
    return this.sql(
      `SELECT m.id, m.remote_id FROM messages m
       WHERE m.account_id = ? AND m.remote_id IS NOT NULL AND m.received_at >= ?
         AND NOT EXISTS (SELECT 1 FROM message_bodies b WHERE b.message_id = m.id)
       ORDER BY m.received_at DESC LIMIT ?`,
    )
      .all(accountId, since, limit)
      .map((row) => ({ id: row.id as number, remoteId: row.remote_id as string }));
  }

  getAttachment(id: number): StoredAttachment | null {
    const row = this.sql(
      `SELECT a.name, a.content_type, a.size, a.remote_id, m.account_id,
         m.remote_id AS message_remote_id, c.content
       FROM attachments a JOIN messages m ON m.id = a.message_id
       LEFT JOIN attachment_contents c ON c.attachment_id = a.id WHERE a.id = ?`,
    ).get(id);
    if (!row) return null;
    return {
      name: row.name as string,
      contentType: row.content_type as string,
      size: row.size as number,
      accountId: row.account_id as number,
      remoteId: row.remote_id as string | null,
      messageRemoteId: row.message_remote_id as string | null,
      content: (row.content as Uint8Array | null) ?? null,
    };
  }

  listSettings(prefix: string): Record<string, string> {
    const rows = this.sql("SELECT key, value FROM settings WHERE key LIKE ? || '%'").all(prefix);
    return Object.fromEntries(rows.map((row) => [row.key as string, row.value as string]));
  }

  getSetting(key: string): string | null {
    const row = this.sql('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? (row.value as string) : null;
  }

  // Commands. Each returns the folders whose content changed.

  setRead(ids: number[], isRead: boolean, now = Date.now()): number[] {
    return this.change('read', ids, isRead, now);
  }

  setFlagged(ids: number[], isFlagged: boolean, now = Date.now()): number[] {
    return this.change('flag', ids, isFlagged, now);
  }

  // Changes messages here at once. For mail of a provider the change also waits in the queue
  // until it was sent there.
  private change(kind: FieldKind, ids: number[], value: boolean, now: number): number[] {
    const column = CHANGE_COLUMNS[kind];
    const update = this.sql(
      `UPDATE messages SET ${column} = ?1 WHERE id = ?2 AND ${column} <> ?1
       RETURNING folder_id, account_id, remote_id`,
    );
    return this.transaction(() => {
      const changes = new Map<number, number>();
      for (const id of ids) {
        const row = update.get(value ? 1 : 0, id);
        if (!row) continue;
        const folderId = row.folder_id as number;
        changes.set(folderId, (changes.get(folderId) ?? 0) + 1);
        if (row.remote_id !== null) {
          this.queue(row.account_id as number, kind, row.remote_id as string, value, !value, now);
        }
      }
      if (kind === 'read') {
        for (const [folderId, count] of changes)
          this.addCounts(folderId, 0, value ? -count : count);
      }
      return [...changes.keys()];
    });
  }

  // Moves messages to a folder of their own account.
  moveMessages(ids: number[], folderId: number, now = Date.now()): number[] {
    const target = this.sql('SELECT * FROM folders WHERE id = ?').get(folderId);
    return target ? this.move(ids, () => target, now) : [];
  }

  // Moves messages to the folder with this role in their account, like Deleted Items.
  moveToRole(ids: number[], role: FolderRole, now = Date.now()): number[] {
    const find = this.sql('SELECT * FROM folders WHERE account_id = ? AND role = ?');
    return this.move(ids, (accountId) => find.get(accountId, role), now);
  }

  private move(ids: number[], target: (accountId: number) => Row | undefined, now: number) {
    return this.transaction(() => this.moveRows(ids, target, now));
  }

  private moveRows(
    ids: number[],
    target: (accountId: number) => Row | undefined,
    now: number,
  ): number[] {
    const find = this.sql(
      `SELECT m.account_id, m.folder_id, m.remote_id, m.is_read, f.remote_id AS folder_remote_id
       FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id = ?`,
    );
    // The round of its new folder, so a round that runs there does not take it for gone.
    const update = this.sql('UPDATE messages SET folder_id = ?, sync_round = ? WHERE id = ?');
    const changed = new Set<number>();
    for (const id of ids) {
      const message = find.get(id);
      if (!message) continue;
      const accountId = message.account_id as number;
      const from = message.folder_id as number;
      const to = target(accountId);
      if (!to || to.account_id !== accountId || to.id === from) continue;
      // Mail of a provider can only go to a folder the provider knows. A draft the provider does
      // not have yet moves here only, and follows there once it was made.
      const remoteId = message.remote_id as string | null;
      if (remoteId !== null && (to.remote_id === null || message.folder_remote_id === null)) {
        continue;
      }
      update.run(to.id as number, to.sync_round as number, id);
      const unread = message.is_read ? 0 : 1;
      this.addCounts(from, -1, -unread);
      this.addCounts(to.id as number, 1, unread);
      changed.add(from).add(to.id as number);
      if (remoteId !== null) {
        const before = message.folder_remote_id as string;
        this.queue(accountId, 'move', remoteId, to.remote_id as string, before, now);
      }
    }
    return [...changed];
  }

  private addCounts(folderId: number, total: number, unread: number): void {
    this.sql(
      `UPDATE folders SET total_count = max(total_count + ?, 0),
         unread_count = max(unread_count + ?, 0) WHERE id = ?`,
    ).run(total, unread, folderId);
  }

  // One waiting change per message and kind. A newer one takes the place of the one before and
  // keeps what the provider had before both. When it brings back just that, nothing is left to
  // send, unless the one before is on its way.
  private queue(
    accountId: number,
    kind: OperationKind,
    remoteId: string,
    value: OperationValue,
    before: OperationValue,
    now: number,
  ): void {
    const waiting = this.sql(
      'SELECT id, data FROM operations WHERE account_id = ? AND remote_id = ? AND kind = ?',
    ).get(accountId, remoteId, kind);
    if (!waiting) {
      this.sql(
        `INSERT INTO operations (account_id, kind, remote_id, data, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(accountId, kind, remoteId, JSON.stringify({ value, before }), now);
      return;
    }
    const id = waiting.id as number;
    const earlier = (JSON.parse(waiting.data as string) as { before: OperationValue }).before;
    if (earlier === value && !this.sending.has(id)) {
      this.sql('DELETE FROM operations WHERE id = ?').run(id);
      return;
    }
    this.sql('UPDATE operations SET data = ?, next_attempt_at = 0 WHERE id = ?').run(
      JSON.stringify({ value, before: earlier }),
      id,
    );
  }

  // The queue of changes for the provider.

  hasOperations(accountId: number): boolean {
    return (
      this.sql('SELECT 1 FROM operations WHERE account_id = ? LIMIT 1').get(accountId) !== undefined
    );
  }

  // The changes that are due, oldest first.
  listDueOperations(accountId: number, now: number, limit: number): Operation[] {
    return this.sql(
      `SELECT * FROM operations WHERE account_id = ? AND next_attempt_at <= ?
       ORDER BY id LIMIT ?`,
    )
      .all(accountId, now, limit)
      .map(toOperation);
  }

  // When the next waiting change is due, or null when none waits.
  nextOperationAt(accountId: number): number | null {
    const row = this.sql(
      'SELECT min(next_attempt_at) AS next FROM operations WHERE account_id = ?',
    ).get(accountId);
    return (row?.next as number | null) ?? null;
  }

  // While a change is on its way, a newer one must not cancel it here.
  markSending(operations: Operation[], sending: boolean): void {
    for (const operation of operations) {
      if (sending) this.sending.add(operation.id);
      else this.sending.delete(operation.id);
    }
  }

  // The provider took the change. A newer one that came in meanwhile stays, and what the
  // provider has before it is now the value that was sent.
  finishOperation(operation: Operation): void {
    const current = this.sql('SELECT data FROM operations WHERE id = ?').get(operation.id);
    if (!current) return;
    if (current.data === operation.data) {
      this.sql('DELETE FROM operations WHERE id = ?').run(operation.id);
      return;
    }
    const { value } = JSON.parse(current.data as string) as { value: OperationValue };
    this.sql('UPDATE operations SET data = ? WHERE id = ?').run(
      JSON.stringify({ value, before: operation.value }),
      operation.id,
    );
  }

  delayOperation(operation: Operation, until: number): void {
    this.sql('UPDATE operations SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?').run(
      until,
      operation.id,
    );
  }

  // For a change that cannot be sent, like one of a kind this version does not know.
  dropOperation(operation: Operation): void {
    this.sql('DELETE FROM operations WHERE id = ?').run(operation.id);
  }

  // The provider refused the change: the message gets back what the provider has. Returns the
  // folders whose content changed.
  undoOperation(operation: Operation): number[] {
    return this.transaction(() => {
      this.dropOperation(operation);
      const { accountId, remoteId, kind, before } = operation;
      if (remoteId === null) return [];
      if (kind === 'move') {
        return typeof before === 'string' ? this.moveBack(accountId, remoteId, before) : [];
      }
      if (kind !== 'read' && kind !== 'flag') return [];
      const column = CHANGE_COLUMNS[kind];
      const row = this.sql(
        `UPDATE messages SET ${column} = ?1 WHERE account_id = ?2 AND remote_id = ?3
           AND ${column} <> ?1 RETURNING folder_id`,
      ).get(before === true ? 1 : 0, accountId, remoteId);
      if (!row) return [];
      const folderId = row.folder_id as number;
      if (kind === 'read') this.addCounts(folderId, 0, before === true ? -1 : 1);
      return [folderId];
    });
  }

  private moveBack(accountId: number, remoteId: string, folderRemoteId: string): number[] {
    const back = this.sql('SELECT * FROM folders WHERE account_id = ? AND remote_id = ?').get(
      accountId,
      folderRemoteId,
    );
    const message = this.sql(
      'SELECT id, folder_id, is_read FROM messages WHERE account_id = ? AND remote_id = ?',
    ).get(accountId, remoteId);
    if (!back || !message || message.folder_id === back.id) return [];
    this.sql('UPDATE messages SET folder_id = ?, sync_round = ? WHERE id = ?').run(
      back.id as number,
      back.sync_round as number,
      message.id as number,
    );
    const unread = message.is_read ? 0 : 1;
    this.addCounts(message.folder_id as number, -1, -unread);
    this.addCounts(back.id as number, 1, unread);
    return [message.folder_id as number, back.id as number];
  }

  // The provider gave a message a new ID, which only happens when it leaves the mailbox.
  replaceRemoteId(accountId: number, from: string, to: string): void {
    this.transaction(() => {
      for (const table of ['messages', 'operations']) {
        this.sql(`UPDATE ${table} SET remote_id = ? WHERE account_id = ? AND remote_id = ?`).run(
          to,
          accountId,
          from,
        );
      }
    });
  }

  // Reads a folder from the start again, when it is not certain what the provider has there.
  restartFolderSync(accountId: number, folderRemoteId: string): void {
    this.sql(
      'UPDATE folders SET sync_link = NULL, sync_pending = 1 WHERE account_id = ? AND remote_id = ?',
    ).run(accountId, folderRemoteId);
  }

  // The changes that wait for the provider, by message.
  private waitingChanges(accountId: number): Map<string, WaitingChanges> {
    const changes = new Map<string, WaitingChanges>();
    const rows = this.sql(
      `SELECT remote_id, kind, data FROM operations
       WHERE account_id = ? AND remote_id IS NOT NULL AND kind IN ('read', 'flag', 'move')`,
    ).all(accountId);
    for (const row of rows) {
      const remoteId = row.remote_id as string;
      const data = JSON.parse(row.data as string) as WaitingChange;
      changes.set(remoteId, { ...changes.get(remoteId), [row.kind as OperationKind]: data });
    }
    return changes;
  }

  // How the counters of the provider differ from here while changes wait for it, by folder.
  private waitingCounts(accountId: number): Map<number, { total: number; unread: number }> {
    const counts = new Map<number, { total: number; unread: number }>();
    const add = (folderId: number, total: number, unread: number) => {
      const entry = counts.get(folderId) ?? { total: 0, unread: 0 };
      counts.set(folderId, { total: entry.total + total, unread: entry.unread + unread });
    };
    const find = this.sql(
      'SELECT folder_id, is_read FROM messages WHERE account_id = ? AND remote_id = ?',
    );
    const folder = this.sql('SELECT id FROM folders WHERE account_id = ? AND remote_id = ?');
    for (const [remoteId, waiting] of this.waitingChanges(accountId)) {
      if (!waiting.read && !waiting.move) continue;
      const here = find.get(accountId, remoteId);
      if (!here) continue;
      // Where the provider still has the message, and whether it counts it as unread there.
      const there = waiting.move
        ? (folder.get(accountId, String(waiting.move.before))?.id as number | undefined)
        : (here.folder_id as number);
      if (there === undefined) continue;
      const unreadThere = waiting.read ? waiting.read.before !== true : !here.is_read;
      add(here.folder_id as number, 1, here.is_read ? 0 : 1);
      add(there, -1, unreadThere ? -1 : 0);
    }
    // Drafts the provider has not made yet.
    const drafts = this.sql(
      `SELECT m.folder_id, m.is_read FROM messages m JOIN drafts d ON d.message_id = m.id
       WHERE m.account_id = ? AND m.remote_id IS NULL`,
    ).all(accountId);
    for (const row of drafts) add(row.folder_id as number, 1, row.is_read ? 0 : 1);
    return counts;
  }

  // Drafts

  // Starts a draft in the Drafts folder of an account. An answer or forward takes recipients,
  // subject and conversation from its message, and quotes it below the text. Null when there is
  // no such message or no Drafts folder.
  createDraft(
    request: { kind: 'new'; accountId: number } | { kind: ResponseKind; messageId: number },
    now = Date.now(),
  ): { id: number; folderIds: number[] } | null {
    let accountId: number;
    let source: Message | null = null;
    if (request.kind === 'new') {
      accountId = request.accountId;
    } else {
      source = this.getMessage(request.messageId);
      if (!source) return null;
      accountId = source.accountId;
    }
    const account = this.getAccount(accountId);
    const folder = this.sql(
      "SELECT id, sync_round FROM folders WHERE account_id = ? AND role = 'drafts'",
    ).get(accountId);
    if (!account || !folder) return null;

    let recipients: { to: Address[]; cc: Address[] } = { to: [], cc: [] };
    let subject = '';
    let quote = '';
    let sourceRemoteId: string | null = null;
    if (source && request.kind !== 'new') {
      recipients = responseRecipients(request.kind, source, account.email);
      subject = responseSubject(request.kind, source.subject);
      quote = buildQuote(source, source.body, source.preview);
      sourceRemoteId = this.getRemoteMessage(source.id)?.remoteId ?? null;
    }
    return this.transaction(() => {
      const id = this.insertMessage({
        accountId,
        folderId: folder.id as number,
        threadId: source?.threadId ?? null,
        subject,
        preview: draftPreview('', quote),
        from: { name: account.displayName, address: account.email },
        ...recipients,
        receivedAt: now,
        isRead: true,
        isFlagged: false,
        isFocused: true,
        hasAttachments: false,
        importance: 'normal',
      });
      // A round that reads the folder from the start meanwhile must not take it for gone.
      this.sql('UPDATE messages SET sync_round = ? WHERE id = ?').run(
        folder.sync_round as number,
        id,
      );
      this.sql(
        `INSERT INTO drafts (message_id, kind, source_id, source_remote_id, quote)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, request.kind, source?.id ?? null, sourceRemoteId, quote);
      this.writeDraftBody(id, '', quote);
      this.addCounts(folder.id as number, 1, 0);
      return { id, folderIds: this.threadFolders(id) };
    });
  }

  getDraft(id: number): Draft | null {
    const row = this.sql(
      `SELECT d.*, m.account_id, m.subject, m.from_name, m.from_address, m.to_recipients,
         m.cc_recipients FROM drafts d JOIN messages m ON m.id = d.message_id
       WHERE d.message_id = ?`,
    ).get(id);
    if (!row) return null;
    return {
      id,
      accountId: row.account_id as number,
      kind: row.kind as DraftKind,
      from: { name: row.from_name as string, address: row.from_address as string },
      to: JSON.parse(row.to_recipients as string) as Address[],
      cc: JSON.parse(row.cc_recipients as string) as Address[],
      bcc: JSON.parse(row.bcc_recipients as string) as Address[],
      subject: row.subject as string,
      text: row.text as string,
      quote: row.quote as string,
      sourceId: row.source_id as number | null,
    };
  }

  // Stores what the user wrote as a new version for the provider. Returns the folders whose
  // content changed: none when nothing did.
  saveDraft(id: number, content: DraftContent, now = Date.now()): number[] {
    return this.transaction(() => {
      const row = this.sql(
        `SELECT d.text, d.quote, d.bcc_recipients, m.subject, m.to_recipients, m.cc_recipients,
           m.folder_id, f.sync_round FROM drafts d JOIN messages m ON m.id = d.message_id
         JOIN folders f ON f.id = m.folder_id WHERE d.message_id = ?`,
      ).get(id);
      if (!row) return [];
      const people = (list: Address[]) =>
        JSON.stringify(list.map(({ name, address }) => ({ name, address })));
      const [to, cc, bcc] = [people(content.to), people(content.cc), people(content.bcc)];
      const same =
        row.text === content.text &&
        row.subject === content.subject &&
        row.to_recipients === to &&
        row.cc_recipients === cc &&
        row.bcc_recipients === bcc;
      if (same) return [];
      const quote = row.quote as string;
      this.sql(
        `UPDATE messages SET subject = ?, preview = ?, to_recipients = ?, cc_recipients = ?,
           received_at = ?, sync_round = ? WHERE id = ?`,
      ).run(
        content.subject,
        draftPreview(content.text, quote),
        to,
        cc,
        now,
        row.sync_round as number,
        id,
      );
      this.sql(
        `UPDATE drafts SET text = ?, bcc_recipients = ?, version = version + 1, attempts = 0,
           next_attempt_at = 0 WHERE message_id = ?`,
      ).run(content.text, bcc, id);
      this.writeDraftBody(id, content.text, quote);
      return [row.folder_id as number];
    });
  }

  // The editor of a draft closed. A draft nobody wrote in goes: the provider never had it.
  closeDraft(id: number): number[] {
    return this.transaction(() => {
      const folderIds = this.threadFolders(id);
      const row = this.sql(
        `DELETE FROM messages WHERE id = ?1 AND remote_id IS NULL
           AND EXISTS (SELECT 1 FROM drafts WHERE message_id = ?1 AND version = 0)
         RETURNING folder_id`,
      ).get(id);
      if (!row) return [];
      this.addCounts(row.folder_id as number, -1, 0);
      return folderIds;
    });
  }

  // The folders with messages of the conversation of a message, which show whether it has a
  // draft. The folder of the message itself is always among them.
  private threadFolders(id: number): number[] {
    return this.sql(
      `SELECT DISTINCT folder_id FROM messages WHERE id = ?1
         OR thread_id = (SELECT thread_id FROM messages WHERE id = ?1)`,
    )
      .all(id)
      .map((row) => row.folder_id as number);
  }

  // Throws a draft away. One the provider has goes to Deleted Items like any message and can be
  // found there. One the provider never had is removed.
  discardDraft(id: number, now = Date.now()): number[] {
    return this.transaction(() => {
      const row = this.sql(
        `SELECT m.remote_id, m.folder_id, m.is_read FROM messages m
         JOIN drafts d ON d.message_id = m.id WHERE m.id = ?`,
      ).get(id);
      if (!row) return [];
      const folderId = row.folder_id as number;
      const folderIds = this.threadFolders(id);
      if (row.remote_id === null) {
        this.sql('DELETE FROM messages WHERE id = ?').run(id);
        this.addCounts(folderId, -1, row.is_read ? 0 : -1);
        return folderIds;
      }
      this.sql('DELETE FROM drafts WHERE message_id = ?').run(id);
      const deleted = this.sql("SELECT * FROM folders WHERE account_id = ? AND role = 'deleted'");
      const moved = this.moveRows([id], (accountId) => deleted.get(accountId), now);
      return [...new Set([...folderIds, ...moved])];
    });
  }

  // Drafts that were started but never written in, left behind when the app closed.
  removeUntouchedDrafts(): number[] {
    return this.transaction(() => {
      const rows = this.sql(
        `DELETE FROM messages WHERE remote_id IS NULL
           AND id IN (SELECT message_id FROM drafts WHERE version = 0)
         RETURNING folder_id`,
      ).all();
      for (const row of rows) this.addCounts(row.folder_id as number, -1, 0);
      return [...new Set(rows.map((row) => row.folder_id as number))];
    });
  }

  private writeDraftBody(messageId: number, text: string, quote: string): void {
    const body: MessageBody = { contentType: 'html', content: draftHtml(text, quote) };
    this.sql(
      `INSERT INTO message_bodies (message_id, content_type, content) VALUES (?, ?, ?)
       ON CONFLICT (message_id) DO UPDATE SET content_type = excluded.content_type,
         content = excluded.content`,
    ).run(messageId, body.contentType, body.content);
    this.indexBody(messageId, body);
  }

  // The drafts of an account that the provider does not have as they are here, whose turn it is.
  listDueDrafts(accountId: number, now: number, limit: number): DraftToSend[] {
    return this.sql(
      `SELECT d.message_id FROM drafts d JOIN messages m ON m.id = d.message_id
       WHERE m.account_id = ? AND d.version > d.saved_version AND d.next_attempt_at <= ?
       ORDER BY d.next_attempt_at, d.message_id LIMIT ?`,
    )
      .all(accountId, now, limit)
      .flatMap((row) => this.getDraftToSend(row.message_id as number) ?? []);
  }

  getDraftToSend(id: number): DraftToSend | null {
    const row = this.sql(
      `SELECT d.*, m.account_id, m.remote_id, m.subject, m.to_recipients, m.cc_recipients
       FROM drafts d JOIN messages m ON m.id = d.message_id WHERE d.message_id = ?`,
    ).get(id);
    if (!row) return null;
    return {
      messageId: id,
      accountId: row.account_id as number,
      remoteId: row.remote_id as string | null,
      kind: row.kind as DraftKind,
      sourceRemoteId: row.source_remote_id as string | null,
      version: row.version as number,
      attempts: row.attempts as number,
      subject: row.subject as string,
      to: JSON.parse(row.to_recipients as string) as Address[],
      cc: JSON.parse(row.cc_recipients as string) as Address[],
      bcc: JSON.parse(row.bcc_recipients as string) as Address[],
      html: draftHtml(row.text as string, row.quote as string),
    };
  }

  hasDraftsToSend(accountId: number): boolean {
    return this.nextDraftAt(accountId) !== null;
  }

  // When the next draft is due for the provider, or null when the provider has all of them.
  nextDraftAt(accountId: number): number | null {
    const row = this.sql(
      `SELECT min(d.next_attempt_at) AS next FROM drafts d JOIN messages m ON m.id = d.message_id
       WHERE m.account_id = ? AND d.version > d.saved_version`,
    ).get(accountId);
    return (row?.next as number | null) ?? null;
  }

  // The provider made the draft, in its Drafts folder. If it is in another folder here, it is
  // moved there too. False when the draft was thrown away meanwhile: then the one the provider
  // just made goes to Deleted Items.
  draftCreated(accountId: number, messageId: number, remoteId: string, now = Date.now()): boolean {
    return this.transaction(() => {
      const drafts = this.sql(
        "SELECT id, remote_id FROM folders WHERE account_id = ? AND role = 'drafts'",
      ).get(accountId);
      // The sync may have brought the new draft in before its ID was known here.
      const twin = this.sql(
        'DELETE FROM messages WHERE account_id = ? AND remote_id = ? AND id <> ? RETURNING folder_id',
      ).get(accountId, remoteId, messageId);
      if (twin) this.addCounts(twin.folder_id as number, -1, 0);
      const row = this.sql(
        `UPDATE messages SET remote_id = ? WHERE id = ?
         RETURNING folder_id, (SELECT remote_id FROM folders WHERE id = folder_id) AS folder_remote_id`,
      ).get(remoteId, messageId);
      const draftsRemoteId = drafts?.remote_id as string | null | undefined;
      if (!draftsRemoteId) return row !== undefined;
      if (!row) {
        const deleted = this.sql(
          "SELECT remote_id FROM folders WHERE account_id = ? AND role = 'deleted'",
        ).get(accountId);
        const target = deleted?.remote_id as string | null | undefined;
        if (target) this.queue(accountId, 'move', remoteId, target, draftsRemoteId, now);
        return false;
      }
      const here = row.folder_remote_id as string | null;
      if (row.folder_id !== drafts!.id && here) {
        this.queue(accountId, 'move', remoteId, here, draftsRemoteId, now);
      }
      return true;
    });
  }

  // The provider has this version now. A newer one saved meanwhile still waits.
  draftSaved(messageId: number, version: number): void {
    this.sql(
      `UPDATE drafts SET saved_version = max(saved_version, ?), attempts = 0, next_attempt_at = 0
       WHERE message_id = ?`,
    ).run(version, messageId);
  }

  delayDraft(messageId: number, until: number): void {
    this.sql(
      'UPDATE drafts SET attempts = attempts + 1, next_attempt_at = ? WHERE message_id = ?',
    ).run(until, messageId);
  }

  // The provider has the draft no more: it was sent or deleted elsewhere while the user wrote
  // here. It is made again, so the text is not lost.
  draftGone(messageId: number): void {
    this.sql('UPDATE messages SET remote_id = NULL WHERE id = ?').run(messageId);
  }

  // The message a draft answers is gone at the provider. The draft is made as a message of its own.
  forgetDraftSource(messageId: number): void {
    this.sql('UPDATE drafts SET source_remote_id = NULL WHERE message_id = ?').run(messageId);
  }

  // Drafts with a version the provider does not have yet, by their ID there.
  private unsavedDrafts(accountId: number): Set<string> {
    const rows = this.sql(
      `SELECT m.remote_id FROM drafts d JOIN messages m ON m.id = d.message_id
       WHERE m.account_id = ? AND m.remote_id IS NOT NULL AND d.version > d.saved_version`,
    ).all(accountId);
    return new Set(rows.map((row) => row.remote_id as string));
  }

  setSetting(key: string, value: string): void {
    this.sql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  }

  // Puts the words of a stored text into the search index, in place of what was there. The
  // index takes a second row with the same ID without complaint, so the old one goes first.
  indexBody(messageId: number, body: MessageBody): void {
    this.sql('DELETE FROM message_text_fts WHERE rowid = ?').run(messageId);
    this.sql('INSERT INTO message_text_fts (rowid, text) VALUES (?, ?)').run(
      messageId,
      bodyText(body),
    );
  }

  clearTextIndex(): void {
    this.sql("INSERT INTO message_text_fts (message_text_fts) VALUES ('delete-all')").run();
  }

  // Writes used by providers when they bring in data.

  insertAccount(provider: string, email: string, displayName: string, sortOrder: number): number {
    const result = this.sql(
      'INSERT INTO accounts (provider, email, display_name, sort_order) VALUES (?, ?, ?, ?)',
    ).run(provider, email, displayName, sortOrder);
    return Number(result.lastInsertRowid);
  }

  // Returns the existing account when this one was added before.
  addAccount(provider: string, remoteId: string, email: string, displayName: string): number {
    const existing = this.sql('SELECT id FROM accounts WHERE provider = ? AND remote_id = ?').get(
      provider,
      remoteId,
    );
    if (existing) return existing.id as number;

    const order = this.sql('SELECT coalesce(max(sort_order), -1) + 1 AS next FROM accounts').get();
    const result = this.sql(
      `INSERT INTO accounts (provider, remote_id, email, display_name, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(provider, remoteId, email, displayName, order!.next as number);
    return Number(result.lastInsertRowid);
  }

  // Deletes the account with its folders and messages. Returns what it was.
  removeAccount(id: number): { provider: string; remoteId: string | null } | null {
    const row = this.sql('DELETE FROM accounts WHERE id = ? RETURNING provider, remote_id').get(id);
    return row
      ? { provider: row.provider as string, remoteId: row.remote_id as string | null }
      : null;
  }

  deleteAllAccounts(): void {
    this.db.exec('DELETE FROM accounts');
  }

  insertFolder(folder: NewFolder): number {
    const result = this.sql(
      `INSERT INTO folders (account_id, parent_id, name, role, sort_order, is_favorite)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      folder.accountId,
      folder.parentId,
      folder.name,
      folder.role,
      folder.sortOrder,
      folder.isFavorite ? 1 : 0,
    );
    return Number(result.lastInsertRowid);
  }

  insertThread(accountId: number): number {
    const result = this.sql('INSERT INTO threads (account_id) VALUES (?)').run(accountId);
    return Number(result.lastInsertRowid);
  }

  // Does not touch the folder counters. Call addToFolderCounts or recountFolders afterwards.
  insertMessage(message: NewMessage): number {
    const result = this.sql(
      `INSERT INTO messages (account_id, folder_id, thread_id, subject, preview, from_name,
         from_address, to_recipients, cc_recipients, received_at, is_read, is_flagged, is_focused,
         has_attachments, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      message.accountId,
      message.folderId,
      message.threadId,
      message.subject,
      message.preview,
      message.from.name,
      message.from.address,
      JSON.stringify(message.to),
      JSON.stringify(message.cc),
      message.receivedAt,
      message.isRead ? 1 : 0,
      message.isFlagged ? 1 : 0,
      message.isFocused ? 1 : 0,
      message.hasAttachments ? 1 : 0,
      IMPORTANCE.indexOf(message.importance),
    );
    return Number(result.lastInsertRowid);
  }

  addToFolderCounts(folderId: number, total: number, unread: number): void {
    this.sql(
      'UPDATE folders SET total_count = total_count + ?, unread_count = unread_count + ? WHERE id = ?',
    ).run(total, unread, folderId);
  }

  recountFolders(folderIds: number[]): void {
    const recount = this.sql(
      `UPDATE folders SET
         total_count = (SELECT count(*) FROM messages WHERE folder_id = ?1),
         unread_count = (SELECT count(*) FROM messages WHERE folder_id = ?1 AND is_read = 0)
       WHERE id = ?1`,
    );
    for (const folderId of folderIds) recount.run(folderId);
  }

  // Writes used by the sync with a mail provider.

  listRemoteAccounts(provider: string): { id: number; remoteId: string; email: string }[] {
    return this.sql(
      `SELECT id, remote_id, email FROM accounts
       WHERE provider = ? AND remote_id IS NOT NULL ORDER BY id`,
    )
      .all(provider)
      .map((row) => ({
        id: row.id as number,
        remoteId: row.remote_id as string,
        email: row.email as string,
      }));
  }

  listSyncFolders(accountId: number): SyncFolder[] {
    return this.sql(
      `SELECT id, remote_id, role, sync_link, sync_pending, sync_round FROM folders
       WHERE account_id = ? AND remote_id IS NOT NULL ORDER BY sort_order, id`,
    )
      .all(accountId)
      .map((row) => ({
        id: row.id as number,
        remoteId: row.remote_id as string,
        role: row.role as FolderRole | null,
        syncLink: row.sync_link as string | null,
        syncPending: row.sync_pending as number,
        syncRound: row.sync_round as number,
      }));
  }

  // Makes the local folders of an account match the list. Returns whether anything changed.
  saveRemoteFolders(accountId: number, folders: RemoteFolder[]): boolean {
    return this.transaction(() => {
      const known = new Map<string, Row>();
      const rows = this.sql(
        'SELECT * FROM folders WHERE account_id = ? AND remote_id IS NOT NULL',
      ).all(accountId);
      for (const row of rows) known.set(row.remote_id as string, row);
      let changed = false;
      const waiting = this.waitingCounts(accountId);

      // New folders first, so every parent exists before a folder points to it.
      const ids = new Map<string, number>();
      for (const folder of folders) {
        const row = known.get(folder.remoteId);
        if (row) {
          ids.set(folder.remoteId, row.id as number);
          continue;
        }
        const result = this.sql(
          'INSERT INTO folders (account_id, remote_id, name, is_favorite) VALUES (?, ?, ?, ?)',
        ).run(accountId, folder.remoteId, folder.name, folder.role === 'inbox' ? 1 : 0);
        ids.set(folder.remoteId, Number(result.lastInsertRowid));
        changed = true;
      }

      const update = this.sql(
        `UPDATE folders SET parent_id = ?, name = ?, role = ?, sort_order = ?, total_count = ?,
           unread_count = ? WHERE id = ?`,
      );
      for (const folder of folders) {
        const parentId = folder.parentRemoteId ? (ids.get(folder.parentRemoteId) ?? null) : null;
        const id = ids.get(folder.remoteId)!;
        // The counters of the provider do not know yet what waits to be sent there.
        const total = Math.max(folder.totalCount + (waiting.get(id)?.total ?? 0), 0);
        const unread = Math.max(folder.unreadCount + (waiting.get(id)?.unread ?? 0), 0);
        const row = known.get(folder.remoteId);
        const same =
          row &&
          row.parent_id === parentId &&
          row.name === folder.name &&
          row.role === folder.role &&
          row.sort_order === folder.sortOrder &&
          row.total_count === total &&
          row.unread_count === unread;
        if (same) continue;
        update.run(parentId, folder.name, folder.role, folder.sortOrder, total, unread, id);
        changed = true;
      }

      for (const [remoteId, row] of known) {
        if (ids.has(remoteId)) continue;
        this.sql('DELETE FROM folders WHERE id = ?').run(row.id as number);
        changed = true;
      }
      return changed;
    });
  }

  setFolderSync(folderId: number, link: string | null, pending: number): void {
    this.sql('UPDATE folders SET sync_link = ?, sync_pending = ? WHERE id = ?').run(
      link,
      pending,
      folderId,
    );
  }

  // Starts a round that reads the folder from the start. Returns the number of the round.
  startFolderRound(folderId: number): number {
    const row = this.sql(
      `UPDATE folders SET sync_round = sync_round + 1, sync_link = NULL, sync_pending = 1
       WHERE id = ? RETURNING sync_round`,
    ).get(folderId);
    return row!.sync_round as number;
  }

  // Removes what a round from the start did not meet: it is no longer in the folder.
  // A message moved here whose move the provider does not have yet is not gone, and neither is
  // a draft whose latest version, or the draft itself, the provider does not have yet.
  finishFolderRound(folderId: number, round: number): number {
    const result = this.sql(
      `DELETE FROM messages WHERE folder_id = ? AND sync_round < ? AND remote_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.account_id = messages.account_id
           AND o.remote_id = messages.remote_id AND o.kind = 'move')
         AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.message_id = messages.id
           AND d.version > d.saved_version)`,
    ).run(folderId, round);
    return Number(result.changes);
  }

  // Stores one page of a folder's headers. Returns the folders whose content changed.
  saveRemoteMessages(
    accountId: number,
    folderId: number,
    round: number,
    messages: RemoteMessage[],
    removedIds: string[],
  ): number[] {
    const find = this.sql(
      'SELECT id, folder_id, preview FROM messages WHERE account_id = ? AND remote_id = ?',
    );
    const dropBody = this.sql('DELETE FROM message_bodies WHERE message_id = ?');
    const thread = this.sql(
      `INSERT INTO threads (account_id, remote_id) VALUES (?, ?)
       ON CONFLICT (account_id, remote_id) WHERE remote_id IS NOT NULL
       DO UPDATE SET remote_id = excluded.remote_id RETURNING id`,
    );
    const insert = this.sql(
      `INSERT INTO messages (account_id, folder_id, thread_id, remote_id, subject, preview,
         from_name, from_address, to_recipients, cc_recipients, received_at, is_read, is_flagged,
         is_focused, has_attachments, importance, sync_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // A field the provider left out arrives as NULL and keeps its stored value.
    const update = this.sql(
      `UPDATE messages SET folder_id = ?, sync_round = ?,
         thread_id = coalesce(?, thread_id), subject = coalesce(?, subject),
         preview = coalesce(?, preview), from_name = coalesce(?, from_name),
         from_address = coalesce(?, from_address), to_recipients = coalesce(?, to_recipients),
         cc_recipients = coalesce(?, cc_recipients), received_at = coalesce(?, received_at),
         is_read = coalesce(?, is_read), is_flagged = coalesce(?, is_flagged),
         is_focused = coalesce(?, is_focused), has_attachments = coalesce(?, has_attachments),
         importance = coalesce(?, importance)
       WHERE id = ?`,
    );
    // A message that moved may already be stored in its new folder. Then it must stay.
    const remove = this.sql(
      'DELETE FROM messages WHERE account_id = ? AND remote_id = ? AND folder_id = ? RETURNING id',
    );
    const flag = (value: boolean | undefined) => (value === undefined ? null : value ? 1 : 0);
    const json = (value: Address[] | undefined) => (value ? JSON.stringify(value) : null);

    return this.transaction(() => {
      const changed = new Set<number>();
      const waiting = this.waitingChanges(accountId);
      const unsaved = this.unsavedDrafts(accountId);
      for (const { remoteId, fields: reported } of messages) {
        // What the provider reports before it has the changes made here must not undo them. A
        // message on its way to another folder is left alone, and so is a draft the user wrote
        // more in since the last version the provider has.
        const own = waiting.get(remoteId);
        if (own?.move || unsaved.has(remoteId)) continue;
        const read = own?.read?.value;
        const flagged = own?.flag?.value;
        const fields = {
          ...reported,
          isRead: typeof read === 'boolean' ? read : reported.isRead,
          isFlagged: typeof flagged === 'boolean' ? flagged : reported.isFlagged,
        };
        const threadId = fields.conversationId
          ? (thread.get(accountId, fields.conversationId)!.id as number)
          : null;
        const importance = fields.importance ? IMPORTANCE.indexOf(fields.importance) : null;
        const existing = find.get(accountId, remoteId);
        if (existing) {
          // A new preview means the text changed, as with a draft. It is fetched again.
          if (fields.preview !== undefined && fields.preview !== existing.preview) {
            dropBody.run(existing.id as number);
          }
          update.run(
            folderId,
            round,
            threadId,
            fields.subject ?? null,
            fields.preview ?? null,
            fields.from?.name ?? null,
            fields.from?.address ?? null,
            json(fields.to),
            json(fields.cc),
            fields.receivedAt ?? null,
            flag(fields.isRead),
            flag(fields.isFlagged),
            flag(fields.isFocused),
            flag(fields.hasAttachments),
            importance,
            existing.id as number,
          );
          changed.add(existing.folder_id as number);
        } else {
          insert.run(
            accountId,
            folderId,
            threadId,
            remoteId,
            fields.subject ?? '',
            fields.preview ?? '',
            fields.from?.name ?? '',
            fields.from?.address ?? '',
            json(fields.to) ?? '[]',
            json(fields.cc) ?? '[]',
            fields.receivedAt ?? 0,
            flag(fields.isRead) ?? 1,
            flag(fields.isFlagged) ?? 0,
            flag(fields.isFocused) ?? 1,
            flag(fields.hasAttachments) ?? 0,
            importance ?? 1,
            round,
          );
        }
        changed.add(folderId);
      }
      for (const remoteId of removedIds) {
        // A draft gone there while the user writes here is made again with the next save.
        if (unsaved.has(remoteId)) continue;
        if (remove.get(accountId, remoteId, folderId)) changed.add(folderId);
      }
      return [...changed];
    });
  }

  saveBody(messageId: number, body: MessageBody, attachments: NewAttachment[]): void {
    this.transaction(() => {
      this.sql(
        `INSERT INTO message_bodies (message_id, content_type, content) VALUES (?, ?, ?)
         ON CONFLICT (message_id) DO UPDATE SET content_type = excluded.content_type,
           content = excluded.content`,
      ).run(messageId, body.contentType, body.content);
      this.indexBody(messageId, body);
      this.sql('DELETE FROM attachments WHERE message_id = ?').run(messageId);
      const insert = this.sql(
        `INSERT INTO attachments (message_id, remote_id, name, content_type, size, is_inline,
           content_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const keep = this.sql(
        'INSERT INTO attachment_contents (attachment_id, content) VALUES (?, ?)',
      );
      for (const attachment of attachments) {
        const result = insert.run(
          messageId,
          attachment.remoteId ?? null,
          attachment.name,
          attachment.contentType,
          attachment.size,
          attachment.isInline ? 1 : 0,
          attachment.contentId ?? null,
        );
        if (attachment.content) keep.run(Number(result.lastInsertRowid), attachment.content);
      }
    });
  }
}
