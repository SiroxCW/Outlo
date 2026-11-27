// Every entry is one schema version. Never change an entry that was released: add a new one.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    remote_id TEXT,
    name TEXT NOT NULL,
    role TEXT CHECK (role IN ('inbox', 'drafts', 'sent', 'deleted', 'junk', 'archive', 'outbox')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    total_count INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX folders_by_account ON folders(account_id, sort_order);
  CREATE UNIQUE INDEX folders_by_remote_id ON folders(account_id, remote_id)
    WHERE remote_id IS NOT NULL;

  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id TEXT
  ) STRICT;

  -- One row per message per folder. Recipients are JSON arrays of {name, address}.
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    remote_id TEXT,
    subject TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_address TEXT NOT NULL DEFAULT '',
    to_recipients TEXT NOT NULL DEFAULT '[]',
    cc_recipients TEXT NOT NULL DEFAULT '[]',
    received_at INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    is_flagged INTEGER NOT NULL DEFAULT 0 CHECK (is_flagged IN (0, 1)),
    is_focused INTEGER NOT NULL DEFAULT 1 CHECK (is_focused IN (0, 1)),
    has_attachments INTEGER NOT NULL DEFAULT 0 CHECK (has_attachments IN (0, 1)),
    importance INTEGER NOT NULL DEFAULT 1 CHECK (importance IN (0, 1, 2))
  ) STRICT;
  CREATE INDEX messages_by_folder ON messages(folder_id, received_at DESC, id DESC);
  CREATE INDEX messages_by_folder_focus
    ON messages(folder_id, is_focused, received_at DESC, id DESC);
  CREATE INDEX messages_by_thread ON messages(thread_id);
  CREATE UNIQUE INDEX messages_by_remote_id ON messages(folder_id, remote_id)
    WHERE remote_id IS NOT NULL;

  CREATE TABLE message_bodies (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('html', 'text')),
    content TEXT NOT NULL
  ) STRICT;

  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    remote_id TEXT,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    is_inline INTEGER NOT NULL DEFAULT 0 CHECK (is_inline IN (0, 1))
  ) STRICT;
  CREATE INDEX attachments_by_message ON attachments(message_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  -- Search index over the message headers. It only stores the index, the text stays in messages.
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject, from_name, from_address, preview,
    content = 'messages', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, from_name, from_address, preview)
    VALUES (new.id, new.subject, new.from_name, new.from_address, new.preview);
  END;
  CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_name, from_address, preview)
    VALUES ('delete', old.id, old.subject, old.from_name, old.from_address, old.preview);
  END;
  CREATE TRIGGER messages_fts_update
  AFTER UPDATE OF subject, from_name, from_address, preview ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_name, from_address, preview)
    VALUES ('delete', old.id, old.subject, old.from_name, old.from_address, old.preview);
    INSERT INTO messages_fts(rowid, subject, from_name, from_address, preview)
    VALUES (new.id, new.subject, new.from_name, new.from_address, new.preview);
  END;
  `,
];
