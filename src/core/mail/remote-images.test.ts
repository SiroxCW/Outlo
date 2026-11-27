import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl, RemoteImages, type ImageLoader } from './remote-images';

describe('isPublicHttpUrl', () => {
  it.each([
    'https://example.com/a.png',
    'http://images.example.co.uk:8080/a.png?x=1&y=2',
    'https://8.8.8.8/pixel.gif',
    'https://[2001:4860:4860::8888]/a.png',
    'https://localhost.example.com/a.png',
  ])('allows %s', (url) => expect(isPublicHttpUrl(url)).toBe(true));

  it.each([
    'http://localhost/a.png',
    'http://LOCALHOST:8080/a.png',
    'http://printer/a.png',
    'http://router.local/a.png',
    'http://nas.lan/a.png',
    'http://server.internal/a.png',
    'http://something.localhost/a.png',
    'http://localhost./a.png',
    'http://127.0.0.1/a.png',
    'http://127.1/a.png',
    'http://2130706433/a.png',
    'http://0x7f000001/a.png',
    'http://0.0.0.0/a.png',
    'http://10.0.0.5/a.png',
    'http://172.16.0.1/a.png',
    'http://172.31.255.255/a.png',
    'http://192.168.1.1/admin?reboot=1',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/a.png',
    'http://224.0.0.1/a.png',
    'http://[::1]/a.png',
    'http://[::]/a.png',
    'http://[fe80::1]/a.png',
    'http://[fd00::1]/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
    'http://[::ffff:c0a8:101]/a.png',
    'http://user:password@example.com/a.png',
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('refuses %s', (url) => expect(isPublicHttpUrl(url)).toBe(false));
});

describe('RemoteImages', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  function setup(answer: ImageLoader = async () => ({ contentType: 'image/png', data: png })) {
    const asked: string[] = [];
    const images = new RemoteImages(async (url, options) => {
      asked.push(url);
      return answer(url, options);
    });
    return { images, asked };
  }

  it('returns pictures as data URLs', async () => {
    const { images } = setup();
    expect(await images.fetch(['https://example.com/a.png'])).toEqual({
      'https://example.com/a.png': 'data:image/png;base64,iVBORw==',
    });
  });

  it('never asks for addresses inside the own network', async () => {
    const { images, asked } = setup();
    const result = await images.fetch(['http://192.168.1.1/a.png', 'http://localhost/a.png']);
    expect(result).toEqual({});
    expect(asked).toEqual([]);
  });

  it('lets the loader follow redirects to public addresses only', async () => {
    const verdicts: boolean[] = [];
    const { images } = setup(async (_url, options) => {
      verdicts.push(options.allowRedirect('https://cdn.example.com/a.png'));
      verdicts.push(options.allowRedirect('http://127.0.0.1/a.png'));
      return null;
    });
    await images.fetch(['https://example.com/a.png']);
    expect(verdicts).toEqual([true, false]);
  });

  it('leaves out what is not a picture, is too large or fails', async () => {
    const { images } = setup(async (url) => {
      if (url.endsWith('html')) return { contentType: 'text/html', data: png };
      if (url.endsWith('svg')) return { contentType: 'image/svg+xml', data: png };
      if (url.endsWith('big')) return { contentType: 'image/png', data: new Uint8Array(6_000_000) };
      if (url.endsWith('down')) throw new Error('no connection');
      if (url.endsWith('none')) return null;
      return { contentType: 'image/jpeg; charset=binary', data: png };
    });
    const base = 'https://example.com/';
    const result = await images.fetch(
      ['html', 'svg', 'big', 'down', 'none', 'ok'].map((n) => base + n),
    );
    expect(Object.keys(result)).toEqual([`${base}ok`]);
    expect(result[`${base}ok`]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('asks the server only once for the same picture', async () => {
    const { images, asked } = setup();
    const url = 'https://example.com/a.png';
    await images.fetch([url, url]);
    await images.fetch([url]);
    expect(asked).toEqual([url]);
  });
});
