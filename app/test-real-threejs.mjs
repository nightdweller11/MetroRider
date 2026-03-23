/**
 * Real Three.js test — verifies ExtrudeGeometry structure, UV neutralization
 * using vertex normals (the actual approach), and merged geometry correctness.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// ══════════════════════════════════════════════════════
// TEST 1: ExtrudeGeometry basic structure
// ══════════════════════════════════════════════════════
console.log('\n══ TEST 1: ExtrudeGeometry structure ══');

const shape1 = new THREE.Shape();
shape1.moveTo(0, 0);
shape1.lineTo(10, 0);
shape1.lineTo(10, 10);
shape1.lineTo(0, 10);
shape1.closePath();

const geom1 = new THREE.ExtrudeGeometry(shape1, { depth: 15, bevelEnabled: false });
const hasIndex = geom1.getIndex() !== null;
console.log(`  Has index buffer: ${hasIndex}`);
console.log(`  Groups: ${JSON.stringify(geom1.groups)}`);
console.log(`  Vertex count: ${geom1.getAttribute('position').count}`);
console.log(`  Has UVs: ${geom1.getAttribute('uv') !== null}`);
console.log(`  Has normals: ${geom1.getAttribute('normal') !== null}`);

assert(geom1.getAttribute('uv') !== null, 'Has UV attribute');
assert(geom1.getAttribute('normal') !== null, 'Has normal attribute');

// After rotation, check normals
geom1.rotateX(-Math.PI / 2);
geom1.computeVertexNormals();

const normals1 = geom1.getAttribute('normal');
let roofVerts = 0, bottomVerts = 0, sideVerts = 0;
for (let i = 0; i < normals1.count; i++) {
  const ny = normals1.getY(i);
  if (ny > 0.5) roofVerts++;
  else if (ny < -0.5) bottomVerts++;
  else sideVerts++;
}
console.log(`  After rotation: roof=${roofVerts}, bottom=${bottomVerts}, side=${sideVerts}`);

assert(roofVerts > 0, `Has roof vertices (${roofVerts})`);
assert(sideVerts > 0, `Has side vertices (${sideVerts})`);

// ══════════════════════════════════════════════════════
// TEST 2: Normal-based UV neutralization
// ══════════════════════════════════════════════════════
console.log('\n══ TEST 2: Normal-based UV neutralization ══');

function neutralizeCapUVs(geom) {
  const uvAttr = geom.getAttribute('uv');
  const normalAttr = geom.getAttribute('normal');
  if (!uvAttr || !normalAttr) return;
  for (let i = 0; i < normalAttr.count; i++) {
    const ny = normalAttr.getY(i);
    if (Math.abs(ny) > 0.5) {
      uvAttr.setXY(i, 0.001, 0.001);
    }
  }
  uvAttr.needsUpdate = true;
}

const shape2 = new THREE.Shape();
shape2.moveTo(0, 0);
shape2.lineTo(20, 0);
shape2.lineTo(20, 15);
shape2.lineTo(0, 15);
shape2.closePath();

const geom2 = new THREE.ExtrudeGeometry(shape2, { depth: 12, bevelEnabled: false });
geom2.rotateX(-Math.PI / 2);
geom2.computeVertexNormals();

// Record UVs before
const uvBefore = geom2.getAttribute('uv');
const normalsBefore = geom2.getAttribute('normal');
const origCapUVs = [];
const origSideUVs = [];
for (let i = 0; i < normalsBefore.count; i++) {
  const ny = normalsBefore.getY(i);
  const uv = { u: uvBefore.getX(i), v: uvBefore.getY(i) };
  if (Math.abs(ny) > 0.5) origCapUVs.push({ i, ...uv });
  else origSideUVs.push({ i, ...uv });
}

console.log(`  Cap vertices: ${origCapUVs.length}`);
console.log(`  Side vertices: ${origSideUVs.length}`);
console.log(`  Sample cap UVs before: ${origCapUVs.slice(0, 4).map(c => `(${c.u.toFixed(2)},${c.v.toFixed(2)})`).join(' ')}`);
console.log(`  Sample side UVs before: ${origSideUVs.slice(0, 4).map(c => `(${c.u.toFixed(2)},${c.v.toFixed(2)})`).join(' ')}`);

// Apply neutralization
neutralizeCapUVs(geom2);

// Verify cap UVs are neutralized
const uvAfter = geom2.getAttribute('uv');
let capsOK = 0, capsFailed = 0;
for (const c of origCapUVs) {
  const u = uvAfter.getX(c.i);
  const v = uvAfter.getY(c.i);
  if (Math.abs(u - 0.001) < 0.0001 && Math.abs(v - 0.001) < 0.0001) capsOK++;
  else capsFailed++;
}
console.log(`  Cap UVs neutralized: ${capsOK}/${origCapUVs.length} (${capsFailed} failed)`);
assert(capsFailed === 0, 'All cap UVs set to (0.001, 0.001)');

// Verify side UVs unchanged
let sidesOK = 0, sidesBroken = 0;
for (const s of origSideUVs) {
  const u = uvAfter.getX(s.i);
  const v = uvAfter.getY(s.i);
  if (Math.abs(u - 0.001) < 0.01 && Math.abs(v - 0.001) < 0.01) sidesBroken++;
  else sidesOK++;
}
console.log(`  Side UVs preserved: ${sidesOK}/${origSideUVs.length} (${sidesBroken} incorrectly neutralized)`);
assert(sidesBroken === 0, 'No side UVs were neutralized');

// ══════════════════════════════════════════════════════
// TEST 3: UV survives mergeGeometries
// ══════════════════════════════════════════════════════
console.log('\n══ TEST 3: UV preservation through mergeGeometries ══');

const buildings = [];
for (let i = 0; i < 5; i++) {
  const s = new THREE.Shape();
  const ox = i * 40;
  s.moveTo(ox, 0);
  s.lineTo(ox + 15, 0);
  s.lineTo(ox + 15, 12);
  s.lineTo(ox, 12);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 5 + i * 3, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  neutralizeCapUVs(g);
  buildings.push(g);
}

const merged = mergeGeometries(buildings, false);
assert(merged !== null, 'Merge succeeded');

const mergedUV = merged.getAttribute('uv');
const mergedNorm = merged.getAttribute('normal');

let mRoof = 0, mRoofNeutralized = 0;
let mSide = 0, mSideNeutralized = 0;
let mBottom = 0, mBottomNeutralized = 0;

for (let i = 0; i < mergedNorm.count; i++) {
  const ny = mergedNorm.getY(i);
  const u = mergedUV.getX(i);
  const v = mergedUV.getY(i);
  const isNeutral = Math.abs(u - 0.001) < 0.01 && Math.abs(v - 0.001) < 0.01;

  if (ny > 0.5) {
    mRoof++;
    if (isNeutral) mRoofNeutralized++;
  } else if (ny < -0.5) {
    mBottom++;
    if (isNeutral) mBottomNeutralized++;
  } else {
    mSide++;
    if (isNeutral) mSideNeutralized++;
  }
}

console.log(`  Merged total vertices: ${mergedNorm.count}`);
console.log(`  Roof: ${mRoof} vertices, ${mRoofNeutralized} neutralized (want ALL)`);
console.log(`  Bottom: ${mBottom} vertices, ${mBottomNeutralized} neutralized (want ALL)`);
console.log(`  Sides: ${mSide} vertices, ${mSideNeutralized} neutralized (want NONE)`);

assert(mRoof > 0 && mRoofNeutralized === mRoof, `All roof UVs neutralized (${mRoofNeutralized}/${mRoof})`);
assert(mBottom > 0 && mBottomNeutralized === mBottom, `All bottom UVs neutralized (${mBottomNeutralized}/${mBottom})`);
assert(mSideNeutralized === 0, `No side UVs were neutralized (${mSideNeutralized}/${mSide})`);

// ══════════════════════════════════════════════════════
// TEST 4: Side UVs produce visible window pattern
// ══════════════════════════════════════════════════════
console.log('\n══ TEST 4: Side UV range check ══');

let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
for (let i = 0; i < mergedNorm.count; i++) {
  const ny = mergedNorm.getY(i);
  if (Math.abs(ny) < 0.5) {
    const u = mergedUV.getX(i);
    const v = mergedUV.getY(i);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
}
console.log(`  Side UV range: U=[${minU.toFixed(3)}, ${maxU.toFixed(3)}], V=[${minV.toFixed(3)}, ${maxV.toFixed(3)}]`);
assert(maxU - minU > 1, `Side UVs span enough for tiling (U range=${(maxU-minU).toFixed(1)})`);
assert(maxV - minV > 0.5, `Side UVs span enough vertically (V range=${(maxV-minV).toFixed(1)})`);

// ══════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
