import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { SERVER_PORT } from './config.js';
import { SqliteTileStore } from './store/SqliteTileStore.js';
import { OverpassFetcher } from './services/OverpassFetcher.js';
import { createTileRoutes } from './routes/tiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message);
});

const app = express();
app.use(compression({
  level: 6,
  threshold: 1024,
}));
app.use(cors());
app.use(express.json());

const store = new SqliteTileStore();
const fetcher = new OverpassFetcher();

// API routes
app.use('/api/tiles', createTileRoutes(store, fetcher));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', tiles: store.tileCount() });
});

// Proxy MetroDreamin API requests
app.use('/api/metrodreamin', async (req, res) => {
  const targetPath = req.url === '/' ? '' : req.url;
  const targetUrl = `https://metrodreamin.com${targetPath}`;
  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.text();
    res.status(response.status).type('application/json').send(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Server] MetroDreamin proxy error: ${msg}`);
    res.status(502).json({ error: 'MetroDreamin proxy failed', detail: msg });
  }
});

// Serve built frontend (production)
const clientDist = path.resolve(__dirname, '..', '..', 'app', 'dist');
app.use(express.static(clientDist));
app.use((_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(SERVER_PORT, () => {
  console.log(`[MetroRider Server] listening on http://localhost:${SERVER_PORT}`);
  console.log(`[MetroRider Server] serving UI from ${clientDist}`);
  console.log(`[MetroRider Server] tile cache: ${store.tileCount()} tiles stored`);
});
