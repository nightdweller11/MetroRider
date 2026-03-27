import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import https from 'https';
import {createConfigRouter} from './routes/config';
import {createAssetsRouter} from './routes/assets';
import {createSketchfabRouter} from './routes/sketchfab';
import {getAdminToken} from './middleware/adminAuth';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const BUILD_DIR = path.join(__dirname, '..', '..', 'build');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
	res.json({status: 'ok', timestamp: Date.now()});
});

app.use('/api/config', createConfigRouter(DATA_DIR));
app.use('/api/assets', createAssetsRouter(DATA_DIR));
app.use('/api/sketchfab', createSketchfabRouter(DATA_DIR));

app.get('/api/admin/verify', (req, res) => {
	const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
	if (!token || token !== getAdminToken()) {
		res.status(403).json({valid: false, error: 'Invalid admin token'});
		return;
	}
	res.json({valid: true});
});

app.use('/data/assets', express.static(path.join(DATA_DIR, 'assets'), {
	maxAge: '7d',
	immutable: true,
	etag: true,
}));

app.get('/api/metrodreamin/user/:userId', (req, res) => {
	const userId = req.params.userId;
	const pageSize = Math.min(parseInt(req.query.limit as string) || 200, 500);
	console.log(`[Server] MetroDreamin user: fetching maps for ${userId} (limit=${pageSize})`);

	const firestoreUrl = 'https://firestore.googleapis.com/v1/projects/metrodreamin/databases/(default)/documents:runQuery';
	const query = JSON.stringify({
		structuredQuery: {
			from: [{collectionId: 'systems'}],
			where: {
				compositeFilter: {
					op: 'AND',
					filters: [
						{fieldFilter: {field: {fieldPath: 'userId'}, op: 'EQUAL', value: {stringValue: userId}}},
						{fieldFilter: {field: {fieldPath: 'isPrivate'}, op: 'EQUAL', value: {booleanValue: false}}},
					],
				},
			},
			orderBy: [{field: {fieldPath: 'lastUpdated'}, direction: 'DESCENDING'}],
			limit: pageSize,
		},
	});

	const userPageUrl = `https://metrodreamin.com/user/${userId}`;

	const fetchUsername = new Promise<string>((resolve) => {
		https.get(userPageUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html',
			},
		}, (proxyRes) => {
			if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
				resolve('Unknown User');
				proxyRes.resume();
				return;
			}
			const chunks: Buffer[] = [];
			proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
			proxyRes.on('end', () => {
				try {
					const html = Buffer.concat(chunks).toString('utf-8');
					const ndIdx = html.indexOf('__NEXT_DATA__');
					if (ndIdx < 0) { resolve('Unknown User'); return; }
					const startTag = html.indexOf('>', ndIdx) + 1;
					const endTag = html.indexOf('</script>', startTag);
					const data = JSON.parse(html.substring(startTag, endTag));
					resolve(data?.props?.pageProps?.userDocData?.displayName || 'Unknown User');
				} catch {
					resolve('Unknown User');
				}
			});
		}).on('error', () => resolve('Unknown User'));
	});

	const postData = Buffer.from(query, 'utf-8');

	const fsReq = https.request({
		hostname: 'firestore.googleapis.com',
		path: '/v1/projects/metrodreamin/databases/(default)/documents:runQuery',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': postData.length,
		},
	}, (fsRes) => {
		const chunks: Buffer[] = [];
		fsRes.on('data', (chunk: Buffer) => chunks.push(chunk));
		fsRes.on('end', () => {
			try {
				const body = Buffer.concat(chunks).toString('utf-8');
				const results = JSON.parse(body);

				if (!Array.isArray(results)) {
					console.error('[Server] Firestore query returned non-array:', body.substring(0, 200));
					res.status(502).json({error: 'Firestore query failed'});
					return;
				}

				const maps = results
					.filter((r: any) => r.document)
					.map((r: any) => {
						const f = r.document.fields || {};
						return {
							id: f.systemId?.stringValue || '',
							title: f.title?.stringValue || 'Untitled',
							numLines: parseInt(f.numLines?.integerValue || '0', 10),
							numStations: parseInt(f.numStations?.integerValue || '0', 10),
						};
					})
					.filter((m: any) => m.id);

				fetchUsername.then((username) => {
					console.log(`[Server] MetroDreamin user "${username}": returning ${maps.length} maps`);
					res.json({username, maps});
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[Server] Firestore parse error: ${msg}`);
				res.status(502).json({error: 'Failed to parse Firestore response'});
			}
		});
	});

	fsReq.on('error', (err) => {
		console.error(`[Server] Firestore request error: ${err.message}`);
		res.status(502).json({error: 'Firestore request failed', detail: err.message});
	});

	fsReq.setTimeout(20000, () => {
		fsReq.destroy();
		res.status(504).json({error: 'Firestore request timeout'});
	});

	fsReq.write(postData);
	fsReq.end();
});

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

app.use(express.static(BUILD_DIR, {maxAge: '1h'}));

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
	console.log(`[MetroRider Server] DATA_DIR: ${DATA_DIR}`);
	console.log(`[MetroRider Server] Admin token: ${getAdminToken()}`);
	console.log(`[MetroRider Server] Admin URL: http://localhost:${PORT}?admin=${getAdminToken()}`);
});
