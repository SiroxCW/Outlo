const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH = `${GRAPH_ORIGIN}/v1.0`;
const MAX_ATTEMPTS = 5;
const MAX_WAIT = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 60 * 1000;
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000;

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// The server could not be reached at all.
export class OfflineError extends Error {}

// The stored sign-in is no longer accepted.
export class SignInNeededError extends Error {}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GraphClientOptions {
  fetch: Fetch;
  // Returns an access token. With force, a new one even if the last one has not expired.
  getToken(force: boolean): Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  maxParallel?: number;
}

export interface GraphRequest {
  method?: 'GET' | 'POST';
  body?: unknown;
  maxPageSize?: number;
}

// How long the server asks us to wait. The header holds seconds or a date.
function retryAfter(response: Response, attempt: number): number {
  const header = response.headers.get('Retry-After');
  const seconds = Number(header);
  const date = header ? Date.parse(header) : NaN;
  const wait =
    header && Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(date)
        ? date - Date.now()
        : 1000 * 2 ** attempt;
  return Math.min(Math.max(wait, 0), MAX_WAIT);
}

// Talks to Microsoft Graph for one mailbox: signs requests, waits when the server asks for it,
// and keeps the number of parallel requests within Microsoft's limit for a mailbox.
export class GraphClient {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxParallel: number;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: GraphClientOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxParallel = options.maxParallel ?? 4;
  }

  // The path is relative to the v1.0 root, or a complete address from an earlier answer.
  async request<Result>(path: string, request: GraphRequest = {}): Promise<Result> {
    const response = await this.limited(() => this.send(path, request, REQUEST_TIMEOUT));
    return (await response.json()) as Result;
  }

  // For file contents: the answer is handed out as it is, so it can be read piece by piece.
  download(path: string): Promise<Response> {
    return this.limited(() => this.send(path, {}, DOWNLOAD_TIMEOUT));
  }

  private async limited<Result>(run: () => Promise<Result>): Promise<Result> {
    if (this.running >= this.maxParallel) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await run();
    } finally {
      // A waiting request takes over the slot, so the count only drops when nobody waits.
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  private async send(path: string, request: GraphRequest, timeout: number): Promise<Response> {
    const url = path.startsWith('/') ? GRAPH + path : path;
    // Addresses from earlier answers are followed, but the token only ever goes to Graph.
    if (!url.startsWith(`${GRAPH_ORIGIN}/`)) {
      throw new GraphError(0, 'ForeignAddress', 'The address does not belong to Microsoft Graph');
    }
    // Immutable IDs stay the same when a message moves to another folder.
    const prefer = ['IdType="ImmutableId"'];
    if (request.maxPageSize) prefer.push(`odata.maxpagesize=${request.maxPageSize}`);
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.options.getToken(false);
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method: request.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Prefer: prefer.join(', '),
            ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        throw new OfflineError(error instanceof Error ? error.message : String(error));
      }

      if (response.ok) return response;

      // The token may have been revoked before its time. Try once with a new one.
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.options.getToken(true);
        continue;
      }
      const temporary = [429, 503, 504].includes(response.status);
      if (temporary && attempt < MAX_ATTEMPTS - 1) {
        await this.sleep(retryAfter(response, attempt));
        continue;
      }
      throw await toError(response);
    }
  }
}

async function toError(response: Response): Promise<Error> {
  let code = '';
  let message = `Microsoft Graph answered with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? '';
    if (body.error?.message) message = body.error.message;
  } catch {
    // No JSON in the answer. The status has to do.
  }
  if (response.status === 401) return new SignInNeededError(message);
  return new GraphError(response.status, code, message);
}
