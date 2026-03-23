import * as THREE from 'three';
import type { OSMData, OSMNode } from './OSMFetcher';
import type { LocalProjection } from './LocalProjection';

const TREE_TRUNK_HEIGHT = 2.5;
const TREE_TRUNK_RADIUS = 0.25;
const TREE_CROWN_RADIUS_MIN = 1.5;
const TREE_CROWN_RADIUS_MAX = 3.0;
const TREE_CROWN_HEIGHT_MIN = 3.0;
const TREE_CROWN_HEIGHT_MAX = 5.0;

const PARK_TREE_DENSITY = 0.003; // trees per square meter
const TREE_ROW_SPACING = 8; // meters between trees in a tree row

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

interface TreeInstance {
  x: number;
  z: number;
  scale: number;
  rotationY: number;
}

function collectTreeInstances(
  data: OSMData,
  projection: LocalProjection,
): TreeInstance[] {
  const instances: TreeInstance[] = [];

  // Individual trees from OSM nodes
  for (const tree of data.trees) {
    const local = projection.projectToLocal(tree.lat, tree.lon);
    instances.push({
      x: local.x,
      z: local.z,
      scale: 0.8 + Math.random() * 0.4,
      rotationY: Math.random() * Math.PI * 2,
    });
  }

  // Trees along tree_row ways
  for (const row of data.treeRows) {
    const points: { x: number; z: number }[] = [];
    for (const nodeId of row.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) continue;
      points.push(projection.projectToLocal(node.lat, node.lon));
    }

    if (points.length < 2) continue;

    // Walk along the polyline placing trees at intervals
    let remaining = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dz = points[i + 1].z - points[i].z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (segLen < 0.1) continue;

      let dist = remaining;
      while (dist < segLen) {
        const t = dist / segLen;
        instances.push({
          x: points[i].x + dx * t,
          z: points[i].z + dz * t,
          scale: 0.8 + Math.random() * 0.4,
          rotationY: Math.random() * Math.PI * 2,
        });
        dist += TREE_ROW_SPACING;
      }
      remaining = dist - segLen;
    }
  }

  // Scattered trees inside parks and grass areas
  for (const park of data.parks) {
    const parkPoints: { x: number; z: number }[] = [];
    for (const nodeId of park.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) continue;
      parkPoints.push(projection.projectToLocal(node.lat, node.lon));
    }

    if (parkPoints.length < 3) continue;

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of parkPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const w = maxX - minX;
    const h = maxZ - minZ;
    const area = w * h;
    const treeCount = Math.floor(area * PARK_TREE_DENSITY);
    const maxAttempts = treeCount * 5;

    let placed = 0;
    for (let attempt = 0; attempt < maxAttempts && placed < treeCount; attempt++) {
      const px = minX + Math.random() * w;
      const pz = minZ + Math.random() * h;

      if (pointInPolygon(px, pz, parkPoints)) {
        instances.push({
          x: px,
          z: pz,
          scale: 0.6 + Math.random() * 0.6,
          rotationY: Math.random() * Math.PI * 2,
        });
        placed++;
      }
    }
  }

  return instances;
}

function pointInPolygon(x: number, z: number, polygon: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function generateVegetation(
  data: OSMData,
  projection: LocalProjection,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const instances = collectTreeInstances(data, projection);
  if (instances.length === 0) {
    console.log('[VegetationGenerator] No trees to generate');
    return group;
  }

  // Procedural tree: trunk (cylinder) + crown (cone)
  const trunkGeom = new THREE.CylinderGeometry(
    TREE_TRUNK_RADIUS * 0.7, TREE_TRUNK_RADIUS, TREE_TRUNK_HEIGHT, 6,
  );
  const crownGeom = new THREE.ConeGeometry(
    (TREE_CROWN_RADIUS_MIN + TREE_CROWN_RADIUS_MAX) / 2,
    (TREE_CROWN_HEIGHT_MIN + TREE_CROWN_HEIGHT_MAX) / 2,
    6,
  );
  // Shift crown geometry up so its base is at y=0
  crownGeom.translate(0, (TREE_CROWN_HEIGHT_MIN + TREE_CROWN_HEIGHT_MAX) / 4, 0);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x8B6914,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x3a7d44,
    roughness: 0.8,
    metalness: 0.0,
    flatShading: true,
  });

  const trunkInstances = new THREE.InstancedMesh(trunkGeom, trunkMat, instances.length);
  const crownInstances = new THREE.InstancedMesh(crownGeom, crownMat, instances.length);

  // Vary crown colors slightly per instance
  const crownColors = new Float32Array(instances.length * 3);
  const trunkColors = new Float32Array(instances.length * 3);
  const color = new THREE.Color();

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const s = inst.scale;

    // Trunk
    _pos.set(inst.x, TREE_TRUNK_HEIGHT * s * 0.5, inst.z);
    _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY);
    _scale.set(s, s, s);
    _mat4.compose(_pos, _quat, _scale);
    trunkInstances.setMatrixAt(i, _mat4);

    // Crown - sits on top of trunk
    _pos.set(inst.x, TREE_TRUNK_HEIGHT * s, inst.z);
    _mat4.compose(_pos, _quat, _scale);
    crownInstances.setMatrixAt(i, _mat4);

    // Subtle color variation for crowns
    const hue = 0.28 + (Math.random() - 0.5) * 0.08;
    const sat = 0.5 + Math.random() * 0.3;
    const lightness = 0.28 + Math.random() * 0.12;
    color.setHSL(hue, sat, lightness);
    crownColors[i * 3] = color.r;
    crownColors[i * 3 + 1] = color.g;
    crownColors[i * 3 + 2] = color.b;

    color.setHSL(0.08, 0.5, 0.2 + Math.random() * 0.1);
    trunkColors[i * 3] = color.r;
    trunkColors[i * 3 + 1] = color.g;
    trunkColors[i * 3 + 2] = color.b;
  }

  trunkInstances.instanceMatrix.needsUpdate = true;
  crownInstances.instanceMatrix.needsUpdate = true;

  // Apply per-instance colors
  trunkInstances.instanceColor = new THREE.InstancedBufferAttribute(trunkColors, 3);
  crownInstances.instanceColor = new THREE.InstancedBufferAttribute(crownColors, 3);

  trunkInstances.castShadow = true;
  crownInstances.castShadow = true;
  crownInstances.receiveShadow = true;

  group.add(trunkInstances);
  group.add(crownInstances);

  console.log(`[VegetationGenerator] Generated ${instances.length} trees`);
  return group;
}
