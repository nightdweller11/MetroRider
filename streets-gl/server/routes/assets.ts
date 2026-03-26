import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import {v4 as uuidv4} from 'uuid';
import {adminAuth} from '../middleware/adminAuth';

const router = Router();
const ASSETS_DIR = path.join(__dirname, '../../data/assets');
const CATALOG_PATH = path.join(ASSETS_DIR, 'catalog.json');

const ALLOWED_MODEL_EXTS = ['.glb', '.gltf'];
const ALLOWED_SOUND_EXTS = ['.mp3', '.ogg', '.wav'];

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => {
			cb(null, '/tmp');
		},
		filename: (_req, file, cb) => {
			const ext = path.extname(file.originalname);
			cb(null, `${uuidv4()}${ext}`);
		},
	}),
	limits: {fileSize: 50 * 1024 * 1024},
});

function readCatalog(): any {
	try {
		return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
	} catch (err) {
		console.error('[Assets] Error reading catalog:', err);
		return {models: {trains: [], tracks: [], stations: []}, sounds: {horn: [], engine: [], rail: [], wind: [], brake: [], doorChime: [], stationChime: []}};
	}
}

function writeCatalog(catalog: any): void {
	fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
}

router.get('/list', (_req: Request, res: Response) => {
	const catalog = readCatalog();
	res.json(catalog);
});

router.post('/upload', adminAuth, upload.single('file'), (req: Request, res: Response) => {
	if (!req.file) {
		res.status(400).json({error: 'No file uploaded'});
		return;
	}

	const category = req.body.category as string;
	const subcategory = req.body.subcategory as string;
	const displayName = req.body.name as string || req.file.originalname;

	if (!category || !subcategory) {
		fs.unlinkSync(req.file.path);
		res.status(400).json({error: 'category and subcategory are required'});
		return;
	}

	const ext = path.extname(req.file.originalname).toLowerCase();
	const isModel = category === 'models';
	const isSound = category === 'sounds';

	if (isModel && !ALLOWED_MODEL_EXTS.includes(ext)) {
		fs.unlinkSync(req.file.path);
		res.status(400).json({error: `Invalid model format. Allowed: ${ALLOWED_MODEL_EXTS.join(', ')}`});
		return;
	}
	if (isSound && !ALLOWED_SOUND_EXTS.includes(ext)) {
		fs.unlinkSync(req.file.path);
		res.status(400).json({error: `Invalid sound format. Allowed: ${ALLOWED_SOUND_EXTS.join(', ')}`});
		return;
	}
	if (!isModel && !isSound) {
		fs.unlinkSync(req.file.path);
		res.status(400).json({error: 'category must be "models" or "sounds"'});
		return;
	}

	const destDir = path.join(ASSETS_DIR, category, subcategory);
	fs.mkdirSync(destDir, {recursive: true});

	const destFilename = `${uuidv4()}${ext}`;
	const destPath = path.join(destDir, destFilename);
	fs.renameSync(req.file.path, destPath);

	const assetId = `uploaded-${uuidv4().slice(0, 8)}`;
	const relativePath = `${category}/${subcategory}/${destFilename}`;

	const catalog = readCatalog();
	const catalogCategory = isModel ? catalog.models : catalog.sounds;
	if (!catalogCategory[subcategory]) {
		catalogCategory[subcategory] = [];
	}

	const entry = {
		id: assetId,
		name: displayName,
		path: relativePath,
		type: isModel ? 'gltf' : 'sample',
		source: 'User Upload',
		uploaded: true,
	};

	catalogCategory[subcategory].push(entry);
	writeCatalog(catalog);

	console.log(`[Assets] Admin uploaded ${category}/${subcategory}: ${displayName} -> ${relativePath}`);
	res.json({ok: true, asset: entry});
});

router.delete('/:id', adminAuth, (req: Request, res: Response) => {
	const assetId = req.params.id;
	const catalog = readCatalog();

	let found = false;
	for (const categoryKey of ['models', 'sounds']) {
		const category = (catalog as any)[categoryKey];
		for (const subKey of Object.keys(category)) {
			const list = category[subKey] as any[];
			const idx = list.findIndex((a: any) => a.id === assetId);
			if (idx >= 0) {
				const asset = list[idx];
				if (!asset.uploaded) {
					res.status(400).json({error: 'Cannot delete bundled assets'});
					return;
				}

				const filePath = path.join(ASSETS_DIR, asset.path);
				try {
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}
				} catch (err) {
					console.error(`[Assets] Error deleting file ${filePath}:`, err);
				}

				list.splice(idx, 1);
				writeCatalog(catalog);
				found = true;
				console.log(`[Assets] Admin deleted asset ${assetId}`);
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

export default router;
