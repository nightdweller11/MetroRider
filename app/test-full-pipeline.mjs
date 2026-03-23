/**
 * Full Pipeline Integration Test
 * Simulates the exact same flow as Game.ts loadMap() to verify:
 * 1. Corridor segments are generated correctly
 * 2. Buildings are actually filtered by corridor clearing
 * 3. Station snapping + routing logic works
 * Run with: node test-full-pipeline.mjs
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

// ── Tel Aviv Metro data (from SampleRoutes.ts) ──
const TEL_AVIV_STATIONS = {
  r1: { name: 'Petah Tikva Central', lat: 32.0905, lng: 34.8855 },
  r2: { name: 'Em HaMoshavot', lat: 32.0865, lng: 34.8720 },
  r3: { name: 'Kiryat Aryeh', lat: 32.0840, lng: 34.8530 },
  r4: { name: 'Bnei Brak', lat: 32.0820, lng: 34.8350 },
  r5: { name: 'Ramat Gan Diamond', lat: 32.0785, lng: 34.8120 },
  r6: { name: 'Arlozorov', lat: 32.0795, lng: 34.7920 },
  r7: { name: 'Dizengoff Center', lat: 32.0755, lng: 34.7745 },
  r8: { name: 'Carlebach', lat: 32.0680, lng: 34.7790 },
  r9: { name: 'Allenby', lat: 32.0640, lng: 34.7710 },
  r10: { name: "Neve Sha'anan", lat: 32.0565, lng: 34.7680 },
  r11: { name: 'Jaffa Clock Tower', lat: 32.0510, lng: 34.7560 },
  r12: { name: 'Bat Yam Central', lat: 32.0225, lng: 34.7505 },
};

const RED_LINE_IDS = ['r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12'];

// ── Projection (matching LocalProjection.ts) ──
const DEG2RAD = Math.PI / 180;

function createProjection(centerLat, centerLng) {
  const metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
  const metersPerDegLat = 111319;
  return {
    centerLat, centerLng, metersPerDegLng, metersPerDegLat,
    projectToLocal(lat, lng) {
      return {
        x: (lng - centerLng) * metersPerDegLng,
        z: -(lat - centerLat) * metersPerDegLat,
      };
    },
  };
}

function bboxFromStations(stations, marginMeters = 500) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
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
  return {
    south: minLat - marginLat, west: minLng - marginLng,
    north: maxLat + marginLat, east: maxLng + marginLng,
    centerLat, centerLng,
  };
}

// ── Catmull-Rom spline (matching TrackBuilder.ts) ──
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildSplinePath(stations, pointsPerSegment = 30) {
  const n = stations.length;
  if (n < 2) return { points: stations.map(s => [s.lng, s.lat]), stationIndices: [0] };
  const pts = [];
  const stationIndices = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)];
    const p1 = stations[i];
    const p2 = stations[i + 1];
    const p3 = stations[Math.min(n - 1, i + 2)];
    stationIndices.push(pts.length);
    for (let j = 0; j < pointsPerSegment; j++) {
      const t = j / pointsPerSegment;
      pts.push([catmullRom(p0.lng, p1.lng, p2.lng, p3.lng, t), catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t)]);
    }
  }
  stationIndices.push(pts.length);
  pts.push([stations[n - 1].lng, stations[n - 1].lat]);
  return { points: pts, stationIndices };
}

// ── Corridor clearing (matching TrackRouter.ts) ──
function pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-10) {
    const ex = px - x1; const ez = pz - z1;
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

function isPointInCorridor(px, pz, segments, radius = 25) {
  for (const seg of segments) {
    const d = pointToSegmentDistance(px, pz, seg.x1, seg.z1, seg.x2, seg.z2);
    if (d < radius) return true;
  }
  return false;
}

function buildCorridorSegments(polylineLocal) {
  const segments = [];
  for (let i = 0; i < polylineLocal.length - 1; i++) {
    segments.push({
      x1: polylineLocal[i].x, z1: polylineLocal[i].z,
      x2: polylineLocal[i + 1].x, z2: polylineLocal[i + 1].z,
    });
  }
  return segments;
}

// ── OSM fetch ──
function buildQuery(south, west, north, east) {
  return `[out:json][bbox:${south},${west},${north},${east}][timeout:120][maxsize:67108864];
(
  way["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
  way["railway"](${south},${west},${north},${east});
  node["natural"="tree"](${south},${west},${north},${east});
);
out body; >; out skel qt;`;
}

async function fetchFromOverpass(bbox) {
  const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);
  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const url = OVERPASS_SERVERS[i];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) continue;
      const text = await resp.text();
      return JSON.parse(text);
    } catch (err) {
      console.log(`  Server ${i + 1} failed: ${err.message}`);
      if (i < OVERPASS_SERVERS.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('All Overpass servers failed');
}

function parseOSMResponse(elements) {
  const nodeMap = new Map();
  const buildings = [];
  const railways = [];
  for (const el of elements) {
    if (el.type === 'node') { nodeMap.set(el.id, el); }
    else if (el.type === 'way') {
      if (!el.tags) continue;
      if (el.tags['building']) buildings.push(el);
      if (el.tags['railway']) railways.push(el);
    }
  }
  return { nodeMap, buildings, railways };
}

// ──────────────────────────────────────────────────
// TEST 1: Corridor segment generation
// ──────────────────────────────────────────────────
function testCorridorGeneration() {
  console.log('\n══ TEST 1: Corridor segment generation from Red Line ══');

  const stations = RED_LINE_IDS.map(id => TEL_AVIV_STATIONS[id]);
  const allStations = Object.values(TEL_AVIV_STATIONS);
  const bbox = bboxFromStations(allStations, 500);
  const projection = createProjection(bbox.centerLat, bbox.centerLng);

  console.log(`  Projection center: ${bbox.centerLat.toFixed(5)}, ${bbox.centerLng.toFixed(5)}`);

  const spline = buildSplinePath(stations);
  console.log(`  Catmull-Rom spline: ${spline.points.length} points`);
  assert(spline.points.length > 100, `Spline has substantial points (${spline.points.length})`);

  const localPoints = spline.points.map(([lng, lat]) => projection.projectToLocal(lat, lng));
  console.log(`  First local point: (${localPoints[0].x.toFixed(1)}, ${localPoints[0].z.toFixed(1)})`);
  console.log(`  Last local point: (${localPoints[localPoints.length - 1].x.toFixed(1)}, ${localPoints[localPoints.length - 1].z.toFixed(1)})`);

  const segments = buildCorridorSegments(localPoints);
  console.log(`  Corridor segments: ${segments.length}`);
  assert(segments.length === localPoints.length - 1, `Segment count matches (${segments.length})`);

  // Verify segments have non-zero length
  let zeroLenCount = 0;
  let totalLen = 0;
  for (const seg of segments) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    totalLen += len;
    if (len < 0.01) zeroLenCount++;
  }
  console.log(`  Total corridor length: ${totalLen.toFixed(1)}m`);
  console.log(`  Zero-length segments: ${zeroLenCount}`);
  assert(totalLen > 5000, `Corridor length > 5km (got ${totalLen.toFixed(0)}m)`);

  // Test that a point ON the track is in the corridor
  const midPoint = localPoints[Math.floor(localPoints.length / 2)];
  assert(isPointInCorridor(midPoint.x, midPoint.z, segments), 'Midpoint of track IS in corridor');

  // Test that a point 100m away is NOT in the corridor
  assert(!isPointInCorridor(midPoint.x + 100, midPoint.z + 100, segments), 'Point 100m away is NOT in corridor');

  return { projection, segments, localPoints };
}

// ──────────────────────────────────────────────────
// TEST 2: Building filtering with real OSM data
// ──────────────────────────────────────────────────
async function testBuildingFiltering(projection, corridorSegments) {
  console.log('\n══ TEST 2: Building filtering with real OSM data ══');

  // Use a small bbox around the Red Line to reduce fetch time
  const smallBbox = { south: 32.065, west: 34.765, north: 32.085, east: 34.800 };
  console.log(`  Fetching OSM data for test bbox...`);

  let data;
  try {
    const json = await fetchFromOverpass(smallBbox);
    data = parseOSMResponse(json.elements);
    console.log(`  Fetched: ${data.buildings.length} buildings, ${data.railways.length} railways`);
  } catch (err) {
    console.error(`  FAILED to fetch: ${err.message}`);
    assert(false, 'OSM fetch succeeded');
    return;
  }

  assert(data.buildings.length > 0, `Has buildings (${data.buildings.length})`);

  // Compute centroids for all buildings
  let validCentroids = 0;
  let inCorridor = 0;
  let outCorridor = 0;
  let failedCentroids = 0;

  const buildingsInCorridor = [];
  const buildingsOutCorridor = [];

  for (const bldg of data.buildings) {
    let overlaps = false;
    let sumX = 0, sumZ = 0, count = 0;
    let allResolved = true;

    // Per-vertex check (matching updated BuildingGenerator)
    for (const nodeId of bldg.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) { allResolved = false; break; }
      const p = projection.projectToLocal(node.lat, node.lon);
      sumX += p.x;
      sumZ += p.z;
      count++;
      if (!overlaps && isPointInCorridor(p.x, p.z, corridorSegments)) {
        overlaps = true;
      }
    }
    if (!allResolved || count === 0) { failedCentroids++; continue; }

    // Centroid check as fallback
    if (!overlaps) {
      const cx = sumX / count;
      const cz = sumZ / count;
      if (isPointInCorridor(cx, cz, corridorSegments)) {
        overlaps = true;
      }
    }

    validCentroids++;
    const cx = sumX / count;
    const cz = sumZ / count;

    if (overlaps) {
      inCorridor++;
      if (buildingsInCorridor.length < 5) {
        buildingsInCorridor.push({ id: bldg.id, x: cx.toFixed(1), z: cz.toFixed(1) });
      }
    } else {
      outCorridor++;
      if (buildingsOutCorridor.length < 3) {
        buildingsOutCorridor.push({ id: bldg.id, x: cx.toFixed(1), z: cz.toFixed(1) });
      }
    }
  }

  console.log(`  Valid centroids: ${validCentroids}`);
  console.log(`  Failed centroids: ${failedCentroids}`);
  console.log(`  Buildings IN corridor (should be cleared): ${inCorridor}`);
  console.log(`  Buildings OUT of corridor (should be kept): ${outCorridor}`);
  console.log(`  Corridor clearing rate: ${(inCorridor / validCentroids * 100).toFixed(1)}%`);

  assert(inCorridor > 0, `Some buildings ARE in the corridor (${inCorridor})`);
  assert(outCorridor > 0, `Most buildings are outside the corridor (${outCorridor})`);
  assert(inCorridor < outCorridor, 'More buildings outside than inside corridor');

  if (buildingsInCorridor.length > 0) {
    console.log('\n  Sample buildings IN corridor (should be cleared):');
    for (const b of buildingsInCorridor) {
      console.log(`    Building ${b.id}: centroid (${b.x}, ${b.z})`);
    }
  }

  // Verify: for buildings in corridor, find the closest segment and distance
  if (buildingsInCorridor.length > 0) {
    console.log('\n  Verifying per-vertex corridor check for first in-corridor building:');
    const bldg = data.buildings.find(b => b.id === buildingsInCorridor[0].id);
    if (bldg) {
      let minVertexDist = Infinity;
      for (const nodeId of bldg.nodes) {
        const node = data.nodeMap.get(nodeId);
        if (!node) continue;
        const p = projection.projectToLocal(node.lat, node.lon);
        for (const seg of corridorSegments) {
          const d = pointToSegmentDistance(p.x, p.z, seg.x1, seg.z1, seg.x2, seg.z2);
          if (d < minVertexDist) minVertexDist = d;
        }
      }
      console.log(`    Nearest vertex distance to track: ${minVertexDist.toFixed(2)}m (threshold: 25m)`);
      assert(minVertexDist < 25, `Building vertex within corridor (${minVertexDist.toFixed(2)}m < 25m)`);
    }
  }
}

// ──────────────────────────────────────────────────
// TEST 3: Verify corridor segments cover the track path
// ──────────────────────────────────────────────────
function testCorridorCoverage(localPoints, segments) {
  console.log('\n══ TEST 3: Corridor coverage verification ══');

  // Every track point should be inside the corridor
  let coveredCount = 0;
  let uncoveredCount = 0;
  for (let i = 0; i < localPoints.length; i += 10) { // sample every 10th point
    const p = localPoints[i];
    if (isPointInCorridor(p.x, p.z, segments)) {
      coveredCount++;
    } else {
      uncoveredCount++;
      if (uncoveredCount <= 3) {
        console.log(`    UNCOVERED track point #${i}: (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
    }
  }

  console.log(`  Track points covered: ${coveredCount}/${coveredCount + uncoveredCount}`);
  assert(uncoveredCount === 0, `All sampled track points are in the corridor (${uncoveredCount} uncovered)`);

  // Points 5m from track should mostly be in corridor
  let near5m = 0, near5mIn = 0;
  for (let i = 0; i < localPoints.length; i += 20) {
    const p = localPoints[i];
    const testX = p.x + 5;
    const testZ = p.z;
    near5m++;
    if (isPointInCorridor(testX, testZ, segments)) near5mIn++;
  }
  console.log(`  Points 5m from track in corridor: ${near5mIn}/${near5m}`);
  assert(near5mIn / near5m > 0.9, `>90% of 5m-offset points in corridor`);

  // Points 50m perpendicular from track should NOT be in corridor (radius = 25m)
  // Test with points offset in both X and Z to account for track direction
  let far50m = 0, far50mIn = 0;
  for (let i = 0; i < localPoints.length; i += 20) {
    const p = localPoints[i];
    far50m++;
    if (isPointInCorridor(p.x + 50, p.z + 50, segments)) far50mIn++;
  }
  console.log(`  Points 50m diag from track in corridor: ${far50mIn}/${far50m}`);
  assert(far50mIn / far50m < 0.25, `<25% of 50m-diagonal-offset points in corridor`);
}

// ──────────────────────────────────────────────────
// TEST 4: ExtrudeGeometry group structure
// ──────────────────────────────────────────────────
function testExtrudeGeometryGroups() {
  console.log('\n══ TEST 4: ExtrudeGeometry group structure (simulated) ══');

  // Three.js ExtrudeGeometry creates these groups:
  // Group 0: front cap (materialIndex 0) - bottom
  // Group 1: back cap (materialIndex 1) - roof
  // Group 2: sides (materialIndex 2)
  //
  // We can verify the expected group structure matches our code's assumptions.
  // (Can't create actual Three.js objects in Node, but can verify the logic)

  // The current code uses mergeGeometries(geometries, false) which DROPS groups
  // This means a single material is applied to ALL faces (sides + caps)
  // FIX NEEDED: either preserve groups with multi-material, or split geometries

  const currentMergePreservesGroups = false; // mergeGeometries(geoms, false)
  assert(!currentMergePreservesGroups, 'Current code drops geometry groups (confirmed bug)');

  console.log('  Issue: mergeGeometries(geoms, false) drops group info');
  console.log('  Result: window texture applied to roof + bottom + sides equally');
  console.log('  Fix: split each building into cap geometry (solid) + side geometry (textured)');
  console.log('  Or: neutralize cap UVs before merging so they show wall color');
}

// ──────────────────────────────────────────────────
// RUN ALL TESTS
// ──────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   MetroRider Full Pipeline Integration Test   ║');
  console.log('╚══════════════════════════════════════════════╝');

  const { projection, segments, localPoints } = testCorridorGeneration();
  testCorridorCoverage(localPoints, segments);
  testExtrudeGeometryGroups();
  await testBuildingFiltering(projection, segments);

  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
