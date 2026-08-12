import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

/**
 * Player profiles + score persistence.
 *
 * Two ways in, because a family device and a personal one want different
 * things:
 *   - EMAIL + PASSWORD, the way every other site works, for a player who wants
 *     their runs on their phone and on their laptop;
 *   - display name + 4-digit PIN, so a kid on the family iPad does not need an
 *     email address to have their own best runs.
 *
 * Both are stored the same way: scrypt (node built-in, no native dependency)
 * over a per-profile salt. A 4-digit PIN is only 10,000 possibilities, so the
 * lockout — 5 attempts, then 5 minutes — is the real defence on that path, and
 * it guards passwords too. Never log a secret, a hash or a token.
 *
 * The email address is the only personal data stored, and only when the player
 * chooses that path.
 */

export interface Profile {
	id: number;
	name: string;
	/** Present only for profiles created with the email + password path. */
	email?: string | null;
	createdAt: number;
}

/** Minimum password length. Short enough for a child, long enough to matter. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately permissive: the goal is to catch a typo, not to police what a
 * valid address looks like. Anything with one @ and a dot after it passes.
 */
export function isPlausibleEmail(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length < 5 || trimmed.length > 254) return false;
	if (trimmed.includes(' ')) return false;
	const at = trimmed.indexOf('@');
	if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
	const domain = trimmed.slice(at + 1);
	const dot = domain.indexOf('.');
	return dot > 0 && dot < domain.length - 1;
}

export interface ScoreRow {
	profileId: number;
	profileName: string;
	mapId: string;
	lineId: string;
	kind: string;
	value: number;
	detail: unknown;
	createdAt: number;
}

/** Scores where a LOWER number is the better result. */
const LOWER_IS_BETTER = new Set(['punctuality-drift', 'stop-error']);

const MAX_HISTORY_PER_KEY = 20;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000; // 6 months — kids' device

/**
 * ONE message for "no such profile" and for "wrong secret". Two different
 * messages would let anyone check which emails have an account here.
 */
const WRONG_CREDENTIALS = 'Wrong details — check the name or email and the password';

export function isHigherBetter(kind: string): boolean {
	return !LOWER_IS_BETTER.has(kind);
}

function hashPin(pin: string, salt: string): string {
	return crypto.scryptSync(pin, salt, 32).toString('hex');
}

export class ProfileStore {
	private readonly db: Database.Database;

	public constructor(dataDir: string) {
		fs.mkdirSync(dataDir, {recursive: true});
		this.db = new Database(path.join(dataDir, 'metrorider.db'));
		this.db.pragma('journal_mode = WAL');
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS profiles (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE COLLATE NOCASE,
				pin_salt TEXT NOT NULL,
				pin_hash TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				failed_attempts INTEGER NOT NULL DEFAULT 0,
				locked_until INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE IF NOT EXISTS sessions (
				token TEXT PRIMARY KEY,
				profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
				created_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS scores (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
				map_id TEXT NOT NULL,
				line_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				value REAL NOT NULL,
				detail_json TEXT,
				is_best INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_scores_board
				ON scores (map_id, line_id, kind, is_best, value);
			CREATE INDEX IF NOT EXISTS idx_scores_profile
				ON scores (profile_id, map_id, line_id, kind, created_at);

			CREATE TABLE IF NOT EXISTS profile_data (
				profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
				key TEXT NOT NULL,
				value_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (profile_id, key)
			);
		`);

		// Added after the first release: profiles created before this have no
		// email and keep signing in with their name + PIN.
		const columns = this.db.prepare('PRAGMA table_info(profiles)').all() as {name: string}[];
		if (!columns.some(c => c.name === 'email')) {
			this.db.exec('ALTER TABLE profiles ADD COLUMN email TEXT');
		}
		this.db.exec(
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email COLLATE NOCASE) WHERE email IS NOT NULL'
		);
	}

	// ---- profiles ----

	/**
	 * Create a profile. `secret` is either a 4-digit PIN (no email) or a
	 * password of at least MIN_PASSWORD_LENGTH characters (with an email).
	 */
	public createProfile(name: string, secret: string, email?: string | null): {token: string; profile: Profile} {
		const clean = name.trim();
		if (clean.length < 2 || clean.length > 24) {
			throw new Error('Name must be 2-24 characters');
		}

		const cleanEmail = email?.trim() ? email.trim() : null;
		if (cleanEmail) {
			if (!isPlausibleEmail(cleanEmail)) {
				throw new Error('That email address does not look right');
			}
			if (secret.length < MIN_PASSWORD_LENGTH) {
				throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
			}
			const takenEmail = this.db.prepare('SELECT id FROM profiles WHERE email = ? COLLATE NOCASE').get(cleanEmail);
			if (takenEmail) {
				throw new Error('There is already an account with that email');
			}
		} else if (!/^\d{4}$/.test(secret)) {
			throw new Error('PIN must be 4 digits');
		}

		const existing = this.db.prepare('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE').get(clean);
		if (existing) {
			throw new Error('That name is taken on this server');
		}

		const salt = crypto.randomBytes(16).toString('hex');
		const now = Date.now();
		const info = this.db.prepare(
			'INSERT INTO profiles (name, email, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)'
		).run(clean, cleanEmail, salt, hashPin(secret, salt), now);

		const profile: Profile = {id: Number(info.lastInsertRowid), name: clean, email: cleanEmail, createdAt: now};
		return {token: this.createSession(profile.id), profile};
	}

	/** Sign in with either the email address or the display name. */
	public login(identifier: string, secret: string): {token: string; profile: Profile} {
		const id = identifier.trim();
		const query = id.includes('@')
			? 'SELECT id, name, email, pin_salt, pin_hash, created_at, failed_attempts, locked_until FROM profiles WHERE email = ? COLLATE NOCASE'
			: 'SELECT id, name, email, pin_salt, pin_hash, created_at, failed_attempts, locked_until FROM profiles WHERE name = ? COLLATE NOCASE';
		const row = this.db.prepare(query).get(id) as {
			id: number; name: string; email: string | null; pin_salt: string; pin_hash: string;
			created_at: number; failed_attempts: number; locked_until: number;
		} | undefined;

		// Same message whether the profile is missing or the secret is wrong —
		// otherwise the endpoint tells anyone which emails have an account.
		if (!row) {
			throw new Error(WRONG_CREDENTIALS);
		}

		const now = Date.now();
		if (row.locked_until > now) {
			const mins = Math.ceil((row.locked_until - now) / 60000);
			throw new Error(`Too many tries — locked for ${mins} more minute${mins === 1 ? '' : 's'}`);
		}

		const candidate = hashPin(secret, row.pin_salt);
		const ok = crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(row.pin_hash, 'hex'));

		if (!ok) {
			const attempts = row.failed_attempts + 1;
			const lockedUntil = attempts >= LOCKOUT_ATTEMPTS ? now + LOCKOUT_MS : 0;
			this.db.prepare('UPDATE profiles SET failed_attempts = ?, locked_until = ? WHERE id = ?')
				.run(attempts >= LOCKOUT_ATTEMPTS ? 0 : attempts, lockedUntil, row.id);
			throw new Error(lockedUntil ? 'Too many tries — locked for 5 minutes' : WRONG_CREDENTIALS);
		}

		this.db.prepare('UPDATE profiles SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(row.id);
		return {
			token: this.createSession(row.id),
			profile: {id: row.id, name: row.name, email: row.email, createdAt: row.created_at},
		};
	}

	public listProfiles(): Profile[] {
		const rows = this.db.prepare('SELECT id, name, created_at FROM profiles ORDER BY name COLLATE NOCASE').all() as
			{id: number; name: string; created_at: number}[];
		return rows.map(r => ({id: r.id, name: r.name, createdAt: r.created_at}));
	}

	public deleteProfile(profileId: number): void {
		this.db.prepare('DELETE FROM profile_data WHERE profile_id = ?').run(profileId);
		this.db.prepare('DELETE FROM scores WHERE profile_id = ?').run(profileId);
		this.db.prepare('DELETE FROM sessions WHERE profile_id = ?').run(profileId);
		this.db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
	}

	// ---- sessions ----

	private createSession(profileId: number): string {
		const token = crypto.randomBytes(32).toString('hex');
		const now = Date.now();
		this.db.prepare('INSERT INTO sessions (token, profile_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
			.run(token, profileId, now, now);
		return token;
	}

	public resolveSession(token: string | undefined): Profile | null {
		if (!token) return null;
		const row = this.db.prepare(`
			SELECT p.id, p.name, p.email, p.created_at, s.last_seen_at
			FROM sessions s JOIN profiles p ON p.id = s.profile_id
			WHERE s.token = ?
		`).get(token) as {id: number; name: string; email: string | null; created_at: number; last_seen_at: number} | undefined;

		if (!row) return null;

		const now = Date.now();
		if (now - row.last_seen_at > SESSION_IDLE_MS) {
			this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
			return null;
		}

		this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(now, token);
		return {id: row.id, name: row.name, email: row.email, createdAt: row.created_at};
	}

	public logout(token: string): void {
		this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
	}

	// ---- scores ----

	/**
	 * Record a run. Returns whether it beat this profile's previous best for
	 * the same (map, line, kind), plus the best value now standing.
	 */
	public submitScore(
		profileId: number,
		mapId: string,
		lineId: string,
		kind: string,
		value: number,
		detail?: unknown,
	): {isPersonalBest: boolean; best: number; previousBest: number | null} {
		if (!Number.isFinite(value)) throw new Error('Score value must be a number');

		const higherBetter = isHigherBetter(kind);
		const now = Date.now();

		const prevBestRow = this.db.prepare(
			'SELECT id, value FROM scores WHERE profile_id = ? AND map_id = ? AND line_id = ? AND kind = ? AND is_best = 1'
		).get(profileId, mapId, lineId, kind) as {id: number; value: number} | undefined;

		const previousBest = prevBestRow?.value ?? null;
		const isPersonalBest = previousBest === null
			|| (higherBetter ? value > previousBest : value < previousBest);

		const insert = this.db.prepare(
			'INSERT INTO scores (profile_id, map_id, line_id, kind, value, detail_json, is_best, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		);

		const tx = this.db.transaction(() => {
			if (isPersonalBest && prevBestRow) {
				this.db.prepare('UPDATE scores SET is_best = 0 WHERE id = ?').run(prevBestRow.id);
			}
			insert.run(
				profileId, mapId, lineId, kind, value,
				detail === undefined ? null : JSON.stringify(detail),
				isPersonalBest ? 1 : 0, now,
			);

			// Keep a rolling history so the DB can't grow without bound, but
			// never drop the row that is currently the personal best.
			const stale = this.db.prepare(`
				SELECT id FROM scores
				WHERE profile_id = ? AND map_id = ? AND line_id = ? AND kind = ? AND is_best = 0
				ORDER BY created_at DESC
				LIMIT -1 OFFSET ?
			`).all(profileId, mapId, lineId, kind, MAX_HISTORY_PER_KEY) as {id: number}[];
			for (const row of stale) {
				this.db.prepare('DELETE FROM scores WHERE id = ?').run(row.id);
			}
		});
		tx();

		return {
			isPersonalBest,
			best: isPersonalBest ? value : (previousBest as number),
			previousBest,
		};
	}

	/** The board: one row per profile (their best), ordered best-first. */
	public getBoard(mapId: string, lineId: string, kind: string, limit = 20): ScoreRow[] {
		const order = isHigherBetter(kind) ? 'DESC' : 'ASC';
		const rows = this.db.prepare(`
			SELECT s.profile_id, p.name AS profile_name, s.map_id, s.line_id, s.kind,
			       s.value, s.detail_json, s.created_at
			FROM scores s JOIN profiles p ON p.id = s.profile_id
			WHERE s.map_id = ? AND s.line_id = ? AND s.kind = ? AND s.is_best = 1
			ORDER BY s.value ${order}, s.created_at ASC
			LIMIT ?
		`).all(mapId, lineId, kind, Math.min(100, Math.max(1, limit))) as {
			profile_id: number; profile_name: string; map_id: string; line_id: string;
			kind: string; value: number; detail_json: string | null; created_at: number;
		}[];

		return rows.map(r => ({
			profileId: r.profile_id,
			profileName: r.profile_name,
			mapId: r.map_id,
			lineId: r.line_id,
			kind: r.kind,
			value: r.value,
			detail: r.detail_json ? JSON.parse(r.detail_json) : null,
			createdAt: r.created_at,
		}));
	}

	public getProfileScores(profileId: number, mapId?: string, lineId?: string): ScoreRow[] {
		const clauses = ['s.profile_id = ?', 's.is_best = 1'];
		const params: unknown[] = [profileId];
		if (mapId) { clauses.push('s.map_id = ?'); params.push(mapId); }
		if (lineId) { clauses.push('s.line_id = ?'); params.push(lineId); }

		const rows = this.db.prepare(`
			SELECT s.profile_id, p.name AS profile_name, s.map_id, s.line_id, s.kind,
			       s.value, s.detail_json, s.created_at
			FROM scores s JOIN profiles p ON p.id = s.profile_id
			WHERE ${clauses.join(' AND ')}
			ORDER BY s.created_at DESC
		`).all(...params) as {
			profile_id: number; profile_name: string; map_id: string; line_id: string;
			kind: string; value: number; detail_json: string | null; created_at: number;
		}[];

		return rows.map(r => ({
			profileId: r.profile_id,
			profileName: r.profile_name,
			mapId: r.map_id,
			lineId: r.line_id,
			kind: r.kind,
			value: r.value,
			detail: r.detail_json ? JSON.parse(r.detail_json) : null,
			createdAt: r.created_at,
		}));
	}

	// ---- per-profile key/value (badges, saved setup, discoveries) ----

	public setData(profileId: number, key: string, value: unknown): void {
		this.db.prepare(`
			INSERT INTO profile_data (profile_id, key, value_json, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(profile_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
		`).run(profileId, key, JSON.stringify(value ?? null), Date.now());
	}

	public getData(profileId: number, key: string): unknown {
		const row = this.db.prepare('SELECT value_json FROM profile_data WHERE profile_id = ? AND key = ?')
			.get(profileId, key) as {value_json: string} | undefined;
		return row ? JSON.parse(row.value_json) : null;
	}

	public listDataKeys(profileId: number): string[] {
		const rows = this.db.prepare('SELECT key FROM profile_data WHERE profile_id = ? ORDER BY key')
			.all(profileId) as {key: string}[];
		return rows.map(r => r.key);
	}

	public close(): void {
		this.db.close();
	}
}
