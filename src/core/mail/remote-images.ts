const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_CACHE = 48 * 1024 * 1024;
const TIMEOUT = 15_000;
const PARALLEL = 6;
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)\b/i;

export interface LoadedImage {
  contentType: string;
  data: Uint8Array;
}

// Fetches one picture without cookies. Before it follows a redirect it has to ask allowRedirect.
// Returns null for everything that is not a complete answer within the limits.
export type ImageLoader = (
  url: string,
  options: { maxBytes: number; timeoutMs: number; allowRedirect(url: string): boolean },
) => Promise<LoadedImage | null>;

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

// A mail must not make the app send requests into the user's own network, for example to the
// router. This check sees addresses only: a public name that points to a private address passes.
export function isPublicHttpUrl(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
    if (mapped) return !isPrivateIpv4(mapped);
    // Loopback, unspecified, unique local (fc00::/7), link local (fe80::/10), mapped in hex.
    return !/^(::1?$|f[cd]|fe[89ab]|::ffff:)/.test(ip);
  }
  if (/^\d+(\.\d+){3}$/.test(host)) return !isPrivateIpv4(host);
  // Without a dot it is a name of the local network. A number alone is an address in disguise.
  if (!host.includes('.') || /^(0x[0-9a-f]+|\d+)$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/.test(host);
}

// Pictures that mails link to on the internet. They are only fetched when the user asks for it,
// and kept in memory for a while so the same mail does not ask the sender's server twice.
export class RemoteImages {
  private readonly cache = new Map<string, string>();
  private cacheSize = 0;

  constructor(private readonly load: ImageLoader) {}

  async fetch(urls: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const queue = [...new Set(urls)].filter(isPublicHttpUrl);
    const worker = async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        const image = this.cache.get(url) ?? (await this.fetchOne(url));
        if (image) result[url] = image;
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return result;
  }

  private async fetchOne(url: string): Promise<string | null> {
    let loaded: LoadedImage | null;
    try {
      loaded = await this.load(url, {
        maxBytes: MAX_IMAGE,
        timeoutMs: TIMEOUT,
        allowRedirect: isPublicHttpUrl,
      });
    } catch {
      return null;
    }
    const type = IMAGE_TYPES.exec(loaded?.contentType.trim() ?? '')?.[0];
    if (!loaded || !type || loaded.data.byteLength > MAX_IMAGE) return null;

    const dataUrl = `data:${type.toLowerCase()};base64,${Buffer.from(loaded.data).toString('base64')}`;
    this.cache.set(url, dataUrl);
    this.cacheSize += dataUrl.length;
    // The oldest entries leave first.
    for (const [key, value] of this.cache) {
      if (this.cacheSize <= MAX_CACHE) break;
      this.cache.delete(key);
      this.cacheSize -= value.length;
    }
    return dataUrl;
  }
}
