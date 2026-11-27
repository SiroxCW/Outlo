const MAX_TERMS = 10;

// Turns what the user typed into an FTS5 query: every word must match, as a prefix.
// Quoting each word keeps FTS5 operators and syntax characters in the input harmless.
export function toFtsQuery(input: string): string | null {
  const terms = input.match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_TERMS);
  if (!terms?.length) return null;
  return terms.map((term) => `"${term}"*`).join(' ');
}
