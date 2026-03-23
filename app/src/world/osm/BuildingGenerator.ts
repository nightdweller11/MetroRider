import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OSMData, OSMWay, OSMNode } from './OSMFetcher';
import type { LocalProjection } from './LocalProjection';
import { isPointInCorridor, CORRIDOR_RADIUS, pointToSegmentDistance } from './TrackRouter';

type CorridorSegment = { x1: number; z1: number; x2: number; z2: number };

const DEFAULT_BUILDING_COLORS = [
  0xd4c9b8, 0xc8bfb0, 0xb8ada0, 0xe0d5c5,
  0xc0b8a8, 0xd0c8b8, 0xbcb4a4, 0xe8ddd0,
  0xccc4b4, 0xd8d0c0,
];

const TEX_W = 128;
const TEX_H = 256;
const WINDOW_COLS = 4;
const WINDOW_ROWS = 8;
const LIT_RATIO = 0.35;

const WALL_COLORS = ['#b0a898', '#a89888', '#b8a8a0', '#c0b0a0', '#a8a098'];
const LIT_TINTS = ['#f5d78a', '#f0e0a0', '#ffe8b0', '#f5c870', '#e8d890'];

function createWindowTexture(): THREE.CanvasTexture {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(TEX_W, TEX_H) as unknown as HTMLCanvasElement
    : document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  const wallColor = WALL_COLORS[Math.floor(Math.random() * WALL_COLORS.length)];
  const litTint = LIT_TINTS[Math.floor(Math.random() * LIT_TINTS.length)];
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const cellW = TEX_W / WINDOW_COLS;
  const cellH = TEX_H / WINDOW_ROWS;
  const winW = cellW * 0.55;
  const winH = cellH * 0.5;
  const padX = (cellW - winW) / 2;
  const padY = (cellH - winH) * 0.45;

  for (let row = 0; row < WINDOW_ROWS; row++) {
    for (let col = 0; col < WINDOW_COLS; col++) {
      const x = col * cellW + padX;
      const y = row * cellH + padY;
      const lit = Math.random() < LIT_RATIO;
      ctx.fillStyle = lit ? litTint : '#3a4555';
      ctx.fillRect(x, y, winW, winH);

      if (lit) {
        ctx.fillStyle = 'rgba(255,230,160,0.3)';
        ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FLOOR_HEIGHT = 3.0;
const DEFAULT_MIN_FLOORS = 1;
const DEFAULT_MAX_FLOORS = 7;

function getBuildingHeight(tags: Record<string, string> | undefined): number {
  if (!tags) return (DEFAULT_MIN_FLOORS + Math.random() * (DEFAULT_MAX_FLOORS - DEFAULT_MIN_FLOORS)) * FLOOR_HEIGHT;

  if (tags['height']) {
    const h = parseFloat(tags['height']);
    if (!isNaN(h) && h > 0) return h;
  }

  if (tags['building:levels']) {
    const levels = parseInt(tags['building:levels'], 10);
    if (!isNaN(levels) && levels > 0) return levels * FLOOR_HEIGHT;
  }

  return (DEFAULT_MIN_FLOORS + Math.random() * (DEFAULT_MAX_FLOORS - DEFAULT_MIN_FLOORS)) * FLOOR_HEIGHT;
}

const NAMED_COLORS: Record<string, number> = {
  white: 0xffffff, beige: 0xf5f5dc, cream: 0xfffdd0, ivory: 0xfffff0,
  gray: 0x808080, grey: 0x808080, brown: 0x8b4513, tan: 0xd2b48c,
  red: 0xcc3333, blue: 0x3333cc, green: 0x339933, yellow: 0xcccc33,
  orange: 0xcc6633, black: 0x222222, silver: 0xc0c0c0, bronze: 0xcd7f32,
  pink: 0xffc0cb, purple: 0x800080, maroon: 0x800000,
};

function getBuildingColor(tags: Record<string, string> | undefined): number {
  if (tags?.['building:colour']) {
    const c = tags['building:colour'].toLowerCase().trim();

    if (NAMED_COLORS[c] !== undefined) return NAMED_COLORS[c];

    if (/^#[0-9a-f]{3,6}$/i.test(c)) {
      try { return new THREE.Color(c).getHex(); } catch { /* fall through */ }
    }

    if (/^rgb/i.test(c)) {
      try { return new THREE.Color(c).getHex(); } catch { /* fall through */ }
    }
  }
  return DEFAULT_BUILDING_COLORS[Math.floor(Math.random() * DEFAULT_BUILDING_COLORS.length)];
}

/**
 * After rotation, neutralize UVs for roof/bottom faces using vertex normals.
 * Vertices with |normal.y| > 0.5 are cap faces (roof or bottom) — set their
 * UVs to the wall-color corner so they show solid color, not windows.
 */
function neutralizeCapUVs(geom: THREE.BufferGeometry): void {
  const uvAttr = geom.getAttribute('uv') as THREE.BufferAttribute | null;
  const normalAttr = geom.getAttribute('normal') as THREE.BufferAttribute | null;
  if (!uvAttr || !normalAttr) return;

  for (let i = 0; i < normalAttr.count; i++) {
    const ny = normalAttr.getY(i);
    if (Math.abs(ny) > 0.5) {
      uvAttr.setXY(i, 0.001, 0.001);
    }
  }
  uvAttr.needsUpdate = true;
}

function createBuildingGeometry(
  way: OSMWay,
  nodeMap: Map<number, OSMNode>,
  projection: LocalProjection,
): THREE.BufferGeometry | null {
  const projected: { x: number; z: number }[] = [];
  for (const nodeId of way.nodes) {
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    projected.push(projection.projectToLocal(node.lat, node.lon));
  }

  if (projected.length < 4) return null;

  const first = projected[0];
  const last = projected[projected.length - 1];
  if (Math.abs(first.x - last.x) > 0.01 || Math.abs(first.z - last.z) > 0.01) {
    projected.push({ ...first });
  }

  const shapePoints = projected.slice(0, -1);
  if (shapePoints.length < 3) return null;

  let area = 0;
  for (let i = 0; i < shapePoints.length; i++) {
    const j = (i + 1) % shapePoints.length;
    area += shapePoints[i].x * shapePoints[j].z;
    area -= shapePoints[j].x * shapePoints[i].z;
  }
  area = Math.abs(area) / 2;
  if (area < 1) return null;

  const signedArea = shapePoints.reduce((sum, p, i) => {
    const next = shapePoints[(i + 1) % shapePoints.length];
    return sum + (p.x * next.z - next.x * p.z);
  }, 0);
  if (signedArea < 0) shapePoints.reverse();

  const height = getBuildingHeight(way.tags);

  const shape = new THREE.Shape();
  shape.moveTo(shapePoints[0].x, -shapePoints[0].z);
  for (let i = 1; i < shapePoints.length; i++) {
    shape.lineTo(shapePoints[i].x, -shapePoints[i].z);
  }
  shape.closePath();

  try {
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    });

    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    neutralizeCapUVs(geom);

    return geom;
  } catch (err) {
    console.error(`[BuildingGenerator] Failed to extrude building ${way.id}:`, err);
    return null;
  }
}

export interface BuildingClearingStats {
  trackClearedCount: number;
  builtCount: number;
  trackCorridorSegments: number;
  corridorRadius: number;
  phase3Executed: boolean;
  nearMissCount: number;
}

export function generateBuildings(
  data: OSMData,
  projection: LocalProjection,
  corridorSegments: CorridorSegment[] = [],
): { group: THREE.Group; stats: BuildingClearingStats } {
  const group = new THREE.Group();
  group.name = 'buildings';

  const colorBuckets = new Map<number, THREE.BufferGeometry[]>();

  let builtCount = 0;
  let skippedCount = 0;
  let trackClearedCount = 0;
  let nearMissCount = 0;
  let diagLogged = 0;

  console.log(`[BuildingGenerator] Starting: ${data.buildings.length} buildings, ${corridorSegments.length} track corridor segments, radius=${CORRIDOR_RADIUS}m`);

  if (corridorSegments.length > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const seg of corridorSegments) {
      if (seg.x1 < minX) minX = seg.x1;
      if (seg.x2 < minX) minX = seg.x2;
      if (seg.x1 > maxX) maxX = seg.x1;
      if (seg.x2 > maxX) maxX = seg.x2;
      if (seg.z1 < minZ) minZ = seg.z1;
      if (seg.z2 < minZ) minZ = seg.z2;
      if (seg.z1 > maxZ) maxZ = seg.z1;
      if (seg.z2 > maxZ) maxZ = seg.z2;
    }
    console.log(`[BuildingGenerator] Corridor bounds: X[${minX.toFixed(0)}..${maxX.toFixed(0)}] Z[${minZ.toFixed(0)}..${maxZ.toFixed(0)}]`);
  }

  for (const building of data.buildings) {
    const projectedVertices: { x: number; z: number }[] = [];
    for (const nodeId of building.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) continue;
      projectedVertices.push(projection.projectToLocal(node.lat, node.lon));
    }

    if (projectedVertices.length === 0) {
      skippedCount++;
      continue;
    }

    const centroid = {
      x: projectedVertices.reduce((s, p) => s + p.x, 0) / projectedVertices.length,
      z: projectedVertices.reduce((s, p) => s + p.z, 0) / projectedVertices.length,
    };

    if (corridorSegments.length > 0) {
      let overlaps = false;
      let minDist = Infinity;

      for (const v of projectedVertices) {
        if (isPointInCorridor(v.x, v.z, corridorSegments)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps && isPointInCorridor(centroid.x, centroid.z, corridorSegments)) {
        overlaps = true;
      }

      if (!overlaps) {
        for (const seg of corridorSegments) {
          const d = pointToSegmentDistance(centroid.x, centroid.z, seg.x1, seg.z1, seg.x2, seg.z2);
          if (d < minDist) minDist = d;
        }
        if (minDist < CORRIDOR_RADIUS * 2) {
          nearMissCount++;
          if (diagLogged < 10) {
            const latLng = projection.localToLatLng(centroid.x, centroid.z);
            console.log(`[BuildingGenerator] NEAR-MISS building ${building.id}: centroid=(${centroid.x.toFixed(1)}, ${centroid.z.toFixed(1)}) lat/lng=(${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}) minDist=${minDist.toFixed(1)}m (radius=${CORRIDOR_RADIUS}m)`);
            diagLogged++;
          }
        }
      }

      if (overlaps) {
        trackClearedCount++;
        if (trackClearedCount <= 5) {
          const latLng = projection.localToLatLng(centroid.x, centroid.z);
          console.log(`[BuildingGenerator] CLEARED building ${building.id}: centroid=(${centroid.x.toFixed(1)}, ${centroid.z.toFixed(1)}) lat/lng=(${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)})`);
        }
        continue;
      }
    }

    const geom = createBuildingGeometry(building, data.nodeMap, projection);
    if (!geom) {
      skippedCount++;
      continue;
    }

    const color = getBuildingColor(building.tags);
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
      console.error(`[BuildingGenerator] Failed to merge ${geometries.length} geometries for color ${color.toString(16)}`);
      continue;
    }

    merged.computeVertexNormals();

    const windowTex = createWindowTexture();
    windowTex.repeat.set(0.08, 0.12);

    const material = new THREE.MeshStandardMaterial({
      color,
      map: windowTex,
      roughness: 0.8,
      metalness: 0.05,
      emissive: 0xffe8a0,
      emissiveIntensity: 0.06,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    for (const g of geometries) g.dispose();
  }

  console.log(`[BuildingGenerator] Result: ${builtCount} built, ${skippedCount} skipped, ${trackClearedCount} track-cleared, ${nearMissCount} near-misses (within ${CORRIDOR_RADIUS * 2}m), ${colorBuckets.size} color groups`);

  const stats: BuildingClearingStats = {
    trackClearedCount,
    builtCount,
    trackCorridorSegments: corridorSegments.length,
    corridorRadius: CORRIDOR_RADIUS,
    phase3Executed: false,
    nearMissCount,
  };
  return { group, stats };
}
