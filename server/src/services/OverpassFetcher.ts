import {
  OVERPASS_SERVERS,
  OVERPASS_MAX_CONCURRENT,
  OVERPASS_DELAY_MS,
  OVERPASS_TIMEOUT_MS,
  OVERPASS_MAX_RETRIES,
} from '../config.js';

function buildQuery(south: number, west: number, north: number, east: number): string {
  return `[out:json][bbox:${south},${west},${north},${east}][timeout:120][maxsize:67108864];
(
  way["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
  way["railway"](${south},${west},${north},${east});
  way["natural"="tree_row"](${south},${west},${north},${east});
  way["landuse"="grass"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["leisure"="garden"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["waterway"](${south},${west},${north},${east});
  node["natural"="tree"](${south},${west},${north},${east});
  node["highway"="traffic_signals"](${south},${west},${north},${east});
  node["amenity"="bench"](${south},${west},${north},${east});
  node["highway"="street_lamp"](${south},${west},${north},${east});
);
out body; >; out skel qt;`;
}

interface QueueItem {
  south: number;
  west: number;
  north: number;
  east: number;
  resolve: (data: { elements: unknown[]; raw: string }) => void;
  reject: (err: Error) => void;
}

export class OverpassFetcher {
  private queue: QueueItem[] = [];
  private active = 0;
  private serverIndex = 0;
  private inFlight = new Map<string, Promise<{ elements: unknown[]; raw: string }>>();

  private bboxKey(s: number, w: number, n: number, e: number): string {
    return `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  }

  private nextServer(): string {
    const server = OVERPASS_SERVERS[this.serverIndex % OVERPASS_SERVERS.length];
    this.serverIndex++;
    return server;
  }

  async fetch(
    south: number, west: number, north: number, east: number,
  ): Promise<{ elements: unknown[]; raw: string }> {
    const key = this.bboxKey(south, west, north, east);

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = new Promise<{ elements: unknown[]; raw: string }>((resolve, reject) => {
      this.queue.push({ south, west, north, east, resolve, reject });
      this.processQueue();
    });

    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));

    return promise;
  }

  private processQueue(): void {
    while (this.active < OVERPASS_MAX_CONCURRENT && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.executeRequest(item)
        .catch(() => { /* rejection already forwarded via item.reject */ })
        .finally(() => {
          this.active--;
          if (this.queue.length > 0) {
            setTimeout(() => this.processQueue(), OVERPASS_DELAY_MS);
          }
        });
    }
  }

  private async executeRequest(item: QueueItem): Promise<void> {
    const { south, west, north, east, resolve, reject } = item;
    const query = buildQuery(south, west, north, east);
    const bboxStr = `(${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)})`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < OVERPASS_MAX_RETRIES; attempt++) {
      const serverUrl = this.nextServer();
      const serverName = new URL(serverUrl).hostname.split('.')[0];

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 || response.status === 503) {
          const backoff = OVERPASS_DELAY_MS * Math.pow(2, attempt);
          console.log(`[Overpass] ${serverName} 429 for ${bboxStr}, backoff ${backoff}ms`);
          await this.sleep(backoff);
          continue;
        }

        if (!response.ok) {
          lastError = new Error(`${serverName} ${response.status}: ${response.statusText}`);
          console.error(`[Overpass] ${lastError.message}`);
          continue;
        }

        const raw = await response.text();
        const json = JSON.parse(raw);

        if (!json.elements || !Array.isArray(json.elements)) {
          lastError = new Error('Invalid response: missing elements');
          console.error(`[Overpass] ${lastError.message} from ${serverName}`);
          continue;
        }

        console.log(`[Overpass] ${serverName} ${bboxStr}: ${json.elements.length} elements`);
        resolve({ elements: json.elements, raw });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.name === 'AbortError' ? 'timeout' : lastError.message;
        console.error(`[Overpass] ${serverName} ${bboxStr}: ${msg}`);
        if (attempt < OVERPASS_MAX_RETRIES - 1) {
          await this.sleep(OVERPASS_DELAY_MS * (attempt + 1));
        }
      }
    }

    reject(lastError ?? new Error('All Overpass attempts failed'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
