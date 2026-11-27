import { describe, expect, it } from 'vitest';
import { toFtsQuery } from './fts-query';

describe('toFtsQuery', () => {
  it('requires every word, each as a prefix', () => {
    expect(toFtsQuery('quarterly rep')).toBe('"quarterly"* "rep"*');
  });

  it('splits addresses and punctuation the way the index does', () => {
    expect(toFtsQuery('anna.berg@example.com')).toBe('"anna"* "berg"* "example"* "com"*');
  });

  it('keeps letters of other languages', () => {
    expect(toFtsQuery('Grüße aus Zürich')).toBe('"Grüße"* "aus"* "Zürich"*');
  });

  it('makes operators and quotes harmless', () => {
    expect(toFtsQuery('budget" OR subject:* NEAR(')).toBe('"budget"* "OR"* "subject"* "NEAR"*');
  });

  it('returns null when nothing searchable is left', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('  "*" -- ')).toBeNull();
  });

  it('limits the number of words', () => {
    const query = toFtsQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '));
    expect(query?.split(' ')).toHaveLength(10);
  });
});
