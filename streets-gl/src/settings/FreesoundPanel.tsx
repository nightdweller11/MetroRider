import React, {useState, useCallback, useRef, useEffect} from 'react';

interface FreesoundSound {
	id: number;
	name: string;
	tags: string[];
	username: string;
	license: string;
	duration: number;
	avgRating: number;
	numDownloads: number;
	numRatings: number;
	type: string;
	channels: number;
	samplerate: number;
	filesize: number;
	description: string;
	url: string;
	previews: Record<string, string>;
	images: Record<string, string>;
}

interface SearchResponse {
	count: number;
	results: FreesoundSound[];
	next: string | null;
	previous: string | null;
}

interface ImportResult {
	ok: boolean;
	format: string;
	id?: string;
	path?: string;
	size?: number;
	duration?: number;
	attribution?: {name: string; author: string; license: string; url: string};
	error?: string;
}

type SoundCategory = 'horn' | 'engine' | 'rail' | 'wind' | 'brake' | 'doorChime' | 'stationChime';

interface FreesoundPanelProps {
	adminToken: string;
	onSoundImported: (category: SoundCategory, soundId: string) => void;
	onImportComplete?: () => void;
}

const SUGGESTED_SEARCHES: {label: string; query: string}[] = [
	{label: 'Train Horn', query: 'train horn'},
	{label: 'Subway Horn', query: 'subway metro horn honk'},
	{label: 'Engine Hum', query: 'train engine motor hum'},
	{label: 'Rail Clatter', query: 'rail clatter wheels track'},
	{label: 'Wind Noise', query: 'wind speed rushing air'},
	{label: 'Brake Squeal', query: 'brake squeal train'},
	{label: 'Door Chime', query: 'door chime subway metro'},
	{label: 'Station Chime', query: 'station announcement chime'},
];

const CATEGORY_LABELS: Record<SoundCategory, string> = {
	horn: 'Horn',
	engine: 'Engine',
	rail: 'Rail Clatter',
	wind: 'Wind',
	brake: 'Brake',
	doorChime: 'Door Chime',
	stationChime: 'Station Chime',
};

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function formatSize(bytes: number): string {
	if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
	if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
	return bytes + ' B';
}

function guessCategory(name: string, tags: string[], searchQuery: string): SoundCategory {
	const text = `${name} ${tags.join(' ')} ${searchQuery}`.toLowerCase();
	const hornWords = ['horn', 'honk', 'klaxon', 'whistle', 'toot'];
	const brakeWords = ['brake', 'squeal', 'screech', 'stop'];
	const doorWords = ['door', 'chime', 'ding', 'dong', 'bell', 'open', 'close'];
	const stationWords = ['station', 'announcement', 'platform', 'arrival', 'depart'];
	const railWords = ['rail', 'clatter', 'track', 'click', 'clack', 'wheel', 'rumble'];
	const windWords = ['wind', 'air', 'rush', 'whoosh', 'gust'];
	const engineWords = ['engine', 'motor', 'hum', 'diesel', 'electric', 'traction'];

	if (hornWords.some(w => text.includes(w))) return 'horn';
	if (doorWords.some(w => text.includes(w))) return 'doorChime';
	if (stationWords.some(w => text.includes(w))) return 'stationChime';
	if (brakeWords.some(w => text.includes(w))) return 'brake';
	if (railWords.some(w => text.includes(w))) return 'rail';
	if (windWords.some(w => text.includes(w))) return 'wind';
	if (engineWords.some(w => text.includes(w))) return 'engine';
	return 'horn';
}

export default function FreesoundPanel({adminToken, onSoundImported, onImportComplete}: FreesoundPanelProps): React.ReactElement {
	const [apiConfigured, setApiConfigured] = useState<boolean>(false);
	const [apiChecked, setApiChecked] = useState(false);

	const [query, setQuery] = useState('');
	const [results, setResults] = useState<FreesoundSound[]>([]);
	const [searching, setSearching] = useState(false);
	const [totalCount, setTotalCount] = useState(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [hasNextPage, setHasNextPage] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);

	const [selectedSound, setSelectedSound] = useState<FreesoundSound | null>(null);
	const [importCategory, setImportCategory] = useState<SoundCategory>('horn');
	const [customFileName, setCustomFileName] = useState('');
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);

	const [sortBy, setSortBy] = useState('score');
	const [durationFilter, setDurationFilter] = useState('');
	const [licenseFilter, setLicenseFilter] = useState('');

	const [playingId, setPlayingId] = useState<number | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const lastQueryRef = useRef('');

	useEffect(() => {
		fetch('/api/freesound/status')
			.then(r => r.json())
			.then(d => {
				setApiConfigured(!!d.configured);
				setApiChecked(true);
			})
			.catch((err) => {
				console.error('[FreesoundPanel] Failed to check API status:', err);
				setApiChecked(true);
			});
	}, []);

	useEffect(() => {
		return () => {
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current = null;
			}
		};
	}, []);

	const doSearch = useCallback(async (searchQuery: string, page = 1) => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setSearchError(null);
		if (page === 1) {
			setResults([]);
			setCurrentPage(1);
		}
		lastQueryRef.current = searchQuery;

		const params = new URLSearchParams();
		params.set('query', searchQuery);
		params.set('sort', sortBy);
		params.set('page', String(page));
		params.set('page_size', '15');
		if (licenseFilter) params.set('license', licenseFilter);
		if (durationFilter) params.set('filter', `duration:${durationFilter}`);

		try {
			const response = await fetch(`/api/freesound/search?${params.toString()}`);
			if (!response.ok) {
				const err = await response.json().catch(() => ({error: 'Search failed'}));
				throw new Error(err.detail || err.error || `HTTP ${response.status}`);
			}
			const data: SearchResponse = await response.json();
			setResults(prev => page === 1 ? data.results : [...prev, ...data.results]);
			setTotalCount(data.count);
			setCurrentPage(page);
			setHasNextPage(!!data.next);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[FreesoundPanel] Search error:', msg);
			setSearchError(msg);
		} finally {
			setSearching(false);
		}
	}, [sortBy, durationFilter, licenseFilter]);

	const handleSearch = (e: React.FormEvent): void => {
		e.preventDefault();
		doSearch(query);
	};

	const handleSuggestion = (q: string): void => {
		setQuery(q);
		doSearch(q);
	};

	const handleLoadMore = (): void => {
		doSearch(lastQueryRef.current, currentPage + 1);
	};

	const handlePlay = useCallback((sound: FreesoundSound, e?: React.MouseEvent): void => {
		if (e) e.stopPropagation();

		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}

		if (playingId === sound.id) {
			setPlayingId(null);
			return;
		}

		const previewUrl = sound.previews?.['preview-hq-mp3'] || sound.previews?.['preview-lq-mp3'];
		if (!previewUrl) {
			console.error('[FreesoundPanel] No preview URL for sound:', sound.id);
			return;
		}

		const audio = new Audio(previewUrl);
		audio.addEventListener('ended', () => {
			setPlayingId(null);
			audioRef.current = null;
		});
		audio.addEventListener('error', (ev: Event) => {
			const target = ev.target as HTMLAudioElement;
			console.error(`[FreesoundPanel] Audio error for ${previewUrl}: code=${target?.error?.code} msg=${target?.error?.message}`);
			setPlayingId(null);
			audioRef.current = null;
		});
		audio.play().catch((err: Error) => {
			console.error(`[FreesoundPanel] Audio play() rejected for ${previewUrl}:`, err.message);
			setPlayingId(null);
			audioRef.current = null;
		});
		audioRef.current = audio;
		setPlayingId(sound.id);
	}, [playingId]);

	const handleSoundSelect = useCallback((sound: FreesoundSound): void => {
		setSelectedSound(sound);
		setImportResult(null);
		setCustomFileName('');
		setImportCategory(guessCategory(sound.name, sound.tags, lastQueryRef.current));
	}, []);

	const handleImport = async (): Promise<void> => {
		if (!selectedSound || !adminToken) return;
		setImporting(true);
		setImportResult(null);

		try {
			const response = await fetch(`/api/freesound/import/${selectedSound.id}?token=${adminToken}`, {
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
				console.log(`[FreesoundPanel] Imported sound: ${result.id} to ${importCategory}`);
				onImportComplete?.();
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[FreesoundPanel] Import error:', msg);
			setImportResult({ok: false, format: 'error', error: msg});
		} finally {
			setImporting(false);
		}
	};

	const handleSetActive = (): void => {
		if (!importResult?.ok || !importResult.id) return;
		onSoundImported(importCategory, importResult.id);
	};

	if (!apiChecked) {
		return <div className="fsp-loading">Checking Freesound API...</div>;
	}

	return (
		<div className="fsp-root">
			<div className="fsp-top-bar">
				<h2>Freesound Browser</h2>
				<span className={`fsp-api-badge ${apiConfigured ? 'fsp-api-ok' : 'fsp-api-warn'}`}>
					{apiConfigured ? 'API Connected' : 'No API Key'}
				</span>
			</div>
			<p className="category-description">
				Search Freesound for audio samples. Preview, import, and set them as active sounds.
			</p>

			{!apiConfigured && (
				<div className="fsp-warning">
					Freesound API key not configured. Add <code>FREESOUND_API_KEY</code> to{' '}
					<code>.env</code> to enable searching and importing.
				</div>
			)}

			<div className="fsp-layout">
				<div className="fsp-search-col">
					<form onSubmit={handleSearch} className="fsp-search-form">
						<input
							ref={searchInputRef}
							type="text"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Search Freesound for sounds..."
							className="fsp-search-input"
						/>
						<button type="submit" disabled={searching || !query.trim()} className="btn btn-primary fsp-search-btn">
							{searching ? 'Searching...' : 'Search'}
						</button>
					</form>

					<div className="fsp-filters">
						<label>
							Sort
							<select value={sortBy} onChange={e => setSortBy(e.target.value)}>
								<option value="score">Relevance</option>
								<option value="downloads_desc">Most Downloads</option>
								<option value="rating_desc">Highest Rated</option>
								<option value="created_desc">Newest</option>
								<option value="duration_asc">Shortest</option>
								<option value="duration_desc">Longest</option>
							</select>
						</label>
						<label>
							Duration
							<select value={durationFilter} onChange={e => setDurationFilter(e.target.value)}>
								<option value="">Any</option>
								<option value="[0 TO 2]">Under 2s</option>
								<option value="[0 TO 5]">Under 5s</option>
								<option value="[0 TO 10]">Under 10s</option>
								<option value="[0 TO 30]">Under 30s</option>
								<option value="[0 TO 60]">Under 1min</option>
							</select>
						</label>
						<label>
							License
							<select value={licenseFilter} onChange={e => setLicenseFilter(e.target.value)}>
								<option value="">Any</option>
								<option value="Creative Commons 0">CC0</option>
								<option value="Attribution">CC-BY</option>
								<option value="Attribution NonCommercial">CC-BY-NC</option>
							</select>
						</label>
					</div>

					<div className="fsp-suggestions">
						{SUGGESTED_SEARCHES.map(s => (
							<button
								key={s.query}
								className="fsp-suggestion-btn"
								onClick={() => handleSuggestion(s.query)}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>

				<div className="fsp-results-area">
					{searchError && <div className="fsp-error">{searchError}</div>}

					{results.length > 0 && (
						<div className="fsp-results-count">
							Showing {results.length} of {totalCount.toLocaleString()} result{totalCount !== 1 ? 's' : ''}
						</div>
					)}

					<div className="fsp-grid">
						{results.map(sound => (
							<div
								key={sound.id}
								className={`fsp-card ${selectedSound?.id === sound.id ? 'fsp-card-selected' : ''}`}
								onClick={() => handleSoundSelect(sound)}
							>
								<div className="fsp-card-waveform">
									{sound.images?.waveform_m ? (
										<img src={sound.images.waveform_m} alt={sound.name} loading="lazy" />
									) : (
										<div className="fsp-card-waveform-placeholder" />
									)}
									<button
										className={`fsp-card-play ${playingId === sound.id ? 'fsp-card-playing' : ''}`}
										onClick={e => handlePlay(sound, e)}
									>
										{playingId === sound.id ? '\u25A0' : '\u25B6'}
									</button>
									<span className="fsp-duration-badge">{formatDuration(sound.duration)}</span>
								</div>
								<div className="fsp-card-body">
									<div className="fsp-card-title">{sound.name}</div>
									<div className="fsp-card-meta">
										<span>{sound.username}</span>
										<span>{sound.type?.toUpperCase()}</span>
									</div>
									<div className="fsp-card-stats">
										{sound.avgRating > 0 && (
											<span title="Rating">&starf; {sound.avgRating.toFixed(1)}</span>
										)}
										<span title="Downloads">&darr; {sound.numDownloads.toLocaleString()}</span>
										<span className="fsp-license-tag">
											{sound.license?.replace('Creative Commons ', 'CC ').replace('Attribution', 'BY').replace('NonCommercial', 'NC') || 'N/A'}
										</span>
									</div>
								</div>
							</div>
						))}
					</div>

					{hasNextPage && !searching && (
						<div className="fsp-load-more">
							<button onClick={handleLoadMore} className="btn btn-secondary">
								Load More
							</button>
						</div>
					)}

					{searching && <div className="fsp-loading">Searching Freesound...</div>}

					{!searching && results.length === 0 && !searchError && (
						<div className="fsp-empty">
							Search for sounds or try a suggested search above.
						</div>
					)}
				</div>
			</div>

			{selectedSound && (
				<div className="fsp-detail-overlay">
					<div className="fsp-detail-panel">
						<button className="fsp-detail-close" onClick={() => {
							setSelectedSound(null);
							if (audioRef.current) {
								audioRef.current.pause();
								audioRef.current = null;
								setPlayingId(null);
							}
						}}>&times;</button>

						<div className="fsp-detail-preview">
							{selectedSound.images?.spectral_l ? (
								<img src={selectedSound.images.spectral_l} alt="Spectrogram" className="fsp-detail-spectrogram" />
							) : selectedSound.images?.waveform_l ? (
								<img src={selectedSound.images.waveform_l} alt="Waveform" className="fsp-detail-spectrogram" />
							) : (
								<div className="fsp-detail-no-preview">No preview image</div>
							)}
							<div className="fsp-detail-player">
								<button
									className={`fsp-play-large ${playingId === selectedSound.id ? 'fsp-playing' : ''}`}
									onClick={() => handlePlay(selectedSound)}
								>
									{playingId === selectedSound.id ? '\u25A0 Stop' : '\u25B6 Play'}
								</button>
							</div>
						</div>

						<div className="fsp-detail-info">
							<h3>{selectedSound.name}</h3>
							<div className="fsp-detail-author">
								by{' '}
								<a href={`https://freesound.org/people/${selectedSound.username}/`} target="_blank" rel="noreferrer">
									{selectedSound.username}
								</a>
							</div>

							<div className="fsp-detail-stats-row">
								<div><strong>{formatDuration(selectedSound.duration)}</strong></div>
								<div><strong>{selectedSound.type?.toUpperCase()}</strong> {selectedSound.channels === 1 ? 'mono' : 'stereo'}</div>
								<div><strong>{(selectedSound.samplerate / 1000).toFixed(1)}</strong> kHz</div>
								<div><strong>{formatSize(selectedSound.filesize)}</strong></div>
								{selectedSound.avgRating > 0 && (
									<div>&starf; <strong>{selectedSound.avgRating.toFixed(1)}</strong> ({selectedSound.numRatings})</div>
								)}
								<div>&darr; <strong>{selectedSound.numDownloads.toLocaleString()}</strong></div>
								<span className="fsp-license-tag">{selectedSound.license || 'Unknown'}</span>
							</div>

							{selectedSound.description && (
								<div className="fsp-detail-description">
									{selectedSound.description.substring(0, 300)}
									{selectedSound.description.length > 300 ? '...' : ''}
								</div>
							)}

							{selectedSound.tags?.length > 0 && (
								<div className="fsp-detail-tags">
									{selectedSound.tags.slice(0, 12).map(tag => (
										<span key={tag} className="fsp-tag">{tag}</span>
									))}
								</div>
							)}

							<a
								href={selectedSound.url || `https://freesound.org/sounds/${selectedSound.id}/`}
								target="_blank"
								rel="noreferrer"
								className="fsp-fs-link"
							>
								View on Freesound
							</a>

							{apiConfigured && (
								<div className="fsp-import-section">
									<h4>Import to Library</h4>
									<div className="fsp-category-selector">
										<span className="fsp-category-label">Import as:</span>
										{(Object.keys(CATEGORY_LABELS) as SoundCategory[]).map(cat => (
											<button
												key={cat}
												className={`fsp-category-btn ${importCategory === cat ? 'fsp-category-active' : ''}`}
												onClick={() => setImportCategory(cat)}
											>
												{CATEGORY_LABELS[cat]}
											</button>
										))}
									</div>
									<div className="fsp-import-controls">
										<label>
											File Name (optional)
											<input
												type="text"
												value={customFileName}
												onChange={e => setCustomFileName(e.target.value)}
												placeholder="auto from sound name"
											/>
										</label>
									</div>
									<p className="fsp-import-note">
										Imports the HQ MP3 preview (~128kbps) from Freesound.
									</p>
									<button
										onClick={handleImport}
										disabled={importing}
										className="btn btn-primary fsp-import-btn"
									>
										{importing ? 'Importing...' : 'Download & Import Sound'}
									</button>

									{importResult && (
										<div className={`fsp-import-result ${importResult.ok ? 'fsp-result-ok' : 'fsp-result-fail'}`}>
											{importResult.ok ? (
												<>
													<strong>Imported!</strong>
													<div>{importResult.path} ({formatSize(importResult.size || 0)})</div>
													{importResult.attribution && (
														<div className="fsp-attribution">
															Credit: {importResult.attribution.author} &mdash; {importResult.attribution.license}
														</div>
													)}
													<button
														onClick={handleSetActive}
														className="btn btn-primary fsp-set-active-btn"
													>
														Set as Active {CATEGORY_LABELS[importCategory]} Sound
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

							{!apiConfigured && (
								<div className="fsp-import-result fsp-result-fail">
									API key required. Add <code>FREESOUND_API_KEY</code> to <code>.env</code>.
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
