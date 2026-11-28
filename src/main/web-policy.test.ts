import { describe, expect, it } from 'vitest';
import {
  classifyWebUrl,
  hostOf,
  isSignInHandOff,
  mayLoadInWebView,
  moduleOf,
  pageUrl,
  plainUserAgent,
  startUrl,
} from './web-policy';

describe('classifyWebUrl', () => {
  it.each([
    ['https://outlook.office.com/mail/', 'outlook'],
    ['https://outlook.office365.com/owa/', 'outlook'],
    ['https://outlook.cloud.microsoft/mail/inbox', 'outlook'],
    ['https://outlook.live.com/mail/0/', 'outlook'],
    ['https://OUTLOOK.office.com./mail/', 'outlook'],
    ['https://login.microsoftonline.com/common/oauth2/authorize?x=1', 'signIn'],
    ['https://login.live.com/login.srf', 'signIn'],
    ['https://mysignins.microsoft.com/security-info', 'signIn'],
    ['https://sts.company.example/adfs/ls/', 'external'],
    ['https://www.office.com/', 'external'],
    ['https://example.com/', 'external'],
    ['https://outlook.office.com.evil.example/mail/', 'external'],
    ['https://evil.example/outlook.office.com/', 'external'],
    ['https://outlook.office.com@evil.example/', 'external'],
    ['https://user:secret@outlook.office.com/', 'external'],
    ['https://notoutlook.office.com/', 'external'],
    ['https://sub.outlook.office.com/', 'external'],
    ['http://outlook.office.com/mail/', 'external'],
    ['mailto:ann@example.com', 'external'],
    ['file:///etc/passwd', 'refused'],
    ['javascript:alert(1)', 'refused'],
    ['data:text/html,<script>alert(1)</script>', 'refused'],
    ['app://outlo/index.html', 'refused'],
    ['chrome://settings', 'refused'],
    ['about:blank', 'refused'],
    ['not a url', 'refused'],
  ])('%s is %s', (url, kind) => expect(classifyWebUrl(url)).toBe(kind));

  it('knows the sign-in servers the user allowed for an account', () => {
    const allowed = ['sts.company.example'];
    expect(classifyWebUrl('https://sts.company.example/adfs/ls/?x=1', allowed)).toBe('allowed');
    expect(classifyWebUrl('http://sts.company.example/adfs/ls/', allowed)).toBe('external');
    expect(classifyWebUrl('https://other.company.example/', allowed)).toBe('external');
    expect(mayLoadInWebView('https://sts.company.example/', allowed)).toBe(true);
    expect(mayLoadInWebView('https://sts.company.example/')).toBe(false);
  });
});

describe('isSignInHandOff', () => {
  const signIn = 'https://login.microsoftonline.com/common/login';
  it("is a jump from Microsoft's sign-in page to an unknown secure address", () => {
    expect(isSignInHandOff(signIn, 'https://sts.company.example/adfs/ls/')).toBe(true);
  });

  it.each([
    ['https://outlook.office.com/mail/', 'https://sts.company.example/'],
    ['https://sts.company.example/', 'https://other.example/'],
    [signIn, 'http://sts.company.example/'],
    [signIn, 'https://outlook.office.com/mail/'],
    [signIn, 'https://privacy.microsoft.com/en-us/privacystatement'],
    [signIn, 'https://www.microsoft.com/servicesagreement'],
    [signIn, 'file:///etc/passwd'],
    ['about:blank', 'https://sts.company.example/'],
  ])('is not a jump from %s to %s', (from, to) => expect(isSignInHandOff(from, to)).toBe(false));
});

describe('startUrl', () => {
  it('starts at the Outlook that fits the kind of account, with the address as a hint', () => {
    expect(startUrl('ann.lee+x@company.example', 'work')).toBe(
      'https://outlook.office.com/mail/?login_hint=ann.lee%2Bx%40company.example',
    );
    expect(startUrl('ann@outlook.com', 'personal')).toBe(
      'https://outlook.live.com/mail/?login_hint=ann%40outlook.com',
    );
  });

  it('leaves out what is not an address', () => {
    expect(startUrl('Work', 'work')).toBe('https://outlook.office.com/mail/');
    expect(startUrl('a@b&evil=1 x', 'personal')).toBe('https://outlook.live.com/mail/');
  });

  it('only ever starts at an address the view may load', () => {
    for (const kind of ['work', 'personal'] as const) {
      expect(classifyWebUrl(startUrl('ann@x.example', kind))).toBe('outlook');
    }
  });
});

describe('pageUrl', () => {
  it('opens a module at the Outlook that fits the kind of account', () => {
    expect(pageUrl('calendar', 'personal')).toBe('https://outlook.live.com/calendar/');
    expect(pageUrl('people', 'work')).toBe('https://outlook.office.com/people/');
  });

  it('stays on the host the view already shows', () => {
    const current = 'https://outlook.cloud.microsoft/mail/inbox/id/AAQ';
    expect(pageUrl('calendar', 'work', current)).toBe('https://outlook.cloud.microsoft/calendar/');
    expect(pageUrl('mail', 'work', 'https://login.microsoftonline.com/x')).toBe(
      'https://outlook.office.com/mail/',
    );
    expect(pageUrl('mail', 'work', 'https://evil.example/mail/')).toBe(
      'https://outlook.office.com/mail/',
    );
  });

  it('only ever opens an address the view may load', () => {
    for (const page of ['mail', 'calendar', 'people', 'settings'] as const) {
      expect(classifyWebUrl(pageUrl(page, 'work'))).toBe('outlook');
      expect(classifyWebUrl(pageUrl(page, 'personal'))).toBe('outlook');
    }
  });
});

describe('moduleOf', () => {
  it.each([
    ['https://outlook.live.com/mail/0/inbox', 'mail'],
    ['https://outlook.office.com/mail/options/general', 'mail'],
    ['https://outlook.office.com/owa/', 'mail'],
    ['https://outlook.live.com/calendar/view/workweek', 'calendar'],
    ['https://outlook.office.com/Calendar', 'calendar'],
    ['https://outlook.cloud.microsoft/people/', 'people'],
    ['https://outlook.office.com/calendarx/', 'mail'],
  ])('%s belongs to %s', (url, module) => expect(moduleOf(url)).toBe(module));

  it('knows no module outside Outlook', () => {
    expect(moduleOf('https://login.live.com/calendar/')).toBeUndefined();
    expect(moduleOf('not a url')).toBeUndefined();
  });
});

describe('plainUserAgent', () => {
  it('removes the names of the app and of Electron', () => {
    const full =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) outlo/0.0.1 Chrome/150.0.0.0 Electron/45.5.0 Safari/537.36';
    expect(plainUserAgent(full)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    );
  });

  it('copes with an app name that contains a space', () => {
    const full =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Outlo Mail/0.0.1 Chrome/150.0.0.0 Electron/45.5.0 Safari/537.36';
    expect(plainUserAgent(full)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    );
  });

  it('leaves a plain browser name as it is', () => {
    const plain =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
    expect(plainUserAgent(plain)).toBe(plain);
  });
});

describe('hostOf', () => {
  it('returns the host in lower case, or nothing', () => {
    expect(hostOf('https://STS.Company.example./adfs')).toBe('sts.company.example');
    expect(hostOf('nonsense')).toBe('');
  });
});
