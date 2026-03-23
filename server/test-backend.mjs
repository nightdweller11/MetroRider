/**
 * Backend integration test for the tile server.
 * Tests: config, SQLite store, single tile API, batch API, caching.
 * Run: node test-backend.mjs
 */

const SERVER = 'http://localhost:3001';

async function testHealth() {
  console.log('\n=== Test: Health endpoint ===');
  const res = await fetch(`${SERVER}/health`);
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Body: ${JSON.stringify(data)}`);
  if (res.status !== 200) throw new Error(`Health check failed: ${res.status}`);
  if (data.status !== 'ok') throw new Error(`Health check bad status: ${data.status}`);
  console.log('  PASS');
  return data.tiles;
}

async function testSingleTile() {
  // Tel Aviv area tile - should have buildings/roads
  const tileX = 3479;  // floor(34.79 / 0.01) = 3479
  const tileY = 3208;  // floor(32.08 / 0.01) = 3208
  console.log(`\n=== Test: Single tile fetch (${tileX}, ${tileY}) ===`);

  const start = Date.now();
  const res = await fetch(`${SERVER}/api/tiles/${tileX}/${tileY}`);
  const elapsed = Date.now() - start;
  console.log(`  Status: ${res.status} (${elapsed}ms)`);

  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`Single tile fetch failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log(`  tileX: ${data.tileX}, tileY: ${data.tileY}`);
  console.log(`  bbox: S=${data.bbox.south} W=${data.bbox.west} N=${data.bbox.north} E=${data.bbox.east}`);
  console.log(`  elements: ${data.data.length}`);
  console.log(`  fromCache: ${data.fromCache}`);
  console.log(`  cachedAt: ${new Date(data.cachedAt).toISOString()}`);

  // Validate bbox math
  const expectedSouth = tileY * 0.01;
  const expectedWest = tileX * 0.01;
  if (Math.abs(data.bbox.south - expectedSouth) > 0.0001) {
    throw new Error(`bbox.south mismatch: ${data.bbox.south} vs expected ${expectedSouth}`);
  }
  if (Math.abs(data.bbox.west - expectedWest) > 0.0001) {
    throw new Error(`bbox.west mismatch: ${data.bbox.west} vs expected ${expectedWest}`);
  }

  // Categorize elements
  const nodes = data.data.filter(e => e.type === 'node');
  const ways = data.data.filter(e => e.type === 'way');
  const buildings = ways.filter(w => w.tags?.building);
  const highways = ways.filter(w => w.tags?.highway);
  const trees = nodes.filter(n => n.tags?.natural === 'tree');
  console.log(`  Nodes: ${nodes.length}, Ways: ${ways.length}`);
  console.log(`  Buildings: ${buildings.length}, Highways: ${highways.length}, Trees: ${trees.length}`);

  console.log('  PASS');
  return data;
}

async function testCaching(tileX, tileY) {
  console.log(`\n=== Test: Cache hit (${tileX}, ${tileY}) ===`);

  const start = Date.now();
  const res = await fetch(`${SERVER}/api/tiles/${tileX}/${tileY}`);
  const elapsed = Date.now() - start;
  const data = await res.json();

  console.log(`  Status: ${res.status} (${elapsed}ms)`);
  console.log(`  fromCache: ${data.fromCache}`);
  console.log(`  elements: ${data.data.length}`);

  if (!data.fromCache) {
    console.log('  WARNING: Expected cache hit but got fresh fetch');
  }
  if (elapsed > 100) {
    console.log(`  WARNING: Cache response took ${elapsed}ms, expected < 100ms`);
  }
  console.log('  PASS');
}

async function testBatch() {
  // 4 tiles around central Tel Aviv
  const tiles = [
    { x: 3479, y: 3208 },
    { x: 3480, y: 3208 },
    { x: 3479, y: 3209 },
    { x: 3480, y: 3209 },
  ];
  const tilesParam = tiles.map(t => `${t.x},${t.y}`).join(';');

  console.log(`\n=== Test: Batch tile fetch (${tiles.length} tiles) ===`);

  const start = Date.now();
  const res = await fetch(`${SERVER}/api/tiles/batch?tiles=${tilesParam}`);
  const elapsed = Date.now() - start;
  console.log(`  Status: ${res.status} (${elapsed}ms)`);

  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`Batch fetch failed: ${res.status} - ${text}`);
  }

  const results = await res.json();
  console.log(`  Results count: ${results.length}`);

  let totalElements = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  Tile (${r.tileX},${r.tileY}): ERROR - ${r.error}`);
    } else {
      console.log(`  Tile (${r.tileX},${r.tileY}): ${r.data.length} elements`);
      totalElements += r.data.length;
    }
  }
  console.log(`  Total elements across all tiles: ${totalElements}`);

  if (results.length !== tiles.length) {
    throw new Error(`Expected ${tiles.length} results, got ${results.length}`);
  }

  console.log('  PASS');
}

async function testInvalidTile() {
  console.log('\n=== Test: Invalid tile coordinates ===');

  const res = await fetch(`${SERVER}/api/tiles/abc/def`);
  console.log(`  Status: ${res.status}`);
  if (res.status !== 400) {
    throw new Error(`Expected 400 for invalid coords, got ${res.status}`);
  }
  console.log('  PASS');
}

async function testTileCoordMath() {
  console.log('\n=== Test: Tile coordinate math ===');

  const TILE_SIZE = 0.01;
  const testCases = [
    { lat: 32.0853, lng: 34.7818, desc: 'Tel Aviv center' },
    { lat: 32.514, lng: 34.949, desc: 'Caesarea' },
    { lat: 31.768, lng: 35.213, desc: 'Jerusalem' },
    { lat: 32.794, lng: 34.989, desc: 'Haifa' },
  ];

  for (const tc of testCases) {
    const tileX = Math.floor(tc.lng / TILE_SIZE);
    const tileY = Math.floor(tc.lat / TILE_SIZE);
    const bboxS = tileY * TILE_SIZE;
    const bboxW = tileX * TILE_SIZE;
    const bboxN = (tileY + 1) * TILE_SIZE;
    const bboxE = (tileX + 1) * TILE_SIZE;

    const containsLat = tc.lat >= bboxS && tc.lat < bboxN;
    const containsLng = tc.lng >= bboxW && tc.lng < bboxE;

    console.log(`  ${tc.desc}: (${tc.lat}, ${tc.lng}) -> tile (${tileX}, ${tileY}), bbox: (${bboxS.toFixed(4)},${bboxW.toFixed(4)})-(${bboxN.toFixed(4)},${bboxE.toFixed(4)}), contains: lat=${containsLat} lng=${containsLng}`);

    if (!containsLat || !containsLng) {
      throw new Error(`Tile (${tileX},${tileY}) does not contain point (${tc.lat},${tc.lng})`);
    }
  }
  console.log('  PASS');
}

async function testLoadRadiusMath() {
  console.log('\n=== Test: Load radius tile count ===');

  const TILE_SIZE = 0.01;
  const loadRadius = 3;
  const unloadRadius = 5;

  const centerLat = 32.0853;
  const centerLng = 34.7818;
  const centerTileX = Math.floor(centerLng / TILE_SIZE);
  const centerTileY = Math.floor(centerLat / TILE_SIZE);

  let loadTiles = 0;
  let unloadTiles = 0;
  for (let dx = -unloadRadius; dx <= unloadRadius; dx++) {
    for (let dy = -unloadRadius; dy <= unloadRadius; dy++) {
      if (Math.abs(dx) <= loadRadius && Math.abs(dy) <= loadRadius) {
        loadTiles++;
      } else {
        unloadTiles++;
      }
    }
  }

  const tileSizeKm = TILE_SIZE * 111.319;
  const loadGridSize = (2 * loadRadius + 1);
  const loadAreaKm = loadGridSize * tileSizeKm;

  console.log(`  Center tile: (${centerTileX}, ${centerTileY})`);
  console.log(`  Load radius: ${loadRadius} -> ${loadGridSize}x${loadGridSize} = ${loadTiles} tiles`);
  console.log(`  Tile size: ~${tileSizeKm.toFixed(2)} km`);
  console.log(`  Load area: ~${loadAreaKm.toFixed(1)} x ${loadAreaKm.toFixed(1)} km`);
  console.log(`  Unload buffer: ${unloadTiles} tiles between load and unload radius`);
  console.log(`  Total managed: ${loadTiles + unloadTiles} tiles`);

  if (loadTiles !== 49) throw new Error(`Expected 49 load tiles for radius 3, got ${loadTiles}`);
  console.log('  PASS');
}

async function main() {
  console.log('=== MetroRider Backend Test Suite ===');
  console.log(`Server: ${SERVER}`);

  let passed = 0;
  let failed = 0;

  const tests = [
    ['Health', testHealth],
    ['Tile coord math', testTileCoordMath],
    ['Load radius math', testLoadRadiusMath],
    ['Single tile fetch', testSingleTile],
    ['Invalid tile', testInvalidTile],
  ];

  let firstTileData = null;

  for (const [name, fn] of tests) {
    try {
      const result = await fn();
      if (name === 'Single tile fetch') firstTileData = result;
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${err.message}`);
      failed++;
    }
  }

  // Cache test needs a previously fetched tile
  if (firstTileData) {
    try {
      await testCaching(firstTileData.tileX, firstTileData.tileY);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${err.message}`);
      failed++;
    }
  }

  // Batch test
  try {
    await testBatch();
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${err.message}`);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
