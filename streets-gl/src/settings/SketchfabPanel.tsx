import React, {useState, useCallback, useRef, useEffect} from 'react';

interface SketchfabModel {
	uid: string;
	name: string;
	viewerUrl: string;
	embedUrl: string;
	isDownloadable: boolean;
	license: string;
	user: {username: string; displayName: string; profileUrl: string};
	thumbnails: {url: string; width: number; height: number}[];
	faceCount: number;
	vertexCount: number;
	animationCount: number;
	likeCount: number;
	viewCount: number;
	publishedAt: string;
}

interface SearchResponse {
	results: SketchfabModel[];
	next: string | null;
}

interface ImportResult {
	ok: boolean;
	format: string;
	id?: string;
	path?: string;
	size?: number;
	attribution?: {name: string; author: string; license: string; url: string};
	note?: string;
	error?: string;
}

type ModelCategory = 'stations' | 'trains' | 'tracks';

interface SketchfabPanelProps {
	adminToken: string;
	onModelImported: (category: ModelCategory, modelId: string) => void;
}

const SUGGESTED_SEARCHES: {label: string; query: string}[] = [
	{label: 'Train Stations', query: 'train station platform low poly'},
	{label: 'Metro Stations', query: 'metro subway station'},
	{label: 'Tram Stops', query: 'tram stop shelter'},
	{label: 'Locomotives', query: 'train locomotive low poly'},
	{label: 'Subway Cars', query: 'subway car metro'},
	{label: 'Rail Tracks', query: 'railroad track rail'},
	{label: 'Street Furniture', query: 'street lamp bench urban'},
	{label: 'Trees', query: 'tree low poly nature'},
];

function formatNumber(n: number): string {
	if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
	if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
	return String(n);
}

function getThumbnail(model: SketchfabModel, targetWidth: number): string {
	if (!model.thumbnails || model.thumbnails.length === 0) return '';
	const best = model.thumbnails.reduce((prev, curr) =>
		Math.abs(curr.width - targetWidth) < Math.abs(prev.width - targetWidth) ? curr : prev
	);
	return best.url;
}

export default function SketchfabPanel({adminToken, onModelImported}: SketchfabPanelProps): React.ReactElement {
	const [apiConfigured, setApiConfigured] = useState<boolean>(false);
	const [apiChecked, setApiChecked] = useState(false);

	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SketchfabModel[]>([]);
	const [searching, setSearching] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [searchError, setSearchError] = useState<string | null>(null);

	const [selectedModel, setSelectedModel] = useState<SketchfabModel | null>(null);
	const [importCategory, setImportCategory] = useState<ModelCategory>('stations');
	const [customFileName, setCustomFileName] = useState('');
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);

	const [sortBy, setSortBy] = useState('-likeCount');
	const [maxFaces, setMaxFaces] = useState('100000');
	const [licenseFilter, setLicenseFilter] = useState('');

	const searchInputRef = useRef<HTMLInputElement>(null);
	const nextCursorRef = useRef<string | null>(null);
	nextCursorRef.current = nextCursor;

	useEffect(() => {
		fetch('/api/sketchfab/status')
			.then(r => r.json())
			.then(d => {
				setApiConfigured(!!d.configured);
				setApiChecked(true);
			})
			.catch((err) => {
				console.error('[SketchfabPanel] Failed to check API status:', err);
				setApiChecked(true);
			});
	}, []);

	const doSearch = useCallback(async (searchQuery: string, append = false) => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setSearchError(null);
		if (!append) {
			setResults([]);
		}

		const params = new URLSearchParams();
		params.set('q', searchQuery);
		params.set('downloadable', 'true');
		params.set('sort_by', sortBy);
		if (maxFaces) params.set('max_face_count', maxFaces);
		if (licenseFilter) params.set('license', licenseFilter);
		if (append && nextCursorRef.current) params.set('cursor', nextCursorRef.current);

		try {
			const response = await fetch(`/api/sketchfab/search?${params.toString()}`);
			if (!response.ok) {
				const err = await response.json().catch(() => ({error: 'Search failed'}));
				throw new Error(err.detail || err.error || `HTTP ${response.status}`);
			}
			const data: SearchResponse = await response.json();
			setResults(prev => append ? [...prev, ...data.results] : data.results);
			setNextCursor(data.next ? (() => {
				try {
					return new URL(data.next!).searchParams.get('cursor');
				} catch {
					return null;
				}
			})() : null);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[SketchfabPanel] Search error:', msg);
			setSearchError(msg);
		} finally {
			setSearching(false);
		}
	}, [sortBy, maxFaces, licenseFilter]);

	const handleSearch = (e: React.FormEvent): void => {
		e.preventDefault();
		doSearch(query);
	};

	const handleSuggestion = (q: string): void => {
		setQuery(q);
		doSearch(q);
	};

	const guessCategory = useCallback((modelName: string, searchQuery: string): ModelCategory => {
		const text = `${modelName} ${searchQuery}`.toLowerCase();
		const trainKeywords = ['train', 'locomotive', 'subway car', 'metro car', 'tram', 'wagon', 'railcar', 'coach', 'carriage', 'engine', 'diesel', 'electric'];
		const trackKeywords = ['track', 'rail ', 'rails', 'railroad', 'railway track'];
		if (trainKeywords.some(k => text.includes(k))) return 'trains';
		if (trackKeywords.some(k => text.includes(k))) return 'tracks';
		return 'stations';
	}, []);

	const handleModelSelect = useCallback((model: SketchfabModel): void => {
		setSelectedModel(model);
		setImportResult(null);
		setCustomFileName('');
		setImportCategory(guessCategory(model.name, query));
	}, [guessCategory, query]);

	const handleImport = async (): Promise<void> => {
		if (!selectedModel || !adminToken) return;
		setImporting(true);
		setImportResult(null);

		try {
			const response = await fetch(`/api/sketchfab/import/${selectedModel.uid}?token=${adminToken}`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					category: importCategory,
					fileName: customFileName || undefined,
				}),
			});

			const result: ImportResult = await response.json();
			setImportResult(result);
			if (result.ok && result.id) {
				console.log(`[SketchfabPanel] Imported model: ${result.id} to ${importCategory}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[SketchfabPanel] Import error:', msg);
			setImportResult({ok: false, format: 'error', error: msg});
		} finally {
			setImporting(false);
		}
	};

	const handleSetActive = (): void => {
		if (!importResult?.ok || !importResult.id) return;
		onModelImported(importCategory, importResult.id);
	};

	if (!apiChecked) {
		return <div className="sfp-loading">Checking Sketchfab API...</div>;
	}

	return (
		<div className="sfp-root">
			<div className="sfp-top-bar">
				<h2>Sketchfab Model Browser</h2>
				<span className={`sfp-api-badge ${apiConfigured ? 'sfp-api-ok' : 'sfp-api-warn'}`}>
					{apiConfigured ? 'API Connected' : 'No API Token'}
				</span>
			</div>
			<p className="category-description">
				Search Sketchfab for 3D models. Import them into your library and set them as active.
			</p>

			{!apiConfigured && (
				<div className="sfp-warning">
					Sketchfab API token not configured. Add <code>SKETCHFAB_API_TOKEN</code> to{' '}
					<code>.env</code> to enable importing.
				</div>
			)}

			<div className="sfp-layout">
				<div className="sfp-search-col">
					<form onSubmit={handleSearch} className="sfp-search-form">
						<input
							ref={searchInputRef}
							type="text"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Search Sketchfab models..."
							className="sfp-search-input"
						/>
						<button type="submit" disabled={searching || !query.trim()} className="btn btn-primary sfp-search-btn">
							{searching ? 'Searching...' : 'Search'}
						</button>
					</form>

					<div className="sfp-filters">
						<label>
							Sort
							<select value={sortBy} onChange={e => setSortBy(e.target.value)}>
								<option value="-likeCount">Most Liked</option>
								<option value="-viewCount">Most Viewed</option>
								<option value="-publishedAt">Newest</option>
							</select>
						</label>
						<label>
							Max Faces
							<select value={maxFaces} onChange={e => setMaxFaces(e.target.value)}>
								<option value="">Any</option>
								<option value="5000">5K</option>
								<option value="10000">10K</option>
								<option value="50000">50K</option>
								<option value="100000">100K</option>
								<option value="500000">500K</option>
							</select>
						</label>
						<label>
							License
							<select value={licenseFilter} onChange={e => setLicenseFilter(e.target.value)}>
								<option value="">Any</option>
								<option value="cc0">CC0</option>
								<option value="by">CC-BY</option>
								<option value="by-sa">CC-BY-SA</option>
								<option value="by-nc">CC-BY-NC</option>
							</select>
						</label>
					</div>

					<div className="sfp-suggestions">
						{SUGGESTED_SEARCHES.map(s => (
							<button
								key={s.query}
								className="sfp-suggestion-btn"
								onClick={() => handleSuggestion(s.query)}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>

				<div className="sfp-results-area">
					{searchError && <div className="sfp-error">{searchError}</div>}

					{results.length > 0 && (
						<div className="sfp-results-count">
							{results.length} downloadable model{results.length !== 1 ? 's' : ''}
						</div>
					)}

					<div className="sfp-grid">
						{results.map(model => (
							<div
								key={model.uid}
								className={`sfp-card ${selectedModel?.uid === model.uid ? 'sfp-card-selected' : ''}`}
								onClick={() => handleModelSelect(model)}
							>
								<div className="sfp-card-thumb">
									{getThumbnail(model, 256) && (
										<img src={getThumbnail(model, 256)} alt={model.name} loading="lazy" />
									)}
								</div>
								<div className="sfp-card-body">
									<div className="sfp-card-title">{model.name}</div>
									<div className="sfp-card-meta">
										<span>{model.user.displayName || model.user.username}</span>
										<span>{formatNumber(model.faceCount || 0)} faces</span>
									</div>
									<div className="sfp-card-stats">
										<span title="Likes">&hearts; {formatNumber(model.likeCount)}</span>
										<span title="Views">{formatNumber(model.viewCount)} views</span>
										<span className="sfp-license-tag">{model.license || 'N/A'}</span>
									</div>
								</div>
							</div>
						))}
					</div>

					{nextCursor && !searching && (
						<div className="sfp-load-more">
							<button onClick={() => doSearch(query, true)} className="btn btn-secondary">
								Load More
							</button>
						</div>
					)}

					{searching && <div className="sfp-loading">Searching Sketchfab...</div>}

					{!searching && results.length === 0 && !searchError && (
						<div className="sfp-empty">
							Search for models or try a suggested search above.
						</div>
					)}
				</div>
			</div>

			{selectedModel && (
				<div className="sfp-detail-overlay">
					<div className="sfp-detail-panel">
						<button className="sfp-detail-close" onClick={() => setSelectedModel(null)}>&times;</button>

						<div className="sfp-detail-viewer">
							<iframe
								title={`Sketchfab - ${selectedModel.name}`}
								src={`https://sketchfab.com/models/${selectedModel.uid}/embed?autostart=1&ui_theme=dark`}
								allow="autoplay; fullscreen; xr-spatial-tracking"
								allowFullScreen
							/>
						</div>

						<div className="sfp-detail-info">
							<h3>{selectedModel.name}</h3>
							<div className="sfp-detail-author">
								by{' '}
								<a href={selectedModel.user.profileUrl} target="_blank" rel="noreferrer">
									{selectedModel.user.displayName || selectedModel.user.username}
								</a>
							</div>

							<div className="sfp-detail-stats-row">
								<div><strong>{formatNumber(selectedModel.faceCount || 0)}</strong> faces</div>
								<div><strong>{formatNumber(selectedModel.vertexCount || 0)}</strong> verts</div>
								<div><strong>{selectedModel.animationCount || 0}</strong> anims</div>
								<div className="sfp-license-tag">{selectedModel.license || 'Unknown'}</div>
							</div>

							<a
								href={selectedModel.viewerUrl}
								target="_blank"
								rel="noreferrer"
								className="sfp-sf-link"
							>
								View on Sketchfab
							</a>

							{selectedModel.isDownloadable && apiConfigured && (
								<div className="sfp-import-section">
									<h4>Import to Library</h4>
									<div className="sfp-category-selector">
										<span className="sfp-category-label">Download to:</span>
										{(['stations', 'trains', 'tracks'] as ModelCategory[]).map(cat => (
											<button
												key={cat}
												className={`sfp-category-btn ${importCategory === cat ? 'sfp-category-active' : ''}`}
												onClick={() => setImportCategory(cat)}
											>
												{cat.charAt(0).toUpperCase() + cat.slice(1)}
											</button>
										))}
									</div>
									<div className="sfp-import-controls">
										<label>
											File Name (optional)
											<input
												type="text"
												value={customFileName}
												onChange={e => setCustomFileName(e.target.value)}
												placeholder="auto from model name"
											/>
										</label>
									</div>
									<button
										onClick={handleImport}
										disabled={importing}
										className="btn btn-primary sfp-import-btn"
									>
										{importing ? 'Importing...' : 'Download & Import GLB'}
									</button>

									{importResult && (
										<div className={`sfp-import-result ${importResult.ok ? 'sfp-result-ok' : 'sfp-result-fail'}`}>
											{importResult.ok ? (
												<>
													<strong>Imported!</strong>
													<div>{importResult.path} ({((importResult.size || 0) / 1024).toFixed(0)} KB)</div>
													{importResult.attribution && (
														<div className="sfp-attribution">
															Credit: {importResult.attribution.author} &mdash; {importResult.attribution.license}
														</div>
													)}
													{importResult.note && <div className="sfp-note">{importResult.note}</div>}
													<button
														onClick={handleSetActive}
														className="btn btn-primary sfp-set-active-btn"
													>
														Set as Active {importCategory.slice(0, -1)} Model
													</button>
												</>
											) : (
												<>
													<strong>Import failed</strong>
													<div>{importResult.error}</div>
												</>
											)}
										</div>
									)}
								</div>
							)}

							{!selectedModel.isDownloadable && (
								<div className="sfp-import-result sfp-result-fail">
									This model is not downloadable via the API.
								</div>
							)}
							{!apiConfigured && selectedModel.isDownloadable && (
								<div className="sfp-import-result sfp-result-fail">
									API token required. Add <code>SKETCHFAB_API_TOKEN</code> to <code>.env</code>.
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
