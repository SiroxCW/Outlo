export interface Endpoint {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
  onClose?(handler: () => void): void;
}

export type RequestMap = Record<string, { params: unknown; result: unknown }>;
export type EventMap = Record<string, unknown>;

export type Handlers<Requests extends RequestMap> = {
  [Method in keyof Requests]: (
    params: Requests[Method]['params'],
  ) => Requests[Method]['result'] | Promise<Requests[Method]['result']>;
};

export type EventOf<Events extends EventMap> = {
  [Type in keyof Events]: { type: Type; payload: Events[Type] };
}[keyof Events];

interface RequestMessage {
  id: number;
  method: string;
  params: unknown;
}

type ResponseMessage = { id: number; result: unknown } | { id: number; error: string };

interface EventMessage {
  event: string;
  payload: unknown;
}

function isRecord(message: unknown): message is Record<string, unknown> {
  return typeof message === 'object' && message !== null;
}

function isRequest(message: unknown): message is RequestMessage {
  return isRecord(message) && typeof message.id === 'number' && typeof message.method === 'string';
}

function isResponse(message: unknown): message is ResponseMessage {
  return isRecord(message) && typeof message.id === 'number' && !('method' in message);
}

function isEvent(message: unknown): message is EventMessage {
  return isRecord(message) && typeof message.event === 'string';
}

export function createServer<Requests extends RequestMap, Events extends EventMap>(
  handlers: Handlers<Requests>,
) {
  const endpoints = new Set<Endpoint>();

  async function answer(endpoint: Endpoint, { id, method, params }: RequestMessage) {
    try {
      if (!Object.hasOwn(handlers, method)) throw new Error(`Unknown method: ${method}`);
      const result = await handlers[method]!(params);
      endpoint.post({ id, result } satisfies ResponseMessage);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      endpoint.post({ id, error: text } satisfies ResponseMessage);
    }
  }

  return {
    connect(endpoint: Endpoint): void {
      endpoints.add(endpoint);
      endpoint.onClose?.(() => endpoints.delete(endpoint));
      endpoint.listen((message) => {
        if (isRequest(message)) void answer(endpoint, message);
      });
    },

    emit<Type extends keyof Events & string>(type: Type, payload: Events[Type]): void {
      const message: EventMessage = { event: type, payload };
      for (const endpoint of endpoints) endpoint.post(message);
    },
  };
}

export function createClient<Requests extends RequestMap, Events extends EventMap = EventMap>(
  endpoint: Endpoint,
) {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  const listeners = new Set<(event: EventOf<Events>) => void>();

  endpoint.listen((message) => {
    if (isEvent(message)) {
      const event = { type: message.event, payload: message.payload } as EventOf<Events>;
      for (const listener of listeners) listener(event);
      return;
    }
    if (!isResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if ('error' in message) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });

  return {
    request<Method extends keyof Requests & string>(
      method: Method,
      params: Requests[Method]['params'],
    ): Promise<Requests[Method]['result']> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        endpoint.post({ id, method, params } satisfies RequestMessage);
      });
    },

    subscribe(listener: (event: EventOf<Events>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
