import type { Address } from '@shared/api';

const LOCALE = 'en-US';
const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const weekdayAndDate = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
});
const date = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'numeric', day: 'numeric' });
const full = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const DAY = 24 * 60 * 60 * 1000;

// Short form for the message list: the time for today, the day for the last week, else the date.
export function formatListTime(timestamp: number, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= today) return time.format(timestamp);
  if (timestamp >= today - 6 * DAY) return weekdayAndDate.format(timestamp).replace(',', '');
  return date.format(timestamp);
}

export function formatFullDate(timestamp: number): string {
  return full.format(timestamp).replaceAll(',', '');
}

export function formatAddresses(addresses: Address[]): string {
  return addresses.map((address) => address.name || address.address).join('; ');
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
