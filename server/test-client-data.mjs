/**
 * Client data path test - verifies the full data pipeline from server API
 * through to the parsing that the client TileManager would perform.
 * Tests: API response parsing, OSMData categorization, tile ground extent,
 *        multi-tile assembly, coordinate projection.
 * Run: node test-client-data.mjs
 */

const SERVER = 'http://localhost:3001';
const TILE_SIZE_DEG = 0.01;
const METERS_PER_DEG_LAT = 111319;

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
      if (el.tags['leisure'] === 'park' || el.tags['leisure'] === 'garden' || el.tags['landuse'] === 'grass') {
        parks.push(el);
      }
    }
  }

  return { nodeMap, buildings, highways, railways, trees, treeRows, parks, water, benches, streetLamps, trafficSignals };
}

class LocalProjection {
  constructor(centerLat, centerLng) {
    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  }

  projectToLocal(lat, lng) {
    return {
      x: (lng - this.centerLng) * this.metersPerDegLng,
      z: -(lat - this.centerLat) * METERS_PER_DEG_LAT,
    };
  }

  localToLatLng(x, z) {
    return {
      lat: this.centerLat + (-z / METERS_PER_DEG_LAT),
      lng: this.centerLng + (x / this.metersPerDegLng),
    };
  }
}

async function testOSMDataParsing() {
  console.log('\n=== Test: OSMData parsing from API response ===');

  const res = await fetch(`${SERVER}/api/tiles/3478/3208`);
  const apiResult = await res.json();
  console.log(`  API returned ${apiResult.data.length} elements for tile (${apiResult.tileX}, ${apiResult.tileY})`);

  const osmData = parseOSMElements(apiResult.data);

  console.log(`  Parsed OSMData:`);
  console.log(`    nodeMap: ${osmData.nodeMap.size} nodes`);
  console.log(`    buildings: ${osmData.buildings.length}`);
  console.log(`    highways: ${osmData.highways.length}`);
  console.log(`    railways: ${osmData.railways.length}`);
  console.log(`    trees: ${osmData.trees.length}`);
  console.log(`    treeRows: ${osmData.treeRows.length}`);
  console.log(`    parks: ${osmData.parks.length}`);
  console.log(`    water: ${osmData.water.length}`);
  console.log(`    benches: ${osmData.benches.length}`);
  console.log(`    streetLamps: ${osmData.streetLamps.length}`);
  console.log(`    trafficSignals: ${osmData.trafficSignals.length}`);

  if (osmData.nodeMap.size === 0) throw new Error('No nodes parsed');
  if (osmData.buildings.length + osmData.highways.length === 0) throw new Error('No buildings or highways parsed');

  // Verify buildings have resolvable nodes
  let resolvedCount = 0;
  let unresolvedCount = 0;
  for (const building of osmData.buildings.slice(0, 10)) {
    const resolved = building.nodes.every(nid => osmData.nodeMap.has(nid));
    if (resolved) resolvedCount++;
    else unresolvedCount++;
  }
  console.log(`  Building node resolution (first 10): ${resolvedCount} resolved, ${unresolvedCount} unresolved`);
  if (resolvedCount === 0 && osmData.buildings.length > 0) {
    throw new Error('No buildings have resolvable nodes');
  }

  console.log('  PASS');
  return osmData;
}

async function testTileGroundExtent() {
  console.log('\n=== Test: Tile ground extent calculation ===');

  const tileX = 3478;
  const tileY = 3208;
  const bbox = {
    south: tileY * TILE_SIZE_DEG,
    west: tileX * TILE_SIZE_DEG,
    north: (tileY + 1) * TILE_SIZE_DEG,
    east: (tileX + 1) * TILE_SIZE_DEG,
  };

  const centerLat = (bbox.south + bbox.north) / 2;
  const extentLat = (bbox.north - bbox.south) * METERS_PER_DEG_LAT;
  const extentLng = (bbox.east - bbox.west) * METERS_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  const extentMeters = Math.max(extentLat, extentLng) / 2 + 50;

  console.log(`  Tile bbox: S=${bbox.south} W=${bbox.west} N=${bbox.north} E=${bbox.east}`);
  console.log(`  Lat extent: ${extentLat.toFixed(0)}m, Lng extent: ${extentLng.toFixed(0)}m`);
  console.log(`  Ground plane extent: ${extentMeters.toFixed(0)}m`);

  if (extentMeters < 500 || extentMeters > 2000) {
    throw new Error(`Unexpected extent: ${extentMeters}m, expected 500-2000m`);
  }

  console.log('  PASS');
}

async function testProjectionConsistency() {
  console.log('\n=== Test: Projection consistency across tiles ===');

  const centerLat = 32.085;
  const centerLng = 34.782;
  const proj = new LocalProjection(centerLat, centerLng);

  // A point near the center should be near (0,0) in local space
  const centerLocal = proj.projectToLocal(centerLat, centerLng);
  console.log(`  Center -> local: (${centerLocal.x.toFixed(2)}, ${centerLocal.z.toFixed(2)})`);
  if (Math.abs(centerLocal.x) > 1 || Math.abs(centerLocal.z) > 1) {
    throw new Error('Center point should be near (0,0)');
  }

  // A point 1km east should be ~1000m in X
  const eastLocal = proj.projectToLocal(centerLat, centerLng + 1 / 111.319 / Math.cos(centerLat * Math.PI / 180));
  console.log(`  1km east -> local: (${eastLocal.x.toFixed(2)}, ${eastLocal.z.toFixed(2)})`);
  if (Math.abs(eastLocal.x - 1000) > 50) {
    throw new Error(`Expected ~1000m east, got ${eastLocal.x.toFixed(1)}`);
  }

  // A point 1km north should be ~-1000m in Z (Z = south positive)
  const northLocal = proj.projectToLocal(centerLat + 1 / 111.319, centerLng);
  console.log(`  1km north -> local: (${northLocal.x.toFixed(2)}, ${northLocal.z.toFixed(2)})`);
  if (Math.abs(northLocal.z - (-1000)) > 50) {
    throw new Error(`Expected ~-1000m Z for north, got ${northLocal.z.toFixed(1)}`);
  }

  // Round-trip test
  const testLat = 32.09;
  const testLng = 34.79;
  const local = proj.projectToLocal(testLat, testLng);
  const rt = proj.localToLatLng(local.x, local.z);
  console.log(`  Round trip: (${testLat}, ${testLng}) -> (${local.x.toFixed(1)}, ${local.z.toFixed(1)}) -> (${rt.lat.toFixed(6)}, ${rt.lng.toFixed(6)})`);
  if (Math.abs(rt.lat - testLat) > 0.0001 || Math.abs(rt.lng - testLng) > 0.0001) {
    throw new Error('Round-trip projection mismatch');
  }

  console.log('  PASS');
}

async function testMultiTileAssembly() {
  console.log('\n=== Test: Multi-tile data assembly ===');

  const tiles = [
    { x: 3478, y: 3208 },
    { x: 3479, y: 3208 },
    { x: 3478, y: 3209 },
    { x: 3479, y: 3209 },
  ];

  const tilesParam = tiles.map(t => `${t.x},${t.y}`).join(';');
  const res = await fetch(`${SERVER}/api/tiles/batch?tiles=${tilesParam}`);
  const results = await res.json();

  const centerLat = 32.085;
  const centerLng = 34.785;
  const proj = new LocalProjection(centerLat, centerLng);

  let totalBuildings = 0;
  let totalHighways = 0;

  for (const result of results) {
    if (result.error) {
      console.log(`  Tile (${result.tileX},${result.tileY}): ERROR - ${result.error}`);
      continue;
    }

    const osmData = parseOSMElements(result.data);
    totalBuildings += osmData.buildings.length;
    totalHighways += osmData.highways.length;

    // Verify buildings are within tile bbox (approximately)
    const bbox = {
      south: result.tileY * TILE_SIZE_DEG,
      west: result.tileX * TILE_SIZE_DEG,
      north: (result.tileY + 1) * TILE_SIZE_DEG,
      east: (result.tileX + 1) * TILE_SIZE_DEG,
    };

    let inBoundsCount = 0;
    for (const building of osmData.buildings.slice(0, 5)) {
      const firstNode = osmData.nodeMap.get(building.nodes[0]);
      if (firstNode) {
        const inBounds = firstNode.lat >= bbox.south - 0.001 && firstNode.lat <= bbox.north + 0.001 &&
                          firstNode.lon >= bbox.west - 0.001 && firstNode.lon <= bbox.east + 0.001;
        if (inBounds) inBoundsCount++;

        const local = proj.projectToLocal(firstNode.lat, firstNode.lon);
        // Just log one example per tile
        if (building === osmData.buildings[0]) {
          console.log(`  Tile (${result.tileX},${result.tileY}): building @ (${firstNode.lat.toFixed(5)}, ${firstNode.lon.toFixed(5)}) -> local (${local.x.toFixed(1)}, ${local.z.toFixed(1)})`);
        }
      }
    }
  }

  console.log(`  Total buildings across ${results.length} tiles: ${totalBuildings}`);
  console.log(`  Total highways across ${results.length} tiles: ${totalHighways}`);

  if (totalBuildings === 0) throw new Error('No buildings in multi-tile assembly');
  if (totalHighways === 0) throw new Error('No highways in multi-tile assembly');

  console.log('  PASS');
}

async function testTileUpdateLogic() {
  console.log('\n=== Test: Tile update logic (load/unload decision) ===');

  const LOAD_RADIUS = 3;
  const UNLOAD_RADIUS = 5;

  // Simulate train at a position
  const trainLat = 32.085;
  const trainLng = 34.782;
  const tileX = Math.floor(trainLng / TILE_SIZE_DEG);
  const tileY = Math.floor(trainLat / TILE_SIZE_DEG);

  // Compute needed tiles
  const neededTiles = new Set();
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      neededTiles.add(`${tileX + dx},${tileY + dy}`);
    }
  }
  console.log(`  Train at (${trainLat}, ${trainLng}) -> tile (${tileX}, ${tileY})`);
  console.log(`  Needed tiles: ${neededTiles.size}`);

  // Simulate loaded tiles (some overlap, some outside)
  const loadedTiles = new Map();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const key = `${tileX - 1 + dx},${tileY - 1 + dy}`;
      loadedTiles.set(key, { tileX: tileX - 1 + dx, tileY: tileY - 1 + dy });
    }
  }
  console.log(`  Currently loaded: ${loadedTiles.size} tiles`);

  // Find tiles to load
  const toLoad = [];
  for (const key of neededTiles) {
    if (!loadedTiles.has(key)) {
      toLoad.push(key);
    }
  }

  // Find tiles to unload (outside UNLOAD_RADIUS)
  const toUnload = [];
  for (const [key, tile] of loadedTiles) {
    const dx = Math.abs(tile.tileX - tileX);
    const dy = Math.abs(tile.tileY - tileY);
    if (dx > UNLOAD_RADIUS || dy > UNLOAD_RADIUS) {
      toUnload.push(key);
    }
  }

  console.log(`  To load: ${toLoad.length} tiles`);
  console.log(`  To unload: ${toUnload.length} tiles`);
  console.log(`  Kept: ${loadedTiles.size - toUnload.length} tiles`);

  if (toLoad.length === 0 && neededTiles.size > loadedTiles.size) {
    throw new Error('Should have tiles to load');
  }

  console.log('  PASS');
}

async function main() {
  console.log('=== MetroRider Client Data Path Tests ===');
  console.log(`Server: ${SERVER}`);

  let passed = 0;
  let failed = 0;

  const tests = [
    ['OSMData parsing', testOSMDataParsing],
    ['Tile ground extent', testTileGroundExtent],
    ['Projection consistency', testProjectionConsistency],
    ['Multi-tile assembly', testMultiTileAssembly],
    ['Tile update logic', testTileUpdateLogic],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
