import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import https from 'https';
import http from 'http';
import {URL, URLSearchParams} from 'url';
import {adminAuth} from '../middleware/adminAuth';

const SKETCHFAB_API = 'https://api.sketchfab.com/v3';

function getApiToken(): string | null {
	return process.env.SKETCHFAB_API_TOKEN || null;
}

function sketchfabGet(urlPath: string, token: string | null): Promise<any> {
	return new Promise((resolve, reject) => {
		const fullUrl = urlPath.startsWith('http') ? urlPath : `${SKETCHFAB_API}${urlPath}`;
		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'User-Agent': 'MetroRider/1.0',
		};
		if (token) {
			headers['Authorization'] = `Token ${token}`;
		}

		const parsedUrl = new URL(fullUrl);
		const requester = parsedUrl.protocol === 'https:' ? https : http;

		const req = requester.get(fullUrl, {headers}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf-8');
				if (res.statusCode && res.statusCode >= 400) {
					reject(new Error(`Sketchfab API ${res.statusCode}: ${body.substring(0, 500)}`));
					return;
				}
				try {
					resolve(JSON.parse(body));
				} catch (e) {
					reject(new Error(`Failed to parse Sketchfab response: ${body.substring(0, 200)}`));
				}
			});
		});

		req.on('error', (err) => reject(err));
		req.setTimeout(15000, () => {
			req.destroy();
			reject(new Error('Sketchfab API request timeout'));
		});
	});
}

function downloadFile(url: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doGet = (targetUrl: string, redirects = 0): void => {
			if (redirects > 5) {
				reject(new Error('Too many redirects'));
				return;
			}
			const parsedUrl = new URL(targetUrl);
			const requester = parsedUrl.protocol === 'https:' ? https : http;

			const req = requester.get(targetUrl, {
				headers: {'User-Agent': 'MetroRider/1.0'},
			}, (res) => {
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					doGet(res.headers.location, redirects + 1);
					res.resume();
					return;
				}
				if (res.statusCode && res.statusCode >= 400) {
					const chunks: Buffer[] = [];
					res.on('data', (c: Buffer) => chunks.push(c));
					res.on('end', () => {
						reject(new Error(`Download failed: HTTP ${res.statusCode}`));
					});
					return;
				}
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => resolve(Buffer.concat(chunks)));
			});

			req.on('error', (err) => reject(err));
			req.setTimeout(60000, () => {
				req.destroy();
				reject(new Error('Download timeout'));
			});
		};
		doGet(url);
	});
}

export function createSketchfabRouter(dataDir: string): Router {
	const router = Router();
	const stationsDir = path.join(dataDir, 'assets', 'models', 'stations');
	const trainsDir = path.join(dataDir, 'assets', 'models', 'trains');
	const tracksDir = path.join(dataDir, 'assets', 'models', 'tracks');

	router.get('/status', (_req: Request, res: Response) => {
		const token = getApiToken();
		res.json({
			configured: !!token,
			tokenPresent: !!token,
			message: token
				? 'Sketchfab API token is configured'
				: 'No SKETCHFAB_API_TOKEN in .env — search works but downloads require a token',
		});
	});

	router.get('/search', async (req: Request, res: Response) => {
		const q = (req.query.q as string) || '';
		const downloadable = req.query.downloadable !== 'false';
		const sortBy = (req.query.sort_by as string) || '-likeCount';
		const maxFaceCount = req.query.max_face_count as string;
		const license = req.query.license as string;
		const categories = req.query.categories as string;
		const cursor = req.query.cursor as string;

		if (!q) {
			res.status(400).json({error: 'Query parameter "q" is required'});
			return;
		}

		const params = new URLSearchParams();
		params.set('type', 'models');
		params.set('q', q);
		if (downloadable) params.set('downloadable', 'true');
		params.set('sort_by', sortBy);
		if (maxFaceCount) params.set('max_face_count', maxFaceCount);
		if (license) params.set('license', license);
		if (categories) params.set('categories', categories);
		params.set('archives_flavours', 'false');
		if (cursor) params.set('cursor', cursor);

		try {
			const data = await sketchfabGet(`/search?${params.toString()}`, getApiToken());

			const results = (data.results || []).map((m: any) => ({
				uid: m.uid,
				name: m.name,
				viewerUrl: m.viewerUrl,
				embedUrl: m.embedUrl,
				isDownloadable: m.isDownloadable,
				license: m.license?.label || m.license,
				user: {
					username: m.user?.username,
					displayName: m.user?.displayName,
					profileUrl: m.user?.profileUrl,
				},
				thumbnails: extractThumbnails(m.thumbnails),
				faceCount: m.faceCount,
				vertexCount: m.vertexCount,
				animationCount: m.animationCount,
				likeCount: m.likeCount,
				viewCount: m.viewCount,
				publishedAt: m.publishedAt,
				archives: m.archives,
			}));

			res.json({
				results,
				cursors: data.cursors || {},
				next: data.next || null,
				previous: data.previous || null,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Sketchfab] Search error: ${msg}`);
			res.status(502).json({error: 'Sketchfab search failed', detail: msg});
		}
	});

	router.get('/model/:uid', async (req: Request, res: Response) => {
		const uid = req.params.uid;
		if (!uid) {
			res.status(400).json({error: 'Model UID required'});
			return;
		}

		try {
			const model = await sketchfabGet(`/models/${uid}`, getApiToken());
			res.json({
				uid: model.uid,
				name: model.name,
				description: model.description,
				viewerUrl: model.viewerUrl,
				embedUrl: model.embedUrl,
				isDownloadable: model.isDownloadable,
				license: model.license,
				user: {
					username: model.user?.username,
					displayName: model.user?.displayName,
					profileUrl: model.user?.profileUrl,
				},
				thumbnails: extractThumbnails(model.thumbnails),
				faceCount: model.faceCount,
				vertexCount: model.vertexCount,
				animationCount: model.animationCount,
				categories: model.categories,
				tags: model.tags,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Sketchfab] Model detail error: ${msg}`);
			res.status(502).json({error: 'Failed to fetch model details', detail: msg});
		}
	});

	router.post('/import/:uid', adminAuth, async (req: Request, res: Response) => {
		const uid = req.params.uid;
		const category = (req.body.category as string) || 'stations';
		const fileName = req.body.fileName as string;

		if (!uid) {
			res.status(400).json({error: 'Model UID required'});
			return;
		}

		const token = getApiToken();
		if (!token) {
			res.status(400).json({error: 'SKETCHFAB_API_TOKEN not configured in .env'});
			return;
		}

		const validCategories: Record<string, string> = {
			stations: stationsDir,
			trains: trainsDir,
			tracks: tracksDir,
		};

		const destDir = validCategories[category];
		if (!destDir) {
			res.status(400).json({error: `Invalid category: ${category}. Must be one of: ${Object.keys(validCategories).join(', ')}`});
			return;
		}

		try {
			console.log(`[Sketchfab] Admin importing model ${uid} to ${category}`);
			const downloadInfo = await sketchfabGet(`/models/${uid}/download`, token);

			const gltfInfo = downloadInfo.gltf;
			if (!gltfInfo?.url) {
				res.status(400).json({error: 'Model has no downloadable glTF archive'});
				return;
			}

			console.log(`[Sketchfab] Downloading archive from ${gltfInfo.url.substring(0, 80)}...`);
			const archiveBuffer = await downloadFile(gltfInfo.url);
			console.log(`[Sketchfab] Downloaded ${archiveBuffer.length} bytes`);

			const modelInfo = await sketchfabGet(`/models/${uid}`, token).catch(() => null);
			const modelName = fileName
				|| (modelInfo?.name || uid)
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
					.substring(0, 60);

			fs.mkdirSync(destDir, {recursive: true});

			const {extractGLBFromArchive} = await import('../utils/archiveExtract');
			const glbBuffer = await extractGLBFromArchive(archiveBuffer);

			if (!glbBuffer) {
				const zipPath = path.join(destDir, `${modelName}.zip`);
				fs.writeFileSync(zipPath, archiveBuffer);
				console.log(`[Sketchfab] No GLB found in archive, saved raw archive: ${zipPath}`);
				res.json({
					ok: true,
					format: 'zip',
					path: `models/${category}/${modelName}.zip`,
					size: archiveBuffer.length,
					note: 'Archive saved as ZIP — manual conversion to GLB may be needed',
				});
				return;
			}

			const glbPath = path.join(destDir, `${modelName}.glb`);
			if (fs.existsSync(glbPath)) {
				res.status(409).json({error: `File already exists: ${modelName}.glb`});
				return;
			}

			fs.writeFileSync(glbPath, glbBuffer);
			console.log(`[Sketchfab] Imported: ${glbPath} (${glbBuffer.length} bytes)`);

			res.json({
				ok: true,
				format: 'glb',
				id: modelName,
				path: `models/${category}/${modelName}.glb`,
				size: glbBuffer.length,
				attribution: modelInfo ? {
					name: modelInfo.name,
					author: modelInfo.user?.displayName || modelInfo.user?.username,
					license: modelInfo.license?.label || modelInfo.license,
					url: modelInfo.viewerUrl,
				} : undefined,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Sketchfab] Import error: ${msg}`);
			res.status(502).json({error: 'Import failed', detail: msg});
		}
	});

	return router;
}

function extractThumbnails(thumbnails: any): {url: string; width: number; height: number}[] {
	if (!thumbnails?.images) return [];
	return thumbnails.images
		.filter((img: any) => img.url)
		.sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
		.map((img: any) => ({
			url: img.url,
			width: img.width || 0,
			height: img.height || 0,
		}));
}
