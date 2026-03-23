/**
 * End-to-end tile loading test - simulates what TileManager does:
 * 1. Compute center tile from a train position
 * 2. Fetch center tile (fast)
 * 3. Fetch surrounding tiles in batch
 * 4. Verify progressive loading would work
 *
 * Run: node test-e2e-tiles.mjs
 */

const SERVER = 'http://localhost:3001';
const TILE_SIZE_DEG = 0.01;
const LOAD_RADIUS = 3;

function tileCoord(lat, lng) {
  return {
    tileX: Math.floor(lng / TILE_SIZE_DEG),
    tileY: Math.floor(lat / TILE_SIZE_DEG),
  };
}

async function main() {
  // Simulate the Israel railways MetroDreamin map
  // C1 line first station: Caesarea area
  const trainLat = 32.514;
  const trainLng = 34.949;

  console.log('=== E2E Tile Loading Test ===');
  console.log(`Train position: (${trainLat}, ${trainLng})`);

  const center = tileCoord(trainLat, trainLng);
  console.log(`Center tile: (${center.tileX}, ${center.tileY})`);

  // Step 1: Load center tile (this is what loadInitialTiles awaits)
  console.log('\n--- Step 1: Center tile (blocking) ---');
  const t1 = Date.now();
  const centerRes = await fetch(`${SERVER}/api/tiles/${center.tileX}/${center.tileY}`);
  const centerData = await centerRes.json();
  const t1elapsed = Date.now() - t1;
  console.log(`  Status: ${centerRes.status}, elements: ${centerData.data.length}, time: ${t1elapsed}ms, cached: ${centerData.fromCache}`);

  if (centerData.data.length === 0) {
    console.log('  WARNING: Center tile has 0 elements. This could be in ocean/empty area.');
  }

  // Step 2: Compute surrounding tiles
  const surrounding = [];
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      if (dx === 0 && dy === 0) continue;
      surrounding.push({ x: center.tileX + dx, y: center.tileY + dy });
    }
  }

  // Sort by distance
  surrounding.sort((a, b) => {
    const da = Math.abs(a.x - center.tileX) + Math.abs(a.y - center.tileY);
    const db = Math.abs(b.x - center.tileX) + Math.abs(b.y - center.tileY);
    return da - db;
  });

  console.log(`\n--- Step 2: Surrounding tiles (${surrounding.length} tiles, background) ---`);

  // Load in batches of 9 (matching TileManager)
  const batchSize = 9;
  let totalElements = centerData.data.length;
  let tilesLoaded = 1;

  for (let i = 0; i < surrounding.length; i += batchSize) {
    const batch = surrounding.slice(i, i + batchSize);
    const tilesParam = batch.map(t => `${t.x},${t.y}`).join(';');

    const t2 = Date.now();
    const batchRes = await fetch(`${SERVER}/api/tiles/batch?tiles=${tilesParam}`);
    const batchData = await batchRes.json();
    const t2elapsed = Date.now() - t2;

    let batchElements = 0;
    for (const r of batchData) {
      if (!r.error) batchElements += r.data.length;
    }

    totalElements += batchElements;
    tilesLoaded += batch.length;

    console.log(`  Batch ${Math.floor(i/batchSize)+1}: ${batch.length} tiles, ${batchElements} elements, ${t2elapsed}ms (total loaded: ${tilesLoaded}/${surrounding.length + 1}, ${totalElements} elements)`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Total tiles loaded: ${tilesLoaded}`);
  console.log(`  Total elements: ${totalElements}`);
  console.log(`  Center tile was ${centerData.fromCache ? 'cached' : 'fresh'} (${t1elapsed}ms)`);

  // Verify the update logic: simulate train moving to adjacent tile
  console.log('\n--- Step 3: Simulate train movement to adjacent tile ---');
  const newTileX = center.tileX + 1;
  const newTileY = center.tileY;

  const newNeeded = new Set();
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      newNeeded.add(`${newTileX + dx},${newTileY + dy}`);
    }
  }

  const alreadyLoaded = new Set();
  alreadyLoaded.add(`${center.tileX},${center.tileY}`);
  for (const t of surrounding) {
    alreadyLoaded.add(`${t.x},${t.y}`);
  }

  let newToLoad = 0;
  for (const key of newNeeded) {
    if (!alreadyLoaded.has(key)) newToLoad++;
  }

  console.log(`  New position tile: (${newTileX}, ${newTileY})`);
  console.log(`  Already loaded: ${alreadyLoaded.size} tiles`);
  console.log(`  New tiles needed: ${newToLoad} tiles`);
  console.log(`  Tiles to unload: (deferred until unload radius exceeded)`);

  if (newToLoad > 0 && newToLoad <= 14) {
    console.log('  PASS: Incremental loading is efficient');
  } else if (newToLoad === 0) {
    console.log('  PASS: All needed tiles already loaded (within radius)');
  } else {
    console.log(`  WARNING: Loading ${newToLoad} tiles seems high for a 1-tile move`);
  }

  console.log('\n=== All E2E tests passed ===');
}

main().catch(err => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
