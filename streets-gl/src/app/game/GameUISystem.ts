import System from '../System';
import TrainSystem from './TrainSystem';
import GameCameraSystem from './GameCameraSystem';
import AudioSystem from './audio/AudioSystem';
import AssetConfigSystem from './assets/AssetConfigSystem';
import TerrainSystem from '../systems/TerrainSystem';
import MapWorkerSystem from '../systems/MapWorkerSystem';
import TrainRenderingSystem from './rendering/TrainRenderingSystem';


const DEFAULT_MAP_URL = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg%3D%3D';

export default class GameUISystem extends System {
	private container: HTMLElement | null = null;
	private speedEl: HTMLElement | null = null;
	private stationEl: HTMLElement | null = null;
	private directionEl: HTMLElement | null = null;
	private lineColorEl: HTMLElement | null = null;
	private cameraEl: HTMLElement | null = null;
	private lineListEl: HTMLElement | null = null;
	private stationPanelEl: HTMLElement | null = null;
	private debugEl: HTMLElement | null = null;
	private debugVisible: boolean = false;
	private initialized: boolean = false;

	public postInit(): void {
		this.systemManager.onSystemReady(TrainSystem, (trainSystem) => {
			this.createUI(trainSystem);
		});
	}

	private createUI(trainSystem: TrainSystem): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (assetConfig) {
			(window as any).__assetConfigSystem = assetConfig;
		}

		this.container = document.createElement('div');
		this.container.id = 'game-hud';
		this.container.style.cssText = `
			position: fixed; top: 0; left: 0; right: 0; bottom: 0;
			pointer-events: none; z-index: 1000; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		`;
		document.body.appendChild(this.container);

		this.createSpeedometer();
		this.createStationInfo();
		this.createControls(trainSystem);
		this.createLineSelector(trainSystem);
		this.createSettingsButton();
		this.createStartButton(trainSystem);
		this.createDebugOverlay();

		this.initialized = true;
	}

	private createSpeedometer(): void {
		this.speedEl = document.createElement('div');
		this.speedEl.style.cssText = `
			position: absolute; top: 20px; left: 20px;
			background: rgba(0,0,0,0.7); color: #fff; padding: 12px 18px;
			border-radius: 10px; font-size: 20px; font-weight: 600;
			backdrop-filter: blur(10px); display: none;
		`;
		this.speedEl.textContent = '0 km/h';
		this.container.appendChild(this.speedEl);
	}

	private createStationInfo(): void {
		const wrap = document.createElement('div');
		wrap.style.cssText = `
			position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
			background: rgba(0,0,0,0.7); color: #fff; padding: 10px 20px;
			border-radius: 10px; text-align: center; backdrop-filter: blur(10px);
			display: none; min-width: 200px;
		`;

		this.lineColorEl = document.createElement('div');
		this.lineColorEl.style.cssText = `
			width: 100%; height: 4px; border-radius: 2px;
			margin-bottom: 6px; display: none;
		`;

		this.stationEl = document.createElement('div');
		this.stationEl.style.cssText = 'font-size: 16px; font-weight: 600;';
		this.stationEl.textContent = '';

		this.directionEl = document.createElement('div');
		this.directionEl.style.cssText = 'font-size: 12px; color: #aaa; margin-top: 4px;';
		this.directionEl.textContent = '';

		wrap.appendChild(this.lineColorEl);
		wrap.appendChild(this.stationEl);
		wrap.appendChild(this.directionEl);
		this.container.appendChild(wrap);
		this.stationEl.parentElement.style.display = 'none';
	}

	private createControls(trainSystem: TrainSystem): void {
		const controlsWrap = document.createElement('div');
		controlsWrap.style.cssText = `
			position: absolute; bottom: 30px; right: 20px;
			display: flex; flex-direction: row; gap: 8px; align-items: flex-end;
			pointer-events: auto;
		`;

		const createBtn = (emoji: string, tooltip: string): HTMLElement => {
			const btn = document.createElement('div');
			btn.style.cssText = `
				width: 52px; height: 52px; border-radius: 12px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 22px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				transition: background 0.15s;
			`;
			btn.textContent = emoji;
			btn.title = tooltip;
			btn.addEventListener('mouseenter', () => {
				btn.style.background = 'rgba(255,255,255,0.2)';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'rgba(0,0,0,0.65)';
			});
			return btn;
		};

		const col1 = document.createElement('div');
		col1.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
		const accelBtn = createBtn('\u25B2', 'Accelerate');
		const brakeBtn = createBtn('\u25BC', 'Brake');

		const bindPress = (el: HTMLElement, action: 'throttle' | 'brake'): void => {
			const down = (): void => trainSystem.getInput().setHeld(action, true);
			const up = (): void => trainSystem.getInput().setHeld(action, false);
			el.addEventListener('mousedown', down);
			el.addEventListener('mouseup', up);
			el.addEventListener('mouseleave', up);
			el.addEventListener('touchstart', (e) => { e.preventDefault(); down(); });
			el.addEventListener('touchend', (e) => { e.preventDefault(); up(); });
			el.addEventListener('touchcancel', up);
		};
		bindPress(accelBtn, 'throttle');
		bindPress(brakeBtn, 'brake');
		col1.appendChild(accelBtn);
		col1.appendChild(brakeBtn);

		const col2 = document.createElement('div');
		col2.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
		const hornBtn = createBtn('\uD83D\uDD0A', 'Horn');
		const reverseBtn = createBtn('\u21BA', 'Reverse');
		hornBtn.addEventListener('mousedown', () => {
			const audioSystem = this.systemManager.getSystem(AudioSystem);
			if (audioSystem) audioSystem.playHorn();
		});
		hornBtn.addEventListener('touchstart', (e) => {
			e.preventDefault();
			const audioSystem = this.systemManager.getSystem(AudioSystem);
			if (audioSystem) audioSystem.playHorn();
		});
		reverseBtn.addEventListener('click', () => trainSystem.reverseDirection());
		col2.appendChild(hornBtn);
		col2.appendChild(reverseBtn);

		const col3 = document.createElement('div');
		col3.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
		const doorsBtn = createBtn('\u229F', 'Doors');
		doorsBtn.addEventListener('click', () => trainSystem.toggleDoors());

		this.cameraEl = createBtn('\uD83C\uDFA5', 'Camera');
		this.cameraEl.addEventListener('click', () => {
			const camSystem = this.systemManager.getSystem(GameCameraSystem);
			if (camSystem) camSystem.cycleMode();
		});
		col3.appendChild(doorsBtn);
		col3.appendChild(this.cameraEl);

		controlsWrap.appendChild(col1);
		controlsWrap.appendChild(col2);
		controlsWrap.appendChild(col3);
		this.container.appendChild(controlsWrap);
	}

	private createLineSelector(trainSystem: TrainSystem): void {
		this.lineListEl = document.createElement('div');
		this.lineListEl.style.cssText = `
			position: absolute; top: 70px; right: 20px;
			display: flex; flex-direction: column; gap: 4px;
			pointer-events: auto; max-height: calc(100vh - 250px);
			overflow-y: auto; scrollbar-width: thin;
			scrollbar-color: rgba(255,255,255,0.15) transparent;
		`;

		this.rebuildLineList(trainSystem);
		this.container.appendChild(this.lineListEl);
	}

	private rebuildLineList(trainSystem: TrainSystem): void {
		if (!this.lineListEl) return;
		this.lineListEl.innerHTML = '';

		trainSystem.lines.forEach((ls, idx) => {
			const btn = document.createElement('div');
			btn.style.cssText = `
				display: flex; align-items: center; gap: 6px;
				padding: 5px 12px; border-radius: 6px;
				background: rgba(0,0,0,0.6); color: #fff; cursor: pointer;
				font-size: 11px; backdrop-filter: blur(6px);
				border: 1px solid rgba(255,255,255,0.08);
				pointer-events: auto; user-select: none;
			`;
			const swatch = document.createElement('span');
			swatch.style.cssText = `
				width: 10px; height: 10px; border-radius: 50%;
				background: ${ls.parsed.color}; flex-shrink: 0;
			`;
			const label = document.createElement('span');
			label.textContent = ls.parsed.name;

			const arrow = document.createElement('span');
			arrow.style.cssText = 'margin-left: auto; opacity: 0.5; font-size: 10px;';
			arrow.textContent = '\u25B6';

			btn.appendChild(swatch);
			btn.appendChild(label);
			btn.appendChild(arrow);
			btn.addEventListener('click', () => {
				this.showStationPanel(trainSystem, idx);
			});
			this.lineListEl.appendChild(btn);
		});
	}

	private showStationPanel(trainSystem: TrainSystem, lineIdx: number): void {
		if (this.lineListEl) this.lineListEl.style.display = 'none';

		if (this.stationPanelEl) {
			this.stationPanelEl.remove();
		}

		const ls = trainSystem.lines[lineIdx];
		if (!ls) {
			console.error(`[GameUI] Invalid line index for station panel: ${lineIdx}`);
			return;
		}

		const stations = ls.parsed.stations;
		let selectedDir = 1;

		const panel = document.createElement('div');
		panel.style.cssText = `
			position: absolute; top: 70px; right: 20px;
			width: 260px; max-height: calc(100vh - 120px);
			background: rgba(0,0,0,0.85); border-radius: 12px;
			backdrop-filter: blur(12px); pointer-events: auto;
			border: 1px solid rgba(255,255,255,0.12);
			display: flex; flex-direction: column; overflow: hidden;
		`;

		const header = document.createElement('div');
		header.style.cssText = `
			padding: 12px 14px; display: flex; align-items: center; gap: 8px;
			border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;
		`;

		const backBtn = document.createElement('div');
		backBtn.style.cssText = `
			cursor: pointer; font-size: 16px; color: #aaa; padding: 2px 4px;
			border-radius: 4px; transition: color 0.15s;
		`;
		backBtn.textContent = '\u25C0';
		backBtn.title = 'Back to lines';
		backBtn.addEventListener('mouseenter', () => { backBtn.style.color = '#fff'; });
		backBtn.addEventListener('mouseleave', () => { backBtn.style.color = '#aaa'; });
		backBtn.addEventListener('click', () => {
			this.hideStationPanel();
		});

		const colorBar = document.createElement('div');
		colorBar.style.cssText = `
			width: 12px; height: 12px; border-radius: 50%;
			background: ${ls.parsed.color}; flex-shrink: 0;
		`;

		const lineName = document.createElement('div');
		lineName.style.cssText = 'color: #fff; font-size: 13px; font-weight: 600;';
		lineName.textContent = ls.parsed.name;

		header.appendChild(backBtn);
		header.appendChild(colorBar);
		header.appendChild(lineName);

		const dirSection = document.createElement('div');
		dirSection.style.cssText = `
			padding: 8px 14px; display: flex; gap: 6px;
			border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;
		`;

		const firstStation = stations[0]?.name ?? '?';
		const lastStation = stations[stations.length - 1]?.name ?? '?';

		const styleDirBtns = (): void => {
			dirSection.querySelectorAll('div[data-dir]').forEach(b => {
				const el = b as HTMLElement;
				const d = parseInt(el.dataset.dir ?? '1');
				if (d === selectedDir) {
					el.style.background = 'rgba(59, 130, 246, 0.5)';
					el.style.color = '#fff';
					el.style.border = '1px solid rgba(59, 130, 246, 0.6)';
				} else {
					el.style.background = 'rgba(255,255,255,0.06)';
					el.style.color = '#aaa';
					el.style.border = '1px solid rgba(255,255,255,0.08)';
				}
			});
		};

		const createDirBtn = (dir: number, terminalName: string): HTMLElement => {
			const btn = document.createElement('div');
			btn.dataset.dir = String(dir);
			btn.style.cssText = `
				flex: 1; padding: 6px 8px; border-radius: 6px;
				font-size: 10px; text-align: center; cursor: pointer;
				user-select: none; transition: all 0.15s; line-height: 1.3;
			`;

			const arrow = dir === 1 ? '\u2192' : '\u2190';
			btn.innerHTML = `<div style="font-size: 12px;">${arrow}</div><div>${terminalName}</div>`;

			btn.addEventListener('click', () => {
				selectedDir = dir;
				styleDirBtns();
			});

			return btn;
		};

		dirSection.appendChild(createDirBtn(1, lastStation));
		dirSection.appendChild(createDirBtn(-1, firstStation));
		styleDirBtns();

		const stationList = document.createElement('div');
		stationList.style.cssText = `
			flex: 1; overflow-y: auto; padding: 6px 0;
			scrollbar-width: thin;
			scrollbar-color: rgba(255,255,255,0.15) transparent;
		`;

		stations.forEach((st, stIdx) => {
			const row = document.createElement('div');
			row.style.cssText = `
				padding: 8px 14px; cursor: pointer; color: #ddd;
				font-size: 12px; display: flex; align-items: center; gap: 8px;
				transition: background 0.12s; user-select: none;
			`;
			row.addEventListener('mouseenter', () => {
				row.style.background = 'rgba(255,255,255,0.08)';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
			});

			const dot = document.createElement('div');
			dot.style.cssText = `
				width: 8px; height: 8px; border-radius: 50%;
				border: 2px solid ${ls.parsed.color}; flex-shrink: 0;
				background: transparent;
			`;

			const name = document.createElement('span');
			name.textContent = st.name;

			row.appendChild(dot);
			row.appendChild(name);

			row.addEventListener('click', () => {
				trainSystem.goToStation(lineIdx, stIdx, selectedDir);
				if (!trainSystem.gameActive) {
					trainSystem.startGame();
					const camSystem = this.systemManager.getSystem(GameCameraSystem);
					if (camSystem) {
						camSystem.activate();
					}
					const startBtnEl = document.getElementById('game-start-btn');
					if (startBtnEl) startBtnEl.style.display = 'none';
					this.showGameUI();
					this.rebuildLineList(trainSystem);
				}
				const camSystem = this.systemManager.getSystem(GameCameraSystem);
				if (camSystem) camSystem.snapToTrain();
				this.hideStationPanel();
				this.updateLineColorIndicator(trainSystem);
			});

			stationList.appendChild(row);
		});

		panel.appendChild(header);
		panel.appendChild(dirSection);
		panel.appendChild(stationList);

		this.stationPanelEl = panel;
		this.container.appendChild(panel);
	}

	private hideStationPanel(): void {
		if (this.stationPanelEl) {
			this.stationPanelEl.remove();
			this.stationPanelEl = null;
		}
		if (this.lineListEl) this.lineListEl.style.display = 'flex';
	}

	private updateLineColorIndicator(trainSystem: TrainSystem): void {
		const ls = trainSystem.getCurrentLine();
		if (this.lineColorEl && ls) {
			this.lineColorEl.style.background = ls.parsed.color;
			this.lineColorEl.style.display = 'block';
		}
	}

	private static readonly SAVED_MAPS_KEY = 'metrorider-saved-maps';

	private loadSavedMaps(): {url: string; name: string; ts: number; type?: 'map' | 'user'}[] {
		try {
			const raw = localStorage.getItem(GameUISystem.SAVED_MAPS_KEY);
			if (raw) return JSON.parse(raw);
		} catch (e) {
			console.error('[GameUI] Failed to read saved maps:', e);
		}
		return [];
	}

	private saveMapEntry(url: string, name: string, type: 'map' | 'user' = 'map'): void {
		try {
			const maps = this.loadSavedMaps().filter(m => m.url !== url);
			maps.unshift({url, name, ts: Date.now(), type});
			if (maps.length > 50) maps.length = 50;
			localStorage.setItem(GameUISystem.SAVED_MAPS_KEY, JSON.stringify(maps));
		} catch (e) {
			console.error('[GameUI] Failed to save map entry:', e);
		}
	}

	private removeMapEntry(url: string): void {
		try {
			const maps = this.loadSavedMaps().filter(m => m.url !== url);
			localStorage.setItem(GameUISystem.SAVED_MAPS_KEY, JSON.stringify(maps));
		} catch (e) {
			console.error('[GameUI] Failed to remove map entry:', e);
		}
	}

	private createStartButton(trainSystem: TrainSystem): void {
		const CARD_BG = 'rgba(0,0,0,0.88)';
		const BTN_STYLE = `
			padding: 10px 20px; border-radius: 8px; cursor: pointer;
			font-size: 14px; font-weight: 500; text-align: center;
			user-select: none; border: none; width: 100%; box-sizing: border-box;
		`;

		const startBtn = document.createElement('div');
		startBtn.id = 'game-start-btn';
		startBtn.style.cssText = `
			position: absolute; bottom: 50%; left: 50%; transform: translate(-50%, 50%);
			background: ${CARD_BG}; color: #fff; padding: 24px 28px;
			border-radius: 14px; font-size: 18px; font-weight: 600;
			pointer-events: auto; backdrop-filter: blur(10px);
			border: 1px solid rgba(255,255,255,0.15); text-align: center;
			max-width: 460px; width: 92vw; max-height: 85vh; overflow-y: auto;
		`;

		const title = document.createElement('div');
		title.textContent = '\uD83D\uDE87 MetroRider';
		title.style.cssText = 'font-size: 22px; margin-bottom: 8px;';

		const subtitle = document.createElement('div');
		subtitle.textContent = 'Load a MetroDreamin map or user profile, or play the built-in map';
		subtitle.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 16px;';

		const urlInput = document.createElement('input');
		urlInput.type = 'text';
		urlInput.placeholder = 'Paste MetroDreamin map or user URL...';
		urlInput.style.cssText = `
			width: 100%; padding: 10px 14px; border-radius: 8px;
			border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1);
			color: #fff; font-size: 14px; margin-bottom: 10px;
			outline: none; box-sizing: border-box;
		`;

		const loadBtn = document.createElement('div');
		loadBtn.style.cssText = BTN_STYLE + 'background: rgba(59,130,246,0.8); color: #fff; margin-bottom: 8px;';
		loadBtn.textContent = 'Load';

		const playDefaultBtn = document.createElement('div');
		playDefaultBtn.textContent = 'Play Sample Map (Tel Aviv)';
		playDefaultBtn.style.cssText = BTN_STYLE + 'background: rgba(255,255,255,0.12); color: #fff; margin-bottom: 4px;';

		const statusEl = document.createElement('div');
		statusEl.style.cssText = 'font-size: 11px; color: #aaa; margin-top: 10px; display: none;';

		const savedSection = document.createElement('div');
		savedSection.style.cssText = 'margin-top: 16px; text-align: left;';

		const userMapsSection = document.createElement('div');
		userMapsSection.style.cssText = 'margin-top: 12px; text-align: left; display: none;';

		const startGameFlow = (): void => {
			trainSystem.startGame();
			const camSystem = this.systemManager.getSystem(GameCameraSystem);
			if (camSystem) {
				camSystem.activate();
				camSystem.snapToTrain();
			}
			startBtn.style.display = 'none';
			this.showGameUI();
			this.rebuildLineList(trainSystem);
			this.updateLineColorIndicator(trainSystem);
		};

		const loadMapFromUrl = async (url: string): Promise<void> => {
			statusEl.style.display = 'block';
			statusEl.textContent = 'Loading map...';

			try {
				const {fetchMetroDreaminMap} = await import('./data/MetroDreaminImporter');
				const mapData = await fetchMetroDreaminMap(url);
				trainSystem.loadMap(mapData);
				this.saveMapEntry(url, mapData.name);
				statusEl.textContent = `Loaded: ${mapData.name}`;
				setTimeout(startGameFlow, 500);
			} catch (err) {
				statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
				console.error('[GameUI] Failed to load map:', err);
			}
		};

		const showUserMaps = async (url: string): Promise<void> => {
			statusEl.style.display = 'block';
			statusEl.textContent = 'Loading user maps...';
			userMapsSection.style.display = 'block';
			userMapsSection.innerHTML = '';

			try {
				const {fetchUserMaps, buildMapUrl} = await import('./data/MetroDreaminImporter');
				const {username, maps} = await fetchUserMaps(url);

				statusEl.style.display = 'none';

				if (maps.length === 0) {
					statusEl.style.display = 'block';
					statusEl.textContent = `No maps found for "${username}"`;
					return;
				}

				this.saveMapEntry(url, `${username} (${maps.length} maps)`, 'user');
				renderSavedMaps();

				const header = document.createElement('div');
				header.style.cssText = 'font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 8px;';
				header.textContent = `${username}'s Maps (${maps.length})`;
				userMapsSection.appendChild(header);

				let searchInput: HTMLInputElement | null = null;
				if (maps.length > 6) {
					searchInput = document.createElement('input');
					searchInput.type = 'text';
					searchInput.placeholder = 'Search maps...';
					searchInput.style.cssText = `
						width: 100%; padding: 8px 12px; border-radius: 6px;
						border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08);
						color: #fff; font-size: 13px; margin-bottom: 8px;
						outline: none; box-sizing: border-box;
					`;
					userMapsSection.appendChild(searchInput);
				}

				const listContainer = document.createElement('div');
				listContainer.style.cssText = 'max-height: 250px; overflow-y: auto;';
				userMapsSection.appendChild(listContainer);

				const renderList = (filter: string): void => {
					listContainer.innerHTML = '';
					const filtered = filter
						? maps.filter(m => m.title.toLowerCase().includes(filter.toLowerCase()))
						: maps;

					if (filtered.length === 0) {
						const empty = document.createElement('div');
						empty.style.cssText = 'font-size: 12px; color: #666; padding: 12px; text-align: center;';
						empty.textContent = 'No maps match your search';
						listContainer.appendChild(empty);
						return;
					}

					for (const map of filtered) {
						const row = document.createElement('div');
						row.style.cssText = `
							padding: 10px 12px; margin-bottom: 4px; border-radius: 8px;
							background: rgba(255,255,255,0.06); cursor: pointer;
							transition: background 0.12s; border: 1px solid rgba(255,255,255,0.06);
						`;
						row.addEventListener('mouseenter', () => {
							row.style.background = 'rgba(59,130,246,0.2)';
							row.style.borderColor = 'rgba(59,130,246,0.4)';
						});
						row.addEventListener('mouseleave', () => {
							row.style.background = 'rgba(255,255,255,0.06)';
							row.style.borderColor = 'rgba(255,255,255,0.06)';
						});

						const mapTitle = document.createElement('div');
						mapTitle.style.cssText = 'font-size: 13px; font-weight: 600; color: #eee;';
						mapTitle.textContent = map.title;

						const mapMeta = document.createElement('div');
						mapMeta.style.cssText = 'font-size: 11px; color: #888; margin-top: 2px;';
						mapMeta.textContent = `${map.numLines} lines, ${map.numStations} stations`;

						row.appendChild(mapTitle);
						row.appendChild(mapMeta);

						row.addEventListener('click', () => {
							const mapUrl = buildMapUrl(map.id);
							loadMapFromUrl(mapUrl);
						});

						listContainer.appendChild(row);
					}
				};

				renderList('');

				if (searchInput) {
					const si = searchInput;
					si.addEventListener('input', () => {
						renderList(si.value);
					});
				}

			} catch (err) {
				statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
				console.error('[GameUI] Failed to load user maps:', err);
			}
		};

		const renderSavedMaps = (): void => {
			savedSection.innerHTML = '';
			const maps = this.loadSavedMaps();
			if (maps.length === 0) return;

			const header = document.createElement('div');
			header.style.cssText = `
				font-size: 11px; font-weight: 700; color: #888; margin-bottom: 8px;
				text-transform: uppercase; letter-spacing: 1px;
			`;
			header.textContent = 'Recent';
			savedSection.appendChild(header);

			const list = document.createElement('div');
			list.style.cssText = 'max-height: 180px; overflow-y: auto;';

			for (const map of maps.slice(0, 20)) {
				const isUser = map.type === 'user';
				const row = document.createElement('div');
				row.style.cssText = `
					display: flex; align-items: center; justify-content: space-between;
					padding: 8px 10px; margin-bottom: 3px; border-radius: 6px;
					background: rgba(255,255,255,0.05); cursor: pointer;
					transition: background 0.12s;
				`;
				row.addEventListener('mouseenter', () => { row.style.background = isUser ? 'rgba(168,85,247,0.15)' : 'rgba(59,130,246,0.15)'; });
				row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.05)'; });

				if (isUser) {
					const tag = document.createElement('span');
					tag.style.cssText = `
						font-size: 10px; font-weight: 700; color: #a855f7; margin-right: 8px;
						background: rgba(168,85,247,0.15); padding: 2px 6px; border-radius: 4px;
						flex-shrink: 0;
					`;
					tag.textContent = 'USER';
					row.appendChild(tag);
				}

				const nameEl = document.createElement('div');
				nameEl.style.cssText = 'font-size: 13px; color: #ddd; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
				nameEl.textContent = map.name;
				nameEl.title = map.name;

				const removeBtn = document.createElement('div');
				removeBtn.style.cssText = `
					font-size: 12px; color: #666; cursor: pointer; margin-left: 8px;
					padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
				`;
				removeBtn.textContent = '\u2715';
				removeBtn.title = 'Remove from recent';
				removeBtn.addEventListener('mouseenter', () => { removeBtn.style.color = '#ef4444'; });
				removeBtn.addEventListener('mouseleave', () => { removeBtn.style.color = '#666'; });
				removeBtn.addEventListener('click', (ev) => {
					ev.stopPropagation();
					this.removeMapEntry(map.url);
					renderSavedMaps();
				});

				row.appendChild(nameEl);
				row.appendChild(removeBtn);

				row.addEventListener('click', () => {
					if (isUser) {
						showUserMaps(map.url);
					} else {
						loadMapFromUrl(map.url);
					}
				});

				list.appendChild(row);
			}

			savedSection.appendChild(list);
		};

		loadBtn.addEventListener('click', async () => {
			const url = urlInput.value.trim();
			if (!url) return;

			const {isUserUrl, isMapUrl} = await import('./data/MetroDreaminImporter');

			if (isUserUrl(url)) {
				showUserMaps(url);
			} else if (isMapUrl(url)) {
				loadMapFromUrl(url);
			} else {
				statusEl.style.display = 'block';
				statusEl.textContent = 'Unrecognized URL. Use a metrodreamin.com/view/ or /user/ link.';
			}
		});

		playDefaultBtn.addEventListener('click', startGameFlow);

		renderSavedMaps();

		startBtn.appendChild(title);
		startBtn.appendChild(subtitle);
		startBtn.appendChild(urlInput);
		startBtn.appendChild(loadBtn);
		startBtn.appendChild(playDefaultBtn);
		startBtn.appendChild(statusEl);
		startBtn.appendChild(savedSection);
		startBtn.appendChild(userMapsSection);
		this.container.appendChild(startBtn);

		loadMapFromUrl(DEFAULT_MAP_URL);
	}

	private createSettingsButton(): void {
		const btn = document.createElement('div');
		btn.style.cssText = `
			position: absolute; top: 20px; right: 76px;
			width: 42px; height: 42px; border-radius: 10px;
			background: rgba(0,0,0,0.65); color: #fff;
			display: flex; align-items: center; justify-content: center;
			font-size: 20px; cursor: pointer; user-select: none;
			backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
			pointer-events: auto; transition: background 0.15s;
		`;
		btn.textContent = '\u2699';
		btn.title = 'Train & Sound Settings';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.65)'; });
		btn.addEventListener('click', () => {
			window.location.href = '/settings.html';
		});
		this.container.appendChild(btn);
	}

	private createDebugOverlay(): void {
		this.debugEl = document.createElement('div');
		this.debugEl.style.cssText = `
			position: absolute; bottom: 20px; left: 20px;
			background: rgba(0,0,0,0.85); color: #0f0; padding: 12px 16px;
			border-radius: 8px; font-size: 11px; font-family: monospace;
			line-height: 1.6; pointer-events: none; display: none;
			max-width: 400px; white-space: pre; backdrop-filter: blur(8px);
			border: 1px solid rgba(0,255,0,0.2);
		`;
		this.container.appendChild(this.debugEl);

		window.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey && !e.altKey) {
				this.debugVisible = !this.debugVisible;
				if (this.debugEl) {
					this.debugEl.style.display = this.debugVisible ? 'block' : 'none';
				}
			}
		});
	}

	private showGameUI(): void {
		if (this.speedEl) this.speedEl.style.display = 'block';
		if (this.stationEl?.parentElement) this.stationEl.parentElement.style.display = 'block';
	}

	private debugFrameCounter: number = 0;

	public update(deltaTime: number): void {
		if (!this.initialized) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) return;

		if (this.speedEl) {
			this.speedEl.textContent = `${Math.round(trainSystem.getSpeedKmH())} km/h`;
		}

		if (this.stationEl && trainSystem.stationState) {
			const ss = trainSystem.stationState;
			if (ss.arriving) {
				this.stationEl.textContent = ss.stationName;
			} else if (ss.nextStationIdx >= 0) {
				this.stationEl.textContent = `Next: ${ss.stationName}`;
			} else {
				this.stationEl.textContent = ss.stationName;
			}
		}

		if (this.directionEl) {
			this.directionEl.textContent = `\u2192 ${trainSystem.getTerminalName()}`;
		}

		if (this.lineColorEl) {
			const ls = trainSystem.getCurrentLine();
			if (ls && this.lineColorEl.style.display === 'none') {
				this.lineColorEl.style.background = ls.parsed.color;
				this.lineColorEl.style.display = 'block';
			}
		}

		if (this.debugVisible && this.debugEl) {
			this.debugFrameCounter++;
			if (this.debugFrameCounter % 10 === 0) {
				this.updateDebugOverlay(trainSystem);
			}
		}
	}

	private updateDebugOverlay(trainSystem: TrainSystem): void {
		if (!this.debugEl) return;

		const tp = trainSystem.trainPosition;
		const lines: string[] = [];

		lines.push('--- MetroRider Debug ---');

		if (tp) {
			lines.push(`Lat:     ${tp.lat.toFixed(6)}`);
			lines.push(`Lon:     ${tp.lon.toFixed(6)}`);
			lines.push(`Height:  ${tp.height.toFixed(2)}m`);
			lines.push(`Heading: ${(tp.heading * 180 / Math.PI).toFixed(1)}°`);
			lines.push(`World:   (${tp.x.toFixed(0)}, ${tp.y.toFixed(0)})`);
		}

		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		if (terrainSystem?.terrainHeightProvider && tp) {
			const th = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(tp.x, tp.y, true);
			lines.push(`Terrain: ${th !== null ? th.toFixed(2) + 'm' : 'null (not loaded)'}`);
		} else {
			lines.push('Terrain: provider not ready');
		}

		const camSystem = this.systemManager.getSystem(GameCameraSystem);
		if (camSystem) {
			lines.push(`Camera:  ${camSystem.getModeLabel()}`);
		}

		const ls = trainSystem.getCurrentLine();
		if (ls) {
			lines.push(`Line:    ${ls.parsed.name}`);
			lines.push(`Dist:    ${trainSystem.physicsState.trainDist.toFixed(0)}m / ${ls.track.totalLength.toFixed(0)}m`);
			lines.push(`Dir:     ${trainSystem.physicsState.direction > 0 ? 'Forward' : 'Backward'}`);
		}

		const trainRendering = this.systemManager.getSystem(TrainRenderingSystem);
		if (trainRendering) {
			const trackReady = trainRendering.trackMesh?.isMeshReady() ?? false;
			const trainReady = trainRendering.trainMesh?.isMeshReady() ?? false;
			const stationCount = trainRendering.stationMeshes.length;
			lines.push(`Meshes:  train=${trainReady ? 'OK' : 'NO'} track=${trackReady ? 'OK' : 'NO'} stations=${stationCount}`);
		}

		lines.push('');
		lines.push('Press D to hide');

		this.debugEl.textContent = lines.join('\n');
	}
}
