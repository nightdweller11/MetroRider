import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../config.js';
import type { TileRow, TileStore } from './TileStore.js';

export class SqliteTileStore implements TileStore {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS osm_tiles (
        tile_x        INTEGER NOT NULL,
        tile_y        INTEGER NOT NULL,
        data          TEXT    NOT NULL,
        fetched_at    INTEGER NOT NULL,
        bbox_south    REAL    NOT NULL,
        bbox_west     REAL    NOT NULL,
        bbox_north    REAL    NOT NULL,
        bbox_east     REAL    NOT NULL,
        element_count INTEGER DEFAULT 0,
        PRIMARY KEY (tile_x, tile_y)
      );
    `);
    console.log('[SqliteTileStore] database ready');
  }

  getTile(x: number, y: number): TileRow | null {
    const row = this.db
      .prepare('SELECT * FROM osm_tiles WHERE tile_x = ? AND tile_y = ?')
      .get(x, y) as TileRow | undefined;
    return row ?? null;
  }

  setTile(row: TileRow): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO osm_tiles
          (tile_x, tile_y, data, fetched_at, bbox_south, bbox_west, bbox_north, bbox_east, element_count)
        VALUES
          (@tile_x, @tile_y, @data, @fetched_at, @bbox_south, @bbox_west, @bbox_north, @bbox_east, @element_count)
      `)
      .run(row);
  }

  hasTile(x: number, y: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM osm_tiles WHERE tile_x = ? AND tile_y = ?')
      .get(x, y);
    return !!row;
  }

  tileCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM osm_tiles')
      .get() as { cnt: number };
    return row.cnt;
  }

  deleteTile(x: number, y: number): void {
    this.db
      .prepare('DELETE FROM osm_tiles WHERE tile_x = ? AND tile_y = ?')
      .run(x, y);
  }

  close(): void {
    this.db.close();
  }
}
