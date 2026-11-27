import type { MessageBody, MessageSummary } from '@shared/api';
import type { NewAttachment } from '../mail/store';
import { ATTACHMENT_NAMES, OWNER, SENTENCES } from './content';
import { createRandom } from './random';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The demo account has no server, so the body of a message is made up when it is first opened.
// It depends only on the message, so opening it again gives the same text.
export function createDemoBody(message: MessageSummary): {
  body: MessageBody;
  attachments: NewAttachment[];
} {
  const random = createRandom(message.id);
  const firstName = (name: string) => name.split(' ')[0] ?? name;
  const greetingName = message.to[0]?.name ?? OWNER.name;

  const paragraphs = Array.from({ length: 2 + random.int(3) }, () =>
    Array.from({ length: 1 + random.int(3) }, () => random.pick(SENTENCES)).join(' '),
  );
  const html = [
    `<p>Hi ${escapeHtml(firstName(greetingName))},</p>`,
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p>Best regards,<br>${escapeHtml(message.from.name)}</p>`,
  ].join('\n');

  const attachments: NewAttachment[] = [];
  if (message.hasAttachments) {
    const count = 1 + random.int(3);
    for (let index = 0; index < count; index++) {
      const [name, contentType] = random.pick(ATTACHMENT_NAMES);
      attachments.push({
        name,
        contentType,
        size: 20_000 + random.int(3_000_000),
        isInline: false,
      });
    }
  }
  return { body: { contentType: 'html', content: html }, attachments };
}
