import { net } from 'electron';
import type { Fetch } from './graph/client';
import type { ImageLoader } from './mail/remote-images';

// Electron's network stack follows the proxy settings of the system. Node's own does not.
export const electronFetch: Fetch = (url, init) => net.fetch(url, init);

// Fetches a picture without cookies and asks before every redirect.
export const loadImage: ImageLoader = (url, options) =>
  new Promise((resolve) => {
    const request = net.request({ url, redirect: 'manual', credentials: 'omit' });
    const timer = setTimeout(() => stop(), options.timeoutMs);
    let settled = false;
    const finish = (result: Awaited<ReturnType<ImageLoader>>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const stop = () => {
      request.abort();
      finish(null);
    };

    request.on('redirect', (_status, _method, redirectUrl) => {
      if (options.allowRedirect(redirectUrl)) request.followRedirect();
      else stop();
    });
    request.on('response', (response) => {
      if (response.statusCode !== 200) return stop();
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > options.maxBytes) stop();
        else chunks.push(chunk);
      });
      response.on('end', () => {
        const type = response.headers['content-type'];
        finish({
          contentType: (Array.isArray(type) ? type[0] : type) ?? '',
          data: Buffer.concat(chunks),
        });
      });
      response.on('error', () => finish(null));
    });
    request.on('error', () => finish(null));
    request.end();
  });
