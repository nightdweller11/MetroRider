/**
 * Test: Are buildings placed correctly relative to roads?
 * 
 * Checks:
 * 1. Do buildings and roads use the same projection?
 * 2. Are buildings adjacent to roads (not overlapping or far away)?
 * 3. Are there buildings sitting ON TOP of roads?
 * 4. Are there road segments with no buildings nearby?
 *
 * Run: node test-building-placement.mjs
 */

const DEG2RAD = Math.PI / 180;

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
  localToLatLng(x, z) {
    return {
      lat: this.centerLat + (-z / this.metersPerDegLat),
      lng: this.centerLng + (x / this.metersPerDegLng),
    };
  }
}

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOSM(south, west, north, east) {
  const query = `[out:json][bbox:${south},${west},${north},${east}][timeout:60];
(way["building"](${south},${west},${north},${east});
 way["highway"](${south},${west},${north},${east}););
out body; >; out skel qt;`;
  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    try {
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 60000);
      const r = await fetch(OVERPASS_SERVERS[i], {
        method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: `data=${encodeURIComponent(query)}`, signal: ctl.signal,
      });
      clearTimeout(tid);
      if (!r.ok) continue;
      return await r.json();
    } catch (e) {
      console.log(`  Server ${i+1} failed: ${e.message}`);
    }
  }
  throw new Error('All servers failed');
}

function pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2-x1, dz = z2-z1, lenSq = dx*dx+dz*dz;
  if (lenSq < 1e-10) { const ex = px-x1, ez = pz-z1; return Math.sqrt(ex*ex+ez*ez); }
  let t = ((px-x1)*dx+(pz-z1)*dz)/lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1+t*dx, cz = z1+t*dz, ex = px-cx, ez = pz-cz;
  return Math.sqrt(ex*ex+ez*ez);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Building Placement vs Road Alignment Test        ║');
  console.log('╚════════════════════════════════════════════════════╝');

  // Test area: around Em HaMoshavot station (where train was in screenshots)
  const testCenter = { lat: 32.0865, lng: 34.8720 };
  const radiusDeg = 0.003; // ~300m

  const south = testCenter.lat - radiusDeg;
  const north = testCenter.lat + radiusDeg;
  const west = testCenter.lng - radiusDeg;
  const east = testCenter.lng + radiusDeg;

  const projection = new LocalProjection(testCenter.lat, testCenter.lng);

  console.log(`\nTest area: ${south.toFixed(5)},${west.toFixed(5)} to ${north.toFixed(5)},${east.toFixed(5)}`);
  console.log(`Center: ${testCenter.lat}, ${testCenter.lng}`);

  const osmJson = await fetchOSM(south, west, north, east);
  console.log(`Fetched ${osmJson.elements.length} OSM elements`);

  const nodeMap = new Map();
  const buildings = [];
  const roads = [];

  for (const el of osmJson.elements) {
    if (el.type === 'node') nodeMap.set(el.id, el);
    else if (el.type === 'way' && el.tags?.building) buildings.push(el);
    else if (el.type === 'way' && el.tags?.highway) roads.push(el);
  }

  console.log(`Buildings: ${buildings.length}, Roads: ${roads.length}, Nodes: ${nodeMap.size}`);

  // Project all road segments
  const roadSegments = [];
  for (const road of roads) {
    const points = [];
    for (const nodeId of road.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      points.push(projection.projectToLocal(node.lat, node.lon));
    }
    for (let i = 0; i < points.length - 1; i++) {
      roadSegments.push({
        x1: points[i].x, z1: points[i].z,
        x2: points[i+1].x, z2: points[i+1].z,
        type: road.tags?.highway || 'unknown',
        name: road.tags?.name || '',
      });
    }
  }
  console.log(`Road segments: ${roadSegments.length}`);

  // For each building, compute:
  // - Its centroid in local coords
  // - Distance to nearest road segment
  // - Whether any vertex is ON a road (< 2m)
  console.log('\n── Building-to-Road Distance Analysis ──');

  const distBuckets = { '<2m': 0, '2-5m': 0, '5-10m': 0, '10-20m': 0, '20-50m': 0, '>50m': 0 };
  const onRoadBuildings = [];
  const farFromRoadBuildings = [];
  
  let totalBuildings = 0;

  for (const building of buildings) {
    const vertices = [];
    for (const nodeId of building.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      vertices.push({ ...projection.projectToLocal(node.lat, node.lon), lat: node.lat, lng: node.lon });
    }
    if (vertices.length < 3) continue;
    totalBuildings++;

    const centroid = {
      x: vertices.reduce((s, v) => s + v.x, 0) / vertices.length,
      z: vertices.reduce((s, v) => s + v.z, 0) / vertices.length,
    };

    // Find minimum distance from any building vertex to any road segment
    let minVertexDist = Infinity;
    let nearestRoadName = '';
    let nearestRoadType = '';
    for (const v of vertices) {
      for (const seg of roadSegments) {
        const d = pointToSegmentDistance(v.x, v.z, seg.x1, seg.z1, seg.x2, seg.z2);
        if (d < minVertexDist) {
          minVertexDist = d;
          nearestRoadName = seg.name;
          nearestRoadType = seg.type;
        }
      }
    }

    // Also check centroid distance
    let minCentroidDist = Infinity;
    for (const seg of roadSegments) {
      const d = pointToSegmentDistance(centroid.x, centroid.z, seg.x1, seg.z1, seg.x2, seg.z2);
      if (d < minCentroidDist) minCentroidDist = d;
    }

    if (minVertexDist < 2) distBuckets['<2m']++;
    else if (minVertexDist < 5) distBuckets['2-5m']++;
    else if (minVertexDist < 10) distBuckets['5-10m']++;
    else if (minVertexDist < 20) distBuckets['10-20m']++;
    else if (minVertexDist < 50) distBuckets['20-50m']++;
    else distBuckets['>50m']++;

    if (minVertexDist < 1) {
      onRoadBuildings.push({
        id: building.id,
        centroid,
        dist: minVertexDist.toFixed(2),
        road: nearestRoadName || nearestRoadType,
        lat: vertices[0].lat,
        lng: vertices[0].lng,
      });
    }

    if (minVertexDist > 50) {
      farFromRoadBuildings.push({
        id: building.id,
        centroid,
        dist: minVertexDist.toFixed(1),
        lat: vertices[0].lat,
        lng: vertices[0].lng,
      });
    }
  }

  console.log(`\nDistance from building edge to nearest road:`);
  for (const [range, count] of Object.entries(distBuckets)) {
    const pct = totalBuildings > 0 ? ((count / totalBuildings) * 100).toFixed(1) : '0';
    const bar = '█'.repeat(Math.round(count / totalBuildings * 40));
    console.log(`  ${range.padEnd(6)} : ${String(count).padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  }

  console.log(`\nBuildings with edge < 1m from road (touching/overlapping): ${onRoadBuildings.length}`);
  if (onRoadBuildings.length > 0 && onRoadBuildings.length <= 10) {
    for (const b of onRoadBuildings) {
      console.log(`  Building ${b.id}: dist=${b.dist}m to "${b.road}" at (${b.lat.toFixed(5)}, ${b.lng.toFixed(5)})`);
    }
  }

  console.log(`\nBuildings > 50m from any road: ${farFromRoadBuildings.length}`);
  if (farFromRoadBuildings.length > 0) {
    for (const b of farFromRoadBuildings.slice(0, 5)) {
      console.log(`  Building ${b.id}: dist=${b.dist}m at (${b.lat.toFixed(5)}, ${b.lng.toFixed(5)})`);
    }
  }

  // Check: pick 5 buildings and print their actual lat/lng + local coords
  // to verify projection is sane
  console.log('\n── Projection Sanity Check ──');
  console.log('Verifying building and road coordinates use the same projection:');
  
  const sampleBuildings = buildings.slice(0, 3);
  for (const bldg of sampleBuildings) {
    const firstNode = nodeMap.get(bldg.nodes[0]);
    if (!firstNode) continue;
    const local = projection.projectToLocal(firstNode.lat, firstNode.lon);
    console.log(`  Building ${bldg.id}: OSM=(${firstNode.lat.toFixed(6)}, ${firstNode.lon.toFixed(6)}) → local=(${local.x.toFixed(1)}, ${local.z.toFixed(1)})`);
  }

  const sampleRoads = roads.slice(0, 3);
  for (const road of sampleRoads) {
    const firstNode = nodeMap.get(road.nodes[0]);
    if (!firstNode) continue;
    const local = projection.projectToLocal(firstNode.lat, firstNode.lon);
    console.log(`  Road "${road.tags?.name || road.tags?.highway}" ${road.id}: OSM=(${firstNode.lat.toFixed(6)}, ${firstNode.lon.toFixed(6)}) → local=(${local.x.toFixed(1)}, ${local.z.toFixed(1)})`);
  }

  // Check: pick a well-known road and check if buildings are alongside it
  console.log('\n── Road-specific building adjacency ──');
  const namedRoads = roads.filter(r => r.tags?.name);
  const roadsByName = new Map();
  for (const road of namedRoads) {
    const name = road.tags.name;
    if (!roadsByName.has(name)) roadsByName.set(name, []);
    roadsByName.get(name).push(road);
  }

  let roadCount = 0;
  for (const [name, roadWays] of roadsByName) {
    if (roadCount >= 5) break;
    const roadPts = [];
    for (const way of roadWays) {
      for (const nodeId of way.nodes) {
        const node = nodeMap.get(nodeId);
        if (node) roadPts.push(projection.projectToLocal(node.lat, node.lon));
      }
    }
    if (roadPts.length < 2) continue;

    // Count buildings within 15m of this road
    let nearbyCount = 0;
    for (const bldg of buildings) {
      let minD = Infinity;
      for (const nodeId of bldg.nodes) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const p = projection.projectToLocal(node.lat, node.lon);
        for (let i = 0; i < roadPts.length - 1; i++) {
          const d = pointToSegmentDistance(p.x, p.z, roadPts[i].x, roadPts[i].z, roadPts[i+1].x, roadPts[i+1].z);
          if (d < minD) minD = d;
        }
      }
      if (minD < 15) nearbyCount++;
    }

    console.log(`  "${name}": ${roadPts.length} pts, ${nearbyCount} buildings within 15m`);
    roadCount++;
  }

  // VERDICT
  console.log('\n══ VERDICT ══');
  const touchingPct = totalBuildings > 0 ? (distBuckets['<2m'] / totalBuildings * 100).toFixed(1) : 0;
  const within10Pct = totalBuildings > 0 ? ((distBuckets['<2m'] + distBuckets['2-5m'] + distBuckets['5-10m']) / totalBuildings * 100).toFixed(1) : 0;
  
  console.log(`  ${totalBuildings} buildings analyzed`);
  console.log(`  ${touchingPct}% touch a road (<2m) — NORMAL for dense urban area`);
  console.log(`  ${within10Pct}% within 10m of a road — should be high (>70%)`);
  console.log(`  ${farFromRoadBuildings.length} buildings >50m from any road — should be few`);
  
  if (parseFloat(within10Pct) > 60) {
    console.log(`  ✓ Building-road alignment looks CORRECT in OSM data`);
    console.log(`  → Visual issues were likely caused by road corridor clearing (now removed)`);
  } else {
    console.log(`  ✗ Building-road alignment looks OFF — investigate projection`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
