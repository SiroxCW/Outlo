import type { MessageBody } from '@shared/api';

// Longer texts are cut. The start of a mail holds what people search for, and a few huge
// newsletters should not make up most of the index.
export const MAX_INDEXED_TEXT = 100_000;
const MAX_HTML = 1_000_000;

// Elements whose content the reader never sees.
const HIDDEN = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'xml']);
// Tags that end a line or a cell. Other tags, like <b>, can sit inside a word and vanish.
const BREAKS = new Set(
  'p div br hr li ul ol tr td th table tbody thead h1 h2 h3 h4 h5 h6 blockquote pre section article header footer address center'.split(
    ' ',
  ),
);

// Letters with a mark, like &auml;, are kept as their base letter. The index ignores the marks
// anyway, so "a" finds both.
const MARKED_LETTER = /^([a-zA-Z])(?:acute|grave|circ|uml|tilde|ring|cedil|slash|caron|macr)$/;
const LETTERS: Record<string, string> = {
  szlig: 'ß',
  aelig: 'æ',
  AElig: 'Æ',
  oelig: 'œ',
  OElig: 'Œ',
  eth: 'ð',
  ETH: 'Ð',
  thorn: 'þ',
  THORN: 'Þ',
};

function decodeEntity(entity: string): string {
  if (entity.startsWith('#')) {
    const hex = entity[1] === 'x' || entity[1] === 'X';
    const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  }
  // Every other named entity is a sign or a space, which only separates words.
  return LETTERS[entity] ?? MARKED_LETTER.exec(entity)?.[1] ?? ' ';
}

// The words of an HTML text, for the search index. Not for display: nothing here is made safe
// to show, and the layout is lost. One pass from left to right, so broken HTML cannot make it
// slow.
export function htmlToText(input: string): string {
  const html = input.slice(0, MAX_HTML);
  // Only A to Z change, so positions stay the same as in the original.
  const lower = html.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
  const parts: string[] = [];
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) {
      parts.push(html.slice(index));
      break;
    }
    parts.push(html.slice(index, open));

    if (lower.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      index = end < 0 ? html.length : end + 3;
      parts.push(' ');
      continue;
    }
    const tag = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(open, open + 40));
    const next = html[open + 1];
    if (!tag && next !== '!' && next !== '?') {
      // A "<" that starts no tag is part of the text.
      parts.push('<');
      index = open + 1;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close < 0) break;
    index = close + 1;

    const name = tag?.[2] ?? '';
    const opening = tag?.[1] === '' && html[close - 1] !== '/';
    if (opening && HIDDEN.has(name)) {
      const end = lower.indexOf(`</${name}`, index);
      const after = end < 0 ? -1 : html.indexOf('>', end);
      index = after < 0 ? html.length : after + 1;
      parts.push(' ');
    } else if (BREAKS.has(name)) {
      parts.push('\n');
    }
  }

  return parts
    .join('')
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (_match, entity: string) =>
      decodeEntity(entity),
    )
    .replace(/[ \t\r\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n[\s]*/g, '\n')
    .trim();
}

export function bodyText(body: MessageBody): string {
  const text = body.contentType === 'html' ? htmlToText(body.content) : body.content;
  return text.slice(0, MAX_INDEXED_TEXT);
}
