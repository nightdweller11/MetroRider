import System from '~/app/System';

export interface SoundConfig {
	horn: string;
	engine: string;
	rail: string;
	wind: string;
	brake: string;
	doorChime: string;
	stationChime: string;
}

/** How many figures may stand on one platform. */
export type CrowdLevel = 'off' | 'few' | 'normal' | 'busy';
/** How fast passengers pile up while you're away. */
export type DemandLevel = 'calm' | 'normal' | 'rush';

export const CROWD_CAPS: Record<CrowdLevel, number> = {
	off: 0,
	few: 8,
	normal: 20,
	busy: 40,
};

export const DEMAND_SCALES: Record<DemandLevel, number> = {
	calm: 0.5,
	normal: 1,
	rush: 2,
};

export interface AssetConfig {
	trainSlots: string[];
	trackModel: string;
	stationModel: string;
	/**
	 * Figure models used for platform crowds. A LIST, not one id: each waiting
	 * passenger picks a variant deterministically, so a platform reads as a
	 * mixed crowd. Empty = the built-in procedural figure.
	 */
	peopleModels: string[];
	crowdLevel: CrowdLevel;
	demandLevel: DemandLevel;
	sounds: SoundConfig;
}

export interface AssetEntry {
	id: string;
	name: string;
	path: string | null;
	type: 'procedural' | 'gltf' | 'sample';
	source: string;
	uploaded?: boolean;
}

export interface AssetCatalog {
	models: {
		trains: AssetEntry[];
		tracks: AssetEntry[];
		stations: AssetEntry[];
		people: AssetEntry[];
	};
	sounds: {
		horn: AssetEntry[];
		engine: AssetEntry[];
		rail: AssetEntry[];
		wind: AssetEntry[];
		brake: AssetEntry[];
		doorChime: AssetEntry[];
		stationChime: AssetEntry[];
	};
}

type ConfigChangeListener = (config: AssetConfig) => void;

const LOCAL_STORAGE_KEY = 'metrorider-user-config';

/**
 * A config written by an older build (or hand-edited) can carry anything;
 * every consumer of these three fields assumes a valid value, so normalize at
 * the single point where config is merged rather than defending everywhere.
 */
function normalizePeopleModels(raw: unknown): string[] {
	if (!Array.isArray(raw)) return ['procedural-default'];
	const cleaned = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
	return cleaned.length > 0 ? cleaned : ['procedural-default'];
}

function normalizeCrowdLevel(raw: unknown): CrowdLevel {
	return raw === 'off' || raw === 'few' || raw === 'normal' || raw === 'busy' ? raw : 'normal';
}

function normalizeDemandLevel(raw: unknown): DemandLevel {
	return raw === 'calm' || raw === 'normal' || raw === 'rush' ? raw : 'normal';
}
const DEFAULT_SLOTS: string[] = ['procedural-default', 'procedural-default', 'procedural-default'];

function migrateToSlots(raw: any): string[] | null {
	if (Array.isArray(raw.trainSlots) && raw.trainSlots.length > 0) {
		return raw.trainSlots;
	}
	if (raw.trainModel || raw.locomotiveModel || raw.carCount) {
		const car = raw.trainModel || 'procedural-default';
		const loco = raw.locomotiveModel || 'procedural-default';
		const count = raw.carCount ?? 3;
		if (loco !== 'procedural-default' && loco !== car) {
			return [loco, ...Array(count).fill(car)];
		}
		return Array(count).fill(car);
	}
	return null;
}

const DEFAULT_CONFIG: AssetConfig = {
	trainSlots: [...DEFAULT_SLOTS],
	trackModel: 'procedural-default',
	stationModel: 'station-platform-basic',
	peopleModels: ['procedural-default'],
	crowdLevel: 'normal',
	demandLevel: 'normal',
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

export default class AssetConfigSystem extends System {
	private serverConfig: AssetConfig = {...DEFAULT_CONFIG, sounds: {...DEFAULT_CONFIG.sounds}};
	private userOverrides: Partial<AssetConfig> = {};
	private mergedConfig: AssetConfig = {...DEFAULT_CONFIG, sounds: {...DEFAULT_CONFIG.sounds}};
	private catalog: AssetCatalog | null = null;
	private listeners: ConfigChangeListener[] = [];
	private adminToken: string | null = null;
	private loaded: boolean = false;

	public postInit(): void {
		this.detectAdminToken();
		this.loadUserOverrides();
		this.fetchServerConfig().catch((err: Error) => {
			console.error('[AssetConfig] Failed to load server config:', err.message);
		});
		this.fetchCatalog().catch((err: Error) => {
			console.error('[AssetConfig] Failed to load catalog:', err.message);
		});
	}

	private detectAdminToken(): void {
		const params = new URLSearchParams(window.location.search);
		const token = params.get('admin');
		if (token) {
			this.adminToken = token;
			console.log('[AssetConfig] Admin mode active');
		}
	}

	public isAdmin(): boolean {
		return this.adminToken !== null;
	}

	public getAdminToken(): string | null {
		return this.adminToken;
	}

	public getConfig(): AssetConfig {
		return this.mergedConfig;
	}

	public getCatalog(): AssetCatalog | null {
		return this.catalog;
	}

	public isLoaded(): boolean {
		return this.loaded;
	}

	public onChange(listener: ConfigChangeListener): void {
		this.listeners.push(listener);
	}

	public getAssetUrl(relativePath: string): string {
		return `/data/assets/${relativePath}`;
	}

	public getApiUrl(endpoint: string): string {
		return `/api/${endpoint}`;
	}

	private async fetchServerConfig(): Promise<void> {
		try {
			const response = await fetch(this.getApiUrl('config'));
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			this.serverConfig = await response.json();
			this.rebuildMergedConfig();
			this.loaded = true;
			console.log('[AssetConfig] Server config loaded');
		} catch (err) {
			console.warn('[AssetConfig] Using default config (server unavailable)');
			this.loaded = true;
			this.rebuildMergedConfig();
		}
	}

	public async fetchCatalog(): Promise<void> {
		try {
			const response = await fetch(this.getApiUrl('assets/list'));
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			this.catalog = await response.json();
			console.log('[AssetConfig] Catalog loaded');
		} catch (err) {
			console.warn('[AssetConfig] Catalog unavailable, using defaults');
		}
	}

	private loadUserOverrides(): void {
		try {
			const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
			this.lastLocalStorageHash = raw || '';
			if (raw) {
				this.userOverrides = JSON.parse(raw);
				console.log('[AssetConfig] Loaded user overrides from localStorage:', JSON.stringify(this.userOverrides));
			} else {
				console.log('[AssetConfig] No user overrides in localStorage');
			}
		} catch (err) {
			console.warn('[AssetConfig] Invalid localStorage config, ignoring:', err);
		}
	}

	private saveUserOverrides(): void {
		try {
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.userOverrides));
		} catch (err) {
			console.error('[AssetConfig] Failed to save to localStorage:', err);
		}
	}

	private rebuildMergedConfig(): void {
		const userSlots = migrateToSlots(this.userOverrides);
		const serverSlots = migrateToSlots(this.serverConfig) || [...DEFAULT_SLOTS];
		this.mergedConfig = {
			trainSlots: userSlots || serverSlots,
			trackModel: (this.userOverrides as any).trackModel || this.serverConfig.trackModel,
			stationModel: (this.userOverrides as any).stationModel || this.serverConfig.stationModel,
			peopleModels: normalizePeopleModels(
				(this.userOverrides as any).peopleModels
				?? (this.serverConfig as any).peopleModels
				?? DEFAULT_CONFIG.peopleModels,
			),
			crowdLevel: normalizeCrowdLevel(
				(this.userOverrides as any).crowdLevel
				?? (this.serverConfig as any).crowdLevel,
			),
			demandLevel: normalizeDemandLevel(
				(this.userOverrides as any).demandLevel
				?? (this.serverConfig as any).demandLevel,
			),
			sounds: {
				...this.serverConfig.sounds,
				...((this.userOverrides as any).sounds || {}),
			},
		};
		this.notifyListeners();
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.mergedConfig);
			} catch (err) {
				console.error('[AssetConfig] Listener error:', err);
			}
		}
	}

	public setUserConfig(partial: Partial<AssetConfig>): void {
		if (partial.trainSlots !== undefined) {
			(this.userOverrides as any).trainSlots = partial.trainSlots;
			delete (this.userOverrides as any).trainModel;
			delete (this.userOverrides as any).locomotiveModel;
			delete (this.userOverrides as any).carCount;
		}
		if (partial.trackModel !== undefined) {
			(this.userOverrides as any).trackModel = partial.trackModel;
		}
		if (partial.stationModel !== undefined) {
			(this.userOverrides as any).stationModel = partial.stationModel;
		}
		if (partial.peopleModels !== undefined) {
			(this.userOverrides as any).peopleModels = normalizePeopleModels(partial.peopleModels);
		}
		if (partial.crowdLevel !== undefined) {
			(this.userOverrides as any).crowdLevel = normalizeCrowdLevel(partial.crowdLevel);
		}
		if (partial.demandLevel !== undefined) {
			(this.userOverrides as any).demandLevel = normalizeDemandLevel(partial.demandLevel);
		}
		if (partial.sounds) {
			if (!(this.userOverrides as any).sounds) {
				(this.userOverrides as any).sounds = {};
			}
			Object.assign((this.userOverrides as any).sounds, partial.sounds);
		}
		this.saveUserOverrides();
		this.rebuildMergedConfig();
	}

	public async saveAsServerDefault(): Promise<boolean> {
		if (!this.adminToken) {
			console.error('[AssetConfig] Cannot save: not admin');
			return false;
		}

		try {
			const response = await fetch(this.getApiUrl('config') + `?token=${this.adminToken}`, {
				method: 'PUT',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(this.mergedConfig),
			});

			if (!response.ok) {
				const err = await response.json();
				console.error('[AssetConfig] Save failed:', err);
				return false;
			}

			this.serverConfig = {...this.mergedConfig, sounds: {...this.mergedConfig.sounds}};
			console.log('[AssetConfig] Config saved as server default');
			return true;
		} catch (err) {
			console.error('[AssetConfig] Save request failed:', err);
			return false;
		}
	}

	public async uploadAsset(
		file: File,
		category: 'models' | 'sounds',
		subcategory: string,
		displayName: string,
	): Promise<AssetEntry | null> {
		if (!this.adminToken) {
			console.error('[AssetConfig] Cannot upload: not admin');
			return null;
		}

		const formData = new FormData();
		formData.append('file', file);
		formData.append('category', category);
		formData.append('subcategory', subcategory);
		formData.append('name', displayName);

		try {
			const response = await fetch(
				this.getApiUrl('assets/upload') + `?token=${this.adminToken}`,
				{method: 'POST', body: formData},
			);

			if (!response.ok) {
				const err = await response.json();
				console.error('[AssetConfig] Upload failed:', err);
				return null;
			}

			const result = await response.json();
			await this.fetchCatalog();
			console.log('[AssetConfig] Asset uploaded:', result.asset.name);
			return result.asset;
		} catch (err) {
			console.error('[AssetConfig] Upload request failed:', err);
			return null;
		}
	}

	public async deleteAsset(assetId: string): Promise<boolean> {
		if (!this.adminToken) {
			console.error('[AssetConfig] Cannot delete: not admin');
			return false;
		}

		try {
			const response = await fetch(
				this.getApiUrl(`assets/${assetId}`) + `?token=${this.adminToken}`,
				{method: 'DELETE'},
			);

			if (!response.ok) {
				const err = await response.json();
				console.error('[AssetConfig] Delete failed:', err);
				return false;
			}

			await this.fetchCatalog();
			console.log('[AssetConfig] Asset deleted:', assetId);
			return true;
		} catch (err) {
			console.error('[AssetConfig] Delete request failed:', err);
			return false;
		}
	}

	private localStoragePollTimer: number = 0;
	private static readonly LS_POLL_INTERVAL = 2.0;
	private lastLocalStorageHash: string = '';

	public update(deltaTime: number): void {
		this.localStoragePollTimer += deltaTime;
		if (this.localStoragePollTimer >= AssetConfigSystem.LS_POLL_INTERVAL) {
			this.localStoragePollTimer = 0;
			this.checkLocalStorageChanges();
		}
	}

	private checkLocalStorageChanges(): void {
		try {
			const raw = localStorage.getItem(LOCAL_STORAGE_KEY) || '';
			if (raw !== this.lastLocalStorageHash) {
				this.lastLocalStorageHash = raw;
				if (raw) {
					// The raw string changed — apply ALL of it (slots, track,
					// station AND sounds; sound edits used to be silently
					// skipped here and never reached the running game).
					this.userOverrides = JSON.parse(raw);
					this.rebuildMergedConfig();
					console.log('[AssetConfig] Detected localStorage change, config updated');
				}
			}
		} catch (err) {
			console.error('[AssetConfig] Error checking localStorage:', err);
		}
	}
}
