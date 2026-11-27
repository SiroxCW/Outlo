import type { StatementSync } from 'node:sqlite';
import type {
  Account,
  Address,
  Attachment,
  Folder,
  FolderRole,
  Importance,
  Message,
  MessageBody,
  MessageFilter,
  MessagePage,
  MessageSummary,
} from '@shared/api';
import { transaction, type Database } from '../db/database';
import { toFtsQuery } from './fts-query';

type Row = Record<string, unknown>;

const IMPORTANCE: Importance[] = ['low', 'normal', 'high'];

const SUMMARY_COLUMNS = `
  m.id, m.account_id, m.folder_id, m.thread_id, m.subject, m.preview, m.from_name,
  m.from_address, m.to_recipients, m.received_at, m.is_read, m.is_flagged, m.is_focused,
  m.has_attachments, m.importance`;

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

export interface NewAttachment {
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
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
  };
}

function toAttachment(row: Row): Attachment {
  return {
    id: row.id as number,
    name: row.name as string,
    contentType: row.content_type as string,
    size: row.size as number,
    isInline: row.is_inline === 1,
  };
}

// All reads and writes of mail data go through this class. Statements are prepared once.
export class MailStore {
  private readonly statements = new Map<string, StatementSync>();

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
  ): MessagePage {
    const focus = filter === 'all' ? '' : `AND m.is_focused = ${filter === 'focused' ? 1 : 0}`;
    const count = this.sql(
      `SELECT count(*) AS total FROM messages m WHERE m.folder_id = ? ${focus}`,
    ).get(folderId) as { total: number };
    const rows = this.sql(
      `SELECT ${SUMMARY_COLUMNS} FROM messages m WHERE m.folder_id = ? ${focus}
       ORDER BY m.received_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    ).all(folderId, limit, offset);
    return { total: count.total, offset, messages: rows.map(toSummary) };
  }

  countByTime(folderId: number, filter: MessageFilter, boundaries: number[]): number[] {
    const focus = filter === 'all' ? '' : `AND is_focused = ${filter === 'focused' ? 1 : 0}`;
    // One pass over the folder index. Each column counts the messages newer than one boundary.
    const columns = boundaries.map(
      (_, index) => `count(*) FILTER (WHERE received_at >= ?) AS c${index}`,
    );
    const row = this.sql(
      `SELECT count(*) AS total, ${['0 AS none', ...columns].join(', ')}
       FROM messages WHERE folder_id = ? ${focus}`,
    ).get(...boundaries, folderId) as Record<string, number>;

    const newerThan = boundaries.map((_, index) => row[`c${index}`] ?? 0);
    return [...newerThan, row.total ?? 0].map(
      (count, index) => count - (newerThan[index - 1] ?? 0),
    );
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
    const attachments = this.sql('SELECT * FROM attachments WHERE message_id = ? ORDER BY id')
      .all(id)
      .map(toAttachment);
    return {
      ...toSummary(row),
      cc: JSON.parse(row.cc_recipients as string) as Address[],
      body,
      attachments,
    };
  }

  search(query: string, limit: number): MessageSummary[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    return this.sql(
      `SELECT ${SUMMARY_COLUMNS} FROM messages_fts f JOIN messages m ON m.id = f.rowid
       WHERE messages_fts MATCH ? ORDER BY m.received_at DESC, m.id DESC LIMIT ?`,
    )
      .all(match, limit)
      .map(toSummary);
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

  setRead(ids: number[], isRead: boolean): number[] {
    const update = this.sql(
      'UPDATE messages SET is_read = ?1 WHERE id = ?2 AND is_read <> ?1 RETURNING folder_id',
    );
    const adjust = this.sql('UPDATE folders SET unread_count = unread_count + ? WHERE id = ?');

    return this.transaction(() => {
      const changes = new Map<number, number>();
      for (const id of ids) {
        const row = update.get(isRead ? 1 : 0, id);
        if (!row) continue;
        const folderId = row.folder_id as number;
        changes.set(folderId, (changes.get(folderId) ?? 0) + (isRead ? -1 : 1));
      }
      for (const [folderId, delta] of changes) adjust.run(delta, folderId);
      return [...changes.keys()];
    });
  }

  setFlagged(ids: number[], isFlagged: boolean): number[] {
    const update = this.sql(
      'UPDATE messages SET is_flagged = ?1 WHERE id = ?2 AND is_flagged <> ?1 RETURNING folder_id',
    );
    return this.transaction(() => {
      const folderIds = new Set<number>();
      for (const id of ids) {
        const row = update.get(isFlagged ? 1 : 0, id);
        if (row) folderIds.add(row.folder_id as number);
      }
      return [...folderIds];
    });
  }

  setSetting(key: string, value: string): void {
    this.sql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
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

  // Deletes the account with its folders and messages. Returns its ID at the provider.
  removeAccount(id: number): string | null {
    const row = this.sql('DELETE FROM accounts WHERE id = ? RETURNING remote_id').get(id);
    return row ? (row.remote_id as string | null) : null;
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

  saveBody(messageId: number, body: MessageBody, attachments: NewAttachment[]): void {
    this.transaction(() => {
      this.sql(
        `INSERT INTO message_bodies (message_id, content_type, content) VALUES (?, ?, ?)
         ON CONFLICT (message_id) DO UPDATE SET content_type = excluded.content_type,
           content = excluded.content`,
      ).run(messageId, body.contentType, body.content);
      this.sql('DELETE FROM attachments WHERE message_id = ?').run(messageId);
      const insert = this.sql(
        'INSERT INTO attachments (message_id, name, content_type, size, is_inline) VALUES (?, ?, ?, ?, ?)',
      );
      for (const attachment of attachments) {
        insert.run(
          messageId,
          attachment.name,
          attachment.contentType,
          attachment.size,
          attachment.isInline ? 1 : 0,
        );
      }
    });
  }
}
