import { describe, expect, it } from 'vitest';
import { toFtsTerms } from './fts-query';

describe('toFtsTerms', () => {
  it('makes one prefix query per word', () => {
    expect(toFtsTerms('quarterly rep')).toEqual(['"quarterly"*', '"rep"*']);
  });

  it('splits addresses and punctuation the way the index does', () => {
    expect(toFtsTerms('anna.berg@example.com')).toEqual([
      '"anna"*',
      '"berg"*',
      '"example"*',
      '"com"*',
    ]);
  });

  it('keeps letters of other languages', () => {
    expect(toFtsTerms('Grüße aus Zürich')).toEqual(['"Grüße"*', '"aus"*', '"Zürich"*']);
  });

  it('makes operators and quotes harmless', () => {
    expect(toFtsTerms('budget" OR subject:* NEAR(')).toEqual([
      '"budget"*',
      '"OR"*',
      '"subject"*',
      '"NEAR"*',
    ]);
  });

  it('returns nothing when nothing searchable is left', () => {
    expect(toFtsTerms('')).toEqual([]);
    expect(toFtsTerms('  "*" -- ')).toEqual([]);
  });

  it('limits the number of words', () => {
    expect(toFtsTerms(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '))).toHaveLength(10);
  });
});
