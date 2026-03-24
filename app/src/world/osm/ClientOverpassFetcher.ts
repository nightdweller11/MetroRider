import type { OSMElement } from './OSMFetcher';
import { tileBbox, tileKey } from './tileConfig';

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const CACHE_DB_NAME = 'metrorider_osm_cache';
const CACHE_STORE = 'tiles';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 90_000;
const BASE_BACKOFF_MS = 2000;

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

export { buildQuery };

interface CacheEntry {
  data: string;
  timestamp: number;
}

export class ClientOverpassFetcher {
  private serverIndex = 0;
  private db: IDBDatabase | null = null;
  private dbReady: Promise<IDBDatabase | null>;

  constructor() {
    this.dbReady = this.openDB();
  }

  private async openDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      return await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(CACHE_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            db.createObjectStore(CACHE_STORE);
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(req.result);
        };
        req.onerror = () => {
          console.error('[OverpassFetcher] IndexedDB open error:', req.error);
          reject(req.error);
        };
      });
    } catch (err) {
      console.error('[OverpassFetcher] IndexedDB unavailable:', err);
      return null;
    }
  }

  private async getCached(key: string): Promise<CacheEntry | null> {
    const db = this.db ?? await this.dbReady;
    if (!db) return null;
    try {
      return await new Promise<CacheEntry | null>((resolve) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const store = tx.objectStore(CACHE_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => {
          console.error('[OverpassFetcher] Cache read error:', req.error);
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  private async setCache(key: string, data: string): Promise<void> {
    const db = this.db ?? await this.dbReady;
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        const store = tx.objectStore(CACHE_STORE);
        store.put({ data, timestamp: Date.now() } satisfies CacheEntry, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error('[OverpassFetcher] Cache write error:', tx.error);
          resolve();
        };
      });
    } catch {
      // cache write failures are non-fatal
    }
  }

  private nextServer(): string {
    const server = OVERPASS_SERVERS[this.serverIndex % OVERPASS_SERVERS.length];
    this.serverIndex++;
    return server;
  }

  async fetchTile(tileX: number, tileY: number): Promise<OSMElement[]> {
    const key = tileKey(tileX, tileY);
    const bbox = tileBbox(tileX, tileY);

    const cached = await this.getCached(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      const parsed = JSON.parse(cached.data);
      const elements: OSMElement[] = parsed.elements ?? parsed;
      console.log(`[OverpassFetcher] cache hit ${key} (${elements.length} elements)`);
      return elements;
    }

    const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const serverUrl = this.nextServer();
      const serverName = new URL(serverUrl).hostname.split('.')[0];

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 || response.status === 503) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
          console.log(`[OverpassFetcher] ${serverName} ${response.status} for ${key}, backoff ${backoff}ms`);
          await this.sleep(backoff);
          continue;
        }

        if (!response.ok) {
          lastError = new Error(`${serverName} ${response.status}: ${response.statusText}`);
          console.error(`[OverpassFetcher] ${lastError.message}`);
          continue;
        }

        const text = await response.text();
        const json = JSON.parse(text);

        if (!json.elements || !Array.isArray(json.elements)) {
          lastError = new Error(`Invalid response from ${serverName}: missing elements`);
          console.error(`[OverpassFetcher] ${lastError.message}`);
          continue;
        }

        console.log(`[OverpassFetcher] ${serverName} ${key}: ${json.elements.length} elements`);

        this.setCache(key, text).catch(() => {});

        return json.elements as OSMElement[];
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.name === 'AbortError' ? 'timeout' : lastError.message;
        console.error(`[OverpassFetcher] ${serverName} ${key}: ${msg}`);

        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_BACKOFF_MS * (attempt + 1);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`All ${MAX_RETRIES} attempts failed for tile ${key}: ${lastError?.message ?? 'unknown'}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
