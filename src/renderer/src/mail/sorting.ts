import type { ListFilter, MessageSort, SortField } from '@shared/api';
import { t, type TextKey } from '../i18n';

export const LIST_FILTERS: readonly ListFilter[] = ['all', 'unread', 'flagged', 'toMe', 'hasFiles'];
export const SORT_FIELDS: readonly SortField[] = ['date', 'from', 'subject', 'importance', 'flag'];

export const FILTER_LABELS: Record<ListFilter, TextKey> = {
  all: 'filter.all',
  unread: 'filter.unread',
  flagged: 'filter.flagged',
  toMe: 'filter.toMe',
  hasFiles: 'filter.hasFiles',
};

export const SORT_LABELS: Record<SortField, TextKey> = {
  date: 'sort.date',
  from: 'sort.from',
  subject: 'sort.subject',
  importance: 'sort.importance',
  flag: 'sort.flag',
};

type Order = 'descending' | 'ascending';

// The two ways a field can run, the one it starts with first, as in Outlook.
export const ORDERS: Record<SortField, [Order, TextKey][]> = {
  date: [
    ['descending', 'sort.newest'],
    ['ascending', 'sort.oldest'],
  ],
  from: [
    ['ascending', 'sort.aToZ'],
    ['descending', 'sort.zToA'],
  ],
  subject: [
    ['ascending', 'sort.aToZ'],
    ['descending', 'sort.zToA'],
  ],
  importance: [
    ['descending', 'sort.highOnTop'],
    ['ascending', 'sort.lowOnTop'],
  ],
  flag: [
    ['descending', 'sort.flaggedOnTop'],
    ['ascending', 'sort.unflaggedOnTop'],
  ],
};

export const DEFAULT_SORT: MessageSort = { field: 'date', descending: true };

// A field as it starts out when the user picks it.
export function sortBy(field: SortField): MessageSort {
  return { field, descending: ORDERS[field][0]![0] === 'descending' };
}

// Sorts are stored as text in the settings, like "from:asc". Anything unknown means the default.
export function parseSort(value: string): MessageSort {
  const [field, order, ...rest] = value.split(':');
  const known = SORT_FIELDS.includes(field as SortField) && (order === 'asc' || order === 'desc');
  if (!known || rest.length > 0) {
    return DEFAULT_SORT;
  }
  return { field: field as SortField, descending: order === 'desc' };
}

export function formatSort(sort: MessageSort): string {
  return `${sort.field}:${sort.descending ? 'desc' : 'asc'}`;
}

const VALUE_LABELS: Record<string, TextKey> = {
  high: 'group.high',
  normal: 'group.normal',
  low: 'group.low',
  flagged: 'group.flagged',
  unflagged: 'group.unflagged',
};

// The heading of a group in a list that is sorted by anything but date.
export function groupLabel(field: SortField, value: string): string {
  if (field === 'importance' || field === 'flag') {
    const key = VALUE_LABELS[value];
    return key ? t(key) : value;
  }
  if (value.trim() !== '') return value;
  return t(field === 'subject' ? 'group.noSubject' : 'group.noSender');
}
