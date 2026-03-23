/**
 * Test that simulates the priority loading behavior:
 * - Tiles near the train should load before distant tiles
 * - Concurrent requests should spread across servers
 * - Cached tiles should be nearly instant
 * Run: node test-priority-loading.mjs
 */

const SERVER = 'http://localhost:3001';
const TILE_SIZE_DEG = 0.01;
const LOAD_RADIUS = 3;

function tileCoord(lat, lng) {
  return { tileX: Math.floor(lng / TILE_SIZE_DEG), tileY: Math.floor(lat / TILE_SIZE_DEG) };
}

async function main() {
  console.log('=== Priority Loading Test ===\n');

  // Simulate train at Ra'anana area (from the user's screenshot)
  const trainLat = 32.192;
  const trainLng = 34.833;
  const { tileX, tileY } = tileCoord(trainLat, trainLng);
  console.log(`Train at (${trainLat}, ${trainLng}) -> tile (${tileX}, ${tileY})`);

  // Build prioritized tile list like TileManager does
  const tiles = [];
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      tiles.push({
        x: tileX + dx,
        y: tileY + dy,
        priority: dist <= 2 ? 'URGENT' : 'NORMAL',
        dist,
      });
    }
  }

  // Sort by priority then distance (simulating resortQueue)
  tiles.sort((a, b) => {
    const pa = a.priority === 'URGENT' ? 0 : 1;
    const pb = b.priority === 'URGENT' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.dist - b.dist;
  });

  const urgent = tiles.filter(t => t.priority === 'URGENT');
  const normal = tiles.filter(t => t.priority === 'NORMAL');
  console.log(`Queue: ${urgent.length} URGENT, ${normal.length} NORMAL (${tiles.length} total)`);

  // Load URGENT tiles concurrently (6 at a time, like new TileManager)
  console.log('\n--- Loading URGENT tiles (6 concurrent) ---');
  const urgentStart = Date.now();
  const urgentResults = [];

  const loadTile = async (t) => {
    const start = Date.now();
    const res = await fetch(`${SERVER}/api/tiles/${t.x}/${t.y}`);
    const data = await res.json();
    const elapsed = Date.now() - start;
    return { ...t, elements: data.data?.length ?? 0, cached: data.fromCache, elapsed };
  };

  // Batch load with concurrency 6
  for (let i = 0; i < urgent.length; i += 6) {
    const batch = urgent.slice(i, i + 6);
    const results = await Promise.all(batch.map(loadTile));
    for (const r of results) {
      urgentResults.push(r);
      const totalMs = Date.now() - urgentStart;
      console.log(`  ${r.priority} tile (${r.x},${r.y}) dist=${r.dist}: ${r.elements} el, cached=${r.cached}, ${r.elapsed}ms (total: ${totalMs}ms)`);
    }
  }

  const urgentTotal = Date.now() - urgentStart;
  const urgentCached = urgentResults.filter(r => r.cached).length;
  console.log(`\nURGENT summary: ${urgentResults.length} tiles in ${urgentTotal}ms (${urgentCached} cached, ${urgentResults.length - urgentCached} fresh)`);

  // Load first batch of NORMAL tiles
  console.log('\n--- Loading first 6 NORMAL tiles ---');
  const normalStart = Date.now();
  const normalBatch = normal.slice(0, 6);
  const normalResults = await Promise.all(normalBatch.map(loadTile));
  for (const r of normalResults) {
    console.log(`  ${r.priority} tile (${r.x},${r.y}) dist=${r.dist}: ${r.elements} el, cached=${r.cached}, ${r.elapsed}ms`);
  }
  const normalTotal = Date.now() - normalStart;
  const normalCached = normalResults.filter(r => r.cached).length;
  console.log(`\nNORMAL summary: ${normalResults.length} tiles in ${normalTotal}ms (${normalCached} cached, ${normalResults.length - normalCached} fresh)`);

  // Simulate train movement: moving 1 tile east
  console.log('\n--- Simulating train move east ---');
  const newTileX = tileX + 1;
  console.log(`New tile: (${newTileX}, ${tileY})`);

  const newUrgent = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const key = `${newTileX + dx},${tileY + dy}`;
      const alreadyLoaded = urgentResults.some(r => r.x === newTileX + dx && r.y === tileY + dy) ||
                              normalResults.some(r => r.x === newTileX + dx && r.y === tileY + dy);
      if (!alreadyLoaded) {
        newUrgent.push({ x: newTileX + dx, y: tileY + dy, dist: Math.abs(dx) + Math.abs(dy) });
      }
    }
  }

  console.log(`  New URGENT tiles needed: ${newUrgent.length}`);
  if (newUrgent.length > 0) {
    const moveStart = Date.now();
    const moveResults = await Promise.all(newUrgent.slice(0, 6).map(t => loadTile({ ...t, priority: 'URGENT' })));
    const moveTotal = Date.now() - moveStart;
    for (const r of moveResults) {
      console.log(`  NEW tile (${r.x},${r.y}): ${r.elements} el, cached=${r.cached}, ${r.elapsed}ms`);
    }
    console.log(`  New tiles loaded in ${moveTotal}ms`);
  }

  console.log('\n=== Priority loading test complete ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
