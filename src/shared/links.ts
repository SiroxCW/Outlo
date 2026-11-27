const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// Only these may be handed to the system. Anything else (file:, javascript:, custom schemes) is dropped.
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
