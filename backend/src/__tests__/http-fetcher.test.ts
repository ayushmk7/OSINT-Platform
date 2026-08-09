import http from 'http';
import type { AddressInfo } from 'net';
import { fetchUrl } from '../engine/http-fetcher';

/**
 * Spin up a throwaway localhost server so retry/timeout/error behaviour is asserted
 * deterministically instead of against a third party.
 */
function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      });
    });
  });
}

describe('HTTP Fetcher', () => {
  it('should successfully fetch text data from URL', async () => {
    const result = await fetchUrl({ url: 'https://httpbin.org/get', timeoutMs: 10000 });
    expect(result).toBeDefined();
    expect(result).toContain('"url"');
  }, 20000);

  it('should return the raw response body and send a User-Agent', async () => {
    let seenUserAgent = '';
    const server = await startServer((req, res) => {
      seenUserAgent = String(req.headers['user-agent'] ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    try {
      const body = await fetchUrl({ url: server.url, timeoutMs: 2000 });
      expect(JSON.parse(body)).toEqual({ ok: true });
      expect(seenUserAgent).toContain('ReconVillage');
    } finally {
      await server.close();
    }
  });

  it('should retry on failure and succeed on a later attempt', async () => {
    let attempts = 0;
    const server = await startServer((_req, res) => {
      attempts++;
      if (attempts < 3) {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      res.writeHead(200);
      res.end('recovered');
    });
    try {
      const body = await fetchUrl({ url: server.url, timeoutMs: 2000, maxAttempts: 3 });
      expect(body).toBe('recovered');
      expect(attempts).toBe(3);
    } finally {
      await server.close();
    }
  }, 15000);

  it('should throw after exhausting all attempts on a persistent error', async () => {
    let attempts = 0;
    const server = await startServer((_req, res) => {
      attempts++;
      res.writeHead(503);
      res.end('unavailable');
    });
    try {
      await expect(fetchUrl({ url: server.url, timeoutMs: 2000, maxAttempts: 2 })).rejects.toThrow(
        /503/
      );
      expect(attempts).toBe(2);
    } finally {
      await server.close();
    }
  }, 15000);

  it('should abort a request that exceeds the timeout', async () => {
    const pending: http.ServerResponse[] = [];
    const server = await startServer((_req, res) => {
      pending.push(res); // never respond
    });
    try {
      await expect(
        fetchUrl({ url: server.url, timeoutMs: 150, maxAttempts: 1 })
      ).rejects.toBeDefined();
    } finally {
      pending.forEach((res) => res.destroy());
      await server.close();
    }
  }, 15000);
});
