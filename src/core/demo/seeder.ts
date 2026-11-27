import type { Address, FolderRole } from '@shared/api';
import type { MailStore, NewMessage } from '../mail/store';
import {
  COMPANY_DOMAINS,
  DEMO_ACCOUNTS,
  FIRST_NAMES,
  JUNK_SUBJECTS,
  LAST_NAMES,
  NEWSLETTER_SUBJECTS,
  NEWSLETTERS,
  PERSONAL_SUBJECTS,
  SENTENCES,
  SERVICE_SUBJECTS,
  SERVICES,
  WORK_SUBJECTS,
} from './content';
import { createRandom, type Random } from './random';

export interface DemoOptions {
  now: number;
  // Number of messages in the one big inbox, which exists to test long lists.
  largeFolderSize: number;
  // Base size of every other folder. Each folder scales it with its own factor.
  otherFolderSize: number;
  batchSize: number;
}

export const DEFAULT_DEMO_OPTIONS: Omit<DemoOptions, 'now'> = {
  largeFolderSize: 100_000,
  otherFolderSize: 400,
  batchSize: 2_000,
};

interface FolderPlan {
  name: string;
  role: FolderRole | null;
  factor: number;
  favorite?: boolean;
  children?: FolderPlan[];
}

const MINUTE = 60_000;

const STANDARD_FOLDERS: FolderPlan[] = [
  { name: 'Inbox', role: 'inbox', factor: 3, favorite: true },
  { name: 'Drafts', role: 'drafts', factor: 0.03 },
  { name: 'Sent Items', role: 'sent', factor: 2 },
  { name: 'Deleted Items', role: 'deleted', factor: 0.5 },
  { name: 'Junk Email', role: 'junk', factor: 0.2 },
  { name: 'Archive', role: 'archive', factor: 2 },
];

const EXTRA_FOLDERS: FolderPlan[][] = [
  [
    { name: 'Receipts', role: null, factor: 0.5 },
    { name: 'Travel', role: null, factor: 0.3 },
  ],
  [
    {
      name: 'Projects',
      role: null,
      factor: 0.2,
      children: [
        { name: 'Website relaunch', role: null, factor: 0.6 },
        { name: 'Planning', role: null, factor: 0.4 },
      ],
    },
    { name: 'Customers', role: null, factor: 0.5 },
  ],
  [{ name: 'Family', role: null, factor: 0.4 }],
];

interface Task {
  accountId: number;
  owner: Address;
  folderId: number;
  role: FolderRole | null;
  remaining: number;
  // Average distance between two messages. The cursor walks back in time from now.
  averageGap: number;
  cursor: number;
  position: number;
  recentThreads: { id: number; subject: string }[];
}

// Fills an empty database with invented accounts, folders and messages.
// The structure comes first, then the messages in batches, newest first, like a real first sync.
export class DemoSeeder {
  private readonly random: Random;
  private readonly tasks: Task[] = [];

  constructor(
    private readonly store: MailStore,
    private readonly options: DemoOptions,
  ) {
    this.random = createRandom(20261127);
  }

  seedStructure(): void {
    this.store.transaction(() => {
      DEMO_ACCOUNTS.forEach((account, accountIndex) => {
        const accountId = this.store.insertAccount(
          'demo',
          account.email,
          account.displayName,
          accountIndex,
        );
        const owner = { name: account.displayName, address: account.email };
        const plans = [...STANDARD_FOLDERS, ...(EXTRA_FOLDERS[accountIndex] ?? [])];
        let sortOrder = 0;

        const addFolder = (plan: FolderPlan, parentId: number | null) => {
          const folderId = this.store.insertFolder({
            accountId,
            parentId,
            name: plan.name,
            role: plan.role,
            sortOrder: sortOrder++,
            isFavorite: plan.favorite === true,
          });
          const isLargeFolder = accountIndex === 0 && plan.role === 'inbox';
          const count = isLargeFolder
            ? this.options.largeFolderSize
            : Math.round(this.options.otherFolderSize * plan.factor);
          this.tasks.push({
            accountId,
            owner,
            folderId,
            role: plan.role,
            remaining: count,
            averageGap: isLargeFolder ? 20 * MINUTE : 6 * 60 * MINUTE,
            cursor: this.options.now,
            position: 0,
            recentThreads: [],
          });
          plan.children?.forEach((child) => addFolder(child, folderId));
        };
        plans.forEach((plan) => addFolder(plan, null));
      });
    });
    // Small folders first, so everything but the big inbox is complete after the first batch.
    this.tasks.sort((a, b) => a.remaining - b.remaining);
  }

  // Returns the folders that got new messages, or null when everything is seeded.
  seedNextBatch(): number[] | null {
    const added = new Map<number, { total: number; unread: number }>();
    let budget = this.options.batchSize;

    this.store.transaction(() => {
      for (const task of this.tasks) {
        while (task.remaining > 0 && budget > 0) {
          const message = this.createMessage(task);
          this.store.insertMessage(message);
          task.remaining--;
          budget--;

          const counts = added.get(task.folderId) ?? { total: 0, unread: 0 };
          counts.total++;
          if (!message.isRead) counts.unread++;
          added.set(task.folderId, counts);
        }
        if (budget === 0) break;
      }
      // Counting the rows again would get slower with every batch, so add up what was inserted.
      for (const [folderId, counts] of added) {
        this.store.addToFolderCounts(folderId, counts.total, counts.unread);
      }
    });
    return added.size > 0 ? [...added.keys()] : null;
  }

  private person(): Address {
    const first = this.random.pick(FIRST_NAMES);
    const last = this.random.pick(LAST_NAMES);
    const domain = this.random.pick(COMPANY_DOMAINS);
    return {
      name: `${first} ${last}`,
      address: `${first}.${last}@${domain}`.toLowerCase(),
    };
  }

  private preview(): string {
    const count = 1 + this.random.int(2);
    return Array.from({ length: count }, () => this.random.pick(SENTENCES)).join(' ');
  }

  private createMessage(task: Task): NewMessage {
    const random = this.random;
    task.cursor -= Math.round(random.next() * 2 * task.averageGap) + 1000;
    const position = task.position++;
    const outgoing = task.role === 'sent' || task.role === 'drafts';

    let from: Address;
    let subject: string;
    let isFocused = true;
    const kind = random.next();
    if (outgoing) {
      from = task.owner;
      subject = random.pick(kind < 0.7 ? WORK_SUBJECTS : PERSONAL_SUBJECTS);
    } else if (task.role === 'junk') {
      from = { ...this.person(), name: random.pick(NEWSLETTERS).name };
      subject = random.pick(JUNK_SUBJECTS);
    } else if (kind < 0.45) {
      from = this.person();
      subject = random.pick(WORK_SUBJECTS);
    } else if (kind < 0.65) {
      from = random.pick(SERVICES);
      subject = random.pick(SERVICE_SUBJECTS);
      isFocused = false;
    } else if (kind < 0.8) {
      from = random.pick(NEWSLETTERS);
      subject = random.pick(NEWSLETTER_SUBJECTS);
      isFocused = false;
    } else {
      from = this.person();
      subject = random.pick(PERSONAL_SUBJECTS);
    }

    // Some messages answer an earlier one. Walking back in time, the answer comes first.
    let threadId: number;
    const earlier = task.recentThreads.length > 0 && isFocused && random.chance(0.3);
    if (earlier) {
      const thread = random.pick(task.recentThreads);
      threadId = thread.id;
      subject = thread.subject;
    } else {
      threadId = this.store.insertThread(task.accountId);
      if (isFocused && random.chance(0.4)) {
        task.recentThreads.push({ id: threadId, subject });
        if (task.recentThreads.length > 40) task.recentThreads.shift();
        subject = `RE: ${subject}`;
      }
    }

    const unreadChance =
      task.role === 'junk' ? 0.6 : task.role === 'inbox' ? (position < 40 ? 0.55 : 0.04) : 0;
    return {
      accountId: task.accountId,
      folderId: task.folderId,
      threadId,
      subject,
      preview: this.preview(),
      from,
      to: outgoing ? [this.person()] : [task.owner],
      cc: random.chance(0.15) ? [this.person()] : [],
      receivedAt: task.cursor,
      isRead: !random.chance(unreadChance),
      isFlagged: random.chance(0.03),
      isFocused,
      hasAttachments: random.chance(0.14),
      importance: random.chance(0.03) ? 'high' : random.chance(0.01) ? 'low' : 'normal',
    };
  }
}
