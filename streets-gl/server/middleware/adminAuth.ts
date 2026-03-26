import {Request, Response, NextFunction} from 'express';
import {v4 as uuidv4} from 'uuid';

function resolveToken(): string {
	if (process.env.ADMIN_TOKEN) {
		return process.env.ADMIN_TOKEN;
	}

	const generated = uuidv4();
	console.warn(`[AdminAuth] No ADMIN_TOKEN env var set. Generated ephemeral token: ${generated}`);
	console.warn('[AdminAuth] Set ADMIN_TOKEN in your environment to make it persistent.');
	return generated;
}

const ADMIN_TOKEN = resolveToken();

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
	const tokenFromQuery = req.query.token as string | undefined;
	const authHeader = req.headers.authorization;
	const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

	const providedToken = tokenFromQuery || tokenFromHeader;

	if (!providedToken || providedToken !== ADMIN_TOKEN) {
		res.status(403).json({error: 'Forbidden: invalid or missing admin token'});
		return;
	}

	next();
}

export function getAdminToken(): string {
	return ADMIN_TOKEN;
}
