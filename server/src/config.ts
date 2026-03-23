import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TILE_SIZE_DEG = 0.01;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const DB_PATH = path.resolve(__dirname, '..', 'data', 'osm_cache.db');

export const SERVER_PORT = parseInt(process.env.PORT || '8080', 10);

export const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

export const OVERPASS_MAX_CONCURRENT = 6;
export const OVERPASS_DELAY_MS = 300;
export const OVERPASS_TIMEOUT_MS = 90_000;
export const OVERPASS_MAX_RETRIES = 3;
