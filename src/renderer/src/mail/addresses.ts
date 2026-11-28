import type { Address } from '@shared/api';

const VALID = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function isValidAddress(address: string): boolean {
  return VALID.test(address);
}

// Addresses as people type or paste them: "Name <address>" or the address alone, separated by
// semicolons, commas or lines. A comma in quotes, as in "Berg, Anna", belongs to the name.
export function parseAddresses(text: string): Address[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let bracket = false;
  for (const char of text) {
    if (char === '"' && !bracket) quoted = !quoted;
    else if (char === '<' && !quoted) bracket = true;
    else if (char === '>' && !quoted) bracket = false;
    if (!quoted && !bracket && (char === ';' || char === ',' || char === '\n')) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const named = /^(.*?)\s*<([^<>]+)>$/.exec(part);
      if (!named) return { name: '', address: part };
      return { name: named[1]!.replace(/^"|"$/g, '').trim(), address: named[2]!.trim() };
    });
}

// Whether a typed separator ends the address, or belongs to a name in quotes.
export function endsAddress(text: string): boolean {
  return (text.match(/"/g) ?? []).length % 2 === 0;
}
