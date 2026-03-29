import React, {useEffect, useState, useCallback, useRef} from 'react';
import './settings.css';
import ModelPreview from './ModelPreview';
import SketchfabPanel from './SketchfabPanel';
import FreesoundPanel from './FreesoundPanel';
import TrainComposer from './TrainComposer';

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
	trainSlots: string[];
	trackModel: string;
	stationModel: string;
	sounds: Record<string, string>;
}

type CategoryId = 'trains' | 'tracks' | 'stations' | 'horn' | 'engine' | 'rail' | 'wind' | 'brake' | 'doorChime' | 'stationChime' | 'sketchfab' | 'freesound';

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
	if (category === 'tracks') return config.trackModel;
	if (category === 'stations') return config.stationModel;
	return config.sounds?.[category] ?? 'procedural';
}

function setSelectedId(config: AssetConfig, category: CategoryId, id: string): AssetConfig {
	const next = {...config, sounds: {...config.sounds}};
	if (category === 'tracks') next.trackModel = id;
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

async function verifyToken(token: string): Promise<boolean> {
	try {
		const resp = await fetch(`/api/admin/verify?token=${encodeURIComponent(token)}`);
		return resp.ok;
	} catch (e) {
		console.error('[Settings] Token verification failed:', e);
		return false;
	}
}

async function pushConfigToServer(config: AssetConfig, token: string): Promise<boolean> {
	try {
		const resp = await fetch(`/api/config?token=${token}`, {
			method: 'PUT',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify(config),
		});
		return resp.ok;
	} catch (e) {
		console.error('[Settings] Failed to push config to server:', e);
		return false;
	}
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

	const [adminMode, setAdminMode] = useState<boolean>(false);
	const [adminToken, setAdminToken] = useState<string | null>(getAdminToken);
	const [tokenVerified, setTokenVerified] = useState<boolean>(false);
	const uploadRef = useRef<HTMLInputElement>(null);
	const [assetFilter, setAssetFilter] = useState<string>('');
	const [reassigningId, setReassigningId] = useState<string | null>(null);

	useEffect((): void => {
		const initialToken = getAdminToken();
		if (initialToken) {
			verifyToken(initialToken).then(valid => {
				if (!valid) {
					try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
					setAdminToken(null);
					setTokenVerified(false);
				} else {
					setTokenVerified(true);
					const isUrlAdmin = !!new URLSearchParams(window.location.search).get('admin');
					if (isUrlAdmin) setAdminMode(true);
				}
			}).catch(e => console.error('[Settings] Token verification on load failed:', e));
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
			const defaultSlots = ['procedural-default', 'procedural-default', 'procedural-default'];
			const migrateSlots = (raw: any): string[] => {
				if (Array.isArray(raw.trainSlots) && raw.trainSlots.length > 0) return raw.trainSlots;
				if (raw.trainModel || raw.locomotiveModel || raw.carCount) {
					const car = raw.trainModel || 'procedural-default';
					const loco = raw.locomotiveModel || 'procedural-default';
					const count = raw.carCount ?? 3;
					if (loco !== 'procedural-default' && loco !== car) return [loco, ...Array(count).fill(car)];
					return Array(count).fill(car);
				}
				return defaultSlots;
			};
			const serverSlots = migrateSlots(serverCfg);
			const userSlots = (userOverrides as any).trainSlots || (userOverrides as any).trainModel ? migrateSlots(userOverrides) : null;
			const merged: AssetConfig = {
				trainSlots: userSlots || serverSlots,
				trackModel: userOverrides.trackModel ?? serverCfg.trackModel ?? 'procedural-default',
				stationModel: userOverrides.stationModel ?? serverCfg.stationModel ?? 'procedural-default',
				sounds: {...(serverCfg.sounds ?? {}), ...(userOverrides.sounds ?? {})},
			};
			setConfig(merged);
		}).catch((e: Error): void => {
			console.error('[Settings] Failed to load data:', e);
			setError('Failed to load settings data. Is the server running?');
		});
	}, []);

	const flash = useCallback((msg: string): void => {
		setStatusMsg(msg);
		setTimeout((): void => setStatusMsg(null), 2500);
	}, []);

	const refreshCatalog = useCallback((): void => {
		fetch('/api/assets/list')
			.then(r => r.json())
			.then((catalogData: AssetCatalog) => {
				setCatalog(catalogData);
				console.log('[Settings] Catalog refreshed after import');
			})
			.catch((e: Error) => {
				console.error('[Settings] Failed to refresh catalog:', e);
			});
	}, []);

	const handleSketchfabImport = useCallback((category: 'stations' | 'trains' | 'tracks', modelId: string): void => {
		refreshCatalog();
		if (!config) return;

		let next: AssetConfig;
		if (category === 'trains') {
			const newSlots = [...config.trainSlots];
			newSlots[0] = modelId;
			next = {...config, sounds: {...config.sounds}, trainSlots: newSlots};
		} else {
			const categoryMap: Record<string, CategoryId> = {stations: 'stations', tracks: 'tracks'};
			const targetCategory = categoryMap[category];
			if (!targetCategory) return;
			next = setSelectedId(config, targetCategory, modelId);
		}

		setConfig(next);
		saveUserConfig(next);

		if (adminMode && adminToken && tokenVerified) {
			pushConfigToServer(next, adminToken).then(ok => {
				flash(ok
					? `Imported and set as default ${category.slice(0, -1)} model for all users`
					: `Imported and saved locally, but server update failed`
				);
			});
		} else {
			flash(`Imported and selected as active ${category.slice(0, -1)} model`);
		}
		const targetCat: CategoryId = category === 'trains' ? 'trains' : category === 'stations' ? 'stations' : 'tracks';
		setActiveCategory(targetCat);
	}, [config, adminMode, adminToken, tokenVerified, flash, refreshCatalog]);

	const handleFreesoundImport = useCallback((category: string, soundId: string): void => {
		refreshCatalog();
		if (!config) return;

		const next = setSelectedId(config, category as CategoryId, soundId);
		setConfig(next);
		saveUserConfig(next);

		if (adminMode && adminToken && tokenVerified) {
			pushConfigToServer(next, adminToken).then(ok => {
				flash(ok
					? `Imported and set as default ${category} sound for all users`
					: `Imported and saved locally, but server update failed`
				);
			});
		} else {
			flash(`Imported and selected as active ${category} sound`);
		}
		setActiveCategory(category as CategoryId);
	}, [config, adminMode, adminToken, tokenVerified, flash, refreshCatalog]);

	const handleSelect = useCallback((category: CategoryId, id: string): void => {
		if (!config) return;
		const next = setSelectedId(config, category, id);
		setConfig(next);
		saveUserConfig(next);

		if (adminMode && adminToken && tokenVerified) {
			pushConfigToServer(next, adminToken).then(ok => {
				flash(ok ? 'Set as default for all users' : 'Saved locally, but server update failed');
			});
		} else {
			flash('Selection saved');
		}
	}, [config, adminMode, adminToken, tokenVerified, flash]);

	const handleSlotsChange = useCallback((newSlots: string[]): void => {
		if (!config) return;
		const next: AssetConfig = {...config, sounds: {...config.sounds}, trainSlots: newSlots};
		setConfig(next);
		saveUserConfig(next);

		if (adminMode && adminToken && tokenVerified) {
			pushConfigToServer(next, adminToken).then(ok => {
				flash(ok ? 'Train composition set as default for all users' : 'Saved locally, but server update failed');
			});
		} else {
			flash('Train composition updated');
		}
	}, [config, adminMode, adminToken, tokenVerified, flash]);

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

	const handleAdminToggle = useCallback(async (): Promise<void> => {
		if (adminMode) {
			setAdminMode(false);
			flash('Admin mode disabled');
			return;
		}

		let token = adminToken;
		if (!token || !tokenVerified) {
			token = prompt('Enter admin token:');
			if (!token) return;

			const valid = await verifyToken(token);
			if (!valid) {
				flash('Invalid admin token');
				return;
			}

			try { sessionStorage.setItem('metrorider-admin-token', token); } catch (_e) { /* noop */ }
			setAdminToken(token);
			setTokenVerified(true);
		}

		setAdminMode(true);
		flash('Admin mode enabled — selections now apply to all users');
	}, [adminMode, adminToken, tokenVerified, flash]);

	const handleUploadClick = useCallback(async (): Promise<void> => {
		let token = adminToken;
		if (!token || !tokenVerified) {
			token = prompt('Enter admin token to upload assets:');
			if (!token) return;

			const valid = await verifyToken(token);
			if (!valid) {
				flash('Invalid admin token');
				return;
			}

			try { sessionStorage.setItem('metrorider-admin-token', token); } catch (_e) { /* noop */ }
			setAdminToken(token);
			setTokenVerified(true);
		}
		if (uploadRef.current) {
			uploadRef.current.click();
		}
	}, [adminToken, tokenVerified, flash]);

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
				setTokenVerified(false);
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
	}, [activeCategory, adminToken, flash]);

	const handleDelete = useCallback(async (entry: AssetEntry): Promise<void> => {
		let token = adminToken;
		if (!token || !tokenVerified) {
			token = prompt('Enter admin token to delete assets:');
			if (!token) return;

			const valid = await verifyToken(token);
			if (!valid) {
				flash('Invalid admin token');
				return;
			}
			try { sessionStorage.setItem('metrorider-admin-token', token); } catch (_e) { /* noop */ }
			setAdminToken(token);
			setTokenVerified(true);
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
				setTokenVerified(false);
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
	}, [adminToken, tokenVerified, flash]);

	const handleReassign = useCallback(async (entry: AssetEntry, targetSub: string): Promise<void> => {
		setReassigningId(null);
		let token = adminToken;
		if (!token || !tokenVerified) {
			token = prompt('Enter admin token to reassign assets:');
			if (!token) return;
			const valid = await verifyToken(token);
			if (!valid) {
				flash('Invalid admin token');
				return;
			}
			try { sessionStorage.setItem('metrorider-admin-token', token); } catch (_e) { /* noop */ }
			setAdminToken(token);
			setTokenVerified(true);
		}
		try {
			const resp = await fetch(`/api/assets/reassign?token=${token}`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({assetId: entry.id, toCategory: targetSub}),
			});
			if (resp.ok) {
				flash(`Moved "${entry.name}" to ${targetSub}`);
				refreshCatalog();
			} else if (resp.status === 401 || resp.status === 403) {
				try { sessionStorage.removeItem('metrorider-admin-token'); } catch (_e) { /* noop */ }
				setAdminToken(null);
				setTokenVerified(false);
				flash('Invalid admin token. Please try again.');
			} else {
				const body = await resp.json().catch((): {error: string} => ({error: `HTTP ${resp.status}`}));
				flash(`Reassign failed: ${body.error ?? resp.status}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[Settings] Reassign failed:', msg);
			flash('Reassign failed');
		}
	}, [adminToken, tokenVerified, flash, refreshCatalog]);

	if (error) {
		return <div className="settings-page"><div className="settings-error">{error}</div></div>;
	}
	if (!catalog || !config) {
		return <div className="settings-page"><div className="settings-loading">Loading settings...</div></div>;
	}

	const activeCat = CATEGORIES.find(c => c.id === activeCategory);
	const allItems = getItems(catalog, activeCategory);
	const filterLower = assetFilter.toLowerCase().trim();
	const items = filterLower
		? allItems.filter(e => e.name.toLowerCase().includes(filterLower) || e.source.toLowerCase().includes(filterLower))
		: allItems;
	const selectedId = getSelectedId(config, activeCategory);
	const isModelCategory = activeCat?.group === 'models';

	return (
		<div className={`settings-page ${adminMode ? 'admin-active' : ''}`}>
			<header className="settings-header">
				<a href="/" className="settings-back">&larr; Back to Game</a>
				<h1>MetroRider Settings</h1>
				<div className="settings-header-actions">
					<button
						className={`btn ${adminMode ? 'btn-admin-on' : 'btn-admin-off'}`}
						onClick={handleAdminToggle}
						title={adminMode ? 'Click to exit admin mode' : 'Enter admin mode to set defaults for all users'}
					>
						{adminMode ? 'ADMIN MODE ON' : 'Admin Mode'}
					</button>
				</div>
			</header>

			{adminMode && (
				<div className="admin-banner">
					Selections in this mode are saved as defaults for <strong>all users</strong>.
				</div>
			)}

			{statusMsg && <div className="settings-toast">{statusMsg}</div>}

			<div className="settings-body">
				<nav className="settings-sidebar">
					<h3>Models</h3>
					{CATEGORIES.filter(c => c.group === 'models').map(cat => (
						<button
							key={cat.id}
							className={`sidebar-item ${cat.id === activeCategory ? 'active' : ''}`}
							onClick={(): void => { setActiveCategory(cat.id); setAssetFilter(''); }}
						>
							{cat.label}
						</button>
					))}
					<h3>Sounds</h3>
					{CATEGORIES.filter(c => c.group === 'sounds').map(cat => (
						<button
							key={cat.id}
							className={`sidebar-item ${cat.id === activeCategory ? 'active' : ''}`}
							onClick={(): void => { setActiveCategory(cat.id); setAssetFilter(''); }}
						>
							{cat.label}
						</button>
					))}
					{adminMode && (
						<>
							<h3>Admin</h3>
							<button
								className={`sidebar-item ${activeCategory === 'sketchfab' ? 'active' : ''}`}
								onClick={(): void => { setActiveCategory('sketchfab'); setAssetFilter(''); }}
							>
								Sketchfab Browser
							</button>
							<button
								className={`sidebar-item ${activeCategory === 'freesound' ? 'active' : ''}`}
								onClick={(): void => { setActiveCategory('freesound'); setAssetFilter(''); }}
							>
								Freesound Browser
							</button>
						</>
					)}
				</nav>

				<main className="settings-content">
					{activeCategory === 'sketchfab' && adminMode && adminToken ? (
						<SketchfabPanel
							adminToken={adminToken}
							onModelImported={handleSketchfabImport}
							onImportComplete={refreshCatalog}
						/>
					) : activeCategory === 'freesound' && adminMode && adminToken ? (
						<FreesoundPanel
							adminToken={adminToken}
							onSoundImported={handleFreesoundImport}
							onImportComplete={refreshCatalog}
						/>
					) : (
						<>
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

							{allItems.length > 4 && (
								<div className="asset-filter-bar">
									<input
										type="text"
										value={assetFilter}
										onChange={e => setAssetFilter(e.target.value)}
										placeholder={`Filter ${activeCat?.label ?? 'assets'} by name...`}
										className="asset-filter-input"
									/>
									{assetFilter && (
										<button className="asset-filter-clear" onClick={() => setAssetFilter('')}>
											&times;
										</button>
									)}
									{filterLower && (
										<span className="asset-filter-count">
											{items.length} of {allItems.length}
										</span>
									)}
								</div>
							)}

							{activeCategory === 'trains' && config ? (
								<TrainComposer
									slots={config.trainSlots}
									trainModels={allItems}
									onSlotsChange={handleSlotsChange}
									onDelete={handleDelete}
									onReassign={(entry, targetSub) => handleReassign(entry, targetSub)}
									adminMode={adminMode}
								/>
							) : (
								<div className="asset-grid">
									{items.map(entry => {
										const isSelected = entry.id === selectedId;
										const isServerDefault = serverConfig && getSelectedId(serverConfig, activeCategory) === entry.id;
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
															{playingId === entry.id ? '\u25A0' : '\u25B6'}
														</button>
													</div>
												)}

												<div className="asset-info">
													<div className="asset-name">{entry.name}</div>
													<div className="asset-source">{entry.source}</div>
													{isSelected && <div className="asset-selected-badge">Selected</div>}
													{isServerDefault && !isSelected && <div className="asset-default-badge">Server Default</div>}
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
														&#x2715;
													</button>
												)}

												{entry.type !== 'procedural' && adminMode && (
													<div className="reassign-wrapper">
														<button
															className="reassign-btn"
															onClick={(ev: React.MouseEvent): void => {
																ev.stopPropagation();
																setReassigningId(reassigningId === entry.id ? null : entry.id);
															}}
															title="Move to another category"
														>
															&#x21C4;
														</button>
														{reassigningId === entry.id && (
															<div className="reassign-menu" onClick={(ev) => ev.stopPropagation()}>
																<div className="reassign-menu-title">Move to:</div>
																{CATEGORIES
																	.filter(c => c.group === activeCat?.group && c.id !== activeCategory)
																	.map(c => {
																		const subFolder = isModelCategory
																			? c.id
																			: (c.id === 'horn' ? 'horns' : c.id);
																		return (
																			<button
																				key={c.id}
																				className="reassign-menu-item"
																				onClick={() => handleReassign(entry, subFolder)}
																			>
																				{c.label}
																			</button>
																		);
																	})}
															</div>
														)}
													</div>
												)}
											</div>
										);
									})}
								</div>
							)}
						</>
					)}
				</main>
			</div>
		</div>
	);
}
