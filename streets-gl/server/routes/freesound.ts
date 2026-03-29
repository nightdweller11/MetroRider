import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import https from 'https';
import http from 'http';
import {URL, URLSearchParams} from 'url';
import {adminAuth} from '../middleware/adminAuth';

const FREESOUND_API = 'https://freesound.org/apiv2';

const SOUND_FIELDS = [
	'id', 'name', 'tags', 'username', 'license',
	'previews', 'images', 'duration', 'avg_rating',
	'num_downloads', 'num_ratings', 'type', 'channels',
	'samplerate', 'filesize', 'description', 'url',
].join(',');

type SoundCategory = 'horn' | 'engine' | 'rail' | 'wind' | 'brake' | 'doorChime' | 'stationChime';

const CATEGORY_FOLDERS: Record<SoundCategory, string> = {
	horn: 'horns',
	engine: 'engine',
	rail: 'rail',
	wind: 'wind',
	brake: 'brake',
	doorChime: 'doorChime',
	stationChime: 'stationChime',
};

function getApiKey(): string | null {
	return process.env.FREESOUND_API_KEY || null;
}

function freesoundGet(urlPath: string, apiKey: string | null): Promise<any> {
	return new Promise((resolve, reject) => {
		const fullUrl = urlPath.startsWith('http') ? urlPath : `${FREESOUND_API}${urlPath}`;
		const parsedUrl = new URL(fullUrl);

		if (apiKey && !parsedUrl.searchParams.has('token')) {
			parsedUrl.searchParams.set('token', apiKey);
		}

		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'User-Agent': 'MetroRider/1.0',
		};

		const requester = parsedUrl.protocol === 'https:' ? https : http;

		const req = requester.get(parsedUrl.toString(), {headers}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf-8');
				if (res.statusCode && res.statusCode >= 400) {
					reject(new Error(`Freesound API ${res.statusCode}: ${body.substring(0, 500)}`));
					return;
				}
				try {
					resolve(JSON.parse(body));
				} catch (e) {
					reject(new Error(`Failed to parse Freesound response: ${body.substring(0, 200)}`));
				}
			});
		});

		req.on('error', (err) => reject(err));
		req.setTimeout(15000, () => {
			req.destroy();
			reject(new Error('Freesound API request timeout'));
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

export function createFreesoundRouter(dataDir: string): Router {
	const router = Router();
	const soundsBaseDir = path.join(dataDir, 'assets', 'sounds');

	router.get('/status', (_req: Request, res: Response) => {
		const key = getApiKey();
		res.json({
			configured: !!key,
			message: key
				? 'Freesound API key is configured'
				: 'No FREESOUND_API_KEY in .env — search and import will not work',
		});
	});

	router.get('/search', async (req: Request, res: Response) => {
		const query = (req.query.query as string) || '';
		const sort = (req.query.sort as string) || 'score';
		const page = (req.query.page as string) || '1';
		const pageSize = (req.query.page_size as string) || '15';
		const filter = (req.query.filter as string) || '';
		const license = (req.query.license as string) || '';

		if (!query) {
			res.status(400).json({error: 'Query parameter "query" is required'});
			return;
		}

		const apiKey = getApiKey();
		if (!apiKey) {
			res.status(400).json({error: 'FREESOUND_API_KEY not configured in .env'});
			return;
		}

		const params = new URLSearchParams();
		params.set('query', query);
		params.set('fields', SOUND_FIELDS);
		params.set('sort', sort);
		params.set('page', page);
		params.set('page_size', pageSize);

		const filterParts: string[] = [];
		if (filter) filterParts.push(filter);
		if (license) filterParts.push(`license:"${license}"`);
		if (filterParts.length > 0) params.set('filter', filterParts.join(' '));

		try {
			const data = await freesoundGet(`/search/?${params.toString()}`, apiKey);

			const results = (data.results || []).map((s: any) => ({
				id: s.id,
				name: s.name,
				tags: s.tags || [],
				username: s.username,
				license: s.license,
				duration: s.duration,
				avgRating: s.avg_rating,
				numDownloads: s.num_downloads,
				numRatings: s.num_ratings,
				type: s.type,
				channels: s.channels,
				samplerate: s.samplerate,
				filesize: s.filesize,
				description: s.description,
				url: s.url,
				previews: s.previews || {},
				images: s.images || {},
			}));

			res.json({
				count: data.count || 0,
				results,
				next: data.next || null,
				previous: data.previous || null,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Freesound] Search error: ${msg}`);
			res.status(502).json({error: 'Freesound search failed', detail: msg});
		}
	});

	router.get('/sound/:id', async (req: Request, res: Response) => {
		const soundId = req.params.id;
		if (!soundId) {
			res.status(400).json({error: 'Sound ID required'});
			return;
		}

		const apiKey = getApiKey();
		if (!apiKey) {
			res.status(400).json({error: 'FREESOUND_API_KEY not configured in .env'});
			return;
		}

		try {
			const sound = await freesoundGet(`/sounds/${soundId}/?fields=${SOUND_FIELDS}`, apiKey);
			res.json({
				id: sound.id,
				name: sound.name,
				tags: sound.tags || [],
				username: sound.username,
				license: sound.license,
				duration: sound.duration,
				avgRating: sound.avg_rating,
				numDownloads: sound.num_downloads,
				numRatings: sound.num_ratings,
				type: sound.type,
				channels: sound.channels,
				samplerate: sound.samplerate,
				filesize: sound.filesize,
				description: sound.description,
				url: sound.url,
				previews: sound.previews || {},
				images: sound.images || {},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Freesound] Sound detail error: ${msg}`);
			res.status(502).json({error: 'Failed to fetch sound details', detail: msg});
		}
	});

	router.post('/import/:id', adminAuth, async (req: Request, res: Response) => {
		const soundId = req.params.id;
		const category = (req.body.category as string) || '';
		const fileName = req.body.fileName as string;

		if (!soundId) {
			res.status(400).json({error: 'Sound ID required'});
			return;
		}

		if (!category || !CATEGORY_FOLDERS[category as SoundCategory]) {
			res.status(400).json({
				error: `Invalid category: "${category}". Must be one of: ${Object.keys(CATEGORY_FOLDERS).join(', ')}`,
			});
			return;
		}

		const apiKey = getApiKey();
		if (!apiKey) {
			res.status(400).json({error: 'FREESOUND_API_KEY not configured in .env'});
			return;
		}

		try {
			console.log(`[Freesound] Admin importing sound ${soundId} to ${category}`);

			const sound = await freesoundGet(
				`/sounds/${soundId}/?fields=id,name,username,license,previews,duration,type`,
				apiKey,
			);

			const previewUrl = sound.previews?.['preview-hq-mp3'];
			if (!previewUrl) {
				res.status(400).json({error: 'Sound has no HQ MP3 preview available'});
				return;
			}

			console.log(`[Freesound] Downloading preview from ${previewUrl.substring(0, 80)}...`);
			const audioBuffer = await downloadFile(previewUrl);
			console.log(`[Freesound] Downloaded ${audioBuffer.length} bytes`);

			const soundName = fileName
				|| (sound.name || `freesound-${soundId}`)
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
					.substring(0, 60);

			const folder = CATEGORY_FOLDERS[category as SoundCategory];
			const destDir = path.join(soundsBaseDir, folder);
			fs.mkdirSync(destDir, {recursive: true});

			const mp3Path = path.join(destDir, `${soundName}.mp3`);
			if (fs.existsSync(mp3Path)) {
				res.status(409).json({error: `File already exists: ${soundName}.mp3`});
				return;
			}

			fs.writeFileSync(mp3Path, audioBuffer);
			console.log(`[Freesound] Imported: ${mp3Path} (${audioBuffer.length} bytes)`);

			res.json({
				ok: true,
				format: 'mp3',
				id: soundName,
				path: `sounds/${folder}/${soundName}.mp3`,
				size: audioBuffer.length,
				duration: sound.duration,
				attribution: {
					name: sound.name,
					author: sound.username,
					license: sound.license,
					url: `https://freesound.org/sounds/${soundId}/`,
				},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Freesound] Import error: ${msg}`);
			res.status(502).json({error: 'Import failed', detail: msg});
		}
	});

	return router;
}
