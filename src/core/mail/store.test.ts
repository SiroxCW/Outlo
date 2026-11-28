import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListOptions, MessageFilter, MessageSort } from '@shared/api';
import { openDatabase } from '../db/database';
import { GROUP_KEYS, MailStore, type NewMessage } from './store';

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

describe('listSettings', () => {
  it('returns only the settings below a prefix', () => {
    store.setSetting('ui.theme', 'dark');
    store.setSetting('ui.listWidth', '400');
    store.setSetting('demo.seeded', '1');
    expect(store.listSettings('ui.')).toEqual({ 'ui.theme': 'dark', 'ui.listWidth': '400' });
  });
});
