import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {adminAuth} from '../middleware/adminAuth';

const router = Router();
const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

function readConfig(): object {
	try {
		const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
		return JSON.parse(raw);
	} catch (err) {
		console.error('[Config] Error reading config:', err);
		return getDefaultConfig();
	}
}

function getDefaultConfig(): object {
	return {
		trainModel: 'procedural-default',
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
}

router.get('/', (_req: Request, res: Response) => {
	const config = readConfig();
	res.json(config);
});

router.put('/', adminAuth, (req: Request, res: Response) => {
	const newConfig = req.body;
	if (!newConfig || typeof newConfig !== 'object') {
		res.status(400).json({error: 'Invalid config payload'});
		return;
	}

	try {
		fs.mkdirSync(path.dirname(CONFIG_PATH), {recursive: true});
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
		console.log('[Config] Config updated by admin');
		res.json({ok: true, config: newConfig});
	} catch (err) {
		console.error('[Config] Error writing config:', err);
		res.status(500).json({error: 'Failed to write config'});
	}
});

export default router;
