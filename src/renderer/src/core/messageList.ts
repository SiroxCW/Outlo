import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { MessageFilter, MessageSummary } from '@shared/api';
import { createDateGroups } from '../mail/dateGroups';
import type { ListGroup } from '../mail/listLayout';
import { t } from '../i18n';
import { useCoreEvents } from './events';

const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 40;

interface Page {
  version: number;
  messages: MessageSummary[];
}

export interface MessageListState {
  groups: ListGroup[];
  total: number;
  loaded: boolean;
  // The moment the groups were counted. Rows format their time relative to it.
  now: Date;
}

// Holds the part of a folder that is on screen. The list can be any length, because only the
// pages around the visible rows are fetched and kept.
export class MessageListSource {
  private state: MessageListState = { groups: [], total: 0, loaded: false, now: new Date() };
  private version = 0;
  private readonly pages = new Map<number, Page>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly folderId: number,
    readonly filter: MessageFilter,
  ) {
    this.refresh();
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
    const dateGroups = createDateGroups(now);
    window.outlo
      .request('messages.countByTime', {
        folderId: this.folderId,
        filter: this.filter,
        boundaries: dateGroups.map((group) => group.start),
      })
      .then((counts) => {
        if (version !== this.version) return;
        let offset = 0;
        const groups = dateGroups.map((group, index) => {
          const count = counts[index] ?? 0;
          const entry: ListGroup = {
            key: group.key,
            label: 'key' in group.label ? t(group.label.key) : group.label.text,
            count,
            offset,
          };
          offset += count;
          return entry;
        });
        this.state = { groups, total: offset, loaded: true, now };
        this.notify();
      })
      .catch(() => undefined);
  }

  // Returns the message at a position if it is loaded, and fetches its page if not.
  get(offset: number): MessageSummary | undefined {
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
      .request('messages.list', {
        folderId: this.folderId,
        filter: this.filter,
        offset: pageIndex * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
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

export function useMessageList(folderId: number | undefined, filter: MessageFilter) {
  const source = useMemo(
    () => (folderId === undefined ? undefined : new MessageListSource(folderId, filter)),
    [folderId, filter],
  );
  const state = useSyncExternalStore(
    source?.subscribe ?? (() => () => undefined),
    source?.getState ?? (() => undefined),
  );

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
