import { Router, type Request, type Response } from 'express';
import { TILE_SIZE_DEG, CACHE_TTL_MS } from '../config.js';
import type { TileStore } from '../store/TileStore.js';
import type { OverpassFetcher } from '../services/OverpassFetcher.js';

function tileBbox(tileX: number, tileY: number) {
  return {
    south: tileY * TILE_SIZE_DEG,
    west: tileX * TILE_SIZE_DEG,
    north: (tileY + 1) * TILE_SIZE_DEG,
    east: (tileX + 1) * TILE_SIZE_DEG,
  };
}

async function fetchAndCacheTile(
  store: TileStore,
  fetcher: OverpassFetcher,
  tileX: number,
  tileY: number,
): Promise<{ elements: unknown[]; cachedAt: number }> {
  const bbox = tileBbox(tileX, tileY);

  const result = await fetcher.fetch(bbox.south, bbox.west, bbox.north, bbox.east);

  const now = Date.now();
  store.setTile({
    tile_x: tileX,
    tile_y: tileY,
    data: result.raw,
    fetched_at: now,
    bbox_south: bbox.south,
    bbox_west: bbox.west,
    bbox_north: bbox.north,
    bbox_east: bbox.east,
    element_count: result.elements.length,
  });

  return { elements: result.elements, cachedAt: now };
}

export function createTileRoutes(store: TileStore, fetcher: OverpassFetcher): Router {
  const router = Router();

  router.get('/batch', async (req: Request, res: Response) => {
    const tilesParam = req.query.tiles as string | undefined;
    if (!tilesParam) {
      res.status(400).json({ error: 'Missing ?tiles= parameter. Format: x1,y1;x2,y2;...' });
      return;
    }

    const pairs = tilesParam.split(';').map(p => {
      const [x, y] = p.split(',').map(Number);
      return { x, y };
    });

    if (pairs.some(p => isNaN(p.x) || isNaN(p.y))) {
      res.status(400).json({ error: 'Invalid tile coordinates' });
      return;
    }

    const results: unknown[] = [];

    for (const { x, y } of pairs) {
      try {
        const bbox = tileBbox(x, y);
        const cached = store.getTile(x, y);

        if (cached && (Date.now() - cached.fetched_at) < CACHE_TTL_MS) {
          const parsed = JSON.parse(cached.data);
          results.push({
            tileX: x,
            tileY: y,
            bbox,
            data: parsed.elements ?? parsed,
            cachedAt: cached.fetched_at,
          });
        } else {
          const fetched = await fetchAndCacheTile(store, fetcher, x, y);
          results.push({
            tileX: x,
            tileY: y,
            bbox,
            data: fetched.elements,
            cachedAt: fetched.cachedAt,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[tiles] Failed to get tile ${x},${y}: ${msg}`);
        results.push({ tileX: x, tileY: y, error: msg });
      }
    }

    res.json(results);
  });

  router.get('/:tileX/:tileY', async (req: Request, res: Response) => {
    const tileX = parseInt(req.params.tileX as string, 10);
    const tileY = parseInt(req.params.tileY as string, 10);

    if (isNaN(tileX) || isNaN(tileY)) {
      res.status(400).json({ error: 'Invalid tile coordinates' });
      return;
    }

    const bbox = tileBbox(tileX, tileY);

    const cached = store.getTile(tileX, tileY);
    if (cached && (Date.now() - cached.fetched_at) < CACHE_TTL_MS) {
      const parsed = JSON.parse(cached.data);
      res.json({
        tileX,
        tileY,
        bbox,
        data: parsed.elements ?? parsed,
        cachedAt: cached.fetched_at,
        fromCache: true,
      });
      return;
    }

    try {
      const fetched = await fetchAndCacheTile(store, fetcher, tileX, tileY);
      res.json({
        tileX,
        tileY,
        bbox,
        data: fetched.elements,
        cachedAt: fetched.cachedAt,
        fromCache: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tiles] Failed to fetch tile ${tileX},${tileY}: ${msg}`);
      res.status(502).json({ error: `Failed to fetch tile: ${msg}` });
    }
  });

  return router;
}
