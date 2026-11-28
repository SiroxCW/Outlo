import { describe, expect, it } from 'vitest';
import {
  buildQuote,
  draftHtml,
  draftPreview,
  responseRecipients,
  responseSubject,
  type QuotedMessage,
} from './compose';

const me = 'alex@mailbox.example';
const anna = { name: 'Anna Berg', address: 'anna@bluepeak.example' };
const ben = { name: '', address: 'ben@bluepeak.example' };
const source: QuotedMessage = {
  subject: 'Plans',
  from: anna,
  to: [{ name: 'Alex', address: 'Alex@Mailbox.example' }, ben],
  cc: [anna],
  receivedAt: Date.UTC(2026, 10, 27, 9, 30),
};

describe('answers', () => {
  it('adds RE: or FW: once', () => {
    expect(responseSubject('reply', 'Plans')).toBe('RE: Plans');
    expect(responseSubject('replyAll', 'Re: Plans')).toBe('Re: Plans');
    expect(responseSubject('forward', 'RE: Plans')).toBe('FW: RE: Plans');
    expect(responseSubject('forward', 'Fwd: Plans')).toBe('Fwd: Plans');
  });

  it('replies to the sender, and to all but the user once each', () => {
    expect(responseRecipients('reply', source, me)).toEqual({ to: [anna], cc: [] });
    expect(responseRecipients('replyAll', source, me)).toEqual({ to: [anna, ben], cc: [] });
    expect(responseRecipients('forward', source, me)).toEqual({ to: [], cc: [] });
  });

  it('answers the own message to the people it went to', () => {
    const own = { ...source, from: { name: 'Alex', address: me }, cc: [] };
    expect(responseRecipients('reply', own, me).to).toEqual(own.to);
    expect(responseRecipients('replyAll', own, me).to).toEqual([ben]);
    const toSelf = { ...own, to: [{ name: 'Alex', address: me }] };
    expect(responseRecipients('replyAll', toSelf, me).to).toEqual([own.from]);
  });
});

describe('quotes', () => {
  it('writes who wrote to whom, made safe, above the message', () => {
    const quote = buildQuote(
      { ...source, subject: '<b>Plans</b>' },
      { contentType: 'text', content: 'Line one\nLine <two>' },
      '',
    );
    expect(quote).toContain('<b>From:</b> Anna Berg &lt;anna@bluepeak.example&gt;<br>');
    expect(quote).toContain(
      '<b>To:</b> Alex &lt;Alex@Mailbox.example&gt;; ben@bluepeak.example<br>',
    );
    expect(quote).toContain('<b>Cc:</b> Anna Berg');
    expect(quote).toMatch(/<b>Sent:<\/b> \w+day, November 27, 2026 \d+:30 [AP]M/);
    expect(quote).toContain('<b>Subject:</b> &lt;b&gt;Plans&lt;/b&gt;');
    expect(quote).toContain('<div>Line one<br>Line &lt;two&gt;</div>');
  });

  it('keeps the body of an HTML mail with its styles, and falls back to the preview', () => {
    const html =
      '<html><head><title>x</title><style>p{}</style></head><body dir="ltr"><p>Hi</p></body></html>';
    expect(buildQuote(source, { contentType: 'html', content: html }, '')).toContain(
      '<div><style>p{}</style><p>Hi</p></div>',
    );
    expect(buildQuote(source, null, 'The start & more')).toContain(
      '<div>The start &amp; more</div>',
    );
  });
});

describe('the body for the provider', () => {
  it('keeps empty lines and gives paragraphs no spacing', () => {
    const html = draftHtml('<p>Hi</p><p></p><p>Bye</p>', '');
    expect(html).toContain(
      '<p style="margin: 0">Hi</p><p style="margin: 0"><br></p><p style="margin: 0">Bye</p>',
    );
    expect(html).toMatch(/^<html><head><meta [^>]*charset=utf-8"><\/head><body>/);
    expect(draftHtml('<p>Hi</p>', '<div>quote</div>')).toContain('</div><br><div>quote</div>');
  });

  it('previews the text with its signs', () => {
    expect(draftPreview('<p>Tom &amp; Jerry &lt;3</p><p>Next</p>', '')).toBe('Tom & Jerry <3 Next');
    expect(draftPreview('', '<div>Quoted</div>')).toBe('Quoted');
  });
});
