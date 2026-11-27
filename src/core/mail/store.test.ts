import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { MailStore, type NewMessage } from './store';

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
  store = new MailStore(openDatabase(':memory:'));
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
