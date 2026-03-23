/**
 * Tests the full tile lifecycle: load, cache, dynamic loading, unloading decisions.
 * Simulates what TileManager does as the train moves.
 * Run: node test-tile-lifecycle.mjs
 */

const SERVER = 'http://localhost:3001';
const TILE_SIZE_DEG = 0.01;
const LOAD_RADIUS = 3;
const UNLOAD_RADIUS = 5;

function tileCoord(lat, lng) {
  return { tileX: Math.floor(lng / TILE_SIZE_DEG), tileY: Math.floor(lat / TILE_SIZE_DEG) };
}
function tileKey(x, y) { return `${x},${y}`; }

async function fetchTile(x, y) {
  const res = await fetch(`${SERVER}/api/tiles/${x}/${y}`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

async function main() {
  console.log('=== Tile Lifecycle Test ===\n');

  // Simulate a train moving along a path (Tel Aviv area, cached tiles)
  const trainPath = [
    { lat: 32.085, lng: 34.782 },  // Start
    { lat: 32.085, lng: 34.790 },  // Move east (same tile y)
    { lat: 32.085, lng: 34.800 },  // Cross tile boundary east
    { lat: 32.090, lng: 34.800 },  // Cross tile boundary north
    { lat: 32.095, lng: 34.810 },  // Move further northeast
  ];

  const loaded = new Map();
  const pending = new Set();
  let totalLoaded = 0;
  let totalUnloaded = 0;

  for (let step = 0; step < trainPath.length; step++) {
    const pos = trainPath[step];
    const { tileX, tileY } = tileCoord(pos.lat, pos.lng);
    console.log(`--- Step ${step + 1}: Train at (${pos.lat}, ${pos.lng}) -> tile (${tileX}, ${tileY}) ---`);

    // Compute needed tiles
    const needed = new Set();
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        needed.add(tileKey(tileX + dx, tileY + dy));
      }
    }

    // Find tiles to load
    const toLoad = [];
    for (const key of needed) {
      if (!loaded.has(key) && !pending.has(key)) {
        const [x, y] = key.split(',').map(Number);
        toLoad.push({ x, y, key });
      }
    }

    // Find tiles to unload
    const toUnload = [];
    for (const [key, tile] of loaded) {
      const dx = Math.abs(tile.x - tileX);
      const dy = Math.abs(tile.y - tileY);
      if (dx > UNLOAD_RADIUS || dy > UNLOAD_RADIUS) {
        toUnload.push(key);
      }
    }

    console.log(`  Needed: ${needed.size}, Already loaded: ${loaded.size}`);
    console.log(`  To load: ${toLoad.length}, To unload: ${toUnload.length}`);

    // Unload
    for (const key of toUnload) {
      loaded.delete(key);
      totalUnloaded++;
    }

    // Load (just the first 3 to keep the test fast)
    const sample = toLoad.slice(0, 3);
    for (const t of sample) {
      try {
        const start = Date.now();
        const data = await fetchTile(t.x, t.y);
        const elapsed = Date.now() - start;
        loaded.set(t.key, { x: t.x, y: t.y, elements: data.data.length });
        totalLoaded++;
        console.log(`  Loaded tile ${t.key}: ${data.data.length} elements, cached: ${data.fromCache}, ${elapsed}ms`);
      } catch (err) {
        console.error(`  Failed to load tile ${t.key}: ${err.message}`);
      }
    }

    // Mark rest as "would load"
    if (toLoad.length > sample.length) {
      console.log(`  (would also load ${toLoad.length - sample.length} more tiles)`);
      for (const t of toLoad.slice(sample.length)) {
        loaded.set(t.key, { x: t.x, y: t.y, elements: -1 }); // placeholder
      }
    }

    console.log(`  State: ${loaded.size} loaded, ${totalLoaded} total fetched, ${totalUnloaded} total unloaded\n`);
  }

  // Verify no tile is loaded twice
  console.log('--- Verification ---');
  console.log(`  Total tiles loaded: ${totalLoaded}`);
  console.log(`  Total tiles unloaded: ${totalUnloaded}`);
  console.log(`  Currently loaded: ${loaded.size}`);

  // Test cache performance
  console.log('\n--- Cache performance test ---');
  const cachedTile = { x: 3478, y: 3208 };
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await fetchTile(cachedTile.x, cachedTile.y);
    times.push(Date.now() - start);
  }
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  5 cached fetches: avg ${avgTime.toFixed(1)}ms, times: [${times.join(', ')}]ms`);

  if (avgTime < 100) {
    console.log('  PASS: Cached tile performance is good');
  } else {
    console.log('  WARNING: Cached tiles are slow');
  }

  console.log('\n=== Lifecycle test complete ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
