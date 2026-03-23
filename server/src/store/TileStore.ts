export interface TileRow {
  tile_x: number;
  tile_y: number;
  data: string;
  fetched_at: number;
  bbox_south: number;
  bbox_west: number;
  bbox_north: number;
  bbox_east: number;
  element_count: number;
}

export interface TileStore {
  getTile(x: number, y: number): TileRow | null;
  setTile(row: TileRow): void;
  hasTile(x: number, y: number): boolean;
  tileCount(): number;
  deleteTile(x: number, y: number): void;
  close(): void;
}
