const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE_DB_NAME = 'metrorider_osm_cache';
const CACHE_STORE = 'tiles';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RETRIES = 3;

export interface OSMNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OSMWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

export interface OSMRelation {
  type: 'relation';
  id: number;
  members: Array<{
    type: 'node' | 'way' | 'relation';
    ref: number;
    role: string;
  }>;
  tags?: Record<string, string>;
}

export type OSMElement = OSMNode | OSMWay | OSMRelation;

export interface OSMData {
  nodeMap: Map<number, OSMNode>;
  buildings: OSMWay[];
  highways: OSMWay[];
  railways: OSMWay[];
  trees: OSMNode[];
  treeRows: OSMWay[];
  parks: OSMWay[];
  water: OSMWay[];
  benches: OSMNode[];
  streetLamps: OSMNode[];
  trafficSignals: OSMNode[];
}

function bboxKey(south: number, west: number, north: number, east: number): string {
  return `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
}

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

async function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error('[OSMFetcher] IndexedDB open error:', request.error);
      reject(request.error);
    };
  });
}

async function getCached(db: IDBDatabase, key: string): Promise<{ data: string; timestamp: number } | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const store = tx.objectStore(CACHE_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => {
      console.error('[OSMFetcher] Cache read error:', req.error);
      resolve(null);
    };
  });
}

async function setCache(db: IDBDatabase, key: string, data: string): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    store.put({ data, timestamp: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[OSMFetcher] Cache write error:', tx.error);
      resolve();
    };
  });
}

function parseOSMResponse(elements: OSMElement[]): OSMData {
  const nodeMap = new Map<number, OSMNode>();
  const buildings: OSMWay[] = [];
  const highways: OSMWay[] = [];
  const railways: OSMWay[] = [];
  const trees: OSMNode[] = [];
  const treeRows: OSMWay[] = [];
  const parks: OSMWay[] = [];
  const water: OSMWay[] = [];
  const benches: OSMNode[] = [];
  const streetLamps: OSMNode[] = [];
  const trafficSignals: OSMNode[] = [];

  for (const el of elements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);

      if (!el.tags) continue;
      if (el.tags['natural'] === 'tree') trees.push(el);
      if (el.tags['amenity'] === 'bench') benches.push(el);
      if (el.tags['highway'] === 'street_lamp') streetLamps.push(el);
      if (el.tags['highway'] === 'traffic_signals') trafficSignals.push(el);
    } else if (el.type === 'way') {
      if (!el.tags) continue;
      if (el.tags['building']) buildings.push(el);
      if (el.tags['highway']) highways.push(el);
      if (el.tags['railway']) railways.push(el);
      if (el.tags['natural'] === 'tree_row') treeRows.push(el);
      if (el.tags['natural'] === 'water') water.push(el);
      if (el.tags['waterway']) water.push(el);
      if (el.tags['leisure'] === 'park' || el.tags['leisure'] === 'garden' || el.tags['landuse'] === 'grass') {
        parks.push(el);
      }
    }
  }

  return { nodeMap, buildings, highways, railways, trees, treeRows, parks, water, benches, streetLamps, trafficSignals };
}

export async function fetchOSMData(
  south: number, west: number, north: number, east: number,
): Promise<OSMData> {
  const key = bboxKey(south, west, north, east);

  let db: IDBDatabase | null = null;
  try {
    db = await openCacheDB();
    const cached = await getCached(db, key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      console.log(`[OSMFetcher] Cache hit for bbox ${key}`);
      const parsed = JSON.parse(cached.data);
      return parseOSMResponse(parsed.elements);
    }
  } catch (err) {
    console.error('[OSMFetcher] Cache check failed, fetching from API:', err);
  }

  const query = buildQuery(south, west, north, east);

  let text: string | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const serverUrl = OVERPASS_SERVERS[attempt % OVERPASS_SERVERS.length];
    console.log(`[OSMFetcher] Attempt ${attempt + 1}/${MAX_RETRIES}: fetching from ${serverUrl}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = new Error(`Overpass API returned ${response.status}: ${response.statusText}`);
        console.error(`[OSMFetcher] ${lastError.message}, trying next server...`);
        continue;
      }

      text = await response.text();
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[OSMFetcher] Attempt ${attempt + 1} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES - 1) {
        const delay = 2000 * (attempt + 1);
        console.log(`[OSMFetcher] Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  if (!text) {
    throw new Error(`[OSMFetcher] All ${MAX_RETRIES} attempts failed. Last error: ${lastError?.message ?? 'unknown'}`);
  }

  const json = JSON.parse(text);

  if (!json.elements || !Array.isArray(json.elements)) {
    throw new Error('[OSMFetcher] Invalid Overpass API response: missing elements array');
  }

  console.log(`[OSMFetcher] Received ${json.elements.length} elements from Overpass API`);

  if (db) {
    try {
      await setCache(db, key, text);
      console.log('[OSMFetcher] Cached response in IndexedDB');
    } catch (err) {
      console.error('[OSMFetcher] Failed to cache response:', err);
    }
  }

  return parseOSMResponse(json.elements);
}
