import type { GraphClient } from '../graph/client';
import type { GraphPage } from '../graph/mapping';
import { INLINE_IMAGE_TYPES, type MailStore, type NewAttachment } from '../mail/store';

// A picture inside the text that is larger than this is treated like any other attachment.
const MAX_INLINE_IMAGE = 5 * 1024 * 1024;

interface GraphBody {
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
}

interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
}

const ATTACHMENT_FIELDS =
  'id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId';

// Some senders write the name in angle brackets, as in the mail headers.
function cleanContentId(contentId: string | null | undefined): string | null {
  const cleaned = contentId?.trim().replace(/^<|>$/g, '');
  return cleaned ? cleaned : null;
}

// Fetches the text of a message, the list of its attachments and the pictures the text shows.
export async function fetchBody(
  client: GraphClient,
  store: MailStore,
  messageId: number,
  remoteId: string,
): Promise<void> {
  const path = `/me/messages/${encodeURIComponent(remoteId)}`;
  const message = await client.request<GraphBody>(`${path}?$select=body,hasAttachments`);
  const content = message.body?.content ?? '';
  const isHtml = message.body?.contentType?.toLowerCase() === 'html';

  // Pictures inside the text do not count as attachments for the provider, so the text decides too.
  const found: GraphAttachment[] = [];
  if (message.hasAttachments || /cid:/i.test(content)) {
    let link: string | undefined = `${path}/attachments?$select=${ATTACHMENT_FIELDS}`;
    while (link) {
      const page: GraphPage<GraphAttachment> = await client.request(link);
      found.push(...(page.value ?? []));
      link = page['@odata.nextLink'];
    }
  }

  const attachments: NewAttachment[] = [];
  for (const entry of found) {
    // Links to files in a cloud drive have no content of their own.
    if (entry['@odata.type']?.endsWith('referenceAttachment')) continue;
    const attachment: NewAttachment = {
      remoteId: entry.id,
      name: entry.name || 'attachment',
      contentType: entry.contentType || 'application/octet-stream',
      size: entry.size ?? 0,
      isInline: entry.isInline ?? false,
      contentId: cleanContentId(entry.contentId),
    };
    const shown =
      isHtml &&
      attachment.contentId !== null &&
      content.includes(`cid:${attachment.contentId}`) &&
      INLINE_IMAGE_TYPES.test(attachment.contentType) &&
      attachment.size <= MAX_INLINE_IMAGE;
    if (shown) {
      const id = encodeURIComponent(entry.id);
      const response = await client.download(`${path}/attachments/${id}/$value`);
      attachment.content = new Uint8Array(await response.arrayBuffer());
    }
    attachments.push(attachment);
  }

  store.saveBody(messageId, { contentType: isHtml ? 'html' : 'text', content }, attachments);
}
