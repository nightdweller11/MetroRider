import {Router, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {adminAuth} from '../middleware/adminAuth';

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

export function createConfigRouter(dataDir: string): Router {
	const router = Router();
	const configPath = path.join(dataDir, 'config.json');

	function readConfig(): object {
		try {
			const raw = fs.readFileSync(configPath, 'utf-8');
			return JSON.parse(raw);
		} catch (err) {
			console.error('[Config] Error reading config:', err);
			return getDefaultConfig();
		}
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
			fs.mkdirSync(path.dirname(configPath), {recursive: true});
			fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
			console.log('[Config] Config updated by admin');
			res.json({ok: true, config: newConfig});
		} catch (err) {
			console.error('[Config] Error writing config:', err);
			res.status(500).json({error: 'Failed to write config'});
		}
	});

	return router;
}
