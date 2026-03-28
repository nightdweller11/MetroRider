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

export interface AssetConfig {
	trainModel: string;
	locomotiveModel: string;
	trackModel: string;
	stationModel: string;
	carCount: number;
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
const DEFAULT_CONFIG: AssetConfig = {
	trainModel: 'procedural-default',
	locomotiveModel: 'procedural-default',
	trackModel: 'procedural-default',
	stationModel: 'station-platform-basic',
	carCount: 3,
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
		this.mergedConfig = {
			trainModel: (this.userOverrides as any).trainModel || this.serverConfig.trainModel,
			locomotiveModel: (this.userOverrides as any).locomotiveModel || this.serverConfig.locomotiveModel || 'procedural-default',
			trackModel: (this.userOverrides as any).trackModel || this.serverConfig.trackModel,
			stationModel: (this.userOverrides as any).stationModel || this.serverConfig.stationModel,
			carCount: (this.userOverrides as any).carCount ?? this.serverConfig.carCount ?? 3,
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
		if (partial.trainModel !== undefined) {
			(this.userOverrides as any).trainModel = partial.trainModel;
		}
		if (partial.locomotiveModel !== undefined) {
			(this.userOverrides as any).locomotiveModel = partial.locomotiveModel;
		}
		if (partial.trackModel !== undefined) {
			(this.userOverrides as any).trackModel = partial.trackModel;
		}
		if (partial.stationModel !== undefined) {
			(this.userOverrides as any).stationModel = partial.stationModel;
		}
		if (partial.carCount !== undefined) {
			(this.userOverrides as any).carCount = partial.carCount;
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
					const parsed = JSON.parse(raw);
					const changed =
						(parsed.trainModel && parsed.trainModel !== (this.userOverrides as any).trainModel) ||
						(parsed.locomotiveModel && parsed.locomotiveModel !== (this.userOverrides as any).locomotiveModel) ||
						(parsed.trackModel && parsed.trackModel !== (this.userOverrides as any).trackModel) ||
						(parsed.stationModel && parsed.stationModel !== (this.userOverrides as any).stationModel);

					if (changed) {
						this.userOverrides = parsed;
						this.rebuildMergedConfig();
						console.log('[AssetConfig] Detected localStorage change, config updated:', JSON.stringify(this.mergedConfig));
					}
				}
			}
		} catch (err) {
			console.error('[AssetConfig] Error checking localStorage:', err);
		}
	}
}
