import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OSMData, OSMNode } from './OSMFetcher';
import type { LocalProjection } from './LocalProjection';

const GROUND_Y = -0.05;
const PARK_Y = 0.01;
const WATER_Y = -0.1;

function createPolygonPlane(
  nodeIds: number[],
  nodeMap: Map<number, OSMNode>,
  projection: LocalProjection,
  yOffset: number,
): THREE.BufferGeometry | null {
  const points: { x: number; z: number }[] = [];
  for (const id of nodeIds) {
    const node = nodeMap.get(id);
    if (!node) return null;
    points.push(projection.projectToLocal(node.lat, node.lon));
  }

  if (points.length < 3) return null;

  // Close if not closed
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) > 0.01 || Math.abs(first.z - last.z) > 0.01) {
    points.push({ ...first });
  }

  const shapePoints = points.slice(0, -1);
  if (shapePoints.length < 3) return null;

  // Ensure CCW winding
  const signedArea = shapePoints.reduce((sum, p, i) => {
    const next = shapePoints[(i + 1) % shapePoints.length];
    return sum + (p.x * next.z - next.x * p.z);
  }, 0);
  if (signedArea < 0) shapePoints.reverse();

  const shape = new THREE.Shape();
  shape.moveTo(shapePoints[0].x, -shapePoints[0].z);
  for (let i = 1; i < shapePoints.length; i++) {
    shape.lineTo(shapePoints[i].x, -shapePoints[i].z);
  }
  shape.closePath();

  try {
    const geom = new THREE.ShapeGeometry(shape);
    // ShapeGeometry is in XY plane, rotate to XZ
    geom.rotateX(-Math.PI / 2);
    // Apply Y offset
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, yOffset);
    }
    pos.needsUpdate = true;
    return geom;
  } catch (err) {
    console.error('[GroundPlane] Failed to create polygon plane:', err);
    return null;
  }
}

export function generateGroundPlane(
  data: OSMData,
  projection: LocalProjection,
  extentMeters: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground';

  // Main ground plane
  const groundGeom = new THREE.PlaneGeometry(extentMeters * 2, extentMeters * 2);
  groundGeom.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x8a9a6a,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  group.add(ground);

  // Park/grass overlays
  const parkGeometries: THREE.BufferGeometry[] = [];
  for (const park of data.parks) {
    const geom = createPolygonPlane(park.nodes, data.nodeMap, projection, PARK_Y);
    if (geom) parkGeometries.push(geom);
  }

  if (parkGeometries.length > 0) {
    const merged = mergeGeometries(parkGeometries, false);
    if (merged) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x5a8a3a,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of parkGeometries) g.dispose();
    }
  }

  // Water overlays
  const waterGeometries: THREE.BufferGeometry[] = [];
  for (const water of data.water) {
    const geom = createPolygonPlane(water.nodes, data.nodeMap, projection, WATER_Y);
    if (geom) waterGeometries.push(geom);
  }

  if (waterGeometries.length > 0) {
    const merged = mergeGeometries(waterGeometries, false);
    if (merged) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3a6a9a,
        roughness: 0.2,
        metalness: 0.3,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of waterGeometries) g.dispose();
    }
  }

  const parkCount = parkGeometries.length;
  const waterCount = waterGeometries.length;
  console.log(`[GroundPlane] Generated ground plane with ${parkCount} parks and ${waterCount} water bodies`);
  return group;
}
