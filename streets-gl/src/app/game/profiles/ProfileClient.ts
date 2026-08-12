/**
 * Player profiles, client side.
 *
 * Two jobs: hold the session token, and make sure a score earned offline is
 * not lost. iOS clears localStorage after about a week of not visiting, which
 * is exactly why profiles exist — so this layer never treats localStorage as
 * the source of truth for anything but the token and the pending queue.
 */

export interface PlayerProfile {
	id: number;
	name: string;
	email?: string | null;
	createdAt?: number;
}

export interface ScoreSubmission {
	mapId: string;
	lineId: string;
	kind: string;
	value: number;
	detail?: unknown;
}

export interface BoardEntry {
	profileId: number;
	profileName: string;
	value: number;
	detail: unknown;
	createdAt: number;
}

const TOKEN_KEY = 'metrorider-profile-token';
const QUEUE_KEY = 'metrorider-score-queue';
const MAX_QUEUE = 50;

type ProfileListener = (profile: PlayerProfile | null) => void;

export default class ProfileClient {
	private static instance: ProfileClient | null = null;

	public static get(): ProfileClient {
		if (!ProfileClient.instance) ProfileClient.instance = new ProfileClient();
		return ProfileClient.instance;
	}

	private token: string | null = null;
	private profile: PlayerProfile | null = null;
	private listeners: ProfileListener[] = [];
	private flushing = false;

	private constructor() {
		try {
			this.token = localStorage.getItem(TOKEN_KEY);
		} catch {
			this.token = null;
		}
	}

	public getProfile(): PlayerProfile | null {
		return this.profile;
	}

	public isSignedIn(): boolean {
		return this.profile !== null;
	}

	public onChange(listener: ProfileListener): void {
		this.listeners.push(listener);
		listener(this.profile);
	}

	private notify(): void {
		for (const l of this.listeners) {
			try {
				l(this.profile);
			} catch (err) {
				console.error('[Profiles] listener failed:', err);
			}
		}
	}

	private setToken(token: string | null): void {
		this.token = token;
		try {
			if (token) localStorage.setItem(TOKEN_KEY, token);
			else localStorage.removeItem(TOKEN_KEY);
		} catch {
			// Private mode / storage full: the session still works for this tab.
		}
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers: Record<string, string> = {'Content-Type': 'application/json'};
		if (this.token) headers.Authorization = `Bearer ${this.token}`;

		const response = await fetch(`/api/profiles${path}`, {...init, headers: {...headers, ...(init.headers ?? {})}});
		const body = await response.json().catch(() => ({}));

		if (!response.ok) {
			throw new Error((body as {error?: string}).error ?? `Request failed (${response.status})`);
		}
		return body as T;
	}

	/** Restore the session on boot. Never throws — a dead token just means guest. */
	public async restore(): Promise<PlayerProfile | null> {
		if (!this.token) return null;
		try {
			const me = await this.request<{profile: PlayerProfile}>('/me');
			this.profile = me.profile;
			this.notify();
			void this.flushQueue();
			return this.profile;
		} catch {
			this.setToken(null);
			this.profile = null;
			this.notify();
			return null;
		}
	}

	public async listProfiles(): Promise<PlayerProfile[]> {
		try {
			const res = await this.request<{profiles: PlayerProfile[]}>('/');
			return res.profiles;
		} catch {
			return [];
		}
	}

	/** `secret` is a password when an email is given, else a 4-digit PIN. */
	public async createProfile(name: string, secret: string, email?: string): Promise<PlayerProfile> {
		const res = await this.request<{token: string; profile: PlayerProfile}>('', {
			method: 'POST',
			body: JSON.stringify(email ? {name, email, password: secret} : {name, pin: secret}),
		});
		this.setToken(res.token);
		this.profile = res.profile;
		this.notify();
		void this.flushQueue();
		return res.profile;
	}

	/** `identifier` is an email address or a display name. */
	public async login(identifier: string, secret: string): Promise<PlayerProfile> {
		const res = await this.request<{token: string; profile: PlayerProfile}>('/login', {
			method: 'POST',
			body: JSON.stringify({name: identifier, email: identifier.includes('@') ? identifier : undefined, password: secret, pin: secret}),
		});
		this.setToken(res.token);
		this.profile = res.profile;
		this.notify();
		void this.flushQueue();
		return res.profile;
	}

	public async logout(): Promise<void> {
		try {
			await this.request('/logout', {method: 'POST'});
		} catch {
			// Signing out locally matters more than the server round-trip.
		}
		this.setToken(null);
		this.profile = null;
		this.notify();
	}

	// ---- scores ----

	/**
	 * Post a score. A signed-out player, a dropped connection or a server
	 * restart must never lose the run: it goes to a local queue and is flushed
	 * the next time the player is signed in and the network answers.
	 */
	public async submitScore(score: ScoreSubmission): Promise<{isPersonalBest: boolean; best: number} | null> {
		if (!this.profile) {
			this.enqueue(score);
			return null;
		}

		try {
			return await this.request<{isPersonalBest: boolean; best: number}>('/scores', {
				method: 'POST',
				body: JSON.stringify(score),
			});
		} catch (err) {
			console.warn('[Profiles] score post failed, queued for later:', err);
			this.enqueue(score);
			return null;
		}
	}

	public async getBoard(mapId: string, lineId: string, kind = 'run-score'): Promise<BoardEntry[]> {
		try {
			const query = `?mapId=${encodeURIComponent(mapId)}&lineId=${encodeURIComponent(lineId)}&kind=${encodeURIComponent(kind)}`;
			const res = await this.request<{board: BoardEntry[]}>(`/scores${query}`);
			return res.board;
		} catch {
			return [];
		}
	}

	public async setData(key: string, value: unknown): Promise<boolean> {
		if (!this.profile) return false;
		try {
			await this.request(`/me/data/${encodeURIComponent(key)}`, {
				method: 'PUT',
				body: JSON.stringify({value}),
			});
			return true;
		} catch {
			return false;
		}
	}

	public async getData<T>(key: string): Promise<T | null> {
		if (!this.profile) return null;
		try {
			const res = await this.request<{value: T | null}>(`/me/data/${encodeURIComponent(key)}`);
			return res.value;
		} catch {
			return null;
		}
	}

	// ---- setup backup ----

	/**
	 * Back the player's train/settings config up to their profile, and restore
	 * it on a device that has none.
	 *
	 * The restore is deliberately one-directional: it only writes local storage
	 * when this device has NO config of its own, so signing in on a shared
	 * family iPad never overwrites what the last player built. If both sides
	 * have one, the local one wins and is pushed up.
	 */
	public async syncSetup(localConfigKey = 'metrorider-user-config'): Promise<'restored' | 'backed-up' | 'skipped'> {
		if (!this.profile) return 'skipped';

		let local: string | null = null;
		try {
			local = localStorage.getItem(localConfigKey);
		} catch {
			return 'skipped';
		}

		if (local) {
			try {
				await this.setData('setup', JSON.parse(local));
				return 'backed-up';
			} catch {
				return 'skipped';
			}
		}

		const remote = await this.getData<unknown>('setup');
		if (remote) {
			try {
				localStorage.setItem(localConfigKey, JSON.stringify(remote));
				return 'restored';
			} catch {
				return 'skipped';
			}
		}
		return 'skipped';
	}

	// ---- offline queue ----

	private readQueue(): ScoreSubmission[] {
		try {
			const raw = localStorage.getItem(QUEUE_KEY);
			const parsed = raw ? JSON.parse(raw) : [];
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	private writeQueue(queue: ScoreSubmission[]): void {
		try {
			localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
		} catch {
			// Nothing sensible to do; the run is lost only if storage is full.
		}
	}

	private enqueue(score: ScoreSubmission): void {
		const queue = this.readQueue();
		queue.push(score);
		this.writeQueue(queue);
	}

	public getQueuedCount(): number {
		return this.readQueue().length;
	}

	/** Send everything the player earned while signed out or offline. */
	public async flushQueue(): Promise<number> {
		if (!this.profile || this.flushing) return 0;

		const queue = this.readQueue();
		if (queue.length === 0) return 0;

		this.flushing = true;
		const remaining: ScoreSubmission[] = [];
		let sent = 0;

		try {
			for (const score of queue) {
				try {
					await this.request('/scores', {method: 'POST', body: JSON.stringify(score)});
					sent++;
				} catch {
					remaining.push(score);
				}
			}
		} finally {
			this.writeQueue(remaining);
			this.flushing = false;
		}

		if (sent > 0) console.log(`[Profiles] Flushed ${sent} saved score(s)`);
		return sent;
	}
}
