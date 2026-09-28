import WebSocket from 'ws';
import { parseJsonObject } from '../db/queries';

/**
 * Decouples ingestion from WebSocket streaming: the scheduler hands entities to the
 * broadcaster, the broadcaster fans them out to every live socket.
 *
 * Broadcast discipline: the globe runs on `entity_update` ONLY, and the scheduler calls
 * `broadcastEntityUpdate` only for new or moved entities. There is deliberately no
 * per-record `observation` broadcast on every poll — for a feed like ADSB that would be
 * thousands of wasted frames every 30 seconds that no client ever reads.
 */
export class TelemetryBroadcaster {
  private clients: Set<WebSocket> = new Set();

  public addClient(ws: WebSocket): void {
    this.clients.add(ws);
  }

  public removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  /** `metadata` is always sent as an object — the same wire format as REST and `initial_state`. */
  public broadcastEntityUpdate(entity: object): void {
    const data: Record<string, unknown> = { ...entity };
    if ('metadata' in data) data.metadata = parseJsonObject(data.metadata);
    this.sendToAll(
      JSON.stringify({
        type: 'entity_update',
        timestamp: new Date().toISOString(),
        data
      })
    );
  }

  /** AI analysis result (see src/analysis). `data` is the same record `GET /api/insights` returns. */
  public broadcastAiInsight(insight: object): void {
    this.sendToAll(
      JSON.stringify({ type: 'ai_insight', timestamp: new Date().toISOString(), data: insight })
    );
  }

  private sendToAll(message: string): void {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}

export const broadcaster = new TelemetryBroadcaster();
