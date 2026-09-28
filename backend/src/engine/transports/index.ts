import { StreamOptions, StreamHandle, StreamTransportConfig } from './stream';
import { startSseStream } from './sse';
import { startWebSocketStream } from './websocket';

export { fetchHttpRecords } from './http';
export type { StreamHandle, StreamOptions } from './stream';

/** Open the long-lived stream for a `websocket` or `sse` transport. */
export function startStream(
  transport: StreamTransportConfig,
  options: StreamOptions
): StreamHandle {
  return transport.type === 'sse'
    ? startSseStream(transport, options)
    : startWebSocketStream(transport, options);
}
