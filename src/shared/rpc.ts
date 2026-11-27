export interface Endpoint {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
}

export type RequestMap = Record<string, { params: unknown; result: unknown }>;

export type Handlers<Map extends RequestMap> = {
  [Method in keyof Map]: (
    params: Map[Method]['params'],
  ) => Map[Method]['result'] | Promise<Map[Method]['result']>;
};

interface RequestMessage {
  id: number;
  method: string;
  params: unknown;
}

type ResponseMessage = { id: number; result: unknown } | { id: number; error: string };

function isRequest(message: unknown): message is RequestMessage {
  if (typeof message !== 'object' || message === null) return false;
  const { id, method } = message as Partial<RequestMessage>;
  return typeof id === 'number' && typeof method === 'string';
}

function isResponse(message: unknown): message is ResponseMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof Reflect.get(message, 'id') === 'number'
  );
}

export function serve<Map extends RequestMap>(endpoint: Endpoint, handlers: Handlers<Map>): void {
  endpoint.listen(async (message) => {
    if (!isRequest(message)) return;
    const { id, method, params } = message;
    try {
      if (!Object.hasOwn(handlers, method)) throw new Error(`Unknown method: ${method}`);
      const result = await handlers[method]!(params);
      endpoint.post({ id, result } satisfies ResponseMessage);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      endpoint.post({ id, error: text } satisfies ResponseMessage);
    }
  });
}

export function createClient<Map extends RequestMap>(endpoint: Endpoint) {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  endpoint.listen((message) => {
    if (!isResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if ('error' in message) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });

  return <Method extends keyof Map & string>(
    method: Method,
    params: Map[Method]['params'],
  ): Promise<Map[Method]['result']> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      endpoint.post({ id, method, params } satisfies RequestMessage);
    });
}
