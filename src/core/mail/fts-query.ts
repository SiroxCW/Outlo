const MAX_TERMS = 10;

// Turns what the user typed into FTS5 queries, one per word, each matching as a prefix.
// Quoting each word keeps FTS5 operators and syntax characters in the input harmless.
export function toFtsTerms(input: string): string[] {
  const terms = input.match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_TERMS) ?? [];
  return terms.map((term) => `"${term}"*`);
}
