import React, {useState, useEffect, useCallback, useRef} from 'react';
import './sketchfab.css';

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

const SUGGESTED_SEARCHES: {label: string; query: string}[] = [
	{label: 'Train Stations', query: 'train station platform low poly'},
	{label: 'Metro Stations', query: 'metro subway station'},
	{label: 'Tram Stops', query: 'tram stop shelter'},
	{label: 'Train Models', query: 'train locomotive low poly'},
	{label: 'Subway Cars', query: 'subway car metro'},
	{label: 'Rail Tracks', query: 'railroad track rail'},
	{label: 'City Buildings', query: 'city building low poly'},
	{label: 'Street Furniture', query: 'street lamp bench urban'},
	{label: 'Trees & Nature', query: 'tree low poly nature'},
	{label: 'Vehicles', query: 'car bus vehicle low poly'},
];

function getAdminToken(): string | null {
	const params = new URLSearchParams(window.location.search);
	const urlToken = params.get('admin');
	if (urlToken) {
		try { sessionStorage.setItem('metrorider-admin-token', urlToken); } catch (e) { /* noop */ }
		return urlToken;
	}
	try { return sessionStorage.getItem('metrorider-admin-token'); } catch (e) { return null; }
}

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

const SketchfabBrowser: React.FC = () => {
	const [adminToken] = useState<string | null>(() => getAdminToken());
	const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
	const [apiConfigured, setApiConfigured] = useState<boolean>(false);

	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SketchfabModel[]>([]);
	const [searching, setSearching] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [totalSearched, setTotalSearched] = useState(0);

	const [selectedModel, setSelectedModel] = useState<SketchfabModel | null>(null);
	const [importCategory, setImportCategory] = useState<ModelCategory>('stations');
	const [customFileName, setCustomFileName] = useState('');
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);
	const [importLog, setImportLog] = useState<ImportResult[]>([]);

	const [sortBy, setSortBy] = useState('-likeCount');
	const [maxFaces, setMaxFaces] = useState('100000');
	const [licenseFilter, setLicenseFilter] = useState('');

	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!adminToken) {
			setIsAuthorized(false);
			return;
		}
		fetch(`/api/admin/verify?token=${adminToken}`)
			.then(r => r.json())
			.then(d => setIsAuthorized(!!d.valid))
			.catch(() => setIsAuthorized(false));

		fetch('/api/sketchfab/status')
			.then(r => r.json())
			.then(d => setApiConfigured(!!d.configured))
			.catch(() => setApiConfigured(false));
	}, [adminToken]);

	const doSearch = useCallback(async (searchQuery: string, append = false) => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setSearchError(null);
		if (!append) {
			setResults([]);
			setTotalSearched(0);
		}

		const params = new URLSearchParams();
		params.set('q', searchQuery);
		params.set('downloadable', 'true');
		params.set('sort_by', sortBy);
		if (maxFaces) params.set('max_face_count', maxFaces);
		if (licenseFilter) params.set('license', licenseFilter);
		if (append && nextCursor) params.set('cursor', nextCursor);

		try {
			const response = await fetch(`/api/sketchfab/search?${params.toString()}`);
			if (!response.ok) {
				const err = await response.json().catch(() => ({error: 'Search failed'}));
				throw new Error(err.detail || err.error || `HTTP ${response.status}`);
			}
			const data: SearchResponse = await response.json();
			setResults(prev => append ? [...prev, ...data.results] : data.results);
			setTotalSearched(prev => append ? prev + data.results.length : data.results.length);
			setNextCursor(data.next ? new URL(data.next).searchParams.get('cursor') : null);
		} catch (err) {
			setSearchError(err instanceof Error ? err.message : String(err));
		} finally {
			setSearching(false);
		}
	}, [sortBy, maxFaces, licenseFilter, nextCursor]);

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		doSearch(query);
	};

	const handleSuggestion = (q: string) => {
		setQuery(q);
		doSearch(q);
	};

	const handleImport = async () => {
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
			if (result.ok) {
				setImportLog(prev => [...prev, result]);
			}
		} catch (err) {
			setImportResult({ok: false, format: 'error', error: err instanceof Error ? err.message : String(err)});
		} finally {
			setImporting(false);
		}
	};

	if (isAuthorized === null) {
		return <div className="sf-page"><div className="sf-loading">Verifying admin access...</div></div>;
	}

	if (!isAuthorized) {
		return (
			<div className="sf-page">
				<div className="sf-auth-error">
					<h1>Admin Access Required</h1>
					<p>This page requires an admin token. Add <code>?admin=YOUR_TOKEN</code> to the URL.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="sf-page">
			<header className="sf-header">
				<div className="sf-header-left">
					<h1>Sketchfab Model Browser</h1>
					<span className="sf-badge">{apiConfigured ? 'API Connected' : 'Search Only (no token)'}</span>
				</div>
				<div className="sf-header-right">
					<a href={`/settings.html?admin=${adminToken}`} className="sf-link">Settings</a>
					<a href={`/?admin=${adminToken}`} className="sf-link">Game</a>
				</div>
			</header>

			{!apiConfigured && (
				<div className="sf-warning">
					Sketchfab API token not configured. Searching works, but importing models requires
					<code>SKETCHFAB_API_TOKEN</code> in <code>.env</code>.
					Get one at <a href="https://sketchfab.com/settings/password" target="_blank" rel="noreferrer">sketchfab.com/settings/password</a>.
				</div>
			)}

			<div className="sf-body">
				<aside className="sf-sidebar">
					<form onSubmit={handleSearch} className="sf-search-form">
						<input
							ref={searchInputRef}
							type="text"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Search Sketchfab models..."
							className="sf-search-input"
						/>
						<button type="submit" disabled={searching || !query.trim()} className="sf-search-btn">
							{searching ? 'Searching...' : 'Search'}
						</button>
					</form>

					<div className="sf-filters">
						<label>Sort by
							<select value={sortBy} onChange={e => setSortBy(e.target.value)}>
								<option value="-likeCount">Most Liked</option>
								<option value="-viewCount">Most Viewed</option>
								<option value="-publishedAt">Newest</option>
								<option value="publishedAt">Oldest</option>
							</select>
						</label>
						<label>Max Faces
							<select value={maxFaces} onChange={e => setMaxFaces(e.target.value)}>
								<option value="">Any</option>
								<option value="5000">5K</option>
								<option value="10000">10K</option>
								<option value="50000">50K</option>
								<option value="100000">100K</option>
								<option value="500000">500K</option>
							</select>
						</label>
						<label>License
							<select value={licenseFilter} onChange={e => setLicenseFilter(e.target.value)}>
								<option value="">Any</option>
								<option value="cc0">CC0 (Public Domain)</option>
								<option value="by">CC-BY</option>
								<option value="by-sa">CC-BY-SA</option>
								<option value="by-nc">CC-BY-NC</option>
							</select>
						</label>
					</div>

					<div className="sf-suggestions">
						<h3>Quick Searches</h3>
						{SUGGESTED_SEARCHES.map(s => (
							<button key={s.query} className="sf-suggestion-btn" onClick={() => handleSuggestion(s.query)}>
								{s.label}
							</button>
						))}
					</div>

					{importLog.length > 0 && (
						<div className="sf-import-log">
							<h3>Imported ({importLog.length})</h3>
							{importLog.map((r, i) => (
								<div key={i} className="sf-import-log-item">
									<span className="sf-check">&#10003;</span>
									{r.attribution?.name || r.id} &rarr; {r.path}
								</div>
							))}
						</div>
					)}
				</aside>

				<main className="sf-main">
					{searchError && <div className="sf-error">{searchError}</div>}

					{results.length > 0 && (
						<div className="sf-results-header">
							Showing {results.length} downloadable models
						</div>
					)}

					<div className="sf-grid">
						{results.map(model => (
							<div
								key={model.uid}
								className={`sf-card ${selectedModel?.uid === model.uid ? 'sf-card--selected' : ''}`}
								onClick={() => {
									setSelectedModel(model);
									setImportResult(null);
									setCustomFileName('');
								}}
							>
								<div className="sf-card-thumb">
									{getThumbnail(model, 256) && (
										<img src={getThumbnail(model, 256)} alt={model.name} loading="lazy" />
									)}
									{!model.isDownloadable && <span className="sf-card-badge">Not downloadable</span>}
								</div>
								<div className="sf-card-info">
									<h4 className="sf-card-title">{model.name}</h4>
									<div className="sf-card-meta">
										<span>{model.user.displayName || model.user.username}</span>
										<span>{formatNumber(model.faceCount || 0)} faces</span>
									</div>
									<div className="sf-card-stats">
										<span title="Likes">&hearts; {formatNumber(model.likeCount)}</span>
										<span title="Views">&#128065; {formatNumber(model.viewCount)}</span>
										<span className="sf-card-license">{model.license || 'N/A'}</span>
									</div>
								</div>
							</div>
						))}
					</div>

					{nextCursor && !searching && (
						<div className="sf-load-more">
							<button onClick={() => doSearch(query, true)} className="sf-load-more-btn">
								Load More Results
							</button>
						</div>
					)}

					{searching && <div className="sf-loading">Searching Sketchfab...</div>}

					{!searching && results.length === 0 && totalSearched === 0 && !searchError && (
						<div className="sf-empty">
							Search Sketchfab for 3D models to add to your MetroRider library.
							Try one of the suggested searches on the left.
						</div>
					)}
				</main>

				{selectedModel && (
					<aside className="sf-detail">
						<button className="sf-detail-close" onClick={() => setSelectedModel(null)}>&times;</button>
						<div className="sf-detail-preview">
							{getThumbnail(selectedModel, 512) && (
								<img src={getThumbnail(selectedModel, 512)} alt={selectedModel.name} />
							)}
						</div>
						<h2>{selectedModel.name}</h2>
						<div className="sf-detail-author">
							by <a href={selectedModel.user.profileUrl} target="_blank" rel="noreferrer">
								{selectedModel.user.displayName || selectedModel.user.username}
							</a>
						</div>
						<div className="sf-detail-stats">
							<div><strong>{formatNumber(selectedModel.faceCount || 0)}</strong> faces</div>
							<div><strong>{formatNumber(selectedModel.vertexCount || 0)}</strong> vertices</div>
							<div><strong>{selectedModel.animationCount || 0}</strong> animations</div>
							<div className="sf-detail-license">{selectedModel.license || 'Unknown license'}</div>
						</div>

						<a href={selectedModel.viewerUrl} target="_blank" rel="noreferrer" className="sf-detail-link">
							View on Sketchfab &rarr;
						</a>

						{selectedModel.isDownloadable && apiConfigured && (
							<div className="sf-import-section">
								<h3>Import to Library</h3>
								<label>Category
									<select value={importCategory} onChange={e => setImportCategory(e.target.value as ModelCategory)}>
										<option value="stations">Stations</option>
										<option value="trains">Trains</option>
										<option value="tracks">Tracks</option>
									</select>
								</label>
								<label>File Name (optional)
									<input
										type="text"
										value={customFileName}
										onChange={e => setCustomFileName(e.target.value)}
										placeholder="auto-generated from model name"
									/>
								</label>
								<button
									onClick={handleImport}
									disabled={importing}
									className="sf-import-btn"
								>
									{importing ? 'Importing...' : 'Download & Import GLB'}
								</button>

								{importResult && (
									<div className={`sf-import-result ${importResult.ok ? 'sf-import-ok' : 'sf-import-fail'}`}>
										{importResult.ok ? (
											<>
												<strong>Imported!</strong>
												<div>{importResult.path} ({((importResult.size || 0) / 1024).toFixed(0)} KB)</div>
												{importResult.attribution && (
													<div className="sf-attribution">
														Credit: {importResult.attribution.author} — {importResult.attribution.license}
													</div>
												)}
												{importResult.note && <div className="sf-note">{importResult.note}</div>}
											</>
										) : (
											<>
												<strong>Import failed</strong>
												<div>{importResult.error || (importResult as any).detail}</div>
											</>
										)}
									</div>
								)}
							</div>
						)}

						{!selectedModel.isDownloadable && (
							<div className="sf-import-result sf-import-fail">
								This model is not downloadable via the API.
							</div>
						)}

						{!apiConfigured && selectedModel.isDownloadable && (
							<div className="sf-import-result sf-import-fail">
								API token required to import. Add <code>SKETCHFAB_API_TOKEN</code> to <code>.env</code>.
							</div>
						)}
					</aside>
				)}
			</div>
		</div>
	);
};

export default SketchfabBrowser;
