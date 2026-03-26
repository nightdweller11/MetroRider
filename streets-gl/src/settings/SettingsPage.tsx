import React, {useEffect, useState, useCallback, useRef} from 'react';
import './settings.css';
import ModelPreview from './ModelPreview';

interface AssetEntry {
	id: string;
	name: string;
	path: string | null;
	type: string;
	source: string;
}

interface AssetCatalog {
	models: {trains: AssetEntry[]; tracks: AssetEntry[]; stations: AssetEntry[]};
	sounds: Record<string, AssetEntry[]>;
}

interface AssetConfig {
	trainModel: string;
	trackModel: string;
	stationModel: string;
	carCount: number;
	sounds: Record<string, string>;
}

type CategoryId = 'trains' | 'tracks' | 'stations' | 'horn' | 'engine' | 'rail' | 'wind' | 'brake' | 'doorChime' | 'stationChime';

const CATEGORIES: {id: CategoryId; label: string; group: 'models' | 'sounds'; description: string}[] = [
	{id: 'trains', label: 'Train Models', group: 'models', description: 'Choose the 3D model for your train. Procedural models are generated in real-time.'},
	{id: 'tracks', label: 'Track Models', group: 'models', description: 'Select how the railway tracks appear along your route.'},
	{id: 'stations', label: 'Station Models', group: 'models', description: 'Pick the station platform style for stops along the line.'},
	{id: 'horn', label: 'Horn', group: 'sounds', description: 'The horn sound played when you press the horn button.'},
	{id: 'engine', label: 'Engine', group: 'sounds', description: 'Continuous engine / motor hum while the train is moving.'},
	{id: 'rail', label: 'Rail Clatter', group: 'sounds', description: 'The rhythmic clatter of wheels on rail joints.'},
	{id: 'wind', label: 'Wind', group: 'sounds', description: 'Wind noise that intensifies with speed.'},
	{id: 'brake', label: 'Brake', group: 'sounds', description: 'Braking sound effect when decelerating.'},
	{id: 'doorChime', label: 'Door Chime', group: 'sounds', description: 'Chime played when doors open or close at a station.'},
	{id: 'stationChime', label: 'Station Chime', group: 'sounds', description: 'Announcement chime when approaching a station.'},
];

const CONFIG_KEY = 'metrorider-user-config';

function getAdminToken(): string | null {
	const params = new URLSearchParams(window.location.search);
	const urlToken = params.get('admin');
	if (urlToken) {
		try { sessionStorage.setItem('metrorider-admin-token', urlToken); } catch (e) { /* noop */ }
		return urlToken;
	}
	try {
		return sessionStorage.getItem('metrorider-admin-token') || null;
	} catch (e) {
		return null;
	}
}

function promptAndStoreAdminToken(): string | null {
	const token = prompt('Enter admin token to upload assets:');
	if (!token) return null;
	try { sessionStorage.setItem('metrorider-admin-token', token); } catch (e) { /* noop */ }
	return token;
}

function loadUserConfig(): Partial<AssetConfig> {
	try {
		const raw = localStorage.getItem(CONFIG_KEY);
		if (raw) return JSON.parse(raw);
	} catch (e) {
		console.error('[Settings] Failed to read localStorage config:', e);
	}
	return {};
}

function saveUserConfig(config: AssetConfig): void {
	try {
		localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
	} catch (e) {
		console.error('[Settings] Failed to save localStorage config:', e);
	}
}

function getSelectedId(config: AssetConfig, category: CategoryId): string {
	if (category === 'trains') return config.trainModel;
	if (category === 'tracks') return config.trackModel;
	if (category === 'stations') return config.stationModel;
	return config.sounds?.[category] ?? 'procedural';
}

function setSelectedId(config: AssetConfig, category: CategoryId, id: string): AssetConfig {
	const next = {...config, sounds: {...config.sounds}};
	if (category === 'trains') next.trainModel = id;
	else if (category === 'tracks') next.trackModel = id;
	else if (category === 'stations') next.stationModel = id;
	else next.sounds[category] = id;
	return next;
}

function getItems(catalog: AssetCatalog, category: CategoryId): AssetEntry[] {
	const cat = CATEGORIES.find(c => c.id === category);
	if (!cat) return [];
	if (cat.group === 'models') return catalog.models[category as 'trains' | 'tracks' | 'stations'] ?? [];
	return catalog.sounds[category] ?? [];
}

export default function SettingsPage(): React.ReactElement {
	const [catalog, setCatalog] = useState<AssetCatalog | null>(null);
	const [config, setConfig] = useState<AssetConfig | null>(null);
	const [serverConfig, setServerConfig] = useState<AssetConfig | null>(null);
	const [activeCategory, setActiveCategory] = useState<CategoryId>('trains');
	const [error, setError] = useState<string | null>(null);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [playingId, setPlayingId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const [adminToken, setAdminToken] = useState<string | null>(getAdminToken);
	const [tokenVerified, setTokenVerified] = useState<boolean>(false);
	const isUrlAdmin = !!new URLSearchParams(window.location.search).get('admin');
	const uploadRef = useRef<HTMLInputElement>(null);

	useEffect((): void => {
		const initialToken = getAdminToken();
		if (initialToken) {
			fetch(`/api/admin/verify?token=${encodeURIComponent(initialToken)}`)
				.then(r => {
					if (!r.ok) {
						console.warn('[Settings] Stored admin token is invalid, clearing');
						try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
						setAdminToken(null);
						setTokenVerified(false);
					} else {
						setTokenVerified(true);
					}
				})
				.catch(e => console.error('[Settings] Token verification on load failed:', e));
		}
	}, []);

	useEffect((): void => {
		Promise.all([
			fetch('/api/assets/list').then(r => r.json()),
			fetch('/api/config').then(r => r.json()),
		]).then(([catalogData, serverCfg]: [AssetCatalog, AssetConfig]): void => {
			setCatalog(catalogData);
			setServerConfig(serverCfg);
			const userOverrides = loadUserConfig();
			const merged: AssetConfig = {
				trainModel: userOverrides.trainModel ?? serverCfg.trainModel ?? 'procedural-default',
				trackModel: userOverrides.trackModel ?? serverCfg.trackModel ?? 'procedural-default',
				stationModel: userOverrides.stationModel ?? serverCfg.stationModel ?? 'procedural-default',
				carCount: (userOverrides as any).carCount ?? (serverCfg as any).carCount ?? 3,
				sounds: {...(serverCfg.sounds ?? {}), ...(userOverrides.sounds ?? {})},
			};
			setConfig(merged);
		}).catch((e: Error): void => {
			console.error('[Settings] Failed to load data:', e);
			setError('Failed to load settings data. Is the server running?');
		});
	}, []);

	const handleSelect = useCallback((category: CategoryId, id: string): void => {
		if (!config) return;
		const next = setSelectedId(config, category, id);
		setConfig(next);
		saveUserConfig(next);
		flash('Selection saved');
	}, [config]);

	const flash = useCallback((msg: string): void => {
		setStatusMsg(msg);
		setTimeout((): void => setStatusMsg(null), 2000);
	}, []);

	const handlePlaySound = useCallback((entry: AssetEntry): void => {
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current.currentTime = 0;
			audioRef.current = null;
		}
		setPlayingId(prev => {
			if (prev === entry.id) return null;

			if (!entry.path) {
				flash('Procedural sounds cannot be previewed');
				return null;
			}

			const url = `/data/assets/${entry.path}`;
			console.log(`[Settings] Playing sound: ${url}`);
			const audio = new Audio(url);
			audio.addEventListener('ended', (): void => {
				setPlayingId(null);
				audioRef.current = null;
			});
			audio.addEventListener('error', (e: Event): void => {
				const target = e.target as HTMLAudioElement;
				console.error(`[Settings] Audio error for ${url}: code=${target?.error?.code} msg=${target?.error?.message}`);
				flash(`Audio failed: ${target?.error?.message || 'unknown error'}`);
				setPlayingId(null);
				audioRef.current = null;
			});
			audio.play().catch((e: Error): void => {
				console.error(`[Settings] Audio play() rejected for ${url}:`, e.message);
				flash(`Cannot play: ${e.message}`);
				setPlayingId(null);
				audioRef.current = null;
			});
			audioRef.current = audio;
			return entry.id;
		});
	}, [flash]);

	const verifyTokenWithServer = useCallback(async (token: string): Promise<boolean> => {
		try {
			const resp = await fetch(`/api/admin/verify?token=${encodeURIComponent(token)}`);
			return resp.ok;
		} catch (e) {
			console.error('[Settings] Token verification failed:', e);
			return false;
		}
	}, []);

	const ensureAdminToken = useCallback(async (): Promise<string | null> => {
		if (adminToken && tokenVerified) return adminToken;

		const tokenToCheck = adminToken || promptAndStoreAdminToken();
		if (!tokenToCheck) return null;

		const valid = await verifyTokenWithServer(tokenToCheck);
		if (!valid) {
			try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
			setAdminToken(null);
			setTokenVerified(false);
			flash('Invalid admin token');
			return null;
		}

		setAdminToken(tokenToCheck);
		setTokenVerified(true);
		return tokenToCheck;
	}, [adminToken, tokenVerified, verifyTokenWithServer]);

	const handleSaveAsDefault = useCallback(async (): Promise<void> => {
		if (!config || !adminToken) return;
		try {
			const resp = await fetch(`/api/config?token=${adminToken}`, {
				method: 'PUT',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(config),
			});
			if (resp.ok) flash('Saved as server default');
			else flash(`Save failed: ${resp.status}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error('[Settings] Save default failed:', msg);
			flash('Save failed');
		}
	}, [config, adminToken]);

	const handleUploadClick = useCallback(async (): Promise<void> => {
		const token = await ensureAdminToken();
		if (!token) {
			flash('Upload cancelled — no admin token provided');
			return;
		}
		if (uploadRef.current) {
			uploadRef.current.click();
		}
	}, [ensureAdminToken]);

	const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
		const file = e.target.files?.[0];
		if (!file) return;

		const token = adminToken;
		if (!token) {
			flash('No admin token available');
			if (uploadRef.current) uploadRef.current.value = '';
			return;
		}

		const activeCat = CATEGORIES.find(c => c.id === activeCategory);
		if (!activeCat) return;

		const formData = new FormData();
		formData.append('file', file);
		formData.append('category', activeCat.group);
		formData.append('subcategory', activeCategory);
		formData.append('name', file.name.replace(/\.[^.]+$/, ''));
		formData.append('source', 'User Upload');

		try {
			const resp = await fetch(`/api/assets/upload?token=${token}`, {
				method: 'POST',
				body: formData,
			});
			if (resp.ok) {
				flash('Upload successful. Reloading...');
				setTimeout((): void => window.location.reload(), 500);
			} else if (resp.status === 401 || resp.status === 403) {
				try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
				setAdminToken(null);
				flash('Invalid admin token. Please try again.');
			} else {
				flash(`Upload failed: ${resp.status}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[Settings] Upload failed:', msg);
			flash('Upload failed');
		}
		if (uploadRef.current) uploadRef.current.value = '';
	}, [activeCategory, adminToken]);

	const handleDelete = useCallback(async (entry: AssetEntry): Promise<void> => {
		const token = await ensureAdminToken();
		if (!token) {
			flash('Delete cancelled — no admin token provided');
			return;
		}
		if (!confirm(`Delete "${entry.name}"?`)) return;
		try {
			const resp = await fetch(`/api/assets/${entry.id}?token=${token}`, {method: 'DELETE'});
			if (resp.ok) {
				flash('Deleted. Reloading...');
				setTimeout((): void => window.location.reload(), 500);
			} else if (resp.status === 401 || resp.status === 403) {
				try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
				setAdminToken(null);
				flash('Invalid admin token. Please try again.');
			} else {
				const body = await resp.json().catch((): {error: string} => ({error: `HTTP ${resp.status}`}));
				flash(`Delete failed: ${body.error ?? resp.status}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[Settings] Delete failed:', msg);
			flash('Delete failed');
		}
	}, [ensureAdminToken]);

	if (error) {
		return <div className="settings-page"><div className="settings-error">{error}</div></div>;
	}
	if (!catalog || !config) {
		return <div className="settings-page"><div className="settings-loading">Loading settings...</div></div>;
	}

	const activeCat = CATEGORIES.find(c => c.id === activeCategory);
	const items = getItems(catalog, activeCategory);
	const selectedId = getSelectedId(config, activeCategory);
	const isModelCategory = activeCat?.group === 'models';

	return (
		<div className="settings-page">
			<header className="settings-header">
				<a href="/" className="settings-back">← Back to Game</a>
				<h1>MetroRider Settings</h1>
				{isUrlAdmin && (
					<div className="settings-admin-bar">
						<span className="admin-badge">ADMIN</span>
						<button className="btn btn-primary" onClick={handleSaveAsDefault}>Save as Server Default</button>
					</div>
				)}
			</header>

			{statusMsg && <div className="settings-toast">{statusMsg}</div>}

			<div className="settings-body">
				<nav className="settings-sidebar">
					<h3>Models</h3>
					{CATEGORIES.filter(c => c.group === 'models').map(cat => (
						<button
							key={cat.id}
							className={`sidebar-item ${cat.id === activeCategory ? 'active' : ''}`}
							onClick={(): void => setActiveCategory(cat.id)}
						>
							{cat.label}
						</button>
					))}
					<h3>Sounds</h3>
					{CATEGORIES.filter(c => c.group === 'sounds').map(cat => (
						<button
							key={cat.id}
							className={`sidebar-item ${cat.id === activeCategory ? 'active' : ''}`}
							onClick={(): void => setActiveCategory(cat.id)}
						>
							{cat.label}
						</button>
					))}
				</nav>

				<main className="settings-content">
					<h2>{activeCat?.label ?? ''}</h2>
					<p className="category-description">{activeCat?.description ?? ''}</p>

					<div className="upload-bar">
						<button className="btn btn-secondary" onClick={handleUploadClick}>
							Upload {isModelCategory ? 'Model' : 'Sound'}
						</button>
						<input
							ref={uploadRef}
							type="file"
							accept={isModelCategory ? '.glb,.gltf' : '.mp3,.wav,.ogg'}
							onChange={handleUpload}
							style={{display: 'none'}}
						/>
					</div>

					{activeCategory === 'trains' && config && (
						<div className="car-count-control">
							<label>Number of Cars: </label>
							<select
								value={config.carCount}
								onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
									const next = {...config, sounds: {...config.sounds}, carCount: parseInt(e.target.value, 10)};
									setConfig(next);
									saveUserConfig(next);
									flash('Car count updated');
								}}
							>
								{[1, 2, 3, 4, 5, 6, 8].map(n => (
									<option key={n} value={n}>{n} {n === 1 ? 'car' : 'cars'}</option>
								))}
							</select>
						</div>
					)}

					<div className="asset-grid">
						{items.map(entry => {
							const isSelected = entry.id === selectedId;
							return (
								<div
									key={entry.id}
									className={`asset-card ${isSelected ? 'selected' : ''}`}
									onClick={(): void => handleSelect(activeCategory, entry.id)}
								>
									{isModelCategory && entry.path ? (
										<div className="asset-preview">
											<ModelPreview modelPath={`/data/assets/${entry.path}`} />
										</div>
									) : isModelCategory ? (
										<div className="asset-preview procedural-preview">
											<span>Procedural</span>
										</div>
									) : (
										<div className="asset-preview sound-preview">
											<button
												className={`play-btn ${playingId === entry.id ? 'playing' : ''}`}
												onClick={(ev: React.MouseEvent): void => {
													ev.stopPropagation();
													handlePlaySound(entry);
												}}
											>
												{playingId === entry.id ? '■' : '▶'}
											</button>
										</div>
									)}

									<div className="asset-info">
										<div className="asset-name">{entry.name}</div>
										<div className="asset-source">{entry.source}</div>
										{isSelected && <div className="asset-selected-badge">Selected</div>}
									</div>

									{entry.type !== 'procedural' && (
										<button
											className="delete-btn"
											onClick={(ev: React.MouseEvent): void => {
												ev.stopPropagation();
												handleDelete(entry);
											}}
											title="Delete (requires admin token)"
										>
											✕
										</button>
									)}
								</div>
							);
						})}
					</div>
				</main>
			</div>
		</div>
	);
}
