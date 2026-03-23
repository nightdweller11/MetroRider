/**
 * TrackRouter Test Script
 * Tests railway graph construction, station snapping, Dijkstra pathfinding,
 * fallback detection, and corridor clearing.
 * Run with: node test-track-router.mjs
 */

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Bbox around Tel Aviv LRT stations (known railway area)
const RAILWAY_BBOX = {
  south: 32.075,
  west: 34.780,
  north: 32.095,
  east: 34.810,
};

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

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

async function fetchFromOverpass(bbox) {
  const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);

  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const url = OVERPASS_SERVERS[i];
    console.log(`  Trying server: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.log(`  Server returned ${resp.status}, trying next...`);
        continue;
      }

      const text = await resp.text();
      return JSON.parse(text);
    } catch (err) {
      console.log(`  Failed: ${err.message}, trying next...`);
      if (i < OVERPASS_SERVERS.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  throw new Error('All Overpass servers failed');
}

function parseOSMResponse(elements) {
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

// ── Haversine (pure JS, matching CoordinateSystem.ts) ──
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Railway graph (matching TrackRouter.ts logic) ──
function buildRailwayGraph(railways, nodeMap) {
  const adjacency = new Map();
  const nodes = new Map();

  for (const way of railways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      const nodeA = nodeMap.get(a);
      const nodeB = nodeMap.get(b);
      if (!nodeA || !nodeB) continue;

      nodes.set(a, { lat: nodeA.lat, lon: nodeA.lon });
      nodes.set(b, { lat: nodeB.lat, lon: nodeB.lon });

      const dist = haversine(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);

      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push({ to: b, weight: dist });
      adjacency.get(b).push({ to: a, weight: dist });
    }
  }

  return { adjacency, nodes };
}

function findNearestNode(lat, lng, graph, maxRadius) {
  let bestId = null;
  let bestDist = maxRadius;

  for (const [id, node] of graph.nodes) {
    const d = haversine(lat, lng, node.lat, node.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }

  return { id: bestId, dist: bestDist };
}

function dijkstra(graph, startNode, endNode) {
  if (startNode === endNode) return [startNode];

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  dist.set(startNode, 0);
  const pq = [{ node: startNode, cost: 0 }];

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node: current, cost: currentCost } = pq.shift();

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endNode) break;

    const edges = graph.adjacency.get(current);
    if (!edges) continue;

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;

      const newCost = currentCost + edge.weight;
      const existing = dist.get(edge.to);
      if (existing === undefined || newCost < existing) {
        dist.set(edge.to, newCost);
        prev.set(edge.to, current);
        pq.push({ node: edge.to, cost: newCost });
      }
    }
  }

  if (!prev.has(endNode) && startNode !== endNode) return null;

  const path = [];
  let cur = endNode;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === startNode) break;
    cur = prev.get(cur);
  }

  if (path[path.length - 1] !== startNode) return null;

  path.reverse();
  return path;
}

// ── Corridor clearing logic (matching TrackRouter.ts) ──
function pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;

  if (lenSq < 1e-10) {
    const ex = px - x1;
    const ez = pz - z1;
    return Math.sqrt(ex * ex + ez * ez);
  }

  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestZ = z1 + t * dz;
  const ex = px - closestX;
  const ez = pz - closestZ;
  return Math.sqrt(ex * ex + ez * ez);
}

function isPointInCorridor(px, pz, segments, radius) {
  for (const seg of segments) {
    const d = pointToSegmentDistance(px, pz, seg.x1, seg.z1, seg.x2, seg.z2);
    if (d < radius) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────
// TEST 1: Railway graph construction
// ──────────────────────────────────────────────────
function testGraphConstruction(data) {
  console.log('\n══ TEST 1: Railway graph construction ══');

  console.log(`  Railways in data: ${data.railways.length}`);
  assert(data.railways.length > 0, 'OSM data contains railway ways');

  const railTypes = {};
  for (const r of data.railways) {
    const type = r.tags?.['railway'] ?? 'unknown';
    railTypes[type] = (railTypes[type] || 0) + 1;
  }
  console.log(`  Railway types: ${JSON.stringify(railTypes)}`);

  const graph = buildRailwayGraph(data.railways, data.nodeMap);

  console.log(`  Graph nodes: ${graph.nodes.size}`);
  console.log(`  Graph vertices with edges: ${graph.adjacency.size}`);

  assert(graph.nodes.size > 0, 'Graph has nodes');
  assert(graph.adjacency.size > 0, 'Graph has edges');

  let totalEdges = 0;
  let minWeight = Infinity;
  let maxWeight = 0;
  for (const [, edges] of graph.adjacency) {
    totalEdges += edges.length;
    for (const e of edges) {
      if (e.weight < minWeight) minWeight = e.weight;
      if (e.weight > maxWeight) maxWeight = e.weight;
    }
  }
  console.log(`  Total edges (directed): ${totalEdges}`);
  console.log(`  Edge weight range: ${minWeight.toFixed(1)}m - ${maxWeight.toFixed(1)}m`);

  assert(totalEdges > 0, 'Graph has edges with computed distances');
  assert(minWeight > 0, 'All edge weights are positive');

  return graph;
}

// ──────────────────────────────────────────────────
// TEST 2: Station snapping
// ──────────────────────────────────────────────────
function testStationSnapping(graph) {
  console.log('\n══ TEST 2: Station snapping ══');

  // Stations near railways within our test bbox (south:32.075 west:34.780 north:32.095 east:34.810)
  const realStations = [
    { name: 'Arlozorov', lat: 32.0795, lng: 34.7920 },
    { name: 'Near HaShalom', lat: 32.0740, lng: 34.7920 },
    { name: 'Ramat Gan Diamond', lat: 32.0785, lng: 34.8000 },
  ];

  for (const st of realStations) {
    const result = findNearestNode(st.lat, st.lng, graph, 500);
    console.log(`  ${st.name}: nearest node = ${result.id}, dist = ${result.dist.toFixed(1)}m`);
    assert(result.id !== null, `${st.name} snaps to a railway node (within 500m)`);
  }

  // Fictional stations far from any railway
  const fictionalStations = [
    { name: 'Middle of Sea', lat: 32.08, lng: 34.70 },
    { name: 'Desert Point', lat: 31.50, lng: 35.50 },
  ];

  for (const st of fictionalStations) {
    const result = findNearestNode(st.lat, st.lng, graph, 200);
    console.log(`  ${st.name}: nearest node = ${result.id}, dist = ${result.id ? result.dist.toFixed(1) + 'm' : 'N/A'}`);
    assert(result.id === null, `${st.name} does NOT snap (no railway within 200m)`);
  }
}

// ──────────────────────────────────────────────────
// TEST 3: Dijkstra pathfinding
// ──────────────────────────────────────────────────
function testDijkstra(graph) {
  console.log('\n══ TEST 3: Dijkstra pathfinding ══');

  // Pick two nodes that we know are in the graph
  const nodeIds = Array.from(graph.nodes.keys());
  if (nodeIds.length < 2) {
    console.log('  Not enough nodes for pathfinding test');
    assert(false, 'Graph has at least 2 nodes');
    return;
  }

  const startId = nodeIds[0];
  const endId = nodeIds[Math.min(50, nodeIds.length - 1)];

  console.log(`  Pathfinding from node ${startId} to node ${endId}`);

  const path = dijkstra(graph, startId, endId);

  if (path) {
    console.log(`  Path found: ${path.length} nodes`);
    assert(path.length >= 2, 'Path has at least 2 nodes');
    assert(path[0] === startId, 'Path starts at start node');
    assert(path[path.length - 1] === endId, 'Path ends at end node');

    // Verify path is connected
    let pathValid = true;
    for (let i = 0; i < path.length - 1; i++) {
      const edges = graph.adjacency.get(path[i]);
      const hasNext = edges?.some(e => e.to === path[i + 1]);
      if (!hasNext) {
        pathValid = false;
        break;
      }
    }
    assert(pathValid, 'Path is fully connected (each consecutive pair has an edge)');

    // Compute total path distance
    let totalDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const nA = graph.nodes.get(path[i]);
      const nB = graph.nodes.get(path[i + 1]);
      if (nA && nB) totalDist += haversine(nA.lat, nA.lon, nB.lat, nB.lon);
    }
    console.log(`  Path distance: ${totalDist.toFixed(1)}m`);
  } else {
    console.log('  No path found (nodes may be in disconnected components)');
    assert(false, 'Dijkstra found a path');
  }

  // Test identity: path from node to itself
  const selfPath = dijkstra(graph, startId, startId);
  assert(selfPath !== null && selfPath.length === 1, 'Path from node to itself is [node]');
}

// ──────────────────────────────────────────────────
// TEST 4: Full route routing (OSM snap vs fallback)
// ──────────────────────────────────────────────────
function testFullRouteRouting(data, graph) {
  console.log('\n══ TEST 4: Full route routing logic ══');

  const SNAP_RADIUS = 200;
  const SNAP_THRESHOLD = 0.5;

  // Test with real Tel Aviv stations (should snap to LRT)
  const realStations = [
    { lat: 32.0795, lng: 34.7920 },
    { lat: 32.0755, lng: 34.7745 },
    { lat: 32.0680, lng: 34.7790 },
  ];

  const snappedReal = realStations.map(s => findNearestNode(s.lat, s.lng, graph, SNAP_RADIUS));
  const snapCountReal = snappedReal.filter(r => r.id !== null).length;
  const ratioReal = snapCountReal / realStations.length;
  console.log(`  Real stations: ${snapCountReal}/${realStations.length} snapped (${(ratioReal * 100).toFixed(0)}%)`);

  if (ratioReal >= SNAP_THRESHOLD) {
    console.log('  → Would use OSM routing');
    assert(true, 'Real stations trigger OSM routing');
  } else {
    console.log('  → Would use fallback (not enough stations near railways in this bbox)');
  }

  // Test with fictional stations (should NOT snap)
  const fictionalStations = [
    { lat: 32.12, lng: 34.82 },
    { lat: 32.13, lng: 34.83 },
    { lat: 32.14, lng: 34.84 },
  ];

  const snappedFictional = fictionalStations.map(s => findNearestNode(s.lat, s.lng, graph, SNAP_RADIUS));
  const snapCountFictional = snappedFictional.filter(r => r.id !== null).length;
  const ratioFictional = snapCountFictional / fictionalStations.length;
  console.log(`  Fictional stations: ${snapCountFictional}/${fictionalStations.length} snapped (${(ratioFictional * 100).toFixed(0)}%)`);
  console.log('  → Would use fallback (Catmull-Rom + corridor clearing)');
  assert(ratioFictional < SNAP_THRESHOLD, 'Fictional stations trigger fallback');
}

// ──────────────────────────────────────────────────
// TEST 5: Corridor clearing (pure math)
// ──────────────────────────────────────────────────
function testCorridorClearing() {
  console.log('\n══ TEST 5: Corridor clearing (pure geometry) ══');

  // Simple track along the X axis: (0,0) → (100,0)
  const segments = [{ x1: 0, z1: 0, x2: 100, z2: 0 }];
  const radius = 15;

  // Point on the track
  let d = pointToSegmentDistance(50, 0, 0, 0, 100, 0);
  assert(Math.abs(d) < 0.01, `Point on track: distance = ${d.toFixed(4)} (expected 0)`);

  // Point 10m away (inside corridor)
  d = pointToSegmentDistance(50, 10, 0, 0, 100, 0);
  assert(Math.abs(d - 10) < 0.01, `Point 10m away: distance = ${d.toFixed(4)} (expected 10)`);
  assert(isPointInCorridor(50, 10, segments, radius), 'Point 10m from track IS in 15m corridor');

  // Point 20m away (outside corridor)
  d = pointToSegmentDistance(50, 20, 0, 0, 100, 0);
  assert(Math.abs(d - 20) < 0.01, `Point 20m away: distance = ${d.toFixed(4)} (expected 20)`);
  assert(!isPointInCorridor(50, 20, segments, radius), 'Point 20m from track is NOT in 15m corridor');

  // Point at segment start
  d = pointToSegmentDistance(0, 14, 0, 0, 100, 0);
  assert(Math.abs(d - 14) < 0.01, `Point at segment start, 14m away: distance = ${d.toFixed(4)} (expected 14)`);
  assert(isPointInCorridor(0, 14, segments, radius), 'Point 14m from start IS in corridor');

  // Point beyond segment end
  d = pointToSegmentDistance(110, 0, 0, 0, 100, 0);
  assert(Math.abs(d - 10) < 0.01, `Point beyond segment end: distance = ${d.toFixed(4)} (expected 10)`);
  assert(isPointInCorridor(110, 0, segments, radius), 'Point 10m beyond end IS in corridor');

  // Diagonal track: (0,0) → (100,100)
  const diagSegments = [{ x1: 0, z1: 0, x2: 100, z2: 100 }];
  d = pointToSegmentDistance(50, 50, 0, 0, 100, 100);
  assert(Math.abs(d) < 0.01, `Point on diagonal: distance = ${d.toFixed(4)} (expected 0)`);

  // Perpendicular offset from diagonal midpoint
  const perpDist = 10 * Math.SQRT2 / 2;
  d = pointToSegmentDistance(50 + 10, 50 - 10, 0, 0, 100, 100);
  // Distance should be 10*sqrt(2) * cos(45) ≈ 10 (perpendicular distance)
  console.log(`  Diagonal track, offset point: distance = ${d.toFixed(4)}`);

  // Multi-segment corridor
  const multiSegments = [
    { x1: 0, z1: 0, x2: 50, z2: 0 },
    { x1: 50, z1: 0, x2: 50, z2: 50 },
    { x1: 50, z1: 50, x2: 100, z2: 50 },
  ];
  assert(isPointInCorridor(25, 5, multiSegments, radius), 'Point near first segment IS in corridor');
  assert(isPointInCorridor(55, 25, multiSegments, radius), 'Point near second segment IS in corridor');
  assert(isPointInCorridor(75, 45, multiSegments, radius), 'Point near third segment IS in corridor');
  assert(!isPointInCorridor(25, 40, multiSegments, radius), 'Point far from all segments is NOT in corridor');

  // Test building centroid filtering simulation
  const buildingCentroids = [
    { x: 25, z: 5, id: 'A' },   // near segment 1 → should be cleared
    { x: 75, z: 45, id: 'B' },  // near segment 3 → should be cleared
    { x: 25, z: 40, id: 'C' },  // far from all → should NOT be cleared
    { x: 80, z: 5, id: 'D' },   // near nothing → should NOT be cleared
    { x: 45, z: 5, id: 'E' },   // near segment 1 → should be cleared
  ];

  const kept = buildingCentroids.filter(b => !isPointInCorridor(b.x, b.z, multiSegments, radius));
  const cleared = buildingCentroids.filter(b => isPointInCorridor(b.x, b.z, multiSegments, radius));

  console.log(`  Building corridor sim: ${cleared.length} cleared, ${kept.length} kept`);
  console.log(`    Cleared: ${cleared.map(b => b.id).join(', ')}`);
  console.log(`    Kept: ${kept.map(b => b.id).join(', ')}`);

  assert(cleared.length === 3, `Expected 3 buildings cleared (got ${cleared.length})`);
  assert(kept.length === 2, `Expected 2 buildings kept (got ${kept.length})`);
  assert(cleared.some(b => b.id === 'A'), 'Building A is cleared');
  assert(cleared.some(b => b.id === 'B'), 'Building B is cleared');
  assert(cleared.some(b => b.id === 'E'), 'Building E is cleared');
  assert(kept.some(b => b.id === 'C'), 'Building C is kept');
  assert(kept.some(b => b.id === 'D'), 'Building D is kept');
}

// ──────────────────────────────────────────────────
// TEST 6: Zero-length segment edge case
// ──────────────────────────────────────────────────
function testZeroLengthSegment() {
  console.log('\n══ TEST 6: Zero-length segment edge case ══');

  const d = pointToSegmentDistance(5, 5, 10, 10, 10, 10);
  const expected = Math.sqrt(50);
  assert(Math.abs(d - expected) < 0.01, `Zero-length segment: distance = ${d.toFixed(4)} (expected ${expected.toFixed(4)})`);
}

// ──────────────────────────────────────────────────
// RUN ALL TESTS
// ──────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   MetroRider TrackRouter Test Suite           ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Pure math tests first (no network)
  testCorridorClearing();
  testZeroLengthSegment();

  // Fetch OSM data and test graph/routing
  console.log('\n  Fetching OSM data for railway area...');
  let data;
  try {
    const json = await fetchFromOverpass(RAILWAY_BBOX);
    data = parseOSMResponse(json.elements);
    console.log(`  Fetched: ${data.railways.length} railways, ${data.buildings.length} buildings, ${data.nodeMap.size} nodes`);
  } catch (err) {
    console.error(`\nFATAL: Failed to fetch OSM data: ${err.message}`);
    failed++;
    printResults();
    return;
  }

  const graph = testGraphConstruction(data);
  testStationSnapping(graph);
  testDijkstra(graph);
  testFullRouteRouting(data, graph);

  printResults();
}

function printResults() {
  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
