export const TILE_SIZE_DEG = 0.01;

export const LOAD_RADIUS = 3;
export const UNLOAD_RADIUS = 5;

export const UPDATE_INTERVAL_MS = 500;

export function tileCoord(lat: number, lng: number): { tileX: number; tileY: number } {
  return {
    tileX: Math.floor(lng / TILE_SIZE_DEG),
    tileY: Math.floor(lat / TILE_SIZE_DEG),
  };
}

export function tileBbox(tileX: number, tileY: number) {
  return {
    south: tileY * TILE_SIZE_DEG,
    west: tileX * TILE_SIZE_DEG,
    north: (tileY + 1) * TILE_SIZE_DEG,
    east: (tileX + 1) * TILE_SIZE_DEG,
  };
}

export function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}
