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

  // The ID of an account at its provider, so a second sign-in finds the account again.
  `
  ALTER TABLE accounts ADD COLUMN remote_id TEXT;
  CREATE UNIQUE INDEX accounts_by_remote_id ON accounts(provider, remote_id)
    WHERE remote_id IS NOT NULL;
  `,

  // Header sync. sync_link is the address where the sync of a folder continues. sync_pending
  // says whether pages are waiting there: 0 none, 1 a round from the start, 2 a round of changes.
  // A message carries the round of its folder in which it was last seen, so a round from the
  // start can remove what it did not meet. A message ID is unique per account, not per folder:
  // it stays the same when the message moves.
  `
  ALTER TABLE folders ADD COLUMN sync_link TEXT;
  ALTER TABLE folders ADD COLUMN sync_pending INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE folders ADD COLUMN sync_round INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN sync_round INTEGER NOT NULL DEFAULT 0;
  DROP INDEX messages_by_remote_id;
  CREATE UNIQUE INDEX messages_by_remote_id ON messages(account_id, remote_id)
    WHERE remote_id IS NOT NULL;
  CREATE UNIQUE INDEX threads_by_remote_id ON threads(account_id, remote_id)
    WHERE remote_id IS NOT NULL;
  `,

  // Pictures that a message shows inside its text are kept, so the message reads the same
  // offline. content_id is the name by which the text refers to a picture. Other attachments
  // are fetched when the user opens or saves them.
  `
  ALTER TABLE attachments ADD COLUMN content_id TEXT;
  CREATE TABLE attachment_contents (
    attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    content BLOB NOT NULL
  ) STRICT;
  `,

  // Lists sorted by sender or subject. Without these, every page deep in a large folder sorts
  // the whole folder again. The expressions have to match GROUP_KEYS in the store exactly.
  `
  CREATE INDEX messages_by_folder_sender ON messages(folder_id,
    (CASE WHEN from_name <> '' THEN from_name ELSE from_address END) COLLATE NOCASE,
    received_at DESC, id DESC);
  CREATE INDEX messages_by_folder_subject ON messages(folder_id, subject COLLATE NOCASE,
    received_at DESC, id DESC);
  `,

  // Search in the text of messages. The row ID is the message ID. The index keeps no copy of
  // the text: the core turns each stored text into words when it saves it, and fills the index
  // for texts that were stored before (setting search.textVersion). A text that goes, also with
  // its message, takes its words along.
  `
  CREATE VIRTUAL TABLE message_text_fts USING fts5(
    text,
    content = '', contentless_delete = 1,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER message_text_fts_delete AFTER DELETE ON message_bodies BEGIN
    DELETE FROM message_text_fts WHERE rowid = old.message_id;
  END;
  `,

  // Lists grouped into conversations ask for every message whether a newer one of its
  // conversation is in the same folder.
  `
  CREATE INDEX messages_by_folder_thread ON messages(folder_id, thread_id, received_at DESC,
    id DESC);
  `,

  // Changes the user made here that still have to reach the provider. They are applied here at
  // once and wait in this table until the provider took them, also across a restart. remote_id
  // names the message at the provider, which stays the same when it moves. data is JSON with
  // what the change sets and what the provider had before, which comes back if it refuses.
  // next_attempt_at is a time in milliseconds, 0 means now.
  `
  CREATE TABLE operations (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    remote_id TEXT,
    data TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX operations_by_account ON operations(account_id, next_attempt_at);
  CREATE INDEX operations_by_remote_id ON operations(account_id, remote_id, kind);
  `,

  // Drafts written here. The message holds what the list shows, this row what the editor needs:
  // the text the user writes, and below it the earlier message of a reply or forward, which is
  // kept as it came. version counts the saves here, saved_version is the one the provider has.
  // source_remote_id names the message that is answered or forwarded, so the provider can make
  // the draft part of its conversation. source_id is that message here, while it is stored.
  `
  CREATE TABLE drafts (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('new', 'reply', 'replyAll', 'forward')),
    source_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    source_remote_id TEXT,
    bcc_recipients TEXT NOT NULL DEFAULT '[]',
    text TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 0,
    saved_version INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  `,
];
