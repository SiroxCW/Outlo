import type { Fetch } from '../graph/client';
import type { GraphFolder, GraphMessage } from '../graph/mapping';

interface FakeFolder {
  id: string;
  name: string;
  parentId: string;
  wellKnown: string | null;
  hidden: boolean;
  messages: Map<string, GraphMessage>;
}

export interface FakeAttachment {
  name: string;
  contentType: string;
  content: Uint8Array;
  isInline?: boolean;
  contentId?: string;
  type?: string;
}

interface Change {
  seq: number;
  folderId: string;
  messageId: string;
}

const ROOT = 'root';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const failure = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

// A small stand-in for Microsoft Graph for tests: folders, messages and delta queries with paging.
export class FakeGraph {
  readonly requests: string[] = [];
  // When false, the folder list only holds the top level, and children have to be asked for.
  nestedFolderList = true;
  // Lets a test answer a request itself, for example with an error.
  intercept: ((url: URL, method: string) => Response | undefined) | undefined;
  offline = false;
  // Graph keeps immutable IDs when a message moves. Lets a test check what happens if not.
  newIdOnMove = false;
  private readonly folders = new Map<string, FakeFolder>();
  private readonly changes: Change[] = [];
  private readonly bodies = new Map<string, { contentType: string; content: string }>();
  private readonly attachments = new Map<string, (FakeAttachment & { id: string })[]>();
  private readonly bcc = new Map<string, unknown>();
  private seq = 0;
  private oldestValidSeq = 0;
  private nextId = 1;

  addFolder(
    name: string,
    options: { parent?: string; wellKnown?: string; hidden?: boolean } = {},
  ): string {
    const id = `folder-${this.nextId++}`;
    this.folders.set(id, {
      id,
      name,
      parentId: options.parent ?? ROOT,
      wellKnown: options.wellKnown ?? null,
      hidden: options.hidden ?? false,
      messages: new Map(),
    });
    return id;
  }

  renameFolder(id: string, name: string): void {
    this.folders.get(id)!.name = name;
  }

  removeFolder(id: string): void {
    this.folders.delete(id);
  }

  addMessage(folderId: string, message: Partial<GraphMessage> = {}): string {
    const id = message.id ?? `message-${this.nextId++}`;
    this.folders.get(folderId)!.messages.set(id, {
      conversationId: `conversation-${id}`,
      subject: `Subject of ${id}`,
      bodyPreview: `Preview of ${id}`,
      from: { emailAddress: { name: 'Sender', address: 'sender@remote.example' } },
      toRecipients: [{ emailAddress: { name: 'Me', address: 'me@remote.example' } }],
      ccRecipients: [],
      receivedDateTime: new Date(Date.UTC(2026, 0, 1) + this.nextId * 60_000).toISOString(),
      isRead: false,
      flag: { flagStatus: 'notFlagged' },
      importance: 'normal',
      hasAttachments: false,
      inferenceClassification: 'focused',
      ...message,
      id,
    });
    this.record(folderId, id);
    return id;
  }

  setBody(messageId: string, contentType: 'html' | 'text', content: string): void {
    this.bodies.set(messageId, { contentType, content });
  }

  // The text of a message as the server has it.
  body(messageId: string): { contentType: string; content: string } | undefined {
    return this.bodies.get(messageId);
  }

  addAttachment(messageId: string, attachment: FakeAttachment): string {
    const id = `attachment-${this.nextId++}`;
    this.attachments.set(messageId, [
      ...(this.attachments.get(messageId) ?? []),
      { ...attachment, id },
    ]);
    return id;
  }

  // The message as the server has it now, in whichever folder.
  find(id: string): GraphMessage | undefined {
    for (const folder of this.folders.values()) {
      const message = folder.messages.get(id);
      if (message) return message;
    }
    return undefined;
  }

  updateMessage(folderId: string, id: string, changes: Partial<GraphMessage>): void {
    const messages = this.folders.get(folderId)!.messages;
    messages.set(id, { ...messages.get(id)!, ...changes });
    this.record(folderId, id);
  }

  removeMessage(folderId: string, id: string): void {
    this.folders.get(folderId)!.messages.delete(id);
    this.record(folderId, id);
  }

  // The ID stays the same, as with Graph's immutable IDs.
  moveMessage(id: string, from: string, to: string): void {
    const message = this.folders.get(from)!.messages.get(id)!;
    this.removeMessage(from, id);
    this.addMessage(to, message);
  }

  // Makes every delta link handed out so far invalid.
  expireSyncState(): void {
    this.oldestValidSeq = this.seq + 1;
    this.seq++;
  }

  private record(folderId: string, messageId: string): void {
    this.changes.push({ seq: ++this.seq, folderId, messageId });
  }

  readonly fetch: Fetch = async (address, init) => {
    const url = new URL(address);
    const path = decodeURIComponent(url.pathname.replace('/v1.0', ''));
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${path}`);
    if (this.offline) throw new TypeError('fetch failed');

    const headers = init.headers as Record<string, string>;
    if (!headers.Authorization?.startsWith('Bearer ')) {
      return failure(401, 'InvalidAuthenticationToken', 'No token');
    }
    if (!headers.Prefer?.includes('IdType="ImmutableId"')) {
      return failure(400, 'Test', 'Immutable IDs were not requested');
    }
    const intercepted = this.intercept?.(url, method);
    if (intercepted) return intercepted;

    if (path === '/$batch') return this.batch(JSON.parse(init.body as string));
    if (path === '/me/mailFolders/delta') {
      const visible = [...this.folders.values()].filter(
        (folder) => !folder.hidden && (this.nestedFolderList || folder.parentId === ROOT),
      );
      return json(200, { value: visible.map((f) => this.toFolder(f)), '@odata.deltaLink': 'x' });
    }
    const children = /^\/me\/mailFolders\/([^/]+)\/childFolders$/.exec(path);
    if (children) {
      const found = [...this.folders.values()].filter(
        (folder) => folder.parentId === children[1] && !folder.hidden,
      );
      return json(200, { value: found.map((folder) => this.toFolder(folder)) });
    }
    const messages = /^\/me\/mailFolders\/([^/]+)\/messages\/delta$/.exec(path);
    if (messages) {
      const size = Number(/odata\.maxpagesize=(\d+)/.exec(headers.Prefer)?.[1] ?? 10);
      return this.messageDelta(url, messages[1]!, size);
    }
    if (path === '/me/messages' && method === 'POST') {
      return this.createDraft(JSON.parse(init.body as string) as Record<string, unknown>);
    }
    const answer = /^\/me\/messages\/([^/]+)\/(createReply|createReplyAll|createForward)$/.exec(
      path,
    );
    if (answer && method === 'POST') return this.createAnswer(answer[1]!, answer[2]!);
    const move = /^\/me\/messages\/([^/]+)\/move$/.exec(path);
    if (move && method === 'POST') {
      const { destinationId } = JSON.parse(init.body as string) as { destinationId?: string };
      return this.moveRequest(move[1]!, destinationId ?? '');
    }
    const single = /^\/me\/messages\/([^/]+)(\/attachments(?:\/([^/]+)\/\$value)?)?$/.exec(path);
    if (single && method === 'PATCH' && !single[2]) {
      return this.patch(single[1]!, JSON.parse(init.body as string) as Record<string, unknown>);
    }
    if (single) return this.message(single[1]!, single[2] !== undefined, single[3]);
    return failure(404, 'Test', `The fake does not know ${path}`);
  };

  private message(id: string, wantsAttachments: boolean, attachmentId?: string): Response {
    const exists = [...this.folders.values()].some((folder) => folder.messages.has(id));
    if (!exists) return failure(404, 'ErrorItemNotFound', 'The message does not exist');
    const attachments = this.attachments.get(id) ?? [];
    if (attachmentId) {
      const found = attachments.find((entry) => entry.id === attachmentId);
      return found
        ? new Response(found.content as BodyInit, {
            headers: { 'Content-Type': found.contentType },
          })
        : failure(404, 'ErrorItemNotFound', 'The attachment does not exist');
    }
    if (wantsAttachments) {
      const value = attachments.map((entry) => ({
        '@odata.type': `#microsoft.graph.${entry.type ?? 'fileAttachment'}`,
        id: entry.id,
        name: entry.name,
        contentType: entry.contentType,
        size: entry.content.byteLength,
        isInline: entry.isInline ?? false,
        contentId: entry.contentId ?? null,
      }));
      return json(200, { value });
    }
    const body = this.bodies.get(id) ?? { contentType: 'html', content: `<p>Text of ${id}</p>` };
    // As with Graph, pictures inside the text alone do not count as attachments.
    const hasAttachments = attachments.some((entry) => !entry.isInline);
    return json(200, { id, body, hasAttachments });
  }

  private moveRequest(id: string, destinationId: string): Response {
    const from = [...this.folders.values()].find((entry) => entry.messages.has(id));
    if (!from) return failure(404, 'ErrorItemNotFound', 'The message does not exist');
    if (!this.folders.has(destinationId)) {
      return failure(404, 'ErrorItemNotFound', 'The destination folder does not exist');
    }
    const message = from.messages.get(id)!;
    this.removeMessage(from.id, id);
    const newId = this.addMessage(destinationId, {
      ...message,
      id: this.newIdOnMove ? `${id}-moved` : id,
    });
    return json(200, this.find(newId));
  }

  private draftsFolder(): FakeFolder | undefined {
    return [...this.folders.values()].find((folder) => folder.wellKnown === 'drafts');
  }

  // A new draft in the Drafts folder, as POST /me/messages makes it.
  private createDraft(fields: Record<string, unknown>): Response {
    const drafts = this.draftsFolder();
    if (!drafts) return failure(404, 'ErrorItemNotFound', 'There is no Drafts folder');
    const id = this.addMessage(drafts.id, {
      subject: '',
      bodyPreview: '',
      from: { emailAddress: { name: 'Me', address: 'me@remote.example' } },
      toRecipients: [],
      isRead: true,
    });
    return this.patch(id, fields, 201);
  }

  // A draft that answers or forwards a message, in its conversation, with the message quoted.
  private createAnswer(sourceId: string, kind: string): Response {
    const source = this.find(sourceId);
    const drafts = this.draftsFolder();
    if (!source || !drafts) return failure(404, 'ErrorItemNotFound', 'The message does not exist');
    const forward = kind === 'createForward';
    const id = this.addMessage(drafts.id, {
      conversationId: source.conversationId,
      subject: `${forward ? 'FW' : 'RE'}: ${source.subject ?? ''}`,
      bodyPreview: 'Quoted by the server',
      from: { emailAddress: { name: 'Me', address: 'me@remote.example' } },
      toRecipients: forward ? [] : [source.from ?? {}],
      isRead: true,
    });
    this.setBody(id, 'html', '<p>Quoted by the server</p>');
    return json(201, this.find(id));
  }

  // Sets what the app may change about a message. Anything else is refused, as a mistake.
  private patch(id: string, changes: Record<string, unknown>, status = 200): Response {
    const folder = [...this.folders.values()].find((entry) => entry.messages.has(id));
    if (!folder) return failure(404, 'ErrorItemNotFound', 'The message does not exist');
    const allowed = ['isRead', 'flag', 'subject', 'body', 'toRecipients', 'ccRecipients'];
    const unknown = Object.keys(changes).filter(
      (key) => !allowed.includes(key) && key !== 'bccRecipients',
    );
    if (unknown.length > 0) return failure(400, 'ErrorInvalidProperty', unknown.join(', '));
    const { body, bccRecipients, ...fields } = changes as Partial<GraphMessage> & {
      body?: { contentType: string; content: string };
      bccRecipients?: unknown;
    };
    if (bccRecipients) this.bcc.set(id, bccRecipients);
    if (body) {
      this.bodies.set(id, { contentType: body.contentType.toLowerCase(), content: body.content });
      const text = body.content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      (fields as Partial<GraphMessage>).bodyPreview = text.slice(0, 255);
    }
    this.updateMessage(folder.id, id, fields);
    return json(status, folder.messages.get(id));
  }

  // Who a draft goes to in secret. Graph does not list it with the other fields.
  bccOf(id: string): unknown {
    return this.bcc.get(id);
  }

  private toFolder(folder: FakeFolder): GraphFolder {
    const children = [...this.folders.values()].filter((entry) => entry.parentId === folder.id);
    const messages = [...folder.messages.values()];
    return {
      id: folder.id,
      displayName: folder.name,
      parentFolderId: folder.parentId,
      childFolderCount: children.length,
      totalItemCount: messages.length,
      unreadItemCount: messages.filter((message) => !message.isRead).length,
      isHidden: folder.hidden,
    };
  }

  private batch(body: { requests: { id: string; url: string }[] }): Response {
    const responses = body.requests.map((request) => {
      const name = /mailFolders\/([^?]+)/.exec(request.url)?.[1];
      const folder = [...this.folders.values()].find((entry) => entry.wellKnown === name);
      return folder
        ? { id: request.id, status: 200, body: { id: folder.id } }
        : { id: request.id, status: 404, body: { error: { code: 'ErrorItemNotFound' } } };
    });
    return json(200, { responses });
  }

  private messageDelta(url: URL, folderId: string, pageSize: number): Response {
    const folder = this.folders.get(folderId);
    if (!folder) return failure(404, 'ErrorItemNotFound', 'The folder does not exist');
    const link = (kind: string, token: string) =>
      `${url.origin}${url.pathname}?$${kind}=${encodeURIComponent(token)}`;
    const token = url.searchParams.get('$skiptoken') ?? url.searchParams.get('$deltatoken');
    const [kind, first, second, third] = token?.split('|') ?? ['start'];
    if (!['start', 'all', 'changes', 'since'].includes(kind!)) {
      return failure(400, 'BadRequest', 'Badly formed token.');
    }

    // A round from the start: everything in the folder, newest first.
    if (kind === 'start' || kind === 'all') {
      const startedAt = kind === 'all' ? Number(first) : this.seq;
      const offset = kind === 'all' ? Number(second) : 0;
      if (startedAt < this.oldestValidSeq) return failure(410, 'SyncStateNotFound', 'Gone');
      const sorted = [...folder.messages.values()].sort((a, b) =>
        (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? ''),
      );
      const value = sorted.slice(offset, offset + pageSize);
      return offset + pageSize < sorted.length
        ? json(200, {
            value,
            '@odata.nextLink': link('skiptoken', `all|${startedAt}|${offset + pageSize}`),
          })
        : json(200, { value, '@odata.deltaLink': link('deltatoken', `since|${startedAt}`) });
    }

    // A round of changes: what happened after the link was handed out.
    const from = Number(first);
    if (from < this.oldestValidSeq) return failure(410, 'SyncStateNotFound', 'Gone');
    const until = kind === 'changes' ? Number(third) : this.seq;
    const offset = kind === 'changes' ? Number(second) : 0;
    const ids = new Set(
      this.changes
        .filter(
          (change) => change.folderId === folderId && change.seq > from && change.seq <= until,
        )
        .map((change) => change.messageId),
    );
    const all = [...ids].map(
      (id) => folder.messages.get(id) ?? { id, '@removed': { reason: 'deleted' } },
    );
    const value = all.slice(offset, offset + pageSize);
    return offset + pageSize < all.length
      ? json(200, {
          value,
          '@odata.nextLink': link('skiptoken', `changes|${from}|${offset + pageSize}|${until}`),
        })
      : json(200, { value, '@odata.deltaLink': link('deltatoken', `since|${until}`) });
  }
}
