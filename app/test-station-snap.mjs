/**
 * Station Snap + Routing Test
 * Tests the routeLineOnRailways logic with real OSM railway data.
 * Verifies the snap threshold, Dijkstra routing, and fallback behavior.
 * Run with: node test-station-snap.mjs
 */

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

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

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Tel Aviv Metro stations ──
const METRO_STATIONS = [
  { name: 'Petah Tikva Central', lat: 32.0905, lng: 34.8855 },
  { name: 'Em HaMoshavot', lat: 32.0865, lng: 34.8720 },
  { name: 'Kiryat Aryeh', lat: 32.0840, lng: 34.8530 },
  { name: 'Bnei Brak', lat: 32.0820, lng: 34.8350 },
  { name: 'Ramat Gan Diamond', lat: 32.0785, lng: 34.8120 },
  { name: 'Arlozorov', lat: 32.0795, lng: 34.7920 },
  { name: 'Dizengoff Center', lat: 32.0755, lng: 34.7745 },
  { name: 'Carlebach', lat: 32.0680, lng: 34.7790 },
  { name: 'Allenby', lat: 32.0640, lng: 34.7710 },
  { name: "Neve Sha'anan", lat: 32.0565, lng: 34.7680 },
  { name: 'Jaffa Clock Tower', lat: 32.0510, lng: 34.7560 },
  { name: 'Bat Yam Central', lat: 32.0225, lng: 34.7505 },
];

// ── Known real train stations (Israel Railways) in the area ──
const REAL_TRAIN_STATIONS = [
  { name: 'Tel Aviv HaShalom', lat: 32.0614, lng: 34.7861 },
  { name: 'Tel Aviv Savidor', lat: 32.0810, lng: 34.7993 },
  { name: 'Bnei Brak', lat: 32.0877, lng: 34.8321 },
];

const SNAP_RADIUS_M = 200;
const SNAP_THRESHOLD_RATIO = 0.5;

// ── Railway graph logic (matching TrackRouter.ts) ──
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
  let bestId = null, bestDist = maxRadius;
  for (const [id, node] of graph.nodes) {
    const d = haversine(lat, lng, node.lat, node.lon);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return { id: bestId, dist: bestDist };
}

function dijkstra(graph, start, end) {
  if (start === end) return [start];
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  dist.set(start, 0);
  const pq = [{ node: start, cost: 0 }];
  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node: current, cost } = pq.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === end) break;
    const edges = graph.adjacency.get(current);
    if (!edges) continue;
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      const nc = cost + e.weight;
      const ex = dist.get(e.to);
      if (ex === undefined || nc < ex) {
        dist.set(e.to, nc);
        prev.set(e.to, current);
        pq.push({ node: e.to, cost: nc });
      }
    }
  }
  if (!prev.has(end) && start !== end) return null;
  const path = [];
  let cur = end;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === start) break;
    cur = prev.get(cur);
  }
  if (path[path.length - 1] !== start) return null;
  path.reverse();
  return path;
}

function routeLineOnRailways(stations, railways, nodeMap) {
  if (stations.length < 2) return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  if (railways.length === 0) return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };

  const graph = buildRailwayGraph(railways, nodeMap);
  const snapResults = stations.map(s => findNearestNode(s.lat, s.lng, graph, SNAP_RADIUS_M));
  const snappedCount = snapResults.filter(r => r.id !== null).length;
  const ratio = snappedCount / stations.length;

  return { graph, snapResults, ratio, snappedCount, usedOSM: ratio >= SNAP_THRESHOLD_RATIO };
}

async function fetchOSM(bbox) {
  const query = `[out:json][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}][timeout:120][maxsize:67108864];
(way["railway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););
out body; >; out skel qt;`;
  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 60000);
      const resp = await fetch(OVERPASS_SERVERS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (!resp.ok) continue;
      return await resp.json();
    } catch (err) {
      console.log(`  Server ${i + 1} failed: ${err.message}`);
      if (i < OVERPASS_SERVERS.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('All servers failed');
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Station Snap + Routing Test               ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Fetch railway data for the Tel Aviv metro area
  const bbox = { south: 32.015, west: 34.740, north: 32.100, east: 34.895 };
  console.log('\n══ Fetching OSM railway data ══');
  console.log(`  Bbox: ${bbox.south},${bbox.west} to ${bbox.north},${bbox.east}`);

  let elements;
  try {
    const json = await fetchOSM(bbox);
    elements = json.elements;
    console.log(`  Total elements: ${elements.length}`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    process.exit(1);
  }

  const nodeMap = new Map();
  const railways = [];
  for (const el of elements) {
    if (el.type === 'node') nodeMap.set(el.id, el);
    else if (el.type === 'way' && el.tags?.railway) railways.push(el);
  }
  console.log(`  Railways: ${railways.length}`);
  console.log(`  Nodes: ${nodeMap.size}`);

  // List railway types
  const typeCounts = {};
  for (const r of railways) {
    const t = r.tags.railway;
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log('  Railway types:', typeCounts);

  assert(railways.length > 0, `Has railway data (${railways.length})`);

  // ══ TEST 1: Station snap for Metro (fictional line) ══
  console.log('\n══ TEST 1: Metro station snapping (fictional line) ══');
  const metroResult = routeLineOnRailways(METRO_STATIONS, railways, nodeMap);
  console.log(`  Snap ratio: ${metroResult.snappedCount}/${METRO_STATIONS.length} = ${(metroResult.ratio * 100).toFixed(0)}%`);
  console.log(`  Would use OSM: ${metroResult.usedOSM}`);

  for (let i = 0; i < METRO_STATIONS.length; i++) {
    const st = METRO_STATIONS[i];
    const snap = metroResult.snapResults[i];
    const status = snap.id !== null ? `✓ snapped (${snap.dist.toFixed(0)}m)` : '✗ no snap';
    console.log(`    ${st.name}: ${status}`);
  }

  // The metro is fictional so less than 50% should snap
  console.log(`  Expected: fallback to Catmull-Rom (fictional line)`);

  // ══ TEST 2: Real train station snapping ══
  console.log('\n══ TEST 2: Real train station snapping ══');
  const realResult = routeLineOnRailways(REAL_TRAIN_STATIONS, railways, nodeMap);
  console.log(`  Snap ratio: ${realResult.snappedCount}/${REAL_TRAIN_STATIONS.length} = ${(realResult.ratio * 100).toFixed(0)}%`);
  console.log(`  Would use OSM: ${realResult.usedOSM}`);

  for (let i = 0; i < REAL_TRAIN_STATIONS.length; i++) {
    const st = REAL_TRAIN_STATIONS[i];
    const snap = realResult.snapResults[i];
    const status = snap.id !== null ? `✓ snapped (${snap.dist.toFixed(0)}m)` : '✗ no snap';
    console.log(`    ${st.name}: ${status}`);
  }

  assert(realResult.snappedCount >= 2, `At least 2 real stations snap (${realResult.snappedCount})`);

  // ══ TEST 3: Dijkstra routing between real stations ══
  if (realResult.usedOSM && realResult.graph) {
    console.log('\n══ TEST 3: Dijkstra routing between real stations ══');
    const from = realResult.snapResults[0];
    const to = realResult.snapResults[1];
    if (from.id !== null && to.id !== null) {
      const path = dijkstra(realResult.graph, from.id, to.id);
      if (path) {
        console.log(`  Route: ${REAL_TRAIN_STATIONS[0].name} → ${REAL_TRAIN_STATIONS[1].name}`);
        console.log(`  Path nodes: ${path.length}`);
        let pathLen = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const n1 = realResult.graph.nodes.get(path[i]);
          const n2 = realResult.graph.nodes.get(path[i + 1]);
          if (n1 && n2) pathLen += haversine(n1.lat, n1.lon, n2.lat, n2.lon);
        }
        console.log(`  Path length: ${pathLen.toFixed(0)}m`);
        const straight = haversine(
          REAL_TRAIN_STATIONS[0].lat, REAL_TRAIN_STATIONS[0].lng,
          REAL_TRAIN_STATIONS[1].lat, REAL_TRAIN_STATIONS[1].lng
        );
        console.log(`  Straight-line distance: ${straight.toFixed(0)}m`);
        assert(path.length > 2, `Path has intermediate nodes (${path.length})`);
        assert(pathLen > straight, `Path length > straight-line (${pathLen.toFixed(0)} > ${straight.toFixed(0)})`);
        assert(pathLen < straight * 5, `Path not unreasonably long (< 5x straight line)`);
      } else {
        console.log('  No path found (graph may be disconnected)');
        assert(false, 'Dijkstra found a path');
      }
    }
  } else {
    console.log('\n══ TEST 3: Dijkstra routing (skipped - not enough snaps) ══');
  }

  // ══ TEST 4: Verify fallback behavior ══
  console.log('\n══ TEST 4: Verify fallback behavior ══');
  const fakeStations = [
    { lat: 32.1, lng: 34.9, name: 'Middle of nowhere 1' },
    { lat: 32.11, lng: 34.91, name: 'Middle of nowhere 2' },
  ];
  const fakeResult = routeLineOnRailways(fakeStations, railways, nodeMap);
  console.log(`  Fake stations snap: ${fakeResult.snappedCount}/${fakeStations.length}`);
  assert(!fakeResult.usedOSM, 'Fake stations fall back to Catmull-Rom');

  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Unhandled:', err); process.exit(1); });
