import type { TextKey } from '../i18n';

export interface DateGroup {
  key: string;
  // Either a text key or a ready label, for the names of weekdays.
  label: { key: TextKey } | { text: string };
  // Messages received at or after this time belong to the group, if no newer group takes them.
  start: number;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// The groups Outlook uses for a list sorted by date, newest first. The week starts on Sunday.
export function createDateGroups(now: Date): DateGroup[] {
  const today = startOfDay(now);
  const weekStart = addDays(today, -today.getDay());
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

  const groups: DateGroup[] = [
    { key: 'today', label: { key: 'group.today' }, start: today.getTime() },
    { key: 'yesterday', label: { key: 'group.yesterday' }, start: addDays(today, -1).getTime() },
  ];
  for (let day = addDays(today, -2); day >= weekStart; day = addDays(day, -1)) {
    groups.push({
      key: `day-${day.getDay()}`,
      label: { text: weekday.format(day) },
      start: day.getTime(),
    });
  }
  groups.push(
    { key: 'lastWeek', label: { key: 'group.lastWeek' }, start: addDays(weekStart, -7).getTime() },
    {
      key: 'twoWeeksAgo',
      label: { key: 'group.twoWeeksAgo' },
      start: addDays(weekStart, -14).getTime(),
    },
    {
      key: 'threeWeeksAgo',
      label: { key: 'group.threeWeeksAgo' },
      start: addDays(weekStart, -21).getTime(),
    },
    {
      key: 'earlierThisMonth',
      label: { key: 'group.earlierThisMonth' },
      start: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
    },
    {
      key: 'lastMonth',
      label: { key: 'group.lastMonth' },
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(),
    },
    { key: 'older', label: { key: 'group.older' }, start: 0 },
  );

  // A group that would start later than the one before it covers no time at all. Drop it.
  return groups.filter((group, index) => index === 0 || group.start < groups[index - 1]!.start);
}
