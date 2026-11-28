import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ListEntry, ListFilter, MessageFilter, MessageSort } from '@shared/api';
import { createDateGroups } from '../mail/dateGroups';
import type { ListGroup } from '../mail/listLayout';
import { groupLabel } from '../mail/sorting';
import { t } from '../i18n';
import { useCoreEvents } from './events';

const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 40;

interface Page {
  version: number;
  messages: ListEntry[];
}

export interface MessageListState {
  groups: ListGroup[];
  total: number;
  loaded: boolean;
  // The moment the groups were counted. Rows format their time relative to it.
  now: Date;
}

// How the user narrowed and ordered the list, with the Filter and Sort menus.
export interface ListView {
  show: ListFilter;
  sort: MessageSort;
  // One row per conversation, when sorted by date.
  conversations: boolean;
}

// Holds the part of a folder that is on screen. The list can be any length, because only the
// pages around the visible rows are fetched and kept.
export class MessageListSource {
  private state: MessageListState = { groups: [], total: 0, loaded: false, now: new Date() };
  private version = 0;
  private keepId: number | undefined;
  private readonly pages = new Map<number, Page>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly folderId: number,
    readonly filter: MessageFilter,
    readonly view: ListView,
  ) {
    this.refresh();
  }

  private get query() {
    return {
      folderId: this.folderId,
      filter: this.filter,
      show: this.view.show,
      sort: this.view.sort,
      conversations: this.view.conversations,
      ...(this.keepId === undefined ? {} : { keepId: this.keepId }),
    };
  }

  // The open message stays in a filtered list until another one is opened.
  keep(id: number | undefined): void {
    if (id === this.keepId) return;
    this.keepId = id;
    if (this.view.show !== 'all') this.refresh();
  }

  // Where a message is in the list, if its page is loaded and up to date.
  offsetOf(id: number): number | undefined {
    return this.find((message) => message.id === id);
  }

  // Where the row of a conversation is, under the same condition.
  offsetOfThread(threadId: number): number | undefined {
    return this.find((message) => message.threadId === threadId);
  }

  private find(test: (message: ListEntry) => boolean): number | undefined {
    for (const [pageIndex, page] of this.pages) {
      if (page.version !== this.version) continue;
      const index = page.messages.findIndex(test);
      if (index >= 0) return pageIndex * PAGE_SIZE + index;
    }
    return undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): MessageListState => this.state;

  private notify(): void {
    // A new object tells React that messages may have arrived, even when the counts are the same.
    this.state = { ...this.state };
    for (const listener of this.listeners) listener();
  }

  // Counts again and marks the pages as outdated. They stay visible until fresh ones arrive.
  refresh(): void {
    const version = ++this.version;
    const now = new Date();
    this.countGroups(now)
      .then((counted) => {
        if (version !== this.version) return;
        let offset = 0;
        const groups = counted.map((group) => {
          const entry: ListGroup = { ...group, offset };
          offset += group.count;
          return entry;
        });
        this.state = { groups, total: offset, loaded: true, now };
        this.notify();
      })
      .catch(() => undefined);
  }

  // A list sorted by date is grouped by day, any other by the value it is sorted by.
  private async countGroups(now: Date): Promise<Omit<ListGroup, 'offset'>[]> {
    const { field, descending } = this.view.sort;
    if (field !== 'date') {
      const groups = await window.outlo.request('messages.countByGroup', this.query);
      return groups.map((group) => ({
        key: `${field}:${group.value}`,
        label: groupLabel(field, group.value),
        count: group.count,
      }));
    }
    const dateGroups = createDateGroups(now);
    const counts = await window.outlo.request('messages.countByTime', {
      ...this.query,
      boundaries: dateGroups.map((group) => group.start),
    });
    const groups = dateGroups.map((group, index) => ({
      key: group.key,
      label: 'key' in group.label ? t(group.label.key) : group.label.text,
      count: counts[index] ?? 0,
    }));
    return descending ? groups : groups.reverse();
  }

  // Returns the message at a position if it is loaded, and fetches its page if not.
  get(offset: number): ListEntry | undefined {
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const page = this.pages.get(pageIndex);
    if (page?.version !== this.version) this.load(pageIndex);
    return page?.messages[offset - pageIndex * PAGE_SIZE];
  }

  private load(pageIndex: number): void {
    const version = this.version;
    const key = `${version}:${pageIndex}`;
    if (this.requested.has(key)) return;
    this.requested.add(key);

    window.outlo
      .request('messages.list', { ...this.query, offset: pageIndex * PAGE_SIZE, limit: PAGE_SIZE })
      .then((result) => {
        this.requested.delete(key);
        if (version !== this.version) return;
        this.pages.delete(pageIndex);
        this.pages.set(pageIndex, { version, messages: result.messages });
        // Map keeps insertion order, so the first key is the page that was loaded longest ago.
        while (this.pages.size > MAX_CACHED_PAGES) {
          this.pages.delete(this.pages.keys().next().value!);
        }
        this.notify();
      })
      .catch(() => this.requested.delete(key));
  }
}

export function useMessageList(
  folderId: number | undefined,
  filter: MessageFilter,
  { show, sort: { field, descending }, conversations }: ListView,
  openId: number | undefined,
) {
  const source = useMemo(
    () =>
      folderId === undefined
        ? undefined
        : new MessageListSource(folderId, filter, {
            show,
            sort: { field, descending },
            conversations,
          }),
    [folderId, filter, show, field, descending, conversations],
  );
  const state = useSyncExternalStore(
    source?.subscribe ?? (() => () => undefined),
    source?.getState ?? (() => undefined),
  );

  useEffect(() => source?.keep(openId), [source, openId]);

  useCoreEvents(
    (event) =>
      event.type === 'messages.changed' &&
      source !== undefined &&
      event.payload.folderIds.includes(source.folderId),
    () => source?.refresh(),
  );

  // The date groups depend on the day. Count again when the window comes back after a while.
  useEffect(() => {
    const onFocus = () => source?.refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [source]);

  return { source, state };
}
