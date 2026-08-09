import WebSocket from 'ws';

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

  public broadcastEntityUpdate(entity: unknown): void {
    this.sendToAll(
      JSON.stringify({
        type: 'entity_update',
        timestamp: new Date().toISOString(),
        data: entity
      })
    );
  }

  /**
   * Available for explicitly requested single observations. NOT called per record on
   * every ingestion poll — see the broadcast discipline note above.
   */
  public broadcastObservation(observation: unknown): void {
    this.sendToAll(
      JSON.stringify({
        type: 'observation',
        timestamp: new Date().toISOString(),
        data: observation
      })
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
