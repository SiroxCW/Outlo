import type { Address, DraftKind, MessageBody } from '@shared/api';
import { htmlToText } from './text';

// How drafts are put together: their subject, recipients and quote when they answer or forward a
// message, and the HTML that goes to the provider. The words are English, like the rest of the
// app for now.

const PREFIXES: Record<Exclude<DraftKind, 'new'>, { add: string; known: RegExp }> = {
  reply: { add: 'RE: ', known: /^re:/i },
  replyAll: { add: 'RE: ', known: /^re:/i },
  forward: { add: 'FW: ', known: /^(fw|fwd):/i },
};
const PREVIEW_LENGTH = 255;
// The look of the text the user writes, as Outlook sends it.
const TEXT_STYLE = 'font-family: Aptos, Calibri, Helvetica, sans-serif; font-size: 12pt;';

export interface QuotedMessage {
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  receivedAt: number;
}

// As in Outlook, a prefix that is there already is not added again.
export function responseSubject(kind: Exclude<DraftKind, 'new'>, subject: string): string {
  const prefix = PREFIXES[kind];
  return prefix.known.test(subject.trim()) ? subject : prefix.add + subject;
}

const same = (a: Address, b: string) => a.address.toLowerCase() === b.toLowerCase();

// Who a reply goes to. A reply to the user's own message goes to the people it went to.
export function responseRecipients(
  kind: Exclude<DraftKind, 'new'>,
  source: QuotedMessage,
  ownAddress: string,
): { to: Address[]; cc: Address[] } {
  if (kind === 'forward') return { to: [], cc: [] };
  const fromMe = same(source.from, ownAddress);
  if (kind === 'reply') return { to: fromMe ? source.to : [source.from], cc: [] };
  const seen = new Set<string>();
  const keep = (list: Address[]) =>
    list.filter((entry) => {
      const key = entry.address.toLowerCase();
      if (!key || seen.has(key) || same(entry, ownAddress)) return false;
      seen.add(key);
      return true;
    });
  const to = keep(fromMe ? source.to : [source.from, ...source.to]);
  return { to: fromMe && to.length === 0 ? [source.from] : to, cc: keep(source.cc) };
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatPeople(list: Address[]): string {
  return list
    .map((entry) => (entry.name ? `${entry.name} <${entry.address}>` : entry.address))
    .join('; ');
}

function formatSent(time: number): string {
  const date = new Date(time);
  const day = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${day} ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

// The inside of the body of an HTML mail, with the styles from its head, which its classes need.
function innerHtml(html: string): string {
  const head = /<head[\s>][\s\S]*?<\/head>/i.exec(html)?.[0] ?? '';
  const styles = head.match(/<style[\s>][\s\S]*?<\/style>/gi) ?? [];
  const body = /<body[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(html);
  return styles.join('') + (body ? body[1]! : html.replace(/<\/?(html|head)[^>]*>/gi, ''));
}

// The earlier message below a reply or forward, as Outlook writes it: a line, who wrote it to
// whom and when, and the message. Without a stored text its beginning has to do.
export function buildQuote(
  source: QuotedMessage,
  body: MessageBody | null,
  preview: string,
): string {
  const line = (label: string, value: string) => `<b>${label}:</b> ${escapeHtml(value)}<br>`;
  const header =
    line('From', formatPeople([source.from])) +
    line('Sent', formatSent(source.receivedAt)) +
    line('To', formatPeople(source.to)) +
    (source.cc.length > 0 ? line('Cc', formatPeople(source.cc)) : '') +
    `<b>Subject:</b> ${escapeHtml(source.subject)}`;
  const content =
    body?.contentType === 'html'
      ? innerHtml(body.content)
      : escapeHtml(body?.content ?? preview).replace(/\r?\n/g, '<br>');
  return (
    '<hr style="display:inline-block;width:98%" tabindex="-1">' +
    '<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" ' +
    `color="#000000">${header}</font><div>&nbsp;</div></div><div>${content}</div>`
  );
}

// The editor writes paragraphs without spacing in between, and an empty one for an empty line.
// Mail programs give paragraphs a margin and let empty ones collapse, so both are made explicit.
function mailParagraphs(text: string): string {
  return text.replace(/<p>/g, '<p style="margin: 0">').replace(/(<p[^>]*>)<\/p>/g, '$1<br></p>');
}

// The whole body as it goes to the provider.
export function draftHtml(text: string, quote: string): string {
  return (
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>' +
    `<body><div style="${TEXT_STYLE}">${mailParagraphs(text)}</div>` +
    (quote ? `<br>${quote}` : '') +
    '</body></html>'
  );
}

// The beginning of the text, for the list. The provider makes its own when it has the draft.
export function draftPreview(text: string, quote: string): string {
  const kept = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
  const signs = ['&', '<', '>', '"', "'"];
  // The few signs the editor writes as entities are kept through the conversion to text.
  const marked = (text + '\n' + quote).replace(/&(amp|lt|gt|quot|#39);/g, (entity) =>
    String.fromCharCode(0xe000 + kept.indexOf(entity)),
  );
  return htmlToText(marked)
    .replace(/[-]/g, (sign) => signs[sign.charCodeAt(0) - 0xe000]!)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_LENGTH);
}
