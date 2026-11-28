import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListOptions, MessageFilter, MessageSort } from '@shared/api';
import { openDatabase } from '../db/database';
import { GROUP_KEYS, MailStore, type NewMessage } from './store';
import { indexStoredTexts, TEXT_INDEX_VERSION } from './text-index';

let db: DatabaseSync;
let store: MailStore;
let accountId: number;
let inbox: number;
let archive: number;

function message(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    accountId,
    folderId: inbox,
    threadId: null,
    subject: 'Quarterly report',
    preview: 'The numbers look better than last month.',
    from: { name: 'Anna Berg', address: 'anna.berg@bluepeak.example' },
    to: [{ name: 'Alex Morgan', address: 'alex@mailbox.example' }],
    cc: [],
    receivedAt: 1_000,
    isRead: false,
    isFlagged: false,
    isFocused: true,
    hasAttachments: false,
    importance: 'normal',
    ...overrides,
  };
}

function add(overrides: Partial<NewMessage> = {}): number {
  const id = store.insertMessage(message(overrides));
  store.recountFolders([overrides.folderId ?? inbox]);
  return id;
}

const folder = (id: number) => store.listFolders().find((entry) => entry.id === id)!;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new MailStore(db);
  accountId = store.insertAccount('demo', 'alex@mailbox.example', 'Alex Morgan', 0);
  const base = { accountId, parentId: null, isFavorite: false };
  inbox = store.insertFolder({ ...base, name: 'Inbox', role: 'inbox', sortOrder: 0 });
  archive = store.insertFolder({ ...base, name: 'Archive', role: 'archive', sortOrder: 1 });
});

describe('accounts and folders', () => {
  it('lists what was inserted, in sort order', () => {
    expect(store.listAccounts()).toEqual([
      {
        id: accountId,
        provider: 'demo',
        email: 'alex@mailbox.example',
        displayName: 'Alex Morgan',
      },
    ]);
    expect(store.listFolders().map((entry) => [entry.name, entry.role])).toEqual([
      ['Inbox', 'inbox'],
      ['Archive', 'archive'],
    ]);
  });

  it('removes folders and messages together with their account', () => {
    add();
    store.deleteAllAccounts();
    expect(store.listFolders()).toEqual([]);
    expect(store.search('quarterly', 10)).toEqual([]);
  });
});

describe('listMessages', () => {
  it('returns the newest messages first and the total', () => {
    const old = add({ receivedAt: 100 });
    const recent = add({ receivedAt: 300 });
    const middle = add({ receivedAt: 200 });
    const page = store.listMessages(inbox, 'all', 0, 10);
    expect(page.total).toBe(3);
    expect(page.messages.map((entry) => entry.id)).toEqual([recent, middle, old]);
  });

  it('cuts a window out of the list', () => {
    for (let index = 0; index < 10; index++) add({ receivedAt: index, subject: `m${index}` });
    const page = store.listMessages(inbox, 'all', 3, 4);
    expect(page.total).toBe(10);
    expect(page.offset).toBe(3);
    expect(page.messages.map((entry) => entry.subject)).toEqual(['m6', 'm5', 'm4', 'm3']);
  });

  it('keeps a stable order for messages with the same time', () => {
    const first = add({ receivedAt: 500 });
    const second = add({ receivedAt: 500 });
    expect(store.listMessages(inbox, 'all', 0, 10).messages.map((entry) => entry.id)).toEqual([
      second,
      first,
    ]);
  });

  it('separates Focused and Other, each with its own total', () => {
    add({ isFocused: true });
    add({ isFocused: false });
    add({ isFocused: false });
    expect(store.listMessages(inbox, 'focused', 0, 10).total).toBe(1);
    expect(store.listMessages(inbox, 'other', 0, 10).total).toBe(2);
    expect(store.listMessages(inbox, 'all', 0, 10).total).toBe(3);
  });

  it('only shows messages of the folder that was asked for', () => {
    add({ folderId: archive });
    expect(store.listMessages(inbox, 'all', 0, 10).messages).toEqual([]);
    expect(store.listMessages(archive, 'all', 0, 10).total).toBe(1);
  });

  it('maps all fields of a message', () => {
    const id = add({ isFlagged: true, hasAttachments: true, importance: 'high', isRead: true });
    expect(store.listMessages(inbox, 'all', 0, 1).messages[0]).toEqual({
      id,
      accountId,
      folderId: inbox,
      threadId: null,
      subject: 'Quarterly report',
      preview: 'The numbers look better than last month.',
      from: { name: 'Anna Berg', address: 'anna.berg@bluepeak.example' },
      to: [{ name: 'Alex Morgan', address: 'alex@mailbox.example' }],
      receivedAt: 1_000,
      isRead: true,
      isFlagged: true,
      isFocused: true,
      hasAttachments: true,
      importance: 'high',
    });
  });
});

describe('getMessage', () => {
  it('returns null for a message that does not exist', () => {
    expect(store.getMessage(12345)).toBeNull();
  });

  it('has no body until one was saved', () => {
    const id = add({ cc: [{ name: 'Ben Dorn', address: 'ben@quillon.example' }] });
    const loaded = store.getMessage(id)!;
    expect(loaded.body).toBeNull();
    expect(loaded.attachments).toEqual([]);
    expect(loaded.cc).toEqual([{ name: 'Ben Dorn', address: 'ben@quillon.example' }]);
  });

  it('returns the saved body and attachments, and replaces them on a second save', () => {
    const id = add();
    const file = { name: 'a.pdf', contentType: 'application/pdf', size: 10, isInline: false };
    store.saveBody(id, { contentType: 'html', content: '<p>one</p>' }, [file, file]);
    store.saveBody(id, { contentType: 'text', content: 'two' }, [file]);
    const loaded = store.getMessage(id)!;
    expect(loaded.body).toEqual({ contentType: 'text', content: 'two' });
    expect(loaded.attachments).toHaveLength(1);
    expect(loaded.attachments[0]).toMatchObject(file);
  });
});

describe('setRead', () => {
  it('marks messages and keeps the unread counter of the folder right', () => {
    const a = add();
    const b = add();
    add();
    expect(folder(inbox).unreadCount).toBe(3);

    expect(store.setRead([a, b], true)).toEqual([inbox]);
    expect(folder(inbox).unreadCount).toBe(1);
    expect(store.getMessage(a)!.isRead).toBe(true);

    store.setRead([a], false);
    expect(folder(inbox).unreadCount).toBe(2);
  });

  it('does not count a message twice and reports nothing when nothing changed', () => {
    const a = add();
    store.setRead([a, a], true);
    expect(folder(inbox).unreadCount).toBe(0);
    expect(store.setRead([a], true)).toEqual([]);
    expect(folder(inbox).unreadCount).toBe(0);
  });

  it('handles messages from several folders and ignores unknown ones', () => {
    const a = add();
    const b = add({ folderId: archive });
    expect(store.setRead([a, b, 999], true).sort()).toEqual([inbox, archive].sort());
    expect(folder(inbox).unreadCount).toBe(0);
    expect(folder(archive).unreadCount).toBe(0);
  });
});

describe('setFlagged', () => {
  it('sets and clears the flag and reports the folder', () => {
    const a = add();
    expect(store.setFlagged([a], true)).toEqual([inbox]);
    expect(store.getMessage(a)!.isFlagged).toBe(true);
    expect(store.setFlagged([a], true)).toEqual([]);
    store.setFlagged([a], false);
    expect(store.getMessage(a)!.isFlagged).toBe(false);
  });
});

describe('search', () => {
  it('finds messages by subject, sender name, address and preview', () => {
    const report = add({ subject: 'Quarterly report' });
    const dinner = add({
      subject: 'Dinner on Saturday?',
      from: { name: 'Mira Falk', address: 'mira@quillon.example' },
      preview: 'Shall we try the new place?',
    });
    const ids = (query: string) => store.search(query, 10).map((entry) => entry.id);
    expect(ids('quarterly')).toEqual([report]);
    expect(ids('mira')).toEqual([dinner]);
    expect(ids('quillon.example')).toEqual([dinner]);
    expect(ids('new place')).toEqual([dinner]);
  });

  it('matches the beginning of words and needs every word', () => {
    const id = add({ subject: 'Budget review for next year' });
    expect(store.search('budg rev', 10).map((entry) => entry.id)).toEqual([id]);
    expect(store.search('budget holiday', 10)).toEqual([]);
  });

  it('ignores accents and case', () => {
    const id = add({ subject: 'Café in Zürich' });
    expect(store.search('CAFE zurich', 10).map((entry) => entry.id)).toEqual([id]);
  });

  it('returns the newest matches first and respects the limit', () => {
    for (let index = 0; index < 5; index++) add({ receivedAt: index, subject: `Invoice ${index}` });
    const found = store.search('invoice', 3);
    expect(found.map((entry) => entry.subject)).toEqual(['Invoice 4', 'Invoice 3', 'Invoice 2']);
  });

  it('survives input full of search syntax', () => {
    add();
    expect(() => store.search('"*" OR NEAR( subject: -- ^', 10)).not.toThrow();
    expect(store.search('""', 10)).toEqual([]);
  });
});

describe('search in the text of messages', () => {
  const ids = (query: string) => store.search(query, 10).map((entry) => entry.id);
  const html = (content: string) => ({ contentType: 'html', content }) as const;

  it('finds a message by a word that only its text contains, once the text is stored', () => {
    const id = add();
    expect(ids('pineapple')).toEqual([]);
    store.saveBody(
      id,
      html('<p>Bring a <b>pine</b>apple, please.</p><style>.hidden{}</style>'),
      [],
    );
    expect(ids('pineapple')).toEqual([id]);
    expect(ids('hidden')).toEqual([]);
  });

  it('lets each word match another part of the message', () => {
    const id = add({ from: { name: 'Mira Falk', address: 'mira@quillon.example' } });
    add({ subject: 'Invoice' });
    store.saveBody(id, html('<p>The invoice is attached.</p>'), []);
    expect(ids('mira invoice')).toEqual([id]);
    expect(ids('mira holiday')).toEqual([]);
  });

  it('lists a message once, also when it matches in the header and in the text', () => {
    const id = add({ subject: 'Invoice' });
    store.saveBody(id, html('<p>Invoice attached</p>'), []);
    expect(ids('invoice')).toEqual([id]);
  });

  it('forgets the old words when the text is replaced or deleted', () => {
    const id = add();
    store.saveBody(id, html('<p>pineapple</p>'), []);
    store.saveBody(id, { contentType: 'text', content: 'mango' }, []);
    expect(ids('pineapple')).toEqual([]);
    expect(ids('mango')).toEqual([id]);

    db.prepare('DELETE FROM message_bodies WHERE message_id = ?').run(id);
    expect(ids('mango')).toEqual([]);
  });

  it('forgets the words together with the message', () => {
    const id = add();
    store.saveBody(id, html('<p>pineapple</p>'), []);
    store.deleteAllAccounts();
    const other = store.insertAccount('demo', 'b@x.example', 'B', 0);
    const folderId = store.insertFolder({
      accountId: other,
      parentId: null,
      isFavorite: false,
      name: 'Inbox',
      role: 'inbox',
      sortOrder: 0,
    });
    // The new message may get the ID of the deleted one. It must not inherit its words.
    const fresh = store.insertMessage(message({ accountId: other, folderId }));
    expect(fresh).toBe(id);
    expect(ids('pineapple')).toEqual([]);
  });
});

describe('indexStoredTexts', () => {
  const ids = (query: string) => store.search(query, 10).map((entry) => entry.id);

  it('indexes texts stored before, in batches, and only once per version', async () => {
    const stored = Array.from({ length: 250 }, () => add());
    for (const id of stored) {
      db.prepare("INSERT INTO message_bodies VALUES (?, 'text', 'kiwi')").run(id);
    }
    expect(ids('kiwi')).toEqual([]);

    await indexStoredTexts(store, () => false);
    expect(store.search('kiwi', 500)).toHaveLength(250);
    expect(store.getSetting('search.textVersion')).toBe(TEXT_INDEX_VERSION);

    // Done is done: a text that is somehow missing from the index stays missing.
    store.clearTextIndex();
    await indexStoredTexts(store, () => false);
    expect(ids('kiwi')).toEqual([]);
  });

  it('starts from nothing for a new version, without doubling what is there', async () => {
    const id = add();
    store.saveBody(id, { contentType: 'text', content: 'kiwi' }, []);
    store.setSetting('search.textVersion', '0');
    await indexStoredTexts(store, () => false);
    expect(ids('kiwi')).toEqual([id]);
    const rows = db.prepare("SELECT rowid FROM message_text_fts WHERE text MATCH 'kiwi'").all();
    expect(rows).toHaveLength(1);
  });

  it('stops when the core closes', async () => {
    add();
    db.prepare("INSERT INTO message_bodies VALUES (1, 'text', 'kiwi')").run();
    await indexStoredTexts(store, () => true);
    expect(store.getSetting('search.textVersion')).toBeNull();
  });
});

describe('settings', () => {
  it('stores, overwrites and reads values', () => {
    expect(store.getSetting('theme')).toBeNull();
    store.setSetting('theme', 'dark');
    store.setSetting('theme', 'light');
    expect(store.getSetting('theme')).toBe('light');
  });
});

describe('countByTime', () => {
  it('counts the messages of each time span', () => {
    for (const receivedAt of [950, 900, 600, 550, 500, 100]) add({ receivedAt });
    expect(store.countByTime(inbox, 'all', [900, 500, 200])).toEqual([2, 3, 0, 1]);
  });

  it('respects the filter and returns one total without boundaries', () => {
    add({ receivedAt: 10, isFocused: false });
    add({ receivedAt: 20 });
    expect(store.countByTime(inbox, 'other', [15])).toEqual([0, 1]);
    expect(store.countByTime(inbox, 'all', [])).toEqual([2]);
  });
});

describe('filters', () => {
  const ids = (options: ListOptions, filter: MessageFilter = 'all') =>
    store.listMessages(inbox, filter, 0, 50, options).messages.map((entry) => entry.id);
  const toSam = [{ name: 'Sam', address: 'sam@x.example' }];

  it('leaves in only what the filter asks for, and counts the same', () => {
    const unread = add({ to: toSam });
    const flagged = add({ isRead: true, isFlagged: true, to: toSam });
    const withFiles = add({ isRead: true, hasAttachments: true, to: toSam });
    // "To me" is the To line, whatever the case of the address. A copy does not count.
    const toMe = add({ isRead: true, to: [{ name: 'Alex', address: 'ALEX@Mailbox.example' }] });
    add({ isRead: true, to: toSam, cc: [{ name: 'Alex', address: 'alex@mailbox.example' }] });

    expect(ids({ show: 'unread' })).toEqual([unread]);
    expect(ids({ show: 'flagged' })).toEqual([flagged]);
    expect(ids({ show: 'hasFiles' })).toEqual([withFiles]);
    expect(ids({ show: 'toMe' })).toEqual([toMe]);
    expect(ids({ show: 'all' })).toHaveLength(5);
    expect(store.listMessages(inbox, 'all', 0, 50, { show: 'unread' }).total).toBe(1);
    expect(store.countByTime(inbox, 'all', [], { show: 'flagged' })).toEqual([1]);
  });

  it('works together with Focused and Other', () => {
    add({ isFocused: false });
    const otherRead = add({ isFocused: false, isRead: true, isFlagged: true });
    add({ isFocused: true, isFlagged: true });
    expect(ids({ show: 'flagged' }, 'other')).toEqual([otherRead]);
  });

  it('keeps the open message, but only in its own folder', () => {
    const open = add({ isRead: true, receivedAt: 200 });
    const unread = add({ receivedAt: 100 });
    const elsewhere = add({ folderId: archive, isRead: true });
    expect(ids({ show: 'unread', keepId: open })).toEqual([open, unread]);
    expect(store.countByTime(inbox, 'all', [150], { show: 'unread', keepId: open })).toEqual([
      1, 1,
    ]);
    expect(ids({ show: 'unread', keepId: elsewhere })).toEqual([unread]);
    // Without a filter there is nothing to keep, and the message is not listed twice.
    expect(ids({ keepId: open })).toEqual([open, unread]);
  });
});

describe('sorting', () => {
  const list = (sort: MessageSort) => store.listMessages(inbox, 'all', 0, 50, { sort }).messages;

  it('sorts by date both ways', () => {
    const old = add({ receivedAt: 100 });
    const recent = add({ receivedAt: 300 });
    const sort = { field: 'date', descending: false } as const;
    expect(list(sort).map((entry) => entry.id)).toEqual([old, recent]);
    expect(store.countByGroup(inbox, 'all', { sort })).toEqual([]);
  });

  it('groups by sender without regard to case, newest first inside a group', () => {
    add({ from: { name: 'bert', address: 'b@x.example' }, receivedAt: 100 });
    add({ from: { name: 'Anna', address: 'a@x.example' }, receivedAt: 100 });
    add({ from: { name: '', address: 'carl@x.example' }, receivedAt: 100 });
    add({ from: { name: 'anna', address: 'a2@x.example' }, receivedAt: 300 });
    const sort = { field: 'from', descending: false } as const;

    const groups = store.countByGroup(inbox, 'all', { sort });
    expect(groups.map((group) => [group.value.toLowerCase(), group.count])).toEqual([
      ['anna', 2],
      ['bert', 1],
      ['carl@x.example', 1],
    ]);
    expect(list(sort).map((entry) => entry.from.address)).toEqual([
      'a2@x.example',
      'a@x.example',
      'b@x.example',
      'carl@x.example',
    ]);
    const reversed = { field: 'from', descending: true } as const;
    expect(store.countByGroup(inbox, 'all', { sort: reversed })[0]?.value).toBe('carl@x.example');
    expect(list(reversed)[0]?.from.address).toBe('carl@x.example');
  });

  it('groups by subject, importance and flag in the order of the list', () => {
    add({ subject: 'Budget', importance: 'low' });
    add({ subject: 'agenda', importance: 'high', isFlagged: true });
    add({ subject: 'Agenda', importance: 'normal' });

    expect(
      store.countByGroup(inbox, 'all', { sort: { field: 'subject', descending: false } }),
    ).toMatchObject([{ count: 2 }, { value: 'Budget', count: 1 }]);
    const importance = { field: 'importance', descending: true } as const;
    expect(store.countByGroup(inbox, 'all', { sort: importance })).toEqual([
      { value: 'high', count: 1 },
      { value: 'normal', count: 1 },
      { value: 'low', count: 1 },
    ]);
    expect(list(importance).map((entry) => entry.importance)).toEqual(['high', 'normal', 'low']);
    expect(store.countByGroup(inbox, 'all', { sort: { field: 'flag', descending: true } })).toEqual(
      [
        { value: 'flagged', count: 1 },
        { value: 'unflagged', count: 2 },
      ],
    );
  });

  it('reads lists sorted by sender or subject from an index', () => {
    for (const [field, index] of [
      ['from', 'messages_by_folder_sender'],
      ['subject', 'messages_by_folder_subject'],
    ] as const) {
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT m.id FROM messages m WHERE m.folder_id = ?
           ORDER BY ${GROUP_KEYS[field]} ASC, m.received_at DESC, m.id DESC LIMIT 100 OFFSET 5000`,
        )
        .all(inbox);
      expect(plan.map((row) => row.detail).join(' ')).toContain(index);
    }
  });

  it('counts the groups of a filtered list only', () => {
    add({ subject: 'Read', isRead: true });
    add({ subject: 'Unread' });
    const options = { show: 'unread', sort: { field: 'subject', descending: false } } as const;
    expect(store.countByGroup(inbox, 'all', options)).toEqual([{ value: 'Unread', count: 1 }]);
  });
});

describe('conversations', () => {
  const grouped = { conversations: true } as const;
  const list = (options: ListOptions = grouped, filter: MessageFilter = 'all') =>
    store.listMessages(inbox, filter, 0, 50, options);
  const ids = (options?: ListOptions, filter?: MessageFilter) =>
    list(options, filter).messages.map((entry) => entry.id);
  let sent: number;
  let deleted: number;
  let junk: number;

  beforeEach(() => {
    const base = { accountId, parentId: null, isFavorite: false, sortOrder: 2 };
    sent = store.insertFolder({ ...base, name: 'Sent Items', role: 'sent' });
    deleted = store.insertFolder({ ...base, name: 'Deleted Items', role: 'deleted' });
    junk = store.insertFolder({ ...base, name: 'Junk Email', role: 'junk' });
  });

  it('shows each conversation once, as its newest message in the folder', () => {
    const thread = store.insertThread(accountId);
    const first = add({ threadId: thread, receivedAt: 100 });
    const answer = add({ threadId: thread, receivedAt: 300 });
    const alone = add({ threadId: null, receivedAt: 200 });
    const other = add({ threadId: store.insertThread(accountId), receivedAt: 50 });
    // A newer message of the conversation in another folder does not take the place.
    add({ threadId: thread, folderId: sent, receivedAt: 400 });

    expect(ids()).toEqual([answer, alone, other]);
    expect(list().total).toBe(3);
    expect(store.countByTime(inbox, 'all', [250], grouped)).toEqual([1, 2]);
    expect(ids({})).toEqual([answer, alone, first, other]);
    // Only a list sorted by date is grouped, as in Outlook.
    const bySender = { ...grouped, sort: { field: 'from', descending: false } } as const;
    expect(list(bySender).messages).toHaveLength(4);
    expect(list(bySender).messages[0]?.conversation).toBeUndefined();
  });

  it('picks the newest message that passes the tab and the filter', () => {
    const thread = store.insertThread(accountId);
    const unread = add({ threadId: thread, receivedAt: 100 });
    const read = add({ threadId: thread, receivedAt: 200, isRead: true });
    const other = add({ threadId: thread, receivedAt: 300, isFocused: false, isRead: true });
    expect(ids({ ...grouped, show: 'unread' })).toEqual([unread]);
    expect(ids(grouped, 'focused')).toEqual([read]);
    expect(ids(grouped, 'other')).toEqual([other]);
    // The open message keeps its conversation in the list after it was read.
    store.setRead([unread], true);
    expect(ids({ ...grouped, show: 'unread' })).toEqual([]);
    expect(ids({ ...grouped, show: 'unread', keepId: unread })).toEqual([unread]);
    expect(list({ ...grouped, show: 'unread', keepId: unread }).total).toBe(1);
    expect(list({ ...grouped, show: 'flagged' }).total).toBe(0);
  });

  it('sums up the conversation for the row', () => {
    const thread = store.insertThread(accountId);
    const anna = { name: 'Anna Berg', address: 'anna@x.example' };
    add({ threadId: thread, receivedAt: 100, from: anna, isRead: true, hasAttachments: true });
    add({ threadId: thread, receivedAt: 200, from: { name: 'Ben', address: 'ben@x.example' } });
    add({ threadId: thread, receivedAt: 300, from: { ...anna, address: 'ANNA@x.example' } });
    add({ threadId: thread, folderId: sent, receivedAt: 250, isRead: false, isFlagged: true });
    // Deleted Items and Junk stay out of the conversation in the inbox.
    add({ threadId: thread, folderId: deleted, receivedAt: 500, isRead: false });
    add({ threadId: thread, folderId: junk, receivedAt: 600, hasAttachments: true });

    expect(list().messages[0]?.conversation).toEqual({
      size: 4,
      unreadCount: 2,
      isFlagged: true,
      hasAttachments: true,
      // Newest first, each address once whatever its case.
      senders: [
        { name: 'Anna Berg', address: 'ANNA@x.example' },
        { name: 'Anna Berg', address: 'anna.berg@bluepeak.example' },
        { name: 'Ben', address: 'ben@x.example' },
      ],
    });
    // In Deleted Items the deleted message is part of it.
    const inDeleted = store.listMessages(deleted, 'all', 0, 10, grouped).messages[0];
    expect(inDeleted?.conversation?.size).toBe(5);
  });

  it('describes a message without a conversation by itself', () => {
    add({ threadId: null, isRead: false, isFlagged: true });
    expect(list().messages[0]?.conversation).toEqual({
      size: 1,
      unreadCount: 1,
      isFlagged: true,
      hasAttachments: false,
      senders: [{ name: 'Anna Berg', address: 'anna.berg@bluepeak.example' }],
    });
  });

  it('returns the whole conversation, newest first', () => {
    const thread = store.insertThread(accountId);
    const first = add({ threadId: thread, receivedAt: 100 });
    const reply = add({ threadId: thread, folderId: sent, receivedAt: 200 });
    const binned = add({ threadId: thread, folderId: deleted, receivedAt: 300 });
    const alone = add({ threadId: null });
    const ofConversation = (id: number, folderId = inbox) =>
      store.getConversation(id, folderId).map((entry) => entry.id);

    expect(ofConversation(first)).toEqual([reply, first]);
    expect(ofConversation(binned, deleted)).toEqual([binned, reply, first]);
    expect(ofConversation(alone)).toEqual([alone]);
    expect(ofConversation(9_999)).toEqual([]);
  });

  it('finds the newer message of a conversation through an index', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT m.id FROM messages m WHERE m.folder_id = ? AND NOT EXISTS (
           SELECT 1 FROM messages n WHERE n.folder_id = m.folder_id AND n.thread_id = m.thread_id
             AND (n.received_at > m.received_at OR (n.received_at = m.received_at AND n.id > m.id)))
         ORDER BY m.received_at DESC LIMIT 100`,
      )
      .all(inbox);
    expect(plan.map((row) => row.detail).join(' ')).toContain('messages_by_folder_thread');
  });
});

describe('listSettings', () => {
  it('returns only the settings below a prefix', () => {
    store.setSetting('ui.theme', 'dark');
    store.setSetting('ui.listWidth', '400');
    store.setSetting('demo.seeded', '1');
    expect(store.listSettings('ui.')).toEqual({ 'ui.theme': 'dark', 'ui.listWidth': '400' });
  });
});
