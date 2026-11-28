import { describe, expect, it } from 'vitest';
import { createDateGroups } from './dateGroups';
import { conversationTopic, formatListTime, formatSize } from './format';
import { createListLayout, expandRow, type ListGroup } from './listLayout';
import { DEFAULT_SORT, formatSort, groupLabel, parseSort, sortBy } from './sorting';

const at = (year: number, month: number, day: number, hour = 0) =>
  new Date(year, month - 1, day, hour).getTime();

describe('createDateGroups', () => {
  // Friday, 27 November 2026.
  const groups = createDateGroups(new Date(2026, 10, 27, 15, 30));
  const keys = groups.map((group) => group.key);

  it('starts with today and yesterday, then the earlier days of the week', () => {
    expect(keys.slice(0, 7)).toEqual([
      'today',
      'yesterday',
      'day-3',
      'day-2',
      'day-1',
      'day-0',
      'lastWeek',
    ]);
    expect(groups[0]!.start).toBe(at(2026, 11, 27));
    expect(groups[2]!.label).toEqual({ text: 'Wednesday' });
    expect(groups[5]!.start).toBe(at(2026, 11, 22));
  });

  it('continues with the weeks before and ends with older', () => {
    expect(keys.slice(6)).toEqual([
      'lastWeek',
      'twoWeeksAgo',
      'threeWeeksAgo',
      'lastMonth',
      'older',
    ]);
    expect(groups.find((group) => group.key === 'lastWeek')!.start).toBe(at(2026, 11, 15));
    expect(groups.at(-1)!.start).toBe(0);
  });

  it('never lets a group start later than the one before', () => {
    for (let day = 1; day <= 60; day++) {
      const starts = createDateGroups(new Date(2026, 0, day, 12)).map((group) => group.start);
      expect(starts).toEqual([...starts].sort((a, b) => b - a));
      expect(new Set(starts).size).toBe(starts.length);
    }
  });

  it('has no weekday groups on a Sunday and Monday', () => {
    const sunday = createDateGroups(new Date(2026, 10, 22, 9)).map((group) => group.key);
    expect(sunday.slice(0, 3)).toEqual(['today', 'yesterday', 'lastWeek']);
    const monday = createDateGroups(new Date(2026, 10, 23, 9)).map((group) => group.key);
    expect(monday.slice(0, 3)).toEqual(['today', 'yesterday', 'lastWeek']);
  });

  it('adds "earlier this month" late in a month', () => {
    const late = createDateGroups(new Date(2026, 10, 30, 9)).map((group) => group.key);
    expect(late).toContain('earlierThisMonth');
  });
});

describe('createListLayout', () => {
  const groups: ListGroup[] = [
    { key: 'a', label: 'A', count: 2, offset: 0 },
    { key: 'empty', label: 'Empty', count: 0, offset: 2 },
    { key: 'b', label: 'B', count: 3, offset: 2 },
  ];

  it('puts a header before the messages of every group that has some', () => {
    const layout = createListLayout(groups, new Set());
    expect(layout.rowCount).toBe(7);
    const rows = Array.from({ length: 7 }, (_, index) => layout.rowAt(index));
    expect(rows.map((row) => (row.kind === 'header' ? row.group.key : row.offset))).toEqual([
      'a',
      0,
      1,
      'b',
      2,
      3,
      4,
    ]);
  });

  it('hides the messages of a collapsed group but keeps its header', () => {
    const layout = createListLayout(groups, new Set(['a']));
    expect(layout.rowCount).toBe(5);
    expect(layout.rowAt(0)).toMatchObject({ kind: 'header' });
    expect(layout.rowAt(1)).toMatchObject({ kind: 'header', group: { key: 'b' } });
    expect(layout.rowAt(2)).toMatchObject({ kind: 'message', offset: 2 });
  });

  it('finds the row of a message', () => {
    const layout = createListLayout(groups, new Set());
    expect(layout.rowOfOffset(0)).toBe(1);
    expect(layout.rowOfOffset(4)).toBe(6);
    expect(layout.rowOfOffset(5)).toBeNull();
    expect(createListLayout(groups, new Set(['b'])).rowOfOffset(3)).toBeNull();
  });

  it('puts the messages of an open conversation below its row', () => {
    const layout = expandRow(createListLayout(groups, new Set()), 2, 2);
    expect(layout.rowCount).toBe(9);
    const rows = Array.from({ length: 9 }, (_, index) => layout.rowAt(index));
    expect(
      rows.map((row) =>
        row.kind === 'header' ? row.group.key : row.kind === 'child' ? `c${row.index}` : row.offset,
      ),
    ).toEqual(['a', 0, 1, 'b', 2, 'c0', 'c1', 3, 4]);
    expect(rows[5]).toMatchObject({ kind: 'child', offset: 2, group: { key: 'b' } });
    expect(layout.rowOfOffset(1)).toBe(2);
    expect(layout.rowOfOffset(2)).toBe(4);
    expect(layout.rowOfOffset(3)).toBe(7);
  });

  it('leaves the list as it is when the open conversation is not shown', () => {
    const plain = createListLayout(groups, new Set(['b']));
    expect(expandRow(plain, 3, 4)).toBe(plain);
    expect(expandRow(plain, 0, 0)).toBe(plain);
  });

  it('handles a very long list without building it', () => {
    const big = createListLayout(
      [{ key: 'x', label: 'X', count: 5_000_000, offset: 0 }],
      new Set(),
    );
    expect(big.rowCount).toBe(5_000_001);
    expect(big.rowAt(4_999_999)).toMatchObject({ kind: 'message', offset: 4_999_998 });
  });

  it('is empty without messages', () => {
    expect(createListLayout([], new Set()).rowCount).toBe(0);
  });
});

describe('formatListTime', () => {
  const now = new Date(2026, 10, 27, 15, 30);

  it('shows the time for today', () => {
    expect(formatListTime(at(2026, 11, 27, 9), now)).toMatch(/^9:00\sAM$/);
  });

  it('shows weekday and date for the last days', () => {
    expect(formatListTime(at(2026, 11, 25, 9), now)).toBe('Wed 11/25');
  });

  it('shows the full date for older messages', () => {
    expect(formatListTime(at(2026, 10, 2, 9), now)).toBe('10/2/2026');
  });
});

describe('formatSize', () => {
  it('uses the fitting unit', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(20_480)).toBe('20 KB');
    expect(formatSize(3_145_728)).toBe('3.0 MB');
  });
});

describe('sorting', () => {
  it('stores a sort as text and reads it back', () => {
    const sort = { field: 'subject', descending: false } as const;
    expect(parseSort(formatSort(sort))).toEqual(sort);
    expect(parseSort(formatSort(DEFAULT_SORT))).toEqual(DEFAULT_SORT);
  });

  it('falls back to newest first for anything it does not know', () => {
    for (const value of ['', 'size:desc', 'date', 'date:up', 'from:asc:extra']) {
      expect(parseSort(value)).toEqual(DEFAULT_SORT);
    }
  });

  it('starts names at A and the rest with the most important on top', () => {
    expect(sortBy('from')).toEqual({ field: 'from', descending: false });
    expect(sortBy('subject').descending).toBe(false);
    expect(sortBy('date').descending).toBe(true);
    expect(sortBy('importance').descending).toBe(true);
    expect(sortBy('flag').descending).toBe(true);
  });

  it('names the groups, also the empty ones', () => {
    expect(groupLabel('from', 'Anna Berg')).toBe('Anna Berg');
    expect(groupLabel('from', '')).toBe('(No sender)');
    expect(groupLabel('subject', '  ')).toBe('(No subject)');
    expect(groupLabel('importance', 'high')).toBe('High importance');
    expect(groupLabel('flag', 'unflagged')).toBe('Not flagged');
  });
});

describe('conversationTopic', () => {
  it('takes away the prefixes of answers and forwards, also several and in other languages', () => {
    expect(conversationTopic('RE: Budget')).toBe('Budget');
    expect(conversationTopic('Re: FW: re[2]: Budget')).toBe('Budget');
    expect(conversationTopic('AW: WG: Angebot')).toBe('Angebot');
    expect(conversationTopic('  Fwd:Plans ')).toBe('Plans');
  });

  it('leaves words alone that only start like a prefix', () => {
    expect(conversationTopic('Review: the plan')).toBe('Review: the plan');
    expect(conversationTopic('Reminder')).toBe('Reminder');
    expect(conversationTopic('')).toBe('');
  });
});
