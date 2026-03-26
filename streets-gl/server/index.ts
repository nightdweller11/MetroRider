import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import https from 'https';
import configRouter from './routes/config';
import assetsRouter from './routes/assets';
import {getAdminToken} from './middleware/adminAuth';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const BUILD_DIR = path.join(__dirname, '..', '..', 'build');

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
	res.json({status: 'ok', timestamp: Date.now()});
});

app.use('/api/config', configRouter);
app.use('/api/assets', assetsRouter);

app.get('/api/admin/verify', (req, res) => {
	const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
	if (!token || token !== getAdminToken()) {
		res.status(403).json({valid: false, error: 'Invalid admin token'});
		return;
	}
	res.json({valid: true});
});

app.use('/data/assets', express.static(path.join(__dirname, '..', '..', 'data', 'assets')));

app.get('/api/metrodreamin/view/:systemId', (req, res) => {
	const systemId = req.params.systemId;
	const targetUrl = `https://metrodreamin.com/view/${systemId}`;
	console.log(`[Server] MetroDreamin proxy: fetching ${targetUrl}`);

	const proxyReq = https.get(targetUrl, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.5',
		},
	}, (proxyRes) => {
		if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
			console.log(`[Server] MetroDreamin proxy: following redirect to ${proxyRes.headers.location}`);
			https.get(proxyRes.headers.location, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
					'Accept': 'text/html',
				},
			}, (redirectRes) => {
				const chunks: Buffer[] = [];
				redirectRes.on('data', (chunk: Buffer) => chunks.push(chunk));
				redirectRes.on('end', () => {
					const html = Buffer.concat(chunks).toString('utf-8');
					console.log(`[Server] MetroDreamin proxy: redirect response ${redirectRes.statusCode}, ${html.length} bytes`);
					res.type('text/html').send(html);
				});
			}).on('error', (err) => {
				console.error(`[Server] MetroDreamin proxy redirect error: ${err.message}`);
				res.status(502).json({error: 'MetroDreamin redirect failed', detail: err.message});
			});
			return;
		}

		if (proxyRes.statusCode && proxyRes.statusCode !== 200) {
			console.error(`[Server] MetroDreamin proxy: HTTP ${proxyRes.statusCode}`);
			res.status(proxyRes.statusCode).json({error: `MetroDreamin returned ${proxyRes.statusCode}`});
			return;
		}

		const chunks: Buffer[] = [];
		proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
		proxyRes.on('end', () => {
			const html = Buffer.concat(chunks).toString('utf-8');
			console.log(`[Server] MetroDreamin proxy: success, ${html.length} bytes`);
			res.type('text/html').send(html);
		});
	});

	proxyReq.on('error', (err) => {
		console.error(`[Server] MetroDreamin proxy error: ${err.message}`);
		res.status(502).json({error: 'MetroDreamin proxy failed', detail: err.message});
	});

	proxyReq.setTimeout(20000, () => {
		proxyReq.destroy();
		console.error('[Server] MetroDreamin proxy: timeout');
		res.status(504).json({error: 'MetroDreamin proxy timeout'});
	});
});

app.use(express.static(BUILD_DIR));

app.get('/{*path}', (_req, res) => {
	const indexPath = path.join(BUILD_DIR, 'index.html');
	if (fs.existsSync(indexPath)) {
		res.sendFile(indexPath);
	} else {
		res.status(404).send('Frontend not built yet. Run: npm run build');
	}
});

app.listen(PORT, () => {
	console.log(`[MetroRider Server] Running on http://localhost:${PORT}`);
	console.log(`[MetroRider Server] Admin token: ${getAdminToken()}`);
	console.log(`[MetroRider Server] Admin URL: http://localhost:${PORT}?admin=${getAdminToken()}`);
});
