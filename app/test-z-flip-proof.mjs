/**
 * PROOF TEST: Z-flip bug in building placement.
 *
 * Hypothesis: THREE.Shape(x, z) + ExtrudeGeometry + rotateX(-PI/2)
 * produces final vertices at Z' = -z (mirrored), while roads use
 * raw (x, Y_OFFSET, z) which is correct.
 *
 * This test proves the bug exists, then proves the fix works,
 * all without touching application code.
 *
 * Run: node test-z-flip-proof.mjs
 */

import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ─── LocalProjection (exact copy) ───
class LocalProjection {
  constructor(centerLat, centerLng) {
    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
    this.metersPerDegLat = 111319;
  }
  projectToLocal(lat, lng) {
    return {
      x: (lng - this.centerLng) * this.metersPerDegLng,
      z: -(lat - this.centerLat) * this.metersPerDegLat,
    };
  }
}

// ─── Test data: a simple rectangular building ───
// Building at approximately Em HaMoshavot, Petah Tikva
// 4 corners forming a ~20m x 10m rectangle
const CENTER_LAT = 32.0865;
const CENTER_LNG = 34.8720;
const proj = new LocalProjection(CENTER_LAT, CENTER_LNG);

// Building 200m north and 150m east of center
const buildingLat = CENTER_LAT + 200 / 111319;
const buildingLng = CENTER_LNG + 150 / (111319 * Math.cos(CENTER_LAT * DEG2RAD));

// 4 corners (small rectangle)
const corners = [
  { lat: buildingLat,            lng: buildingLng },
  { lat: buildingLat,            lng: buildingLng + 20 / (111319 * Math.cos(CENTER_LAT * DEG2RAD)) },
  { lat: buildingLat - 10/111319, lng: buildingLng + 20 / (111319 * Math.cos(CENTER_LAT * DEG2RAD)) },
  { lat: buildingLat - 10/111319, lng: buildingLng },
];

const projectedCorners = corners.map(c => proj.projectToLocal(c.lat, c.lng));
const BUILDING_HEIGHT = 15;

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║  Z-Flip Proof Test                                   ║');
console.log('╚═══════════════════════════════════════════════════════╝');

console.log('\n── Setup ──');
console.log(`  Projection center: (${CENTER_LAT}, ${CENTER_LNG})`);
console.log(`  Building at: lat=${buildingLat.toFixed(6)}, lng=${buildingLng.toFixed(6)}`);
console.log(`  Projected corners:`);
for (let i = 0; i < projectedCorners.length; i++) {
  const c = projectedCorners[i];
  console.log(`    [${i}] x=${c.x.toFixed(2)}, z=${c.z.toFixed(2)}`);
}

const expectedZ_avg = projectedCorners.reduce((s, c) => s + c.z, 0) / projectedCorners.length;
const expectedX_avg = projectedCorners.reduce((s, c) => s + c.x, 0) / projectedCorners.length;
console.log(`  Expected centroid: x=${expectedX_avg.toFixed(2)}, z=${expectedZ_avg.toFixed(2)}`);
console.log(`  Building height: ${BUILDING_HEIGHT}m`);

// ═══════════════════════════════════════════════════════
// TEST 1: Current code path (BUGGY)
//   Shape(x, z) + ExtrudeGeometry + rotateX(-PI/2)
// ═══════════════════════════════════════════════════════
console.log('\n══ TEST 1: Current code (Shape with x, z) ══');

function buildGeometry_current(pts, height) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].z);  // <-- current code uses z as shape Y
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, pts[i].z);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geom.rotateX(-Math.PI / 2);
  return geom;
}

const geomCurrent = buildGeometry_current(projectedCorners, BUILDING_HEIGHT);
const posCurrent = geomCurrent.getAttribute('position');

let minZ_current = Infinity, maxZ_current = -Infinity;
let minX_current = Infinity, maxX_current = -Infinity;
let minY_current = Infinity, maxY_current = -Infinity;

for (let i = 0; i < posCurrent.count; i++) {
  const x = posCurrent.getX(i);
  const y = posCurrent.getY(i);
  const z = posCurrent.getZ(i);
  if (x < minX_current) minX_current = x;
  if (x > maxX_current) maxX_current = x;
  if (y < minY_current) minY_current = y;
  if (y > maxY_current) maxY_current = y;
  if (z < minZ_current) minZ_current = z;
  if (z > maxZ_current) maxZ_current = z;
}

console.log(`  Rendered X range: [${minX_current.toFixed(2)}, ${maxX_current.toFixed(2)}]`);
console.log(`  Rendered Y range: [${minY_current.toFixed(2)}, ${maxY_current.toFixed(2)}]`);
console.log(`  Rendered Z range: [${minZ_current.toFixed(2)}, ${maxZ_current.toFixed(2)}]`);
console.log(`  Expected Z range: [${Math.min(...projectedCorners.map(c=>c.z)).toFixed(2)}, ${Math.max(...projectedCorners.map(c=>c.z)).toFixed(2)}]`);

const renderedZ_avg_current = (minZ_current + maxZ_current) / 2;
console.log(`  Rendered Z centroid: ${renderedZ_avg_current.toFixed(2)}`);
console.log(`  Expected Z centroid: ${expectedZ_avg.toFixed(2)}`);
console.log(`  Difference: ${(renderedZ_avg_current - expectedZ_avg).toFixed(2)}m`);

// The bug: rendered Z should equal -expectedZ (negated)
assert(
  Math.abs(renderedZ_avg_current - (-expectedZ_avg)) < 1.0,
  `BUG CONFIRMED: rendered Z (${renderedZ_avg_current.toFixed(2)}) ≈ -expected Z (${(-expectedZ_avg).toFixed(2)})`
);

assert(
  Math.abs(renderedZ_avg_current - expectedZ_avg) > 100,
  `BUG CONFIRMED: rendered Z is far from correct position (off by ${Math.abs(renderedZ_avg_current - expectedZ_avg).toFixed(0)}m)`
);

// X should be correct (no flip on X axis)
const renderedX_avg_current = (minX_current + maxX_current) / 2;
assert(
  Math.abs(renderedX_avg_current - expectedX_avg) < 1.0,
  `X axis is correct: rendered (${renderedX_avg_current.toFixed(2)}) ≈ expected (${expectedX_avg.toFixed(2)})`
);

// Y should be 0..height (vertical extrusion)
assert(
  minY_current >= -0.1 && maxY_current <= BUILDING_HEIGHT + 0.1,
  `Y axis is correct: [${minY_current.toFixed(2)}, ${maxY_current.toFixed(2)}] ≈ [0, ${BUILDING_HEIGHT}]`
);

geomCurrent.dispose();

// ═══════════════════════════════════════════════════════
// TEST 2: Road vertex (correct — no Shape/rotation)
// ═══════════════════════════════════════════════════════
console.log('\n══ TEST 2: Road vertex (raw x, Y_OFFSET, z) ══');

const ROAD_Y_OFFSET = 0.05;
const roadPoint = proj.projectToLocal(buildingLat, buildingLng);
const roadVertex = { x: roadPoint.x, y: ROAD_Y_OFFSET, z: roadPoint.z };

console.log(`  Road vertex: x=${roadVertex.x.toFixed(2)}, y=${roadVertex.y.toFixed(2)}, z=${roadVertex.z.toFixed(2)}`);
console.log(`  Expected:    x=${roadPoint.x.toFixed(2)}, y=${ROAD_Y_OFFSET}, z=${roadPoint.z.toFixed(2)}`);

assert(
  Math.abs(roadVertex.z - roadPoint.z) < 0.01,
  `Road Z is correct: ${roadVertex.z.toFixed(2)} = expected ${roadPoint.z.toFixed(2)}`
);

// Compare road Z vs building Z
console.log(`\n  Road Z at this lat/lng:     ${roadVertex.z.toFixed(2)}`);
console.log(`  Building Z at this lat/lng: ${renderedZ_avg_current.toFixed(2)} (from current buggy code)`);
console.log(`  Difference:                 ${Math.abs(roadVertex.z - renderedZ_avg_current).toFixed(0)}m`);

assert(
  Math.abs(roadVertex.z - renderedZ_avg_current) > 100,
  `MISMATCH CONFIRMED: road and building at same lat/lng render ${Math.abs(roadVertex.z - renderedZ_avg_current).toFixed(0)}m apart in Z`
);

// ═══════════════════════════════════════════════════════
// TEST 3: Fixed code path
//   Shape(x, -z) + ExtrudeGeometry + rotateX(-PI/2)
// ═══════════════════════════════════════════════════════
console.log('\n══ TEST 3: Fixed code (Shape with x, -z) ══');

function buildGeometry_fixed(pts, height) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].z);  // <-- FIX: negate z
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, -pts[i].z);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geom.rotateX(-Math.PI / 2);
  return geom;
}

const geomFixed = buildGeometry_fixed(projectedCorners, BUILDING_HEIGHT);
const posFixed = geomFixed.getAttribute('position');

let minZ_fixed = Infinity, maxZ_fixed = -Infinity;
let minX_fixed = Infinity, maxX_fixed = -Infinity;
let minY_fixed = Infinity, maxY_fixed = -Infinity;

for (let i = 0; i < posFixed.count; i++) {
  const x = posFixed.getX(i);
  const y = posFixed.getY(i);
  const z = posFixed.getZ(i);
  if (x < minX_fixed) minX_fixed = x;
  if (x > maxX_fixed) maxX_fixed = x;
  if (y < minY_fixed) minY_fixed = y;
  if (y > maxY_fixed) maxY_fixed = y;
  if (z < minZ_fixed) minZ_fixed = z;
  if (z > maxZ_fixed) maxZ_fixed = z;
}

console.log(`  Rendered X range: [${minX_fixed.toFixed(2)}, ${maxX_fixed.toFixed(2)}]`);
console.log(`  Rendered Y range: [${minY_fixed.toFixed(2)}, ${maxY_fixed.toFixed(2)}]`);
console.log(`  Rendered Z range: [${minZ_fixed.toFixed(2)}, ${maxZ_fixed.toFixed(2)}]`);
console.log(`  Expected Z range: [${Math.min(...projectedCorners.map(c=>c.z)).toFixed(2)}, ${Math.max(...projectedCorners.map(c=>c.z)).toFixed(2)}]`);

const renderedZ_avg_fixed = (minZ_fixed + maxZ_fixed) / 2;
console.log(`  Rendered Z centroid: ${renderedZ_avg_fixed.toFixed(2)}`);
console.log(`  Expected Z centroid: ${expectedZ_avg.toFixed(2)}`);

assert(
  Math.abs(renderedZ_avg_fixed - expectedZ_avg) < 1.0,
  `FIX WORKS: rendered Z (${renderedZ_avg_fixed.toFixed(2)}) ≈ expected Z (${expectedZ_avg.toFixed(2)})`
);

// Fixed building should match road position
assert(
  Math.abs(renderedZ_avg_fixed - roadVertex.z) < 10,
  `FIX WORKS: building Z (${renderedZ_avg_fixed.toFixed(2)}) now near road Z (${roadVertex.z.toFixed(2)})`
);

// X should still be correct
const renderedX_avg_fixed = (minX_fixed + maxX_fixed) / 2;
assert(
  Math.abs(renderedX_avg_fixed - expectedX_avg) < 1.0,
  `X axis still correct after fix: rendered (${renderedX_avg_fixed.toFixed(2)}) ≈ expected (${expectedX_avg.toFixed(2)})`
);

geomFixed.dispose();

// ═══════════════════════════════════════════════════════
// TEST 4: ShapeGeometry (GroundPlane) has the same bug
// ═══════════════════════════════════════════════════════
console.log('\n══ TEST 4: ShapeGeometry (parks/water) same bug ══');

function buildFlatGeometry_current(pts, yOffset) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].z);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, pts[i].z);
  }
  shape.closePath();

  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, yOffset);
  }
  pos.needsUpdate = true;
  return geom;
}

const parkGeom = buildFlatGeometry_current(projectedCorners, 0.01);
const parkPos = parkGeom.getAttribute('position');

let parkZ_min = Infinity, parkZ_max = -Infinity;
for (let i = 0; i < parkPos.count; i++) {
  const z = parkPos.getZ(i);
  if (z < parkZ_min) parkZ_min = z;
  if (z > parkZ_max) parkZ_max = z;
}
const parkZ_avg = (parkZ_min + parkZ_max) / 2;

assert(
  Math.abs(parkZ_avg - (-expectedZ_avg)) < 1.0,
  `GroundPlane ALSO Z-FLIPPED: park Z (${parkZ_avg.toFixed(2)}) ≈ -expected (${(-expectedZ_avg).toFixed(2)})`
);

parkGeom.dispose();

// ═══════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════');

if (failed === 0) {
  console.log('\nCONCLUSION: Z-flip bug is PROVEN.');
  console.log('  - Current code: buildings render at Z = -world_z (mirrored N-S)');
  console.log('  - Roads render at Z = world_z (correct)');
  console.log('  - Fix (negate Z in Shape): buildings render at Z = world_z (correct)');
  console.log('  - GroundPlane (parks/water) has the same bug');
}

process.exit(failed > 0 ? 1 : 0);
