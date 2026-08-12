import {Router, Request, Response, NextFunction} from 'express';
import {ProfileStore, Profile} from '../store/ProfileStore';

/**
 * Profile + score endpoints.
 *
 * No email, no PII: a name, a 4-digit PIN and game results. Nothing here is
 * logged with its payload, and errors are returned as plain sentences the game
 * can show a nine-year-old.
 */

interface AuthedRequest extends Request {
	profile?: Profile;
}

/** Small in-memory limiter — one server process, family-scale traffic. */
function createRateLimiter(maxPerMinute: number): (req: Request, res: Response, next: NextFunction) => void {
	const hits = new Map<string, {count: number; resetAt: number}>();

	return (req: Request, res: Response, next: NextFunction): void => {
		const key = req.ip ?? 'unknown';
		const now = Date.now();
		const entry = hits.get(key);

		if (!entry || now > entry.resetAt) {
			hits.set(key, {count: 1, resetAt: now + 60_000});
			// Opportunistic cleanup so the map cannot grow forever.
			if (hits.size > 5000) {
				for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
			}
			next();
			return;
		}

		entry.count++;
		if (entry.count > maxPerMinute) {
			res.status(429).json({error: 'Too many requests — wait a minute and try again'});
			return;
		}
		next();
	};
}

function readToken(req: Request): string | undefined {
	const header = req.headers.authorization;
	if (header?.startsWith('Bearer ')) return header.slice(7);
	return undefined;
}

export function createProfilesRouter(store: ProfileStore): Router {
	const router = Router();
	const limit = createRateLimiter(30);

	const requireProfile = (req: AuthedRequest, res: Response, next: NextFunction): void => {
		const profile = store.resolveSession(readToken(req));
		if (!profile) {
			res.status(401).json({error: 'Not signed in'});
			return;
		}
		req.profile = profile;
		next();
	};

	const fail = (res: Response, err: unknown, status = 400): void => {
		const message = err instanceof Error ? err.message : 'Something went wrong';
		res.status(status).json({error: message});
	};

	// --- who plays on this server (names only, for the "Who's driving?" row) ---
	router.get('/', limit, (_req: Request, res: Response) => {
		try {
			res.json({profiles: store.listProfiles().map(p => ({id: p.id, name: p.name}))});
		} catch (err) {
			fail(res, err, 500);
		}
	});

	router.post('/', limit, (req: Request, res: Response) => {
		try {
			const {name, pin} = req.body ?? {};
			const result = store.createProfile(String(name ?? ''), String(pin ?? ''));
			console.log(`[Profiles] Created profile "${result.profile.name}"`);
			res.json(result);
		} catch (err) {
			fail(res, err);
		}
	});

	router.post('/login', limit, (req: Request, res: Response) => {
		try {
			const {name, pin} = req.body ?? {};
			res.json(store.login(String(name ?? ''), String(pin ?? '')));
		} catch (err) {
			fail(res, err, 401);
		}
	});

	router.post('/logout', (req: Request, res: Response) => {
		const token = readToken(req);
		if (token) store.logout(token);
		res.json({ok: true});
	});

	router.get('/me', requireProfile, (req: AuthedRequest, res: Response) => {
		const profile = req.profile!;
		res.json({
			profile,
			dataKeys: store.listDataKeys(profile.id),
			scores: store.getProfileScores(profile.id),
		});
	});

	// --- per-profile saved data (setup backup, badges, discoveries) ---
	router.get('/me/data/:key', requireProfile, (req: AuthedRequest, res: Response) => {
		const key = String(req.params.key);
		res.json({key, value: store.getData(req.profile!.id, key)});
	});

	router.put('/me/data/:key', requireProfile, (req: AuthedRequest, res: Response) => {
		try {
			store.setData(req.profile!.id, String(req.params.key), req.body?.value ?? null);
			res.json({ok: true});
		} catch (err) {
			fail(res, err);
		}
	});

	// --- scores ---
	router.post('/scores', requireProfile, (req: AuthedRequest, res: Response) => {
		try {
			const {mapId, lineId, kind, value, detail} = req.body ?? {};
			if (!mapId || !lineId || !kind) {
				res.status(400).json({error: 'mapId, lineId and kind are required'});
				return;
			}
			const result = store.submitScore(
				req.profile!.id, String(mapId), String(lineId), String(kind), Number(value), detail,
			);
			res.json(result);
		} catch (err) {
			fail(res, err);
		}
	});

	/**
	 * The board is PUBLIC on purpose: everyone on this server sees the family
	 * best runs. It exposes display names and numbers, nothing else.
	 */
	router.get('/scores', limit, (req: Request, res: Response) => {
		try {
			const mapId = String(req.query.mapId ?? '');
			const lineId = String(req.query.lineId ?? '');
			const kind = String(req.query.kind ?? 'run-score');
			if (!mapId || !lineId) {
				res.status(400).json({error: 'mapId and lineId are required'});
				return;
			}
			const limitParam = Number(req.query.limit ?? 20);
			res.json({board: store.getBoard(mapId, lineId, kind, Number.isFinite(limitParam) ? limitParam : 20)});
		} catch (err) {
			fail(res, err, 500);
		}
	});

	return router;
}
