const BASE = [
  "default-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

// Fluent UI inserts its styles at runtime, which needs 'unsafe-inline' for styles.
export const CONTENT_SECURITY_POLICY = [
  ...BASE,
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join('; ');

// The Vite dev server adds an inline script and a websocket for hot reloading.
export const DEV_CONTENT_SECURITY_POLICY = [
  ...BASE,
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://localhost:*",
].join('; ');
