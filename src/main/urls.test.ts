import { describe, expect, it } from 'vitest';
import { isSameSite, resolveAppFile } from './urls';

const ROOT = '/opt/outlo/renderer';

describe('resolveAppFile', () => {
  it('serves index.html for the root address', () => {
    expect(resolveAppFile(ROOT, 'app://outlo/')).toBe(`${ROOT}/index.html`);
  });

  it('maps a path to a file below the root', () => {
    expect(resolveAppFile(ROOT, 'app://outlo/assets/index-abc.js?v=1#x')).toBe(
      `${ROOT}/assets/index-abc.js`,
    );
  });

  it('decodes escaped characters in file names', () => {
    expect(resolveAppFile(ROOT, 'app://outlo/assets/a%20b.png')).toBe(`${ROOT}/assets/a b.png`);
  });

  it.each([
    'app://outlo/../../etc/passwd',
    'app://outlo/%2e%2e/%2e%2e/etc/passwd',
    'app://outlo/..%2f..%2fetc/passwd',
    'app://outlo/assets/..%2f..%2f..%2fetc/passwd',
    'app://outlo/%00',
    'app://outlo/%E0%A4%A',
  ])('never leaves the root: %s', (url) => {
    const file = resolveAppFile(ROOT, url);
    expect(file === null || file.startsWith(`${ROOT}/`)).toBe(true);
  });

  it.each(['app://other/index.html', 'file:///etc/passwd', 'https://outlo/index.html', 'nonsense'])(
    'rejects addresses of other sites: %s',
    (url) => {
      expect(resolveAppFile(ROOT, url)).toBeNull();
    },
  );
});

describe('isSameSite', () => {
  it('accepts another page of the same site', () => {
    expect(isSameSite('app://outlo/settings.html', 'app://outlo/index.html')).toBe(true);
    expect(isSameSite('http://localhost:5173/src/x.ts', 'http://localhost:5173')).toBe(true);
  });

  it('rejects another host, port or scheme', () => {
    expect(isSameSite('app://evil/index.html', 'app://outlo/index.html')).toBe(false);
    expect(isSameSite('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isSameSite('https://outlo/index.html', 'app://outlo/index.html')).toBe(false);
    expect(isSameSite('not a url', 'app://outlo/index.html')).toBe(false);
  });
});
