/**
 * Tests for the admin API server routes.
 * These test the config and assets endpoints with mock file system operations.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const express = require('express');
const request = require('supertest');
const multer = require('multer');
import * as fs from 'fs';
import * as path from 'path';

const TEST_DATA_DIR = path.join(__dirname, '../../test-data');
const CONFIG_PATH = path.join(TEST_DATA_DIR, 'config.json');
const ASSETS_DIR = path.join(TEST_DATA_DIR, 'assets');
const TOKEN_PATH = path.join(TEST_DATA_DIR, 'admin-token.txt');
const ADMIN_TOKEN = 'test-admin-token-12345';
const CATALOG_PATH = path.join(ASSETS_DIR, 'catalog.json');

let app: any;
let uploadedAssetId: string | null = null;

function readCatalog(): any {
	return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
}

function writeCatalog(catalog: any): void {
	fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
}

beforeAll(() => {
	fs.mkdirSync(path.join(ASSETS_DIR, 'sounds', 'horn'), {recursive: true});
	fs.mkdirSync(path.join(ASSETS_DIR, 'models', 'trains'), {recursive: true});
	fs.writeFileSync(TOKEN_PATH, ADMIN_TOKEN, 'utf-8');

	const defaultConfig = {
		trainSlots: ['procedural-default', 'procedural-default', 'procedural-default'],
		trackModel: 'procedural-default',
		stationModel: 'procedural-default',
		sounds: {
			horn: 'procedural',
			engine: 'procedural',
			rail: 'procedural',
			wind: 'procedural',
			brake: 'procedural',
			doorChime: 'procedural',
			stationChime: 'procedural',
		},
	};
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');

	writeCatalog({
		models: {trains: [], tracks: [], stations: []},
		sounds: {horn: [], engine: [], rail: [], wind: [], brake: [], doorChime: [], stationChime: []},
	});

	app = express();
	app.use(express.json());

	const upload = multer({
		storage: multer.diskStorage({
			destination: (_req: any, _file: any, cb: any) => cb(null, '/tmp'),
			filename: (_req: any, file: any, cb: any) => cb(null, `test-${Date.now()}${path.extname(file.originalname)}`),
		}),
		limits: {fileSize: 50 * 1024 * 1024},
	});

	app.get('/api/config', (_req: any, res: any) => {
		try {
			const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
			res.json(JSON.parse(raw));
		} catch {
			res.status(500).json({error: 'Failed to read config'});
		}
	});

	app.put('/api/config', (req: any, res: any) => {
		const token = req.query.token as string;
		if (token !== ADMIN_TOKEN) {
			res.status(403).json({error: 'Forbidden'});
			return;
		}

		const newConfig = req.body;
		if (!newConfig || typeof newConfig !== 'object') {
			res.status(400).json({error: 'Invalid config'});
			return;
		}

		fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
		res.json({ok: true, config: newConfig});
	});

	app.get('/api/assets/list', (_req: any, res: any) => {
		try {
			res.json(readCatalog());
		} catch {
			res.status(500).json({error: 'Failed to read catalog'});
		}
	});

	app.post('/api/assets/upload', upload.single('file'), (req: any, res: any) => {
		const token = req.query.token as string;
		if (token !== ADMIN_TOKEN) {
			if (req.file) fs.unlinkSync(req.file.path);
			res.status(403).json({error: 'Forbidden'});
			return;
		}
		if (!req.file) {
			res.status(400).json({error: 'No file uploaded'});
			return;
		}

		const category = req.body.category as string;
		const subcategory = req.body.subcategory as string;
		const displayName = req.body.name as string || req.file.originalname;

		if (!category || !subcategory) {
			fs.unlinkSync(req.file.path);
			res.status(400).json({error: 'category and subcategory required'});
			return;
		}

		const ext = path.extname(req.file.originalname).toLowerCase();
		const destDir = path.join(ASSETS_DIR, category, subcategory);
		fs.mkdirSync(destDir, {recursive: true});

		const destFilename = `uploaded-${Date.now()}${ext}`;
		const destPath = path.join(destDir, destFilename);
		fs.renameSync(req.file.path, destPath);

		const assetId = `uploaded-${Date.now()}`;
		const relativePath = `${category}/${subcategory}/${destFilename}`;

		const catalog = readCatalog();
		const catSection = category === 'models' ? catalog.models : catalog.sounds;
		if (!catSection[subcategory]) catSection[subcategory] = [];
		const entry = {id: assetId, name: displayName, path: relativePath, type: category === 'models' ? 'gltf' : 'sample', source: 'User Upload', uploaded: true};
		catSection[subcategory].push(entry);
		writeCatalog(catalog);

		res.json({ok: true, asset: entry});
	});

	app.delete('/api/assets/:id', (req: any, res: any) => {
		const token = req.query.token as string;
		if (token !== ADMIN_TOKEN) {
			res.status(403).json({error: 'Forbidden'});
			return;
		}

		const assetId = req.params.id;
		const catalog = readCatalog();
		let found = false;

		for (const categoryKey of ['models', 'sounds']) {
			const section = catalog[categoryKey];
			for (const subKey of Object.keys(section)) {
				const list = section[subKey] as any[];
				const idx = list.findIndex((a: any) => a.id === assetId);
				if (idx >= 0) {
					const asset = list[idx];
					if (!asset.uploaded) {
						res.status(400).json({error: 'Cannot delete bundled assets'});
						return;
					}
					const filePath = path.join(ASSETS_DIR, asset.path);
					try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
					list.splice(idx, 1);
					writeCatalog(catalog);
					found = true;
					break;
				}
			}
			if (found) break;
		}

		if (!found) {
			res.status(404).json({error: 'Asset not found'});
			return;
		}
		res.json({ok: true});
	});
});

afterAll(() => {
	fs.rmSync(TEST_DATA_DIR, {recursive: true, force: true});
});

describe('GET /api/config', () => {
	test('returns valid config JSON', async () => {
		const res = await request(app).get('/api/config');
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('trainSlots');
		expect(res.body).toHaveProperty('sounds');
		expect(res.body.sounds).toHaveProperty('horn');
	});
});

describe('PUT /api/config', () => {
	test('rejects without admin token', async () => {
		const res = await request(app)
			.put('/api/config')
			.send({trainSlots: ['kenney-subway-a']});
		expect(res.status).toBe(403);
	});

	test('rejects with wrong token', async () => {
		const res = await request(app)
			.put('/api/config?token=wrong-token')
			.send({trainSlots: ['kenney-subway-a']});
		expect(res.status).toBe(403);
	});

	test('accepts with valid admin token', async () => {
		const newConfig = {
			trainSlots: ['kenney-subway-a', 'kenney-subway-a', 'kenney-subway-a'],
			trackModel: 'procedural-default',
			stationModel: 'procedural-default',
			sounds: {
				horn: 'metro-horn',
				engine: 'procedural',
				rail: 'procedural',
				wind: 'procedural',
				brake: 'procedural',
				doorChime: 'procedural',
				stationChime: 'procedural',
			},
		};

		const res = await request(app)
			.put(`/api/config?token=${ADMIN_TOKEN}`)
			.send(newConfig);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);

		const readBack = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
		expect(readBack.trainSlots).toEqual(['kenney-subway-a', 'kenney-subway-a', 'kenney-subway-a']);
		expect(readBack.sounds.horn).toBe('metro-horn');
	});
});

describe('GET /api/assets/list', () => {
	test('returns catalog JSON', async () => {
		const res = await request(app).get('/api/assets/list');
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('models');
		expect(res.body).toHaveProperty('sounds');
		expect(res.body.models).toHaveProperty('trains');
	});
});

describe('POST /api/assets/upload', () => {
	test('rejects without admin token', async () => {
		const testFile = path.join(TEST_DATA_DIR, 'test-sound.mp3');
		fs.writeFileSync(testFile, 'fake-mp3-content');

		const res = await request(app)
			.post('/api/assets/upload')
			.field('category', 'sounds')
			.field('subcategory', 'horn')
			.field('name', 'Test Horn')
			.attach('file', testFile);
		expect(res.status).toBe(403);

		fs.unlinkSync(testFile);
	});

	test('rejects without file', async () => {
		const res = await request(app)
			.post(`/api/assets/upload?token=${ADMIN_TOKEN}`)
			.field('category', 'sounds')
			.field('subcategory', 'horn');
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('No file');
	});

	test('rejects without category/subcategory', async () => {
		const testFile = path.join(TEST_DATA_DIR, 'test-sound2.mp3');
		fs.writeFileSync(testFile, 'fake-mp3-content');

		const res = await request(app)
			.post(`/api/assets/upload?token=${ADMIN_TOKEN}`)
			.attach('file', testFile);
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('category');

		try { fs.unlinkSync(testFile); } catch { /* may have been moved */ }
	});

	test('uploads sound file with valid token', async () => {
		const testFile = path.join(TEST_DATA_DIR, 'test-horn-upload.mp3');
		fs.writeFileSync(testFile, 'fake-mp3-content-for-upload');

		const res = await request(app)
			.post(`/api/assets/upload?token=${ADMIN_TOKEN}`)
			.field('category', 'sounds')
			.field('subcategory', 'horn')
			.field('name', 'My Custom Horn')
			.attach('file', testFile);

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.asset).toHaveProperty('id');
		expect(res.body.asset.name).toBe('My Custom Horn');
		expect(res.body.asset.uploaded).toBe(true);
		expect(res.body.asset.path).toContain('sounds/horn/');

		uploadedAssetId = res.body.asset.id;

		const catalog = readCatalog();
		const hornEntries = catalog.sounds.horn;
		const uploaded = hornEntries.find((e: any) => e.id === uploadedAssetId);
		expect(uploaded).toBeDefined();
		expect(uploaded.name).toBe('My Custom Horn');

		try { fs.unlinkSync(testFile); } catch { /* may have been moved */ }
	});
});

describe('DELETE /api/assets/:id', () => {
	test('rejects without admin token', async () => {
		const res = await request(app).delete('/api/assets/nonexistent');
		expect(res.status).toBe(403);
	});

	test('returns 404 for nonexistent asset', async () => {
		const res = await request(app).delete(`/api/assets/does-not-exist?token=${ADMIN_TOKEN}`);
		expect(res.status).toBe(404);
	});

	test('rejects deleting bundled (non-uploaded) assets', async () => {
		const catalog = readCatalog();
		catalog.sounds.horn.push({id: 'bundled-horn', name: 'Bundled', path: null, type: 'sample', source: 'Built-in'});
		writeCatalog(catalog);

		const res = await request(app).delete(`/api/assets/bundled-horn?token=${ADMIN_TOKEN}`);
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('bundled');
	});

	test('deletes an uploaded asset', async () => {
		expect(uploadedAssetId).not.toBeNull();

		const res = await request(app).delete(`/api/assets/${uploadedAssetId}?token=${ADMIN_TOKEN}`);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);

		const catalog = readCatalog();
		const found = catalog.sounds.horn.find((e: any) => e.id === uploadedAssetId);
		expect(found).toBeUndefined();
	});
});
