import DOMPurify from 'dompurify';
import type { InlineImage, MessageBody } from '@shared/api';
import { isSafeExternalUrl } from '@shared/links';

export interface PrepareOptions {
  inlineImages: InlineImage[];
  // Pictures from the internet that the user asked for, by address. Null: none were asked for.
  remoteImages: Record<string, string> | null;
  // Colours of the app, used for mail that brings no colours of its own.
  textColor: string;
  linkColor: string;
  dark: boolean;
}

export interface PreparedMail {
  // A complete page for the frame that shows the mail.
  page: string;
  // Addresses of pictures on the internet that were left out.
  remoteImages: string[];
  // Attachments that are shown inside the text.
  usedContentIds: string[];
}

// The frame gets no network at all. Pictures are only shown from data the app hands it.
const FRAME_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const EMBEDDED_IMAGE =
  /^data:image\/(png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon);base64,/i;

const FORBIDDEN_TAGS = [
  'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset', 'datalist',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'audio', 'video', 'source', 'track',
  'canvas', 'picture', 'dialog', 'link', 'meta', 'base', 'template', 'slot', 'noscript',
]; // prettier-ignore
const FORBIDDEN_ATTRIBUTES = [
  'srcset', 'sizes', 'ping', 'action', 'formaction', 'background', 'poster', 'autofocus',
  'contenteditable', 'tabindex', 'accesskey', 'id', 'name', 'usemap', 'ismap', 'loading',
]; // prettier-ignore

// What the current run of the cleaner needs. The cleaner works in one go, so one slot is enough.
let run: { inline: Map<string, string>; remote: Record<string, string> | null } | undefined;
let blocked = new Set<string>();
let used = new Set<string>();

function cleanLink(node: Element): void {
  const href = node.getAttribute('href');
  if (href === null) return;
  // Only complete web and mail addresses. They open in the system browser, never in the app.
  if (!isSafeExternalUrl(href)) {
    node.removeAttribute('href');
    return;
  }
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
  // Shows where a link really leads, whatever its text claims.
  node.setAttribute('title', href);
}

function cleanImage(node: Element): void {
  let source = node.getAttribute('src')?.trim() ?? '';
  if (source.startsWith('//')) source = `https:${source}`;

  if (/^cid:/i.test(source)) {
    let contentId = source.slice(4);
    try {
      contentId = decodeURIComponent(contentId);
    } catch {
      // Not encoded after all.
    }
    const picture = run?.inline.get(contentId);
    if (picture) {
      used.add(contentId);
      node.setAttribute('src', picture);
      return;
    }
  } else if (/^https?:/i.test(source)) {
    const picture = run?.remote?.[source];
    if (picture) {
      node.setAttribute('src', picture);
      return;
    }
    blocked.add(source);
  } else if (EMBEDDED_IMAGE.test(source)) {
    return;
  }
  node.removeAttribute('src');
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  if (node.tagName === 'A' || node.tagName === 'AREA') cleanLink(node);
  if (node.tagName === 'IMG') cleanImage(node);
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Plain text keeps its line breaks, and web addresses in it become links.
function textToHtml(text: string): string {
  const html = text
    .split(/(https?:\/\/[^\s<>"']+)/)
    .map((part, index) => {
      if (index % 2 === 0) return escapeHtml(part);
      // A full stop or bracket right after an address belongs to the sentence around it.
      const address = part.replace(/[.,;:!?)\]]+$/, '');
      const rest = escapeHtml(part.slice(address.length));
      return `<a href="${escapeHtml(address)}">${escapeHtml(address)}</a>${rest}`;
    })
    .join('');
  return `<div style="white-space: pre-wrap">${html}</div>`;
}

// Makes the text of a mail safe to show. Scripts, forms, frames and everything that could load
// from the network are removed. What is left goes into a frame that could not run or load them
// anyway: the cleaning and the frame each hold on their own.
export function prepareMail(body: MessageBody, options: PrepareOptions): PreparedMail {
  run = {
    inline: new Map(options.inlineImages.map((image) => [image.contentId, image.dataUrl])),
    remote: options.remoteImages,
  };
  blocked = new Set();
  used = new Set();

  const source = body.contentType === 'html' ? body.content : textToHtml(body.content);
  const root = DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  run = undefined;

  const mailBody = root.tagName === 'BODY' ? root : root.querySelector('body');
  const styles = [...root.querySelectorAll('head style')].map((style) => style.outerHTML);
  // Mail with colours of its own is shown on white, as its sender designed it. Everything else
  // follows the theme of the app.
  const ownColors =
    body.contentType === 'html' &&
    root.querySelector('style, [bgcolor], [color], [style*="color" i], [style*="background" i]') !==
      null;
  const text = ownColors ? '#242424' : options.textColor;
  const link = ownColors ? '#0f6cbd' : options.linkColor;
  const scheme = ownColors || !options.dark ? 'light' : 'dark';

  const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">
<base target="_blank">
<style>
  html { color-scheme: ${scheme}; scrollbar-width: thin; padding: 12px 24px 24px;
    background: ${ownColors ? '#ffffff' : 'transparent'}; }
  body { margin: 0; font: 14px/1.5 'Segoe UI', system-ui, sans-serif; color: ${text};
    overflow-wrap: anywhere; }
  a { color: ${link}; }
</style>
${styles.join('\n')}
</head>
${mailBody?.outerHTML ?? '<body></body>'}
</html>`;

  return { page, remoteImages: [...blocked], usedContentIds: [...used] };
}
