import { describe, expect, it } from 'vitest';
import { toRemoteMessage } from './mapping';

describe('toRemoteMessage', () => {
  it('reads all header fields', () => {
    const result = toRemoteMessage({
      id: 'm1',
      conversationId: 'c1',
      subject: 'Hello',
      bodyPreview: 'Line one\r\n\r\nLine two  ',
      from: { emailAddress: { name: 'Ann', address: 'ann@x.example' } },
      toRecipients: [{ emailAddress: { name: 'Bob', address: 'bob@x.example' } }],
      ccRecipients: [],
      receivedDateTime: '2026-11-27T21:26:20Z',
      isRead: false,
      flag: { flagStatus: 'flagged' },
      importance: 'high',
      hasAttachments: true,
      inferenceClassification: 'other',
    });
    expect(result).toEqual({
      remoteId: 'm1',
      fields: {
        conversationId: 'c1',
        subject: 'Hello',
        preview: 'Line one Line two',
        from: { name: 'Ann', address: 'ann@x.example' },
        to: [{ name: 'Bob', address: 'bob@x.example' }],
        cc: [],
        receivedAt: Date.UTC(2026, 10, 27, 21, 26, 20),
        isRead: false,
        isFlagged: true,
        isFocused: false,
        hasAttachments: true,
        importance: 'high',
      },
    });
  });

  it('leaves out what the answer does not contain', () => {
    expect(toRemoteMessage({ id: 'm1', isRead: true })).toEqual({
      remoteId: 'm1',
      fields: { isRead: true },
    });
  });

  it('copes with drafts: no subject, no sender, no received date', () => {
    const { fields } = toRemoteMessage({
      id: 'm1',
      subject: null,
      from: null,
      receivedDateTime: null,
      sentDateTime: '2026-01-02T00:00:00Z',
    });
    expect(fields).toEqual({ subject: '', receivedAt: Date.UTC(2026, 0, 2) });
  });

  it('falls back to the sender when "from" is missing', () => {
    const { fields } = toRemoteMessage({
      id: 'm1',
      sender: { emailAddress: { address: 'list@x.example' } },
    });
    expect(fields.from).toEqual({ name: '', address: 'list@x.example' });
  });

  it('treats unknown values as the normal case', () => {
    const { fields } = toRemoteMessage({
      id: 'm1',
      importance: 'weird',
      flag: { flagStatus: 'complete' },
      inferenceClassification: 'focused',
    });
    expect(fields).toEqual({ importance: 'normal', isFlagged: false, isFocused: true });
  });
});
