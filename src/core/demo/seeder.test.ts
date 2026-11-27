import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { MailStore } from '../mail/store';
import { createDemoBody } from './body';
import { DemoSeeder, type DemoOptions } from './seeder';

const OPTIONS: DemoOptions = {
  now: Date.UTC(2026, 10, 27, 12),
  largeFolderSize: 600,
  otherFolderSize: 100,
  batchSize: 250,
};

function seed(options: DemoOptions = OPTIONS) {
  const store = new MailStore(openDatabase(':memory:'));
  const seeder = new DemoSeeder(store, options);
  seeder.seedStructure();
  let batches = 0;
  while (seeder.seedNextBatch()) batches++;
  return { store, batches };
}

describe('DemoSeeder', () => {
  it('creates three accounts, each with the standard folders', () => {
    const { store } = seed();
    const accounts = store.listAccounts();
    expect(accounts).toHaveLength(3);
    expect(accounts.every((account) => account.provider === 'demo')).toBe(true);
    for (const account of accounts) {
      const roles = store
        .listFolders()
        .filter((folder) => folder.accountId === account.id)
        .map((folder) => folder.role);
      expect(roles).toEqual(
        expect.arrayContaining(['inbox', 'drafts', 'sent', 'deleted', 'junk', 'archive']),
      );
    }
  });

  it('nests folders below their parent', () => {
    const { store } = seed();
    const folders = store.listFolders();
    const projects = folders.find((folder) => folder.name === 'Projects')!;
    const child = folders.find((folder) => folder.name === 'Website relaunch')!;
    expect(child.parentId).toBe(projects.id);
    expect(child.accountId).toBe(projects.accountId);
  });

  it('fills the big inbox with exactly the requested number of messages', () => {
    const { store } = seed();
    const firstAccount = store.listAccounts()[0]!;
    const inbox = store
      .listFolders()
      .find((folder) => folder.accountId === firstAccount.id && folder.role === 'inbox')!;
    expect(inbox.totalCount).toBe(600);
    expect(store.listMessages(inbox.id, 'all', 0, 1).total).toBe(600);
  });

  it('keeps the folder counters equal to the real numbers', () => {
    const { store } = seed();
    for (const folder of store.listFolders()) {
      const page = store.listMessages(folder.id, 'all', 0, 500);
      expect(page.total).toBe(folder.totalCount);
      if (page.total <= 500) {
        const unread = page.messages.filter((message) => !message.isRead).length;
        expect(unread).toBe(folder.unreadCount);
      }
    }
  });

  it('works in batches of the given size', () => {
    const { store, batches } = seed();
    const total = store.listFolders().reduce((sum, folder) => sum + folder.totalCount, 0);
    expect(batches).toBe(Math.ceil(total / OPTIONS.batchSize));
  });

  it('creates messages in the past, newest first, with plausible content', () => {
    const { store } = seed();
    const inbox = store.listFolders().find((folder) => folder.role === 'inbox')!;
    const messages = store.listMessages(inbox.id, 'all', 0, 500).messages;
    expect(messages[0]!.receivedAt).toBeLessThan(OPTIONS.now);
    for (const message of messages) {
      expect(message.subject).not.toBe('');
      expect(message.preview).not.toBe('');
      expect(message.from.address).toMatch(/@[a-z-]+\.example$/);
      expect(message.to.length).toBeGreaterThan(0);
    }
    expect(messages.some((message) => !message.isRead)).toBe(true);
    expect(messages.some((message) => !message.isFocused)).toBe(true);
  });

  it('writes outgoing mail from the owner of the account', () => {
    const { store } = seed();
    const account = store.listAccounts()[0]!;
    const sent = store
      .listFolders()
      .find((folder) => folder.accountId === account.id && folder.role === 'sent')!;
    const messages = store.listMessages(sent.id, 'all', 0, 50).messages;
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.from.address === account.email)).toBe(true);
  });

  it('produces the same data on every run', () => {
    const subjects = () => {
      const { store } = seed();
      const inbox = store.listFolders().find((folder) => folder.role === 'inbox')!;
      return store.listMessages(inbox.id, 'all', 0, 100).messages.map((entry) => entry.subject);
    };
    expect(subjects()).toEqual(subjects());
  });

  it('makes the data searchable', () => {
    const { store } = seed();
    expect(store.search('report', 5).length).toBeGreaterThan(0);
  });
});

describe('createDemoBody', () => {
  const { store } = seed();
  const inbox = store.listFolders().find((folder) => folder.role === 'inbox')!;
  const messages = store.listMessages(inbox.id, 'all', 0, 500).messages;

  it('writes a short HTML letter that greets the recipient and is signed by the sender', () => {
    const message = messages[0]!;
    const { body } = createDemoBody(message);
    expect(body.contentType).toBe('html');
    expect(body.content).toContain('<p>Hi Alex,</p>');
    expect(body.content).toContain(message.from.name.replace('&', '&amp;'));
  });

  it('gives the same body every time a message is opened', () => {
    expect(createDemoBody(messages[1]!)).toEqual(createDemoBody(messages[1]!));
  });

  it('adds attachments exactly when the message is marked as having some', () => {
    const withFiles = messages.find((message) => message.hasAttachments)!;
    const without = messages.find((message) => !message.hasAttachments)!;
    expect(createDemoBody(withFiles).attachments.length).toBeGreaterThan(0);
    expect(createDemoBody(without).attachments).toEqual([]);
  });

  it('escapes names that contain HTML characters', () => {
    const message = { ...messages[0]!, from: { name: 'Harbor & <Finch>', address: 'x@y.example' } };
    const { body } = createDemoBody(message);
    expect(body.content).toContain('Harbor &amp; &lt;Finch&gt;');
    expect(body.content).not.toContain('<Finch>');
  });
});
