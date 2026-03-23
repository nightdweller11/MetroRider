/**
 * EXACT Game.ts code path test.
 * Reproduces every step of Game.loadMap() with TEL_AVIV_METRO data,
 * including Phase 3 (rebuildBuildings with final corridor segments),
 * and verifies that ZERO remaining buildings overlap the track.
 *
 * Run: node test-exact-game-path.mjs
 */

const DEG2RAD = Math.PI / 180;
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ═══ Step 0: TEL_AVIV_METRO data (exact copy from SampleRoutes.ts) ═══
const TEL_AVIV_METRO = {
  name: 'Tel Aviv Metro',
  stations: {
    r1:  { name: 'Petah Tikva Central', lat: 32.0905, lng: 34.8855 },
    r2:  { name: 'Em HaMoshavot',       lat: 32.0865, lng: 34.8720 },
    r3:  { name: 'Kiryat Aryeh',        lat: 32.0840, lng: 34.8530 },
    r4:  { name: 'Bnei Brak',           lat: 32.0820, lng: 34.8350 },
    r5:  { name: 'Ramat Gan Diamond',   lat: 32.0785, lng: 34.8120 },
    r6:  { name: 'Arlozorov',           lat: 32.0795, lng: 34.7920 },
    r7:  { name: 'Dizengoff Center',    lat: 32.0755, lng: 34.7745 },
    r8:  { name: 'Carlebach',           lat: 32.0680, lng: 34.7790 },
    r9:  { name: 'Allenby',             lat: 32.0640, lng: 34.7710 },
    r10: { name: "Neve Sha'anan",       lat: 32.0565, lng: 34.7680 },
    r11: { name: 'Jaffa Clock Tower',   lat: 32.0510, lng: 34.7560 },
    r12: { name: 'Bat Yam Central',     lat: 32.0225, lng: 34.7505 },
    g1:  { name: 'Tel Aviv University', lat: 32.1135, lng: 34.8045 },
    g2:  { name: 'Ramat Aviv',          lat: 32.1050, lng: 34.7975 },
    g3:  { name: 'Basel Square',        lat: 32.0885, lng: 34.7790 },
    g4:  { name: 'Habima',              lat: 32.0720, lng: 34.7795 },
    g5:  { name: 'Rothschild',          lat: 32.0640, lng: 34.7755 },
    g6:  { name: 'Florentin',           lat: 32.0570, lng: 34.7710 },
    g7:  { name: 'Jaffa Port',          lat: 32.0520, lng: 34.7500 },
    b1:  { name: 'Herzliya Marina',     lat: 32.1610, lng: 34.7920 },
    b2:  { name: 'Tel Baruch Beach',    lat: 32.1310, lng: 34.7870 },
    b3:  { name: 'Port of Tel Aviv',    lat: 32.0985, lng: 34.7715 },
    b4:  { name: 'Gordon Beach',        lat: 32.0830, lng: 34.7670 },
    b5:  { name: 'Frishman Beach',      lat: 32.0780, lng: 34.7680 },
    b6:  { name: 'Jerusalem Beach',     lat: 32.0615, lng: 34.7605 },
  },
  lines: [
    { id: 'red', name: 'Red Line', color: '#e61e25', stationIds: ['r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12'] },
    { id: 'green', name: 'Green Line', color: '#00a878', stationIds: ['g1','g2','g3','g4','g5','g6','g7'] },
    { id: 'blue', name: 'Blue Line', color: '#2196f3', stationIds: ['b1','b2','b3','b4','b5','b6'] },
  ],
};

// ═══ parseMetroMap (exact copy from RouteParser.ts) ═══
function parseMetroMap(data) {
  return data.lines.map(line => {
    const stations = line.stationIds.map(id => {
      const st = data.stations[id];
      return { id, name: st.name, lat: st.lat, lng: st.lng };
    });
    return { id: line.id, name: line.name, color: line.color, stations };
  });
}

// ═══ LocalProjection (exact copy from LocalProjection.ts) ═══
class LocalProjection {
  constructor(centerLat, centerLng) {
    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
    this.metersPerDegLat = 111319;
  }
  setCenter(lat, lng) {
    this.centerLat = lat;
    this.centerLng = lng;
    this.metersPerDegLng = 111319 * Math.cos(lat * DEG2RAD);
  }
  projectToLocal(lat, lng) {
    return {
      x: (lng - this.centerLng) * this.metersPerDegLng,
      z: -(lat - this.centerLat) * this.metersPerDegLat,
    };
  }
  static bboxFromStations(stations, marginMeters = 500) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const s of stations) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const marginLat = marginMeters / 111319;
    const marginLng = marginMeters / (111319 * Math.cos(centerLat * DEG2RAD));
    return { south: minLat - marginLat, west: minLng - marginLng, north: maxLat + marginLat, east: maxLng + marginLng, centerLat, centerLng };
  }
}

// ═══ Catmull-Rom spline (exact copy from TrackBuilder.ts) ═══
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3);
}
function buildSplinePath(stations, pps = 30) {
  const n = stations.length;
  if (n < 2) return { points: stations.map(s => [s.lng, s.lat]), stationIndices: [0] };
  const pts = [], si = [];
  for (let i = 0; i < n-1; i++) {
    const p0 = stations[Math.max(0,i-1)], p1 = stations[i], p2 = stations[i+1], p3 = stations[Math.min(n-1,i+2)];
    si.push(pts.length);
    for (let j = 0; j < pps; j++) {
      const t = j/pps;
      pts.push([catmullRom(p0.lng,p1.lng,p2.lng,p3.lng,t), catmullRom(p0.lat,p1.lat,p2.lat,p3.lat,t)]);
    }
  }
  si.push(pts.length);
  pts.push([stations[n-1].lng, stations[n-1].lat]);
  return { points: pts, stationIndices: si };
}
function buildTrackData(stations) {
  const spline = buildSplinePath(stations);
  return { spline };
}

// ═══ Corridor logic (must match TrackRouter.ts EXACTLY) ═══
const CORRIDOR_RADIUS = 50; // Must match app/src/world/osm/TrackRouter.ts
function pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2-x1, dz = z2-z1, lenSq = dx*dx+dz*dz;
  if (lenSq < 1e-10) { const ex = px-x1, ez = pz-z1; return Math.sqrt(ex*ex+ez*ez); }
  let t = ((px-x1)*dx+(pz-z1)*dz)/lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1+t*dx, cz = z1+t*dz, ex = px-cx, ez = pz-cz;
  return Math.sqrt(ex*ex+ez*ez);
}
function isPointInCorridor(px, pz, segs, radius = CORRIDOR_RADIUS) {
  for (const s of segs) { if (pointToSegmentDistance(px,pz,s.x1,s.z1,s.x2,s.z2) < radius) return true; }
  return false;
}
function buildCorridorSegments(polylineLocal) {
  const segs = [];
  for (let i = 0; i < polylineLocal.length-1; i++) {
    segs.push({ x1: polylineLocal[i].x, z1: polylineLocal[i].z, x2: polylineLocal[i+1].x, z2: polylineLocal[i+1].z });
  }
  return segs;
}

// ═══ Haversine + OSM routing helpers (from TrackRouter.ts) ═══
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*DEG2RAD, dLon = (lon2-lon1)*DEG2RAD;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*DEG2RAD)*Math.cos(lat2*DEG2RAD)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function buildRailwayGraph(railways, nodeMap) {
  const adj = new Map();
  const nodes = new Map();
  for (const way of railways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i], b = way.nodes[i+1];
      const nA = nodeMap.get(a), nB = nodeMap.get(b);
      if (!nA || !nB) continue;
      nodes.set(a, { lat: nA.lat, lon: nA.lon });
      nodes.set(b, { lat: nB.lat, lon: nB.lon });
      const dist = haversine(nA.lat, nA.lon, nB.lat, nB.lon);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ to: b, weight: dist });
      adj.get(b).push({ to: a, weight: dist });
    }
  }
  return { adjacency: adj, nodes };
}

function findNearestNode(lat, lng, graph, maxRadius) {
  let bestId = null, bestDist = maxRadius;
  for (const [id, node] of graph.nodes) {
    const d = haversine(lat, lng, node.lat, node.lon);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestId;
}

function dijkstra(graph, startNode, endNode) {
  if (startNode === endNode) return [startNode];
  const dist = new Map(), prev = new Map(), visited = new Set();
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
  while (cur !== undefined) { path.push(cur); if (cur === startNode) break; cur = prev.get(cur); }
  if (path[path.length-1] !== startNode) return null;
  path.reverse();
  return path;
}

const SNAP_RADIUS_M = 200;
const SNAP_THRESHOLD_RATIO = 0.5;

function routeLineOnRailways(stations, railways, nodeMap) {
  if (stations.length < 2 || railways.length === 0) {
    return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  }
  const graph = buildRailwayGraph(railways, nodeMap);
  const snappedNodes = stations.map(s => findNearestNode(s.lat, s.lng, graph, SNAP_RADIUS_M));
  const snappedCount = snappedNodes.filter(n => n !== null).length;
  const ratio = snappedCount / stations.length;
  if (ratio < SNAP_THRESHOLD_RATIO) {
    return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  }
  const polyline = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const fromSnap = snappedNodes[i], toSnap = snappedNodes[i+1];
    if (fromSnap !== null && toSnap !== null) {
      const path = dijkstra(graph, fromSnap, toSnap);
      if (path && path.length >= 2) {
        const startIdx = polyline.length === 0 ? 0 : 1;
        for (let j = startIdx; j < path.length; j++) {
          const n = graph.nodes.get(path[j]);
          if (n) polyline.push([n.lon, n.lat]);
        }
        continue;
      }
    }
    if (polyline.length === 0) polyline.push([stations[i].lng, stations[i].lat]);
    polyline.push([stations[i+1].lng, stations[i+1].lat]);
  }
  return { polyline, usedOSM: true };
}

function buildTrackDataFromPolyline(polyline, stations) {
  const stationIndices = [];
  for (const st of stations) {
    let bestIdx = 0, bestDistSq = Infinity;
    for (let i = 0; i < polyline.length; i++) {
      const dx = polyline[i][0] - st.lng, dy = polyline[i][1] - st.lat;
      const dSq = dx*dx + dy*dy;
      if (dSq < bestDistSq) { bestDistSq = dSq; bestIdx = i; }
    }
    stationIndices.push(bestIdx);
  }
  return { spline: { points: polyline, stationIndices } };
}

// ═══ Overpass fetch ═══
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
async function fetchOSM(south, west, north, east) {
  const query = `[out:json][bbox:${south},${west},${north},${east}][timeout:120][maxsize:67108864];
(way["building"](${south},${west},${north},${east});way["railway"](${south},${west},${north},${east}););
out body; >; out skel qt;`;
  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    try {
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 90000);
      const r = await fetch(OVERPASS_SERVERS[i], {
        method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: `data=${encodeURIComponent(query)}`, signal: ctl.signal,
      });
      clearTimeout(tid);
      if (!r.ok) { console.log(`  Server ${i+1} returned HTTP ${r.status}`); continue; }
      return await r.json();
    } catch (e) {
      console.log(`  Server ${i+1} failed: ${e.message}`);
      if (i < OVERPASS_SERVERS.length-1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('All Overpass servers failed');
}

// ═══ Building clearing logic (exact copy from BuildingGenerator.ts) ═══
function clearBuildings(buildings, nodeMap, projection, corridorSegments) {
  const kept = [];
  let trackClearedCount = 0;

  for (const building of buildings) {
    const projectedVertices = [];
    for (const nodeId of building.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      projectedVertices.push(projection.projectToLocal(node.lat, node.lon));
    }
    const centroid = projectedVertices.length > 0
      ? {
          x: projectedVertices.reduce((s, p) => s + p.x, 0) / projectedVertices.length,
          z: projectedVertices.reduce((s, p) => s + p.z, 0) / projectedVertices.length,
        }
      : null;

    if (corridorSegments.length > 0) {
      let overlaps = false;
      for (const v of projectedVertices) {
        if (isPointInCorridor(v.x, v.z, corridorSegments)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps && centroid && isPointInCorridor(centroid.x, centroid.z, corridorSegments)) {
        overlaps = true;
      }
      if (overlaps) {
        trackClearedCount++;
        continue;
      }
    }

    kept.push(building);
  }

  return { kept, trackClearedCount };
}

// ═══════════════════════════════════════════════════════════
// MAIN: Follow Game.loadMap() EXACTLY, including Phase 3
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Exact Game.ts loadMap() Path Test (with Phase 3)      ║');
  console.log('║  CORRIDOR_RADIUS = ' + CORRIDOR_RADIUS + 'm (must match TrackRouter.ts)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ────────────────────────────────────────────────
  // PHASE 1: Parse map and build pre-route corridors
  // (Game.ts lines 142-181)
  // ────────────────────────────────────────────────
  console.log('\n══ PHASE 1: Parse + Pre-route Corridor ══');

  const parsed = parseMetroMap(TEL_AVIV_METRO);
  console.log(`[1.1] parseMetroMap: ${parsed.length} lines`);
  for (const l of parsed) console.log(`  Line "${l.name}": ${l.stations.length} stations`);

  const allStations = [];
  for (const line of parsed) {
    for (const st of line.stations) allStations.push({ lat: st.lat, lng: st.lng });
  }

  const bbox = LocalProjection.bboxFromStations(allStations, 500);
  const projection = new LocalProjection(bbox.centerLat, bbox.centerLng);
  console.log(`[1.2] Projection center: (${bbox.centerLat.toFixed(5)}, ${bbox.centerLng.toFixed(5)})`);

  const preRouteTrackData = [];
  for (const line of parsed) {
    const track = buildTrackData(line.stations);
    preRouteTrackData.push({ line, track });
  }

  const preRouteCorridorSegments = [];
  for (const { line, track } of preRouteTrackData) {
    const localPoints = track.spline.points.map(([lng, lat]) => projection.projectToLocal(lat, lng));
    preRouteCorridorSegments.push(...buildCorridorSegments(localPoints));
  }
  console.log(`[1.3] Pre-route corridor segments: ${preRouteCorridorSegments.length}`);
  assert(preRouteCorridorSegments.length > 0, `Pre-route corridor segments exist (${preRouteCorridorSegments.length})`);

  // ────────────────────────────────────────────────
  // FETCH OSM DATA
  // (WorldBuilder.loadArea)
  // ────────────────────────────────────────────────
  console.log('\n══ FETCH OSM DATA ══');
  const bbox2 = LocalProjection.bboxFromStations(allStations, 500);
  projection.setCenter(bbox2.centerLat, bbox2.centerLng);
  assert(Math.abs(bbox.centerLat - bbox2.centerLat) < 0.0001, 'Centers match after setCenter');

  console.log(`  Bbox: S=${bbox2.south.toFixed(4)} W=${bbox2.west.toFixed(4)} N=${bbox2.north.toFixed(4)} E=${bbox2.east.toFixed(4)}`);

  let osmJson;
  try {
    osmJson = await fetchOSM(bbox2.south, bbox2.west, bbox2.north, bbox2.east);
    console.log(`  Fetched ${osmJson.elements.length} elements`);
  } catch (e) {
    console.error(`  FETCH FAILED: ${e.message}`);
    console.error('  Cannot continue without OSM data. Exiting.');
    process.exit(1);
  }

  const nodeMap = new Map();
  const allBuildings = [];
  const railways = [];
  for (const el of osmJson.elements) {
    if (el.type === 'node') nodeMap.set(el.id, el);
    else if (el.type === 'way' && el.tags?.building) allBuildings.push(el);
    else if (el.type === 'way' && el.tags?.railway) railways.push(el);
  }
  console.log(`  Buildings: ${allBuildings.length}, Railways: ${railways.length}, Nodes: ${nodeMap.size}`);
  assert(allBuildings.length > 0, `Has buildings (${allBuildings.length})`);

  // ────────────────────────────────────────────────
  // PHASE 1 CLEARING (initial, with pre-route corridors)
  // This is what WorldBuilder.loadArea does first
  // ────────────────────────────────────────────────
  console.log('\n══ PHASE 1 CLEARING (pre-route corridors) ══');
  const phase1Result = clearBuildings(allBuildings, nodeMap, projection, preRouteCorridorSegments);
  console.log(`  Cleared: ${phase1Result.trackClearedCount}, Kept: ${phase1Result.kept.length}`);

  // ────────────────────────────────────────────────
  // PHASE 2: Route tracks using OSM railways
  // (Game.ts lines 217-261)
  // ────────────────────────────────────────────────
  console.log('\n══ PHASE 2: OSM Railway Routing ══');
  const finalTracks = [];

  for (const line of parsed) {
    let track;
    if (railways.length > 0) {
      const routeResult = routeLineOnRailways(
        line.stations.map(s => ({ lat: s.lat, lng: s.lng })),
        railways,
        nodeMap,
      );
      if (routeResult.usedOSM) {
        track = buildTrackDataFromPolyline(routeResult.polyline, line.stations);
        console.log(`  Line "${line.name}": OSM-routed (${routeResult.polyline.length} points)`);
      } else {
        track = buildTrackData(line.stations);
        console.log(`  Line "${line.name}": Catmull-Rom fallback`);
      }
    } else {
      track = buildTrackData(line.stations);
      console.log(`  Line "${line.name}": no railways, using Catmull-Rom`);
    }
    finalTracks.push({ line, track });
  }

  // ────────────────────────────────────────────────
  // PHASE 3: Rebuild buildings with FINAL corridor segments
  // (Game.ts lines 263-274)
  // ────────────────────────────────────────────────
  console.log('\n══ PHASE 3: Rebuild with Final Corridors ══');
  const finalCorridorSegments = [];
  for (const { line, track } of finalTracks) {
    const localPoints = track.spline.points.map(([lng, lat]) => projection.projectToLocal(lat, lng));
    const segs = buildCorridorSegments(localPoints);
    finalCorridorSegments.push(...segs);
    console.log(`  Line "${line.name}": ${segs.length} final corridor segments`);
  }
  console.log(`  TOTAL final corridor segments: ${finalCorridorSegments.length}`);
  assert(finalCorridorSegments.length > 0, `Final corridor segments exist (${finalCorridorSegments.length})`);

  // Compare pre-route vs final corridor segment counts
  const preVsFinal = finalCorridorSegments.length !== preRouteCorridorSegments.length;
  console.log(`  Pre-route segments: ${preRouteCorridorSegments.length}, Final segments: ${finalCorridorSegments.length}`);
  console.log(`  Corridors differ from pre-route: ${preVsFinal}`);

  // Now clear buildings using FINAL corridor segments (this is what rebuildBuildings does)
  const phase3Result = clearBuildings(allBuildings, nodeMap, projection, finalCorridorSegments);
  console.log(`  Phase 3 cleared: ${phase3Result.trackClearedCount}, Kept: ${phase3Result.kept.length}`);

  assert(phase3Result.trackClearedCount > 0, `Phase 3 cleared buildings (${phase3Result.trackClearedCount})`);
  assert(phase3Result.trackClearedCount > 50, `Significant number cleared in Phase 3 (${phase3Result.trackClearedCount})`);

  // ────────────────────────────────────────────────
  // CRITICAL VERIFICATION: Walk the track and check
  // that NO remaining buildings overlap
  // ────────────────────────────────────────────────
  console.log('\n══ CRITICAL VERIFICATION: No remaining buildings overlap track ══');

  const remainingBuildings = phase3Result.kept;
  let overlappingCount = 0;
  const overlappingDetails = [];

  for (const building of remainingBuildings) {
    const projectedVertices = [];
    for (const nodeId of building.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      projectedVertices.push(projection.projectToLocal(node.lat, node.lon));
    }
    if (projectedVertices.length === 0) continue;

    const centroid = {
      x: projectedVertices.reduce((s, p) => s + p.x, 0) / projectedVertices.length,
      z: projectedVertices.reduce((s, p) => s + p.z, 0) / projectedVertices.length,
    };

    // Find the minimum distance from ANY vertex of this building to ANY corridor segment
    let minVertexDist = Infinity;
    for (const v of projectedVertices) {
      for (const seg of finalCorridorSegments) {
        const d = pointToSegmentDistance(v.x, v.z, seg.x1, seg.z1, seg.x2, seg.z2);
        if (d < minVertexDist) minVertexDist = d;
      }
    }

    // Also check centroid distance
    let minCentroidDist = Infinity;
    for (const seg of finalCorridorSegments) {
      const d = pointToSegmentDistance(centroid.x, centroid.z, seg.x1, seg.z1, seg.x2, seg.z2);
      if (d < minCentroidDist) minCentroidDist = d;
    }

    if (minVertexDist < CORRIDOR_RADIUS || minCentroidDist < CORRIDOR_RADIUS) {
      overlappingCount++;
      if (overlappingDetails.length < 20) {
        overlappingDetails.push({
          id: building.id,
          minVertexDist: minVertexDist.toFixed(1),
          minCentroidDist: minCentroidDist.toFixed(1),
          centroid: `(${centroid.x.toFixed(1)}, ${centroid.z.toFixed(1)})`,
          name: building.tags?.name || '',
        });
      }
    }
  }

  console.log(`  Remaining buildings: ${remainingBuildings.length}`);
  console.log(`  Buildings that STILL overlap track (within ${CORRIDOR_RADIUS}m): ${overlappingCount}`);

  if (overlappingDetails.length > 0) {
    console.log('\n  Buildings that should have been cleared but were NOT:');
    for (const d of overlappingDetails) {
      console.log(`    Building ${d.id}: vertexDist=${d.minVertexDist}m, centroidDist=${d.minCentroidDist}m, pos=${d.centroid} ${d.name}`);
    }
  }

  assert(overlappingCount === 0, `ZERO remaining buildings overlap the track (found ${overlappingCount})`);

  // ────────────────────────────────────────────────
  // SPOT CHECKS: Verify specific dense areas
  // ────────────────────────────────────────────────
  console.log('\n══ SPOT CHECKS: Dense areas ══');
  const spotCheckStations = [
    { ...TEL_AVIV_METRO.stations.r7, name: 'Dizengoff Center' },
    { ...TEL_AVIV_METRO.stations.r8, name: 'Carlebach' },
    { ...TEL_AVIV_METRO.stations.r9, name: 'Allenby' },
    { ...TEL_AVIV_METRO.stations.g4, name: 'Habima' },
    { ...TEL_AVIV_METRO.stations.g5, name: 'Rothschild' },
  ];

  for (const st of spotCheckStations) {
    const stLocal = projection.projectToLocal(st.lat, st.lng);
    let within30m = 0, within30mCleared = 0;
    for (const bldg of allBuildings) {
      let minDist = Infinity;
      for (const nodeId of bldg.nodes) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const p = projection.projectToLocal(node.lat, node.lon);
        const d = Math.sqrt((p.x-stLocal.x)**2 + (p.z-stLocal.z)**2);
        if (d < minDist) minDist = d;
      }
      if (minDist < 30) {
        within30m++;
        let overlaps = false;
        for (const nodeId of bldg.nodes) {
          const node = nodeMap.get(nodeId);
          if (!node) continue;
          const p = projection.projectToLocal(node.lat, node.lon);
          if (isPointInCorridor(p.x, p.z, finalCorridorSegments)) { overlaps = true; break; }
        }
        if (overlaps) within30mCleared++;
      }
    }
    const clearRate = within30m > 0 ? ((within30mCleared/within30m)*100).toFixed(0) : 'N/A';
    console.log(`  ${st.name}: ${within30m} buildings within 30m of station, ${within30mCleared} cleared (${clearRate}%)`);
  }

  // ────────────────────────────────────────────────
  // CORRIDOR SANITY CHECKS
  // ────────────────────────────────────────────────
  console.log('\n══ CORRIDOR SANITY CHECKS ══');
  let totalLen = 0;
  for (const s of finalCorridorSegments) {
    totalLen += Math.sqrt((s.x2-s.x1)**2 + (s.z2-s.z1)**2);
  }
  console.log(`  Total final corridor path length: ${totalLen.toFixed(0)}m`);
  assert(totalLen > 10000, `Corridor path is long enough (${totalLen.toFixed(0)}m > 10000m)`);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of finalCorridorSegments) {
    for (const x of [s.x1, s.x2]) { if (x<minX) minX=x; if (x>maxX) maxX=x; }
    for (const z of [s.z1, s.z2]) { if (z<minZ) minZ=z; if (z>maxZ) maxZ=z; }
  }
  console.log(`  Corridor X range: [${minX.toFixed(0)}, ${maxX.toFixed(0)}]`);
  console.log(`  Corridor Z range: [${minZ.toFixed(0)}, ${maxZ.toFixed(0)}]`);

  // ────────────────────────────────────────────────
  // RESULTS
  // ────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
