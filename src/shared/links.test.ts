import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './links';

describe('isSafeExternalUrl', () => {
  it.each(['https://example.com/a?b=c', 'http://example.com', 'mailto:someone@example.com'])(
    'allows %s',
    (url) => {
      expect(isSafeExternalUrl(url)).toBe(true);
    },
  );

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'app://outlo/index.html',
    'not a url',
    '',
  ])('blocks %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});
