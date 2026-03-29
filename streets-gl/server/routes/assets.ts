import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import {v4 as uuidv4} from 'uuid';
import {adminAuth} from '../middleware/adminAuth';

const MODEL_EXTS = new Set(['.glb', '.gltf']);
const SOUND_EXTS = new Set(['.mp3', '.ogg', '.wav']);

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => cb(null, '/tmp'),
		filename: (_req, file, cb) => {
			const ext = path.extname(file.originalname);
			cb(null, `${uuidv4()}${ext}`);
		},
	}),
	limits: {fileSize: 50 * 1024 * 1024},
});

interface DiscoveredAsset {
	id: string;
	name: string;
	path: string;
	type: 'procedural' | 'gltf' | 'sample';
	source: string;
}

function humanizeName(filename: string): string {
	const stem = path.basename(filename, path.extname(filename));
	return stem
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, c => c.toUpperCase());
}

function scanDir(dir: string, extensions: Set<string>): string[] {
	try {
		return fs.readdirSync(dir)
			.filter(f => extensions.has(path.extname(f).toLowerCase()))
			.sort();
	} catch {
		return [];
	}
}

const PROCEDURAL_MODEL: DiscoveredAsset = {
	id: 'procedural-default',
	name: 'Default (Procedural)',
	path: '',
	type: 'procedural',
	source: 'Built-in',
};

const PROCEDURAL_SOUND: DiscoveredAsset = {
	id: 'procedural',
	name: 'Procedural (Synthesized)',
	path: '',
	type: 'procedural',
	source: 'Built-in',
};

export function createAssetsRouter(dataDir: string): Router {
	const router = Router();
	const assetsDir = path.join(dataDir, 'assets');

	function discoverModels(subcategory: string): DiscoveredAsset[] {
		const dir = path.join(assetsDir, 'models', subcategory);
		const files = scanDir(dir, MODEL_EXTS);
		return files.map(f => ({
			id: path.basename(f, path.extname(f)),
			name: humanizeName(f),
			path: `models/${subcategory}/${f}`,
			type: 'gltf' as const,
			source: 'filesystem',
		}));
	}

	function discoverSounds(subcategory: string): DiscoveredAsset[] {
		const dir = path.join(assetsDir, 'sounds', subcategory);
		const files = scanDir(dir, SOUND_EXTS);
		return files.map(f => ({
			id: path.basename(f, path.extname(f)),
			name: humanizeName(f),
			path: `sounds/${subcategory}/${f}`,
			type: 'sample' as const,
			source: 'filesystem',
		}));
	}

	router.get('/list', (_req: Request, res: Response) => {
		const catalog = {
			models: {
				trains: [PROCEDURAL_MODEL, ...discoverModels('trains')],
				tracks: [PROCEDURAL_MODEL, ...discoverModels('tracks')],
				stations: [PROCEDURAL_MODEL, ...discoverModels('stations')],
			},
			sounds: {
				horn: [PROCEDURAL_SOUND, ...discoverSounds('horns')],
				engine: [PROCEDURAL_SOUND, ...discoverSounds('engine')],
				rail: [PROCEDURAL_SOUND, ...discoverSounds('rail')],
				wind: [PROCEDURAL_SOUND, ...discoverSounds('wind')],
				brake: [PROCEDURAL_SOUND, ...discoverSounds('brake')],
				doorChime: [PROCEDURAL_SOUND, ...discoverSounds('doorChime')],
				stationChime: [PROCEDURAL_SOUND, ...discoverSounds('stationChime')],
			},
		};
		res.json(catalog);
	});

	router.post('/upload', adminAuth, upload.single('file'), (req: Request, res: Response) => {
		if (!req.file) {
			res.status(400).json({error: 'No file uploaded'});
			return;
		}

		const category = req.body.category as string;
		const subcategory = req.body.subcategory as string;
		const displayName = (req.body.name as string) || req.file.originalname;

		if (!category || !subcategory) {
			fs.unlinkSync(req.file.path);
			res.status(400).json({error: 'category and subcategory are required'});
			return;
		}

		const ext = path.extname(req.file.originalname).toLowerCase();
		const isModel = category === 'models';
		const isSound = category === 'sounds';

		if (isModel && !MODEL_EXTS.has(ext)) {
			fs.unlinkSync(req.file.path);
			res.status(400).json({error: `Invalid model format. Allowed: ${[...MODEL_EXTS].join(', ')}`});
			return;
		}
		if (isSound && !SOUND_EXTS.has(ext)) {
			fs.unlinkSync(req.file.path);
			res.status(400).json({error: `Invalid sound format. Allowed: ${[...SOUND_EXTS].join(', ')}`});
			return;
		}
		if (!isModel && !isSound) {
			fs.unlinkSync(req.file.path);
			res.status(400).json({error: 'category must be "models" or "sounds"'});
			return;
		}

		const destDir = path.join(assetsDir, category, subcategory);
		fs.mkdirSync(destDir, {recursive: true});

		const safeName = displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
		const destFilename = `${safeName}${ext}`;
		const destPath = path.join(destDir, destFilename);

		if (fs.existsSync(destPath)) {
			fs.unlinkSync(req.file.path);
			res.status(409).json({error: `Asset "${destFilename}" already exists`});
			return;
		}

		fs.renameSync(req.file.path, destPath);

		const relativePath = `${category}/${subcategory}/${destFilename}`;
		console.log(`[Assets] Admin uploaded ${category}/${subcategory}: ${displayName} -> ${relativePath}`);
		res.json({ok: true, asset: {id: safeName, name: displayName, path: relativePath}});
	});

	router.post('/reassign', adminAuth, (req: Request, res: Response) => {
		const assetId = req.body.assetId as string;
		const toCategory = req.body.toCategory as string;

		if (!assetId || !toCategory) {
			res.status(400).json({error: 'assetId and toCategory are required'});
			return;
		}

		const allSubs: {base: string; sub: string}[] = [
			{base: 'models', sub: 'trains'},
			{base: 'models', sub: 'tracks'},
			{base: 'models', sub: 'stations'},
			{base: 'sounds', sub: 'horns'},
			{base: 'sounds', sub: 'engine'},
			{base: 'sounds', sub: 'rail'},
			{base: 'sounds', sub: 'wind'},
			{base: 'sounds', sub: 'brake'},
			{base: 'sounds', sub: 'doorChime'},
			{base: 'sounds', sub: 'stationChime'},
		];

		const targetEntry = allSubs.find(s => s.sub === toCategory);
		if (!targetEntry) {
			res.status(400).json({error: `Invalid target category: ${toCategory}. Valid: ${allSubs.map(s => s.sub).join(', ')}`});
			return;
		}

		let srcPath: string | null = null;
		let srcBase = '';
		let srcSub = '';
		let srcFilename = '';

		for (const {base, sub} of allSubs) {
			const dir = path.join(assetsDir, base, sub);
			const exts = base === 'models' ? MODEL_EXTS : SOUND_EXTS;
			for (const ext of exts) {
				const candidate = path.join(dir, `${assetId}${ext}`);
				if (fs.existsSync(candidate)) {
					srcPath = candidate;
					srcBase = base;
					srcSub = sub;
					srcFilename = `${assetId}${ext}`;
					break;
				}
			}
			if (srcPath) break;
		}

		if (!srcPath) {
			res.status(404).json({error: `Asset "${assetId}" not found`});
			return;
		}

		if (srcBase !== targetEntry.base) {
			res.status(400).json({error: `Cannot move ${srcBase} asset to ${targetEntry.base} category`});
			return;
		}

		if (srcSub === toCategory) {
			res.status(400).json({error: 'Asset is already in this category'});
			return;
		}

		const destDir = path.join(assetsDir, targetEntry.base, toCategory);
		fs.mkdirSync(destDir, {recursive: true});

		const destPath = path.join(destDir, srcFilename);
		if (fs.existsSync(destPath)) {
			res.status(409).json({error: `Asset "${srcFilename}" already exists in ${toCategory}`});
			return;
		}

		try {
			fs.renameSync(srcPath, destPath);
			console.log(`[Assets] Admin reassigned ${assetId}: ${srcBase}/${srcSub} -> ${srcBase}/${toCategory}`);
			res.json({ok: true, from: `${srcBase}/${srcSub}`, to: `${targetEntry.base}/${toCategory}`});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Assets] Reassign error for ${assetId}: ${msg}`);
			res.status(500).json({error: 'Failed to reassign asset'});
		}
	});

	router.delete('/:id', adminAuth, (req: Request, res: Response) => {
		const assetId = req.params.id;

		const searchDirs = [
			{base: 'models', subs: ['trains', 'tracks', 'stations']},
			{base: 'sounds', subs: ['horns', 'engine', 'rail', 'wind', 'brake', 'doorChime', 'stationChime']},
		];

		for (const {base, subs} of searchDirs) {
			const exts = base === 'models' ? MODEL_EXTS : SOUND_EXTS;
			for (const sub of subs) {
				const dir = path.join(assetsDir, base, sub);
				for (const ext of exts) {
					const filePath = path.join(dir, `${assetId}${ext}`);
					if (fs.existsSync(filePath)) {
						try {
							fs.unlinkSync(filePath);
							console.log(`[Assets] Admin deleted: ${filePath}`);
							res.json({ok: true});
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error(`[Assets] Error deleting ${filePath}: ${msg}`);
							res.status(500).json({error: 'Failed to delete file'});
						}
						return;
					}
				}
			}
		}

		res.status(404).json({error: 'Asset not found'});
	});

	return router;
}
