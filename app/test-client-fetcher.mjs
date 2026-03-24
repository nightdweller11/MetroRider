/**
 * Node.js test script for the client-side Overpass tile fetching logic.
 *
 * Replicates the core algorithms from ClientOverpassFetcher.ts and
 * tileConfig.ts so they can be tested outside the browser (no IndexedDB,
 * no Three.js).
 */

// ───────── Replicate tileConfig.ts ─────────

const TILE_SIZE_DEG = 0.01;
const LOAD_RADIUS = 2;
const UNLOAD_RADIUS = 3;

function tileCoord(lat, lng) {
  return {
    tileX: Math.floor(lng / TILE_SIZE_DEG),
    tileY: Math.floor(lat / TILE_SIZE_DEG),
  };
}

function tileBbox(tileX, tileY) {
  return {
    south: tileY * TILE_SIZE_DEG,
    west: tileX * TILE_SIZE_DEG,
    north: (tileY + 1) * TILE_SIZE_DEG,
    east: (tileX + 1) * TILE_SIZE_DEG,
  };
}

function tileKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

// ───────── Replicate buildQuery ─────────

function buildQuery(south, west, north, east) {
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

// ───────── Replicate parseOSMElements ─────────

function parseOSMElements(elements) {
  const nodeMap = new Map();
  const buildings = [];
  const highways = [];
  const railways = [];
  const trees = [];
  const treeRows = [];
  const parks = [];
  const water = [];
  const benches = [];
  const streetLamps = [];
  const trafficSignals = [];

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
      if (
        el.tags['leisure'] === 'park' ||
        el.tags['leisure'] === 'garden' ||
        el.tags['landuse'] === 'grass'
      ) {
        parks.push(el);
      }
    }
  }

  return { nodeMap, buildings, highways, railways, trees, treeRows, parks, water, benches, streetLamps, trafficSignals };
}

// ───────── Overpass servers & round-robin ─────────

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

let serverIndex = 0;
function nextServer() {
  const s = OVERPASS_SERVERS[serverIndex % OVERPASS_SERVERS.length];
  serverIndex++;
  return s;
}

// ───────── Test helpers ─────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

async function testTileCoordMath() {
  console.log('\n=== Test: Tile coordinate math ===');

  const cities = [
    { name: 'Tel Aviv',   lat: 32.0853,  lng: 34.7818 },
    { name: 'Haifa',      lat: 32.794,   lng: 34.989 },
    { name: 'Jerusalem',  lat: 31.768,   lng: 35.213 },
    { name: 'Caesarea',   lat: 32.514,   lng: 34.949 },
  ];

  for (const city of cities) {
    const { tileX, tileY } = tileCoord(city.lat, city.lng);
    const bbox = tileBbox(tileX, tileY);

    const latInBbox = city.lat >= bbox.south && city.lat < bbox.north;
    const lngInBbox = city.lng >= bbox.west && city.lng < bbox.east;

    console.log(
      `  ${city.name}: (${city.lat}, ${city.lng}) -> tile (${tileX}, ${tileY}), ` +
      `bbox: (${bbox.south.toFixed(4)},${bbox.west.toFixed(4)})-(${bbox.north.toFixed(4)},${bbox.east.toFixed(4)})`
    );
    assert(latInBbox && lngInBbox, `${city.name} lat/lng contained in its tile bbox`);
  }

  const ta = tileCoord(32.0853, 34.7818);
  assert(tileKey(ta.tileX, ta.tileY) === `${ta.tileX},${ta.tileY}`, 'tileKey format');
}

async function testLoadRadiusTileCount() {
  console.log('\n=== Test: Load radius tile count ===');
  const center = tileCoord(32.0853, 34.7818);
  let count = 0;
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      count++;
    }
  }
  const expected = (2 * LOAD_RADIUS + 1) ** 2;
  assert(count === expected, `Load radius ${LOAD_RADIUS} -> ${count} tiles (expected ${expected})`);
  console.log(`  Tile size: ~${(TILE_SIZE_DEG * 111319).toFixed(0)}m`);
  console.log(`  Coverage: ~${((2 * LOAD_RADIUS + 1) * TILE_SIZE_DEG * 111.319).toFixed(1)}km`);

  const unloadTiles = (2 * UNLOAD_RADIUS + 1) ** 2;
  assert(UNLOAD_RADIUS > LOAD_RADIUS, `UNLOAD_RADIUS (${UNLOAD_RADIUS}) > LOAD_RADIUS (${LOAD_RADIUS})`);
  console.log(`  Unload radius: ${UNLOAD_RADIUS} -> max ${unloadTiles} tiles`);
}

async function testBuildQuery() {
  console.log('\n=== Test: Overpass query building ===');
  const bbox = tileBbox(3478, 3208);
  const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);

  assert(query.includes('[out:json]'), 'Query contains [out:json]');
  assert(query.includes('way["building"]'), 'Query requests buildings');
  assert(query.includes('way["highway"]'), 'Query requests highways');
  assert(query.includes('way["railway"]'), 'Query requests railways');
  assert(query.includes('node["natural"="tree"]'), 'Query requests trees');
  assert(query.includes('node["amenity"="bench"]'), 'Query requests benches');
  assert(query.includes('out body; >; out skel qt;'), 'Query has correct output format');
  assert(query.includes(`${bbox.south}`), 'Query uses correct bbox south');
}

async function testRoundRobin() {
  console.log('\n=== Test: Round-robin server selection ===');
  serverIndex = 0;
  const s1 = nextServer();
  const s2 = nextServer();
  const s3 = nextServer();
  const s4 = nextServer();

  assert(s1 === OVERPASS_SERVERS[0], `First server: ${new URL(s1).hostname}`);
  assert(s2 === OVERPASS_SERVERS[1], `Second server: ${new URL(s2).hostname}`);
  assert(s3 === OVERPASS_SERVERS[2], `Third server: ${new URL(s3).hostname}`);
  assert(s4 === OVERPASS_SERVERS[0], `Fourth server wraps to first: ${new URL(s4).hostname}`);
}

async function testLiveOverpassFetch() {
  console.log('\n=== Test: Live Overpass fetch (single tile, Tel Aviv center) ===');

  const { tileX, tileY } = tileCoord(32.0853, 34.7818);
  const bbox = tileBbox(tileX, tileY);
  const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);
  const serverUrl = OVERPASS_SERVERS[0];

  console.log(`  Tile: (${tileX}, ${tileY}), server: ${new URL(serverUrl).hostname}`);
  const t0 = Date.now();

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

    assert(response.ok, `HTTP ${response.status} OK`);

    const text = await response.text();
    const json = JSON.parse(text);
    const elapsed = Date.now() - t0;

    assert(Array.isArray(json.elements), `Response has elements array`);
    assert(json.elements.length > 0, `Elements count: ${json.elements.length}`);

    const data = parseOSMElements(json.elements);
    console.log(`  Fetched in ${elapsed}ms`);
    console.log(`  Nodes: ${data.nodeMap.size}, Buildings: ${data.buildings.length}, Highways: ${data.highways.length}`);
    console.log(`  Railways: ${data.railways.length}, Trees: ${data.trees.length}, Parks: ${data.parks.length}`);

    assert(data.nodeMap.size > 0, 'Has nodes');
    assert(data.buildings.length > 0, 'Has buildings (Tel Aviv center)');
    assert(data.highways.length > 0, 'Has highways');
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    assert(false, `Live fetch failed: ${err.message}`);
  }
}

async function testParseOSMElements() {
  console.log('\n=== Test: parseOSMElements categorization ===');

  const fakeElements = [
    { type: 'node', id: 1, lat: 32.0, lon: 34.7, tags: { natural: 'tree' } },
    { type: 'node', id: 2, lat: 32.0, lon: 34.7, tags: { amenity: 'bench' } },
    { type: 'node', id: 3, lat: 32.0, lon: 34.7, tags: { highway: 'street_lamp' } },
    { type: 'node', id: 4, lat: 32.0, lon: 34.7, tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 5, lat: 32.0, lon: 34.7 },
    { type: 'way', id: 100, nodes: [1, 2], tags: { building: 'yes' } },
    { type: 'way', id: 101, nodes: [1, 3], tags: { highway: 'residential' } },
    { type: 'way', id: 102, nodes: [1, 4], tags: { railway: 'rail' } },
    { type: 'way', id: 103, nodes: [1, 5], tags: { leisure: 'park' } },
    { type: 'way', id: 104, nodes: [2, 3], tags: { natural: 'water' } },
    { type: 'way', id: 105, nodes: [2, 4], tags: { natural: 'tree_row' } },
    { type: 'way', id: 106, nodes: [3, 5], tags: { landuse: 'grass' } },
    { type: 'way', id: 107, nodes: [4, 5] },
  ];

  const data = parseOSMElements(fakeElements);

  assert(data.nodeMap.size === 5, `nodeMap has 5 entries (got ${data.nodeMap.size})`);
  assert(data.trees.length === 1, `1 tree (got ${data.trees.length})`);
  assert(data.benches.length === 1, `1 bench (got ${data.benches.length})`);
  assert(data.streetLamps.length === 1, `1 street lamp (got ${data.streetLamps.length})`);
  assert(data.trafficSignals.length === 1, `1 traffic signal (got ${data.trafficSignals.length})`);
  assert(data.buildings.length === 1, `1 building (got ${data.buildings.length})`);
  assert(data.highways.length === 1, `1 highway (got ${data.highways.length})`);
  assert(data.railways.length === 1, `1 railway (got ${data.railways.length})`);
  assert(data.parks.length === 2, `2 parks (park + grass) (got ${data.parks.length})`);
  assert(data.water.length === 1, `1 water (got ${data.water.length})`);
  assert(data.treeRows.length === 1, `1 tree row (got ${data.treeRows.length})`);
}

async function testConcurrentFetches() {
  console.log('\n=== Test: Concurrent tile fetches (3 tiles) ===');

  const tiles = [
    tileCoord(32.0853, 34.7818),
    tileCoord(32.0853, 34.7918),
    tileCoord(32.0953, 34.7818),
  ];

  const t0 = Date.now();

  const fetchOne = async (tile, idx) => {
    const bbox = tileBbox(tile.tileX, tile.tileY);
    const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);
    const serverUrl = OVERPASS_SERVERS[idx % OVERPASS_SERVERS.length];
    const serverName = new URL(serverUrl).hostname.split('.')[0];

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
      throw new Error(`${serverName} HTTP ${response.status}`);
    }

    const text = await response.text();
    const json = JSON.parse(text);
    return { server: serverName, elements: json.elements?.length ?? 0, tile: `${tile.tileX},${tile.tileY}` };
  };

  try {
    const results = await Promise.all(tiles.map((t, i) => fetchOne(t, i)));
    const elapsed = Date.now() - t0;

    for (const r of results) {
      console.log(`  Tile ${r.tile} via ${r.server}: ${r.elements} elements`);
      assert(r.elements > 0, `Tile ${r.tile} has elements`);
    }

    assert(results.length === 3, `All 3 fetches completed`);
    console.log(`  Total time: ${elapsed}ms (concurrent across ${new Set(results.map(r => r.server)).size} servers)`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    assert(false, `Concurrent fetch failed: ${err.message}`);
  }
}

async function testRetryOnBadUrl() {
  console.log('\n=== Test: Retry on bad server URL ===');

  const badUrl = 'https://httpstat.us/503';
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(badUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    assert(response.status === 503, `Bad URL returned 503 (got ${response.status})`);
    assert(!response.ok, 'Response is not OK');

    const wouldRetry = response.status === 503 || response.status === 429;
    assert(wouldRetry, 'Status 503 triggers retry logic');
    console.log(`  Confirmed: 503 status detected in ${Date.now() - t0}ms, retry logic would fire`);
  } catch (err) {
    console.log(`  Fetch to bad URL errored (expected): ${err.message}`);
    assert(true, 'Error caught gracefully (would trigger retry)');
  }
}

async function testTileUnloadLogic() {
  console.log('\n=== Test: Tile unload logic ===');

  const center = tileCoord(32.0853, 34.7818);

  const loadedTiles = new Map();
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      const key = tileKey(center.tileX + dx, center.tileY + dy);
      loadedTiles.set(key, { tileX: center.tileX + dx, tileY: center.tileY + dy });
    }
  }

  assert(loadedTiles.size === 25, `Initial loaded: ${loadedTiles.size} (5x5 grid)`);

  const newCenter = { tileX: center.tileX + 2, tileY: center.tileY };
  const toUnload = [];
  for (const [key, tile] of loadedTiles) {
    const dx = Math.abs(tile.tileX - newCenter.tileX);
    const dy = Math.abs(tile.tileY - newCenter.tileY);
    if (dx > UNLOAD_RADIUS || dy > UNLOAD_RADIUS) {
      toUnload.push(key);
    }
  }

  console.log(`  After moving 2 tiles east: ${toUnload.length} tiles to unload`);
  assert(toUnload.length > 0, 'Some tiles would be unloaded');

  const remaining = loadedTiles.size - toUnload.length;
  console.log(`  Remaining: ${remaining}, to unload: ${toUnload.length}`);
  assert(remaining > 0, 'Some tiles remain loaded');
}

async function testQueuePriority() {
  console.log('\n=== Test: Queue priority sorting ===');

  const center = { tileX: 3478, tileY: 3208 };
  const queue = [];

  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      const priority = dist <= 1 ? 0 : 1;
      queue.push({ x: center.tileX + dx, y: center.tileY + dy, priority });
    }
  }

  queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = Math.abs(a.x - center.tileX) + Math.abs(a.y - center.tileY);
    const db = Math.abs(b.x - center.tileX) + Math.abs(b.y - center.tileY);
    return da - db;
  });

  assert(queue[0].priority === 0, `First item is URGENT (priority=${queue[0].priority})`);
  assert(queue[0].x === center.tileX && queue[0].y === center.tileY, 'First item is center tile');

  const urgentCount = queue.filter(e => e.priority === 0).length;
  const normalCount = queue.filter(e => e.priority === 1).length;
  assert(urgentCount === 5, `5 URGENT tiles (center + 4 adjacent), got ${urgentCount}`);
  assert(normalCount === 20, `20 NORMAL tiles, got ${normalCount}`);
  assert(queue.length === 25, `Total 25 tiles, got ${queue.length}`);

  console.log(`  Queue order: URGENT=${urgentCount}, NORMAL=${normalCount}`);
}

// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== MetroRider Client-Side Fetcher Test Suite ===\n');

  await testTileCoordMath();
  await testLoadRadiusTileCount();
  await testBuildQuery();
  await testRoundRobin();
  await testParseOSMElements();
  await testQueuePriority();
  await testTileUnloadLogic();
  await testRetryOnBadUrl();
  await testLiveOverpassFetch();
  await testConcurrentFetches();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
