import { describe, expect, it } from 'vitest';
import { bodyText, htmlToText, MAX_INDEXED_TEXT } from './text';

describe('htmlToText', () => {
  it('keeps the words and drops the tags', () => {
    expect(htmlToText('<p>Hello <b>dear</b> Anna,</p><p>see <a href="x">the plan</a>.</p>')).toBe(
      'Hello dear Anna,\nsee the plan.',
    );
  });

  it('does not split a word that a tag runs through, but separates cells and lines', () => {
    expect(htmlToText('im<b>port</b>ant')).toBe('important');
    expect(htmlToText('<table><tr><td>one</td><td>two</td></tr></table>line<br>break')).toBe(
      'one\ntwo\nline\nbreak',
    );
  });

  it('leaves out what the reader never sees', () => {
    const html = `<html><head><title>Secret title</title><style>.x { color: red }</style></head>
      <body><!-- a comment --><script>var hidden = 1;</script><STYLE type="text/css">p{}</STYLE>
      Visible</body></html>`;
    expect(htmlToText(html)).toBe('Visible');
  });

  it('turns entities into letters, and signs into spaces', () => {
    expect(htmlToText('Gr&uuml;&szlig;e &amp; caf&eacute;&nbsp;&#77;&#x6F;re &hellip;')).toBe(
      'Gruße cafe More',
    );
    expect(htmlToText('&#0; &#x110000; &unknownentity; ok')).toBe('ok');
  });

  it('keeps a "<" that starts no tag', () => {
    expect(htmlToText('1 < 2 and 3 <= 4')).toBe('1 < 2 and 3 <= 4');
  });

  it('copes with tags that never end', () => {
    expect(htmlToText('before <style>p { color: red }')).toBe('before');
    expect(htmlToText('before <div class="x')).toBe('before');
    expect(htmlToText('a <style/> b')).toBe('a b');
  });

  it('stays fast on broken HTML', () => {
    const inputs = ['<a'.repeat(200_000), '<style>'.repeat(100_000), '<!--'.repeat(100_000)];
    const start = performance.now();
    for (const input of inputs) htmlToText(input);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe('bodyText', () => {
  it('takes plain text as it is and cuts long texts', () => {
    expect(bodyText({ contentType: 'text', content: 'a <b> c' })).toBe('a <b> c');
    const long = bodyText({ contentType: 'text', content: 'x'.repeat(MAX_INDEXED_TEXT + 10) });
    expect(long).toHaveLength(MAX_INDEXED_TEXT);
  });
});
