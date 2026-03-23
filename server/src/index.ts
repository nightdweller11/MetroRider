import express from 'express';
import cors from 'cors';
import { SERVER_PORT } from './config.js';
import { SqliteTileStore } from './store/SqliteTileStore.js';
import { OverpassFetcher } from './services/OverpassFetcher.js';
import { createTileRoutes } from './routes/tiles.js';

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message);
});

const app = express();
app.use(cors());
app.use(express.json());

const store = new SqliteTileStore();
const fetcher = new OverpassFetcher();

app.use('/api/tiles', createTileRoutes(store, fetcher));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tiles: store.tileCount() });
});

app.listen(SERVER_PORT, () => {
  console.log(`[MetroRider Server] listening on http://localhost:${SERVER_PORT}`);
  console.log(`[MetroRider Server] tile cache: ${store.tileCount()} tiles stored`);
});
