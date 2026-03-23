import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OSMData, OSMWay, OSMNode } from './OSMFetcher';
import type { LocalProjection } from './LocalProjection';

export const ROAD_WIDTHS: Record<string, number> = {
  motorway: 14,
  motorway_link: 8,
  trunk: 12,
  trunk_link: 7,
  primary: 10,
  primary_link: 6,
  secondary: 8,
  secondary_link: 5,
  tertiary: 7,
  tertiary_link: 5,
  residential: 6,
  living_street: 5,
  service: 4,
  unclassified: 5,
  footway: 2,
  path: 1.5,
  cycleway: 2,
  pedestrian: 4,
  steps: 2,
  track: 3,
};

const ROAD_COLORS: Record<string, number> = {
  motorway: 0x666680,
  trunk: 0x666680,
  primary: 0x606060,
  secondary: 0x606060,
  tertiary: 0x585858,
  residential: 0x505050,
  service: 0x484848,
  footway: 0x9c8c7c,
  path: 0x8c7c6c,
  cycleway: 0x6c8c6c,
  pedestrian: 0x9c9080,
  steps: 0x8c8070,
};

const ROAD_Y_OFFSET = 0.05;

function getRoadWidth(highway: string): number {
  return ROAD_WIDTHS[highway] ?? 5;
}

function getRoadColor(highway: string): number {
  return ROAD_COLORS[highway] ?? 0x555555;
}

function createRoadRibbon(
  way: OSMWay,
  nodeMap: Map<number, OSMNode>,
  projection: LocalProjection,
): THREE.BufferGeometry | null {
  const highway = way.tags?.['highway'] ?? '';
  const halfWidth = getRoadWidth(highway) / 2;

  const points: { x: number; z: number }[] = [];
  for (const nodeId of way.nodes) {
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    const local = projection.projectToLocal(node.lat, node.lon);
    points.push(local);
  }

  if (points.length < 2) return null;

  // Filter out near-duplicate consecutive points
  const filtered = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - filtered[filtered.length - 1].x;
    const dz = points[i].z - filtered[filtered.length - 1].z;
    if (dx * dx + dz * dz > 0.01) {
      filtered.push(points[i]);
    }
  }
  if (filtered.length < 2) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < filtered.length; i++) {
    let dx: number, dz: number;
    if (i === 0) {
      dx = filtered[1].x - filtered[0].x;
      dz = filtered[1].z - filtered[0].z;
    } else if (i === filtered.length - 1) {
      dx = filtered[i].x - filtered[i - 1].x;
      dz = filtered[i].z - filtered[i - 1].z;
    } else {
      dx = filtered[i + 1].x - filtered[i - 1].x;
      dz = filtered[i + 1].z - filtered[i - 1].z;
    }

    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) continue;

    // Perpendicular vector (rotated 90 degrees)
    const nx = -dz / len * halfWidth;
    const nz = dx / len * halfWidth;

    // Left vertex
    vertices.push(filtered[i].x + nx, ROAD_Y_OFFSET, filtered[i].z + nz);
    // Right vertex
    vertices.push(filtered[i].x - nx, ROAD_Y_OFFSET, filtered[i].z - nz);
  }

  const numPairs = vertices.length / 6; // 2 vertices per point, 3 components each
  for (let i = 0; i < numPairs - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function generateRoads(
  data: OSMData,
  projection: LocalProjection,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roads';

  const colorBuckets = new Map<number, THREE.BufferGeometry[]>();

  let builtCount = 0;
  let skippedCount = 0;

  for (const road of data.highways) {
    const geom = createRoadRibbon(road, data.nodeMap, projection);
    if (!geom) {
      skippedCount++;
      continue;
    }

    const highway = road.tags?.['highway'] ?? '';
    const color = getRoadColor(highway);

    if (!colorBuckets.has(color)) {
      colorBuckets.set(color, []);
    }
    colorBuckets.get(color)!.push(geom);
    builtCount++;
  }

  for (const [color, geometries] of colorBuckets) {
    if (geometries.length === 0) continue;

    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      console.error(`[RoadGenerator] Failed to merge ${geometries.length} road geometries`);
      continue;
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.receiveShadow = true;
    group.add(mesh);

    for (const g of geometries) g.dispose();
  }

  console.log(`[RoadGenerator] Built ${builtCount} roads (${skippedCount} skipped), ${colorBuckets.size} color groups`);
  return group;
}
