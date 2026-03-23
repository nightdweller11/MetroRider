import * as THREE from 'three';
import type { OSMData, OSMWay, OSMNode } from './OSMFetcher';
import type { LocalProjection } from './LocalProjection';

const LABEL_Y = 5;
const MIN_ROAD_LENGTH = 80;
const LABEL_SCALE = 2.5;
const MAX_LABELS = 600;

const IMPORTANT_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
]);

function createTextTexture(text: string): THREE.CanvasTexture {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(512, 64) as unknown as HTMLCanvasElement
    : document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 64);
  ctx.font = 'bold 32px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, 256, 32);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function computeRoadMidpoint(
  way: OSMWay,
  nodeMap: Map<number, OSMNode>,
  projection: LocalProjection,
): { x: number; z: number; angle: number; length: number } | null {
  const points: { x: number; z: number }[] = [];
  for (const nodeId of way.nodes) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    points.push(projection.projectToLocal(node.lat, node.lon));
  }
  if (points.length < 2) return null;

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dz = points[i + 1].z - points[i].z;
    const len = Math.sqrt(dx * dx + dz * dz);
    segLens.push(len);
    totalLen += len;
  }

  if (totalLen < MIN_ROAD_LENGTH) return null;

  const halfLen = totalLen / 2;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (accum + segLens[i] >= halfLen) {
      const t = (halfLen - accum) / segLens[i];
      const mx = points[i].x + t * (points[i + 1].x - points[i].x);
      const mz = points[i].z + t * (points[i + 1].z - points[i].z);
      const dx = points[i + 1].x - points[i].x;
      const dz = points[i + 1].z - points[i].z;
      const angle = Math.atan2(dx, -dz);
      return { x: mx, z: mz, angle, length: totalLen };
    }
    accum += segLens[i];
  }

  return null;
}

export function generateStreetLabels(
  data: OSMData,
  projection: LocalProjection,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street-labels';

  const seenNames = new Set<string>();
  let labelCount = 0;

  const sorted = [...data.highways]
    .filter(w => {
      const hw = w.tags?.highway ?? '';
      return IMPORTANT_HIGHWAYS.has(hw) && w.tags?.name;
    })
    .sort((a, b) => {
      const order = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'];
      const ia = order.indexOf(a.tags?.highway ?? '');
      const ib = order.indexOf(b.tags?.highway ?? '');
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  for (const road of sorted) {
    if (labelCount >= MAX_LABELS) break;

    const name = road.tags?.name;
    if (!name || seenNames.has(name)) continue;

    const mid = computeRoadMidpoint(road, data.nodeMap, projection);
    if (!mid) continue;

    seenNames.add(name);

    const texture = createTextTexture(name);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);

    const textWidth = Math.min(name.length * 3.5, 60);
    sprite.scale.set(textWidth * LABEL_SCALE, 4 * LABEL_SCALE, 1);
    sprite.position.set(mid.x, LABEL_Y, mid.z);
    sprite.renderOrder = 20;

    group.add(sprite);
    labelCount++;
  }

  console.log(`[StreetLabelGenerator] Created ${labelCount} street labels`);
  return group;
}
