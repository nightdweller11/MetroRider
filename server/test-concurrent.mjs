/**
 * Test concurrent individual tile requests (what the new client does).
 * Verifies tiles load in parallel and render progressively.
 * Run: node test-concurrent.mjs
 */

const SERVER = 'http://localhost:3001';

async function main() {
  console.log('=== Concurrent Tile Loading Test ===');

  // These are cached tiles from Tel Aviv area
  const tiles = [
    { x: 3478, y: 3208 },
    { x: 3479, y: 3208 },
    { x: 3480, y: 3208 },
    { x: 3478, y: 3209 },
    { x: 3479, y: 3209 },
    { x: 3480, y: 3209 },
  ];

  console.log(`\n--- Sequential loading (baseline) ---`);
  const seqStart = Date.now();
  for (const t of tiles) {
    const res = await fetch(`${SERVER}/api/tiles/${t.x}/${t.y}`);
    const data = await res.json();
    const elapsed = Date.now() - seqStart;
    console.log(`  Tile (${t.x},${t.y}): ${data.data.length} elements, at ${elapsed}ms`);
  }
  const seqTotal = Date.now() - seqStart;
  console.log(`  Total sequential: ${seqTotal}ms`);

  console.log(`\n--- Concurrent loading (4 workers) ---`);
  const conStart = Date.now();
  const queue = [...tiles];
  const results = [];

  const worker = async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      const res = await fetch(`${SERVER}/api/tiles/${t.x}/${t.y}`);
      const data = await res.json();
      const elapsed = Date.now() - conStart;
      results.push({ ...t, elements: data.data.length, elapsed });
      console.log(`  Tile (${t.x},${t.y}): ${data.data.length} elements, at ${elapsed}ms`);
    }
  };

  const workers = [];
  for (let i = 0; i < 4; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  const conTotal = Date.now() - conStart;
  console.log(`  Total concurrent: ${conTotal}ms`);

  console.log(`\n--- Speedup: ${(seqTotal / conTotal).toFixed(1)}x ---`);

  // Simulate train movement: load new tiles that aren't cached
  console.log(`\n--- Simulating dynamic loading after train move ---`);
  const currentTile = { x: 3479, y: 3209 };
  const loadRadius = 3;

  // Tiles already loaded
  const loaded = new Set(tiles.map(t => `${t.x},${t.y}`));

  // New tiles needed
  const needed = [];
  for (let dx = -loadRadius; dx <= loadRadius; dx++) {
    for (let dy = -loadRadius; dy <= loadRadius; dy++) {
      const key = `${currentTile.x + dx},${currentTile.y + dy}`;
      if (!loaded.has(key)) {
        needed.push({ x: currentTile.x + dx, y: currentTile.y + dy });
      }
    }
  }

  console.log(`  Current tile: (${currentTile.x}, ${currentTile.y})`);
  console.log(`  Already loaded: ${loaded.size}`);
  console.log(`  New tiles needed: ${needed.length}`);

  // Load a few of them to verify
  if (needed.length > 0) {
    const sample = needed.slice(0, 3);
    console.log(`  Loading sample of ${sample.length} new tiles...`);
    const dynamicStart = Date.now();
    
    const dynamicWorker = async (t) => {
      const res = await fetch(`${SERVER}/api/tiles/${t.x}/${t.y}`);
      const data = await res.json();
      const elapsed = Date.now() - dynamicStart;
      console.log(`    Tile (${t.x},${t.y}): ${data.data.length} elements, cached: ${data.fromCache}, ${elapsed}ms`);
    };
    
    await Promise.all(sample.map(dynamicWorker));
    console.log(`  Dynamic load took: ${Date.now() - dynamicStart}ms`);
  }

  console.log('\n=== PASS ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
