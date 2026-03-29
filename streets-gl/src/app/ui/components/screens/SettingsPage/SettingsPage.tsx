import React, {useEffect, useState, useRef, useCallback} from 'react';
import './SettingsPage.scss';
import ModelPreview from '~/settings/ModelPreview';

export interface SettingsPageProps {
	visible: boolean;
	onClose: () => void;
}

interface AssetEntry {
	id: string;
	name: string;
	path: string | null;
	type: string;
	source: string;
	uploaded?: boolean;
}

interface AssetConfig {
	trainSlots: string[];
	trackModel: string;
	stationModel: string;
	sounds: Record<string, string>;
}

interface AssetCatalog {
	models: Record<string, AssetEntry[]>;
	sounds: Record<string, AssetEntry[]>;
}

type Category = 'trains' | 'tracks' | 'stations' | 'horn' | 'engine' | 'rail' | 'wind' | 'brake' | 'doorChime' | 'stationChime';

const MODEL_CATEGORIES: {key: string; label: string; configKey: keyof AssetConfig | null}[] = [
	{key: 'trains', label: 'Train Models', configKey: null},
	{key: 'tracks', label: 'Track Models', configKey: 'trackModel'},
	{key: 'stations', label: 'Station Models', configKey: 'stationModel'},
];

const SOUND_CATEGORIES: {key: string; label: string}[] = [
	{key: 'horn', label: 'Horn'},
	{key: 'engine', label: 'Engine'},
	{key: 'rail', label: 'Rail Clatter'},
	{key: 'wind', label: 'Wind'},
	{key: 'brake', label: 'Brake'},
	{key: 'doorChime', label: 'Door Chime'},
	{key: 'stationChime', label: 'Station Chime'},
];

function getAssetConfigSystem(): any {
	return (window as any).__assetConfigSystem;
}

const SettingsPage: React.FC<SettingsPageProps> = ({visible, onClose}) => {
	const [activeCategory, setActiveCategory] = useState<string>('trains');
	const [catalog, setCatalog] = useState<AssetCatalog | null>(null);
	const [config, setConfig] = useState<AssetConfig | null>(null);
	const [isAdmin, setIsAdmin] = useState(false);
	const [saving, setSaving] = useState(false);
	const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const loadData = useCallback(() => {
		const sys = getAssetConfigSystem();
		if (!sys) return;

		setIsAdmin(sys.isAdmin());
		const cfg = sys.getConfig();
		setConfig({...cfg, sounds: {...cfg.sounds}});

		const cat = sys.getCatalog();
		if (cat) {
			setCatalog(cat);
		}
	}, []);

	useEffect(() => {
		if (visible) {
			loadData();
		}
		return () => {
			if (previewAudio) {
				previewAudio.pause();
				setPreviewAudio(null);
			}
		};
	}, [visible, loadData]);

	if (!visible) return null;

	const isModelCategory = MODEL_CATEGORIES.some(c => c.key === activeCategory);

	const getItems = (): AssetEntry[] => {
		if (!catalog) return [];
		if (isModelCategory) {
			return catalog.models[activeCategory] || [];
		}
		return catalog.sounds[activeCategory] || [];
	};

	const getSelectedId = (): string => {
		if (!config) return '';
		if (activeCategory === 'trains') {
			return config.trainSlots?.[0] || 'procedural-default';
		}
		if (isModelCategory) {
			const mc = MODEL_CATEGORIES.find(c => c.key === activeCategory);
			return mc?.configKey ? (config as any)[mc.configKey] : '';
		}
		return config.sounds[activeCategory] || '';
	};

	const handleSelect = (assetId: string): void => {
		const sys = getAssetConfigSystem();
		if (!sys) return;

		if (activeCategory === 'trains') {
			const currentSlots = config?.trainSlots || ['procedural-default', 'procedural-default', 'procedural-default'];
			const newSlots = currentSlots.map(() => assetId);
			sys.setUserConfig({trainSlots: newSlots});
		} else if (isModelCategory) {
			const mc = MODEL_CATEGORIES.find(c => c.key === activeCategory);
			if (mc?.configKey) {
				sys.setUserConfig({[mc.configKey]: assetId});
			}
		} else {
			sys.setUserConfig({sounds: {[activeCategory]: assetId}});
		}
		const cfg = sys.getConfig();
		setConfig({...cfg, sounds: {...cfg.sounds}});
	};

	const handleSaveDefault = async (): Promise<void> => {
		const sys = getAssetConfigSystem();
		if (!sys) return;
		setSaving(true);
		try {
			await sys.saveAsServerDefault();
		} catch (err) {
			console.error('[Settings] Failed to save default:', err);
		}
		setSaving(false);
	};

	const handleUpload = (): void => {
		fileInputRef.current?.click();
	};

	const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
		const file = e.target.files?.[0];
		if (!file) return;

		const sys = getAssetConfigSystem();
		if (!sys) return;

		const category = isModelCategory ? 'models' : 'sounds';
		const displayName = file.name.replace(/\.[^.]+$/, '');

		try {
			await sys.uploadAsset(file, category, activeCategory, displayName);
			loadData();
		} catch (err) {
			console.error('[Settings] Upload failed:', err);
		}

		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	};

	const handleDelete = async (assetId: string): Promise<void> => {
		const sys = getAssetConfigSystem();
		if (!sys) return;
		if (!confirm('Delete this asset?')) return;

		try {
			await sys.deleteAsset(assetId);
			loadData();
		} catch (err) {
			console.error('[Settings] Delete failed:', err);
		}
	};

	const handlePreviewSound = (asset: AssetEntry): void => {
		if (previewAudio) {
			previewAudio.pause();
			setPreviewAudio(null);
		}

		if (!asset.path) return;

		const sys = getAssetConfigSystem();
		if (!sys) return;

		const url = sys.getAssetUrl(asset.path);
		const audio = new Audio(url);
		audio.play().catch((err: Error) => console.error('[Settings] Audio preview error:', err.message));
		setPreviewAudio(audio);
	};

	const items = getItems();
	const selectedId = getSelectedId();

	return (
		<div className="settings-overlay" onClick={(e): void => {
			if (e.target === e.currentTarget) onClose();
		}}>
			<div className="settings-container">
				<div className="settings-header">
					<h1>Game Settings</h1>
					<div className="settings-header-actions">
						{isAdmin && (
							<button
								className="settings-btn admin-save"
								onClick={handleSaveDefault}
								disabled={saving}
							>
								{saving ? 'Saving...' : 'Save as Default'}
							</button>
						)}
						<button className="settings-btn close" onClick={onClose}>
							Back to Game
						</button>
					</div>
				</div>

				<div className="settings-body">
					<div className="settings-sidebar">
						<h3>Models</h3>
						{MODEL_CATEGORIES.map(cat => (
							<button
								key={cat.key}
								className={`sidebar-item ${activeCategory === cat.key ? 'active' : ''}`}
								onClick={(): void => setActiveCategory(cat.key)}
							>
								{cat.label}
							</button>
						))}
						<h3>Sounds</h3>
						{SOUND_CATEGORIES.map(cat => (
							<button
								key={cat.key}
								className={`sidebar-item ${activeCategory === cat.key ? 'active' : ''}`}
								onClick={(): void => setActiveCategory(cat.key)}
							>
								{cat.label}
							</button>
						))}
					</div>

					<div className="settings-main">
						<div className="settings-main-header">
							<h2>
								{MODEL_CATEGORIES.find(c => c.key === activeCategory)?.label
									|| SOUND_CATEGORIES.find(c => c.key === activeCategory)?.label
									|| activeCategory}
							</h2>
							{isAdmin && (
								<button className="settings-btn upload" onClick={handleUpload}>
									Upload {isModelCategory ? 'Model' : 'Sound'}
								</button>
							)}
							<input
								ref={fileInputRef}
								type="file"
								style={{display: 'none'}}
								accept={isModelCategory ? '.glb,.gltf' : '.mp3,.ogg,.wav'}
								onChange={handleFileSelected}
							/>
						</div>

						<div className="asset-grid">
							{items.map(asset => (
								<div
									key={asset.id}
									className={`asset-card ${selectedId === asset.id ? 'selected' : ''}`}
									onClick={(): void => handleSelect(asset.id)}
								>
									<div className="asset-preview">
										{asset.type === 'procedural' ? (
											<div className="procedural-preview">
												<span>Procedural</span>
											</div>
										) : isModelCategory && asset.path ? (
											<ModelPreview modelPath={`/data/assets/${asset.path}`} />
										) : !isModelCategory ? (
											<div className="sound-preview">
												<button
													className="play-btn"
													onClick={(e): void => {
														e.stopPropagation();
														handlePreviewSound(asset);
													}}
												>
													&#9654; Play
												</button>
											</div>
										) : (
											<div className="procedural-preview">
												<span>No preview</span>
											</div>
										)}
									</div>
									<div className="asset-info">
										<span className="asset-name">{asset.name}</span>
										<span className="asset-source">{asset.source}</span>
									</div>
									{selectedId === asset.id && (
										<div className="selected-badge">Selected</div>
									)}
									{isAdmin && asset.uploaded && (
										<button
											className="delete-btn"
											onClick={(e): void => {
												e.stopPropagation();
												handleDelete(asset.id);
											}}
										>
											Delete
										</button>
									)}
								</div>
							))}
							{items.length === 0 && (
								<div className="empty-state">
									No assets available in this category.
									{isAdmin && ' Use the Upload button to add some.'}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default SettingsPage;
