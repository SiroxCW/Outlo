export interface CoreInfo {
  pid: number;
  startedAt: number;
  nodeVersion: string;
}

// Every request the UI can send to the core: its parameters and its result.
export type CoreRequests = {
  'core.info': { params: undefined; result: CoreInfo };
};

export type CoreRequest = <Method extends keyof CoreRequests>(
  method: Method,
  params: CoreRequests[Method]['params'],
) => Promise<CoreRequests[Method]['result']>;

// What the preload script exposes to the UI as window.outlo.
export interface OutloBridge {
  request: CoreRequest;
}

export const CORE_PORT_REQUEST = 'core-port-request';
export const CORE_PORT = 'core-port';
