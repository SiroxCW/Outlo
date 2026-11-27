import { en, type TextKey } from './en';

// Every text of the interface goes through this function, so other languages can be added later.
export function t(key: TextKey): string {
  return en[key];
}

export type { TextKey };
