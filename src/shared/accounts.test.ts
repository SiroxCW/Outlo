import { describe, expect, it } from 'vitest';
import { guessWebAccountKind } from './accounts';

describe('guessWebAccountKind', () => {
  it.each([
    'ann@outlook.com',
    'ann@OUTLOOK.de',
    'ann@hotmail.co.uk',
    'ann@live.at',
    'ann@msn.com',
    ' ann@outlook.com ',
  ])('takes %j for a personal account', (email) =>
    expect(guessWebAccountKind(email)).toBe('personal'),
  );

  it.each([
    'ann@company.example',
    'ann@outlook.company.example',
    'ann@notoutlook.com',
    'ann@university.edu',
    'ann@proton.me',
    '',
  ])('takes %j for a work or school account', (email) =>
    expect(guessWebAccountKind(email)).toBe('work'),
  );
});
