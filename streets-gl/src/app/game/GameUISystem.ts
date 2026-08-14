import System from '../System';
import Config from '~/app/Config';
import PassengerSystem from '~/app/game/passengers/PassengerSystem';
import ProfileUI from '~/app/game/profiles/ProfileUI';
import ScoringSystem from '~/app/game/scoring/ScoringSystem';
import SpeedLimitSystem from '~/app/game/limits/SpeedLimitSystem';
import ScoreUI from '~/app/game/scoring/ScoreUI';
import TrainSystem from './TrainSystem';
import GameCameraSystem, {GameCameraMode} from './GameCameraSystem';
import UISystem from '../systems/UISystem';
import RenderSystem from '../systems/RenderSystem';
import ServiceSystem from './service/ServiceSystem';
import {clockFace, describeLateness, latenessSeconds} from './service/ServiceTimetable';
import AudioSystem from './audio/AudioSystem';
import AssetConfigSystem from './assets/AssetConfigSystem';
import TerrainSystem from '../systems/TerrainSystem';
import MapWorkerSystem from '../systems/MapWorkerSystem';
import TrainRenderingSystem from './rendering/TrainRenderingSystem';
import SettingsSystem from '../systems/SettingsSystem';
import CabHud from './ui/CabHud';
import CabSheet, {type SheetRow} from './ui/CabSheet';
import {inferLineMode, lineModeInfo} from './data/LineModes';
import {
	releaseLabel,
	RELEASE_VERSION,
	RELEASE_CODENAME,
	RELEASE_SUMMARY,
	RELEASE_HIGHLIGHTS,
	RELEASE_EMBLEM,
	CHANGELOG,
	isReleaseAnnouncementUnseen,
	markReleaseAnnouncementSeen,
} from './version';


const DEFAULT_MAP_URL = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg%3D%3D';

export default class GameUISystem extends System {
	private container: HTMLElement | null = null;
	private speedEl: HTMLElement | null = null;
	private fpsEl: HTMLElement | null = null;
	private stationEl: HTMLElement | null = null;
	private directionEl: HTMLElement | null = null;
	private lineColorEl: HTMLElement | null = null;
	private cameraEl: HTMLElement | null = null;
	private lineListEl: HTMLElement | null = null;
	private lineListWrap: HTMLElement | null = null;
	private lineListToggle: HTMLElement | null = null;
	private lineListExpanded: boolean = true;
	private cabHud: CabHud | null = null;
	private cabSheet: CabSheet | null = null;
	/** What photo mode the interface is currently dressed for. */
	private photoModeApplied: boolean = false;
	private stationPanelEl: HTMLElement | null = null;
	private debugEl: HTMLElement | null = null;
	private debugVisible: boolean = false;
	private initialized: boolean = false;
	private mobile: boolean = false;
	private mobileTopBtns: HTMLElement[] = [];
	private mobileTopStripEl: HTMLElement | null = null;
	/** The legacy train-customisation button, now a row in the menu sheet. */
	private trainCustomiseEl: HTMLElement | null = null;
	/** The old emoji control cluster, superseded by the cab console. */
	private legacyControlsEl: HTMLElement | null = null;
	private infoPanelEl: HTMLElement | null = null;
	private timeEl: HTMLElement | null = null;
	private paxEl: HTMLElement | null = null;
	private limitEl: HTMLElement | null = null;
	private limitAheadEl: HTMLElement | null = null;
	private readonly profileUI: ProfileUI = new ProfileUI();
	private scoreUI: ScoreUI | null = null;
	private etaEl: HTMLElement | null = null;
	private lastMinute: number = -1;

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
		// Debug/testing handles (used by automated browser tests).
		(window as any).__trainSystem = trainSystem;
		(window as any).__gameSystems = this.systemManager;
		// Config is a module singleton, so a probe has no way to reach the
		// render tunables without this. Exposing it is what let the rail-LOD
		// fade be A/B'd against the SAME camera in one session — the first
		// attempt silently failed to reach Config and produced two runs with
		// identical settings whose difference was pure scene variance.
		(window as any).__config = Config;

		this.mobile = window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024);
		// Closed by default on every device: measured at roughly 38% of the
		// width and 63% of the height of an iPad portrait screen, permanently,
		// to list routes you pick once and never touch again.
		this.lineListExpanded = false;

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
		this.createMetroMapButton(trainSystem);
		this.createMapSelectionButton(trainSystem);
		if (this.mobile) {
			this.createMobileTopStrip();
		}
		this.createStartButton(trainSystem);
		this.container.appendChild(this.profileUI.createHudChip());
		this.bindScoring();
		this.createDebugOverlay();

		// Announce a new release once per version (tracked in localStorage).
		if (isReleaseAnnouncementUnseen()) {
			this.showReleaseSplash();
		}

		// System-wide toasts (e.g. auto-quality governor announcements).
		window.addEventListener('mr-toast', ((e: CustomEvent) => {
			this.showToast(String(e.detail), 2600);
		}) as EventListener);

		this.initialized = true;
	}

	private releaseSplashEl: HTMLElement | null = null;

	/**
	 * Full-screen release splash: version, codename, and what the update
	 * contains. Shown automatically once per version; reopenable any time
	 * via the version badge on the start screen.
	 */
	private showReleaseSplash(): void {
		if (this.releaseSplashEl) return;

		const overlay = document.createElement('div');
		overlay.id = 'release-splash';
		overlay.style.cssText = `
			position: fixed; inset: 0; z-index: 99999;
			background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(6px);
			display: flex; align-items: center; justify-content: center;
			pointer-events: auto; padding: 16px;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		`;

		const card = document.createElement('div');
		card.style.cssText = `
			background: linear-gradient(160deg, rgba(20, 28, 48, 0.98), rgba(10, 12, 20, 0.98));
			border: 1px solid rgba(127, 178, 255, 0.35); border-radius: 16px;
			max-width: 440px; width: 94vw; max-height: 85vh; overflow-y: auto;
			padding: 26px 28px; color: #fff; text-align: center;
			box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
		`;

		const emblem = document.createElement('div');
		emblem.textContent = RELEASE_EMBLEM;
		emblem.style.cssText = 'font-size: 40px; margin-bottom: 8px;';

		const heading = document.createElement('div');
		heading.textContent = RELEASE_CODENAME;
		heading.style.cssText = 'font-size: 24px; font-weight: 700; margin-bottom: 2px;';

		const versionLine = document.createElement('div');
		versionLine.textContent = `MetroRider v${RELEASE_VERSION}`;
		versionLine.style.cssText = 'font-size: 12px; color: #7fb2ff; font-weight: 600; margin-bottom: 14px; letter-spacing: 0.5px;';

		const blurb = document.createElement('div');
		blurb.textContent = RELEASE_SUMMARY;
		blurb.style.cssText = 'font-size: 13px; color: #ccc; line-height: 1.55; margin-bottom: 14px; text-align: left;';

		const list = document.createElement('ul');
		list.style.cssText = 'text-align: left; margin: 0 0 14px; padding-left: 20px; color: #ddd; font-size: 13px; line-height: 1.7;';
		for (const item of RELEASE_HIGHLIGHTS) {
			const li = document.createElement('li');
			li.textContent = item;
			list.appendChild(li);
		}

		// Full changelog — collapsed by default, one section per release.
		const changelogToggle = document.createElement('button');
		changelogToggle.id = 'release-changelog-toggle';
		changelogToggle.textContent = '📜 Changelog ▸';
		changelogToggle.style.cssText = `
			background: none; border: none; color: #7fb2ff; font-size: 12px;
			font-weight: 600; cursor: pointer; padding: 4px 0; margin-bottom: 10px;
		`;

		const changelogSection = document.createElement('div');
		changelogSection.id = 'release-changelog';
		changelogSection.style.cssText = `
			display: none; text-align: left; margin-bottom: 16px;
			border-top: 1px solid rgba(255,255,255,0.12); padding-top: 12px;
		`;

		for (const entry of CHANGELOG) {
			const head = document.createElement('div');
			head.style.cssText = 'font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 2px;';
			head.textContent = `v${entry.version} — “${entry.codename}”`;

			const date = document.createElement('div');
			date.style.cssText = 'font-size: 11px; color: #888; margin-bottom: 6px;';
			date.textContent = entry.date;

			const ul = document.createElement('ul');
			ul.style.cssText = 'margin: 0 0 14px; padding-left: 18px; color: #bbb; font-size: 12px; line-height: 1.6;';
			for (const change of entry.changes) {
				const li = document.createElement('li');
				li.textContent = change;
				ul.appendChild(li);
			}

			changelogSection.appendChild(head);
			changelogSection.appendChild(date);
			changelogSection.appendChild(ul);
		}

		changelogToggle.addEventListener('click', () => {
			const open = changelogSection.style.display !== 'none';
			changelogSection.style.display = open ? 'none' : 'block';
			changelogToggle.textContent = open ? '📜 Changelog ▸' : '📜 Changelog ▾';
		});

		const dismissBtn = document.createElement('button');
		dismissBtn.id = 'release-splash-dismiss';
		dismissBtn.textContent = "Let's ride";
		dismissBtn.style.cssText = `
			padding: 11px 36px; border-radius: 10px; border: none;
			background: #3b82f6; color: #fff; font-size: 15px; font-weight: 600;
			cursor: pointer;
		`;
		dismissBtn.addEventListener('mouseenter', () => { dismissBtn.style.background = '#2563eb'; });
		dismissBtn.addEventListener('mouseleave', () => { dismissBtn.style.background = '#3b82f6'; });

		const dismiss = (): void => {
			markReleaseAnnouncementSeen();
			overlay.remove();
			this.releaseSplashEl = null;
		};
		dismissBtn.addEventListener('click', dismiss);
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay) dismiss();
		});

		card.appendChild(emblem);
		card.appendChild(heading);
		card.appendChild(versionLine);
		card.appendChild(blurb);
		card.appendChild(list);
		card.appendChild(changelogToggle);
		card.appendChild(changelogSection);
		card.appendChild(dismissBtn);
		overlay.appendChild(card);
		document.body.appendChild(overlay);
		this.releaseSplashEl = overlay;
	}

	private createMobileTopStrip(): void {
		const strip = document.createElement('div');
		strip.style.cssText = `
			position: absolute; top: 40px; right: 4px;
			display: flex; flex-direction: column; gap: 4px;
			pointer-events: auto; align-items: center;
		`;
		for (const btn of this.mobileTopBtns) {
			strip.appendChild(btn);
		}
		this.container.appendChild(strip);
		this.mobileTopStripEl = strip;
	}

	private createSpeedometer(): void {
		const m = this.mobile;
		this.infoPanelEl = document.createElement('div');
		this.infoPanelEl.style.cssText = m
			? `position: absolute; top: 4px; left: 4px;
				background: rgba(0,0,0,0.78); color: #fff; padding: 6px 10px;
				border-radius: 8px; backdrop-filter: blur(12px);
				border: 1px solid rgba(255,255,255,0.08);
				display: none; min-width: 130px; font-size: 11px;`
			: `position: absolute; top: 20px; left: 20px;
				background: rgba(0,0,0,0.78); color: #fff; padding: 10px 16px;
				border-radius: 10px; backdrop-filter: blur(12px);
				border: 1px solid rgba(255,255,255,0.08);
				display: none; min-width: 190px; font-size: 13px;`;

		const row = (label: string, valueId: string, big: boolean = false): HTMLElement => {
			const r = document.createElement('div');
			r.style.cssText = `display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 3px;`;
			const lbl = document.createElement('span');
			lbl.style.cssText = `color: #888; font-size: ${m ? '9px' : '10px'}; text-transform: uppercase; letter-spacing: 0.5px;`;
			lbl.textContent = label;
			const val = document.createElement('span');
			val.id = valueId;
			val.style.cssText = big
				? `font-size: ${m ? '16px' : '20px'}; font-weight: 700; font-variant-numeric: tabular-nums;`
				: `font-size: ${m ? '12px' : '14px'}; font-weight: 600; font-variant-numeric: tabular-nums;`;
			r.appendChild(lbl);
			r.appendChild(val);
			return r;
		};

		this.infoPanelEl.appendChild(row('FPS', 'hud-fps-val', false));
		this.infoPanelEl.appendChild(row('SPEED', 'hud-speed-val', true));
		this.infoPanelEl.appendChild(row('TIME', 'hud-time-val', false));

		const sep = document.createElement('div');
		sep.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;';
		this.infoPanelEl.appendChild(sep);

		this.infoPanelEl.appendChild(this.createLimitSignRow());
		this.infoPanelEl.appendChild(row('PAX', 'hud-pax-val', false));
		this.infoPanelEl.appendChild(row('NEXT', 'hud-eta-val', false));

		// Superseded by the cab HUD; kept in the tree because the update loop
		// still writes to its rows, which other surfaces read.
		this.infoPanelEl.style.display = 'none';
		this.container.appendChild(this.infoPanelEl);

		this.cabHud = new CabHud(this.container, action => this.onCabAction(action));
		this.cabSheet = new CabSheet(this.container);

		this.speedEl = document.getElementById('hud-speed-val') ?? this.infoPanelEl;
		this.fpsEl = document.getElementById('hud-fps-val') ?? this.infoPanelEl;
		this.timeEl = document.getElementById('hud-time-val') ?? this.infoPanelEl;
		this.paxEl = document.getElementById('hud-pax-val') ?? this.infoPanelEl;
		this.limitEl = document.getElementById('hud-limit-sign');
		this.limitAheadEl = document.getElementById('hud-limit-ahead');
		this.etaEl = document.getElementById('hud-eta-val') ?? this.infoPanelEl;
	}

	/**
	 * The limit as a road-style sign — a white disc with a red ring — rather
	 * than a number in a list. A sign is read at a glance and says "this is a
	 * rule of the line", which a text row does not.
	 */
	private createLimitSignRow(): HTMLElement {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 6px 0 2px;';

		const sign = document.createElement('div');
		sign.id = 'hud-limit-sign';
		const size = this.mobile ? 34 : 42;
		// The shape, colours and number format are set per frame from the
		// railway's own signage — a German main line, a French TIV, a British
		// mph plate and a tram's road disc are all different objects.
		sign.style.cssText = `
			width: ${size}px; height: ${size}px;
			display: flex; align-items: center; justify-content: center;
			font-weight: 800; font-size: ${this.mobile ? 14 : 16}px;
			box-shadow: 0 1px 4px rgba(0,0,0,0.5); flex: none; line-height: 1;
		`;
		sign.textContent = '—';

		const ahead = document.createElement('div');
		ahead.id = 'hud-limit-ahead';
		ahead.style.cssText = 'font-size: 11px; color: #bbb; line-height: 1.3;';

		wrap.appendChild(sign);
		wrap.appendChild(ahead);
		return wrap;
	}

	private createStationInfo(): void {
		const wrap = document.createElement('div');
		if (this.mobile) {
			wrap.style.cssText = `
				position: absolute; top: 108px; left: 4px; right: 48px;
				background: rgba(0,0,0,0.7); color: #fff; padding: 4px 10px;
				border-radius: 6px; text-align: center; backdrop-filter: blur(10px);
				display: none; overflow: hidden;
			`;
		} else {
			wrap.style.cssText = `
				position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
				background: rgba(0,0,0,0.7); color: #fff; padding: 10px 20px;
				border-radius: 10px; text-align: center; backdrop-filter: blur(10px);
				display: none; min-width: 200px; max-width: calc(100vw - 360px);
			`;
		}

		this.lineColorEl = document.createElement('div');
		this.lineColorEl.style.cssText = `
			width: 100%; height: 3px; border-radius: 2px;
			margin-bottom: 4px; display: none;
		`;

		this.stationEl = document.createElement('div');
		this.stationEl.style.cssText = this.mobile
			? 'font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
			: 'font-size: 16px; font-weight: 600;';
		this.stationEl.textContent = '';

		this.directionEl = document.createElement('div');
		this.directionEl.style.cssText = this.mobile
			? 'font-size: 10px; color: #aaa; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
			: 'font-size: 12px; color: #aaa; margin-top: 4px;';
		this.directionEl.textContent = '';

		wrap.appendChild(this.lineColorEl);
		wrap.appendChild(this.stationEl);
		wrap.appendChild(this.directionEl);
		this.container.appendChild(wrap);
		this.stationEl.parentElement.style.display = 'none';
	}

	private createControls(trainSystem: TrainSystem): void {
		const m = this.mobile;
		const btnSize = m ? 40 : 52;
		const btnRadius = m ? 10 : 12;
		const fontSize = m ? 17 : 22;
		const gap = m ? 6 : 8;

		const controlsWrap = document.createElement('div');
		if (m) {
			controlsWrap.style.cssText = `
				position: absolute; bottom: 12px; right: 8px;
				display: flex; flex-direction: column; gap: ${gap}px; align-items: center;
				pointer-events: auto;
			`;
		} else {
			controlsWrap.style.cssText = `
				position: absolute; bottom: 30px; right: 20px;
				display: flex; flex-direction: row; gap: ${gap}px; align-items: flex-end;
				pointer-events: auto;
			`;
		}

		const createBtn = (emoji: string, tooltip: string): HTMLElement => {
			const btn = document.createElement('div');
			btn.style.cssText = `
				width: ${btnSize}px; height: ${btnSize}px; border-radius: ${btnRadius}px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: ${fontSize}px; cursor: pointer; user-select: none;
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

		const doorsBtn = createBtn('\u229F', 'Doors');
		doorsBtn.addEventListener('click', () => trainSystem.toggleDoors());

		this.cameraEl = createBtn('\uD83C\uDFA5', 'Camera');
		this.cameraEl.addEventListener('click', () => {
			const camSystem = this.systemManager.getSystem(GameCameraSystem);
			if (!camSystem) return;
			if (!camSystem.isActive()) {
				// Follow camera should always own the view during a game;
				// re-activate defensively if something turned it off.
				camSystem.activate();
				camSystem.snapToTrain();
			}
			camSystem.cycleMode();
			this.showCameraModeToast(camSystem.getModeLabel());
		});

		if (m) {
			const row1 = document.createElement('div');
			row1.style.cssText = `display: flex; flex-direction: row; gap: ${gap}px;`;
			row1.appendChild(accelBtn);
			row1.appendChild(hornBtn);
			row1.appendChild(doorsBtn);

			const row2 = document.createElement('div');
			row2.style.cssText = `display: flex; flex-direction: row; gap: ${gap}px;`;
			row2.appendChild(brakeBtn);
			row2.appendChild(reverseBtn);
			row2.appendChild(this.cameraEl);

			controlsWrap.appendChild(row1);
			controlsWrap.appendChild(row2);
		} else {
			const col1 = document.createElement('div');
			col1.style.cssText = `display: flex; flex-direction: column; gap: ${gap}px;`;
			col1.appendChild(accelBtn);
			col1.appendChild(brakeBtn);

			const col2 = document.createElement('div');
			col2.style.cssText = `display: flex; flex-direction: column; gap: ${gap}px;`;
			col2.appendChild(hornBtn);
			col2.appendChild(reverseBtn);

			const col3 = document.createElement('div');
			col3.style.cssText = `display: flex; flex-direction: column; gap: ${gap}px;`;
			col3.appendChild(doorsBtn);
			col3.appendChild(this.cameraEl);

			controlsWrap.appendChild(col1);
			controlsWrap.appendChild(col2);
			controlsWrap.appendChild(col3);
		}

		this.container.appendChild(controlsWrap);
		this.legacyControlsEl = controlsWrap;
	}

	private createLineSelector(trainSystem: TrainSystem): void {
		const m = this.mobile;
		const topOffset = m ? 112 : 70;

		this.lineListWrap = document.createElement('div');
		this.lineListWrap.style.cssText = `
			position: absolute; top: ${topOffset}px; right: ${m ? 8 : 20}px;
			pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end;
		`;

		this.lineListToggle = document.createElement('div');
		this.lineListToggle.style.cssText = `
			width: ${m ? 32 : 36}px; height: ${m ? 32 : 36}px; border-radius: 8px;
			background: rgba(0,0,0,0.65); color: #fff;
			display: flex; align-items: center; justify-content: center;
			font-size: ${m ? 14 : 16}px; cursor: pointer; user-select: none;
			backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
			margin-bottom: 4px; transition: background 0.15s;
		`;
		this.lineListToggle.title = 'Toggle line list';
		this.lineListToggle.addEventListener('mouseenter', () => {
			if (this.lineListToggle) this.lineListToggle.style.background = 'rgba(255,255,255,0.2)';
		});
		this.lineListToggle.addEventListener('mouseleave', () => {
			if (this.lineListToggle) this.lineListToggle.style.background = 'rgba(0,0,0,0.65)';
		});
		this.lineListToggle.addEventListener('click', () => {
			this.lineListExpanded = !this.lineListExpanded;
			this.applyLineListVisibility();
		});

		this.lineListEl = document.createElement('div');
		this.lineListEl.style.cssText = `
			display: flex; flex-direction: column; gap: 4px;
			max-height: calc(100vh - ${topOffset + 50}px);
			overflow-y: auto; scrollbar-width: thin;
			scrollbar-color: rgba(255,255,255,0.15) transparent;
		`;

		this.lineListWrap.appendChild(this.lineListToggle);
		this.lineListWrap.appendChild(this.lineListEl);

		this.rebuildLineList(trainSystem);
		this.applyLineListVisibility();
		this.container.appendChild(this.lineListWrap);
	}

	/** Buttons on the cab console and utility rail. */
	private onCabAction(action: 'map' | 'camera' | 'menu' | 'doors' | 'horn'): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (action === 'doors') {
			trainSystem?.toggleDoors();
			return;
		}
		if (action === 'horn') {
			this.systemManager.getSystem(AudioSystem)?.playHorn?.();
			return;
		}
		if (action === 'camera') {
			this.openCameraSheet();
			return;
		}
		if (action === 'map') {
			document.getElementById('game-metro-map-btn')?.click();
			return;
		}

		// Menu: what you can go and do, summoned rather than permanent.
		this.openMenuSheet();
	}

	/**
	 * The menu used to BE the line picker, which left settings with no door
	 * into them at all once the game had started.
	 */
	private openMenuSheet(): void {
		if (!this.cabSheet) return;

		if (this.cabSheet.isOpen()) {
			this.cabSheet.close();
			return;
		}

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const lineCount = trainSystem?.lines.length ?? 0;

		this.cabSheet.show('Menu', [
			// keepOpen, because these REPLACE the menu with the next sheet. The
			// toggle guard on the openers would read the still-open menu as
			// "already showing" and close it instead of drilling in.
			{
				badge: 'LINE',
				badgeColor: '#4fb6ef',
				title: 'Pick a line',
				subtitle: `${lineCount} routes across the country`,
				keepOpen: true,
				onSelect: (): void => this.showLinePicker(),
			},
			{
				badge: 'VIEW',
				badgeColor: '#8b7bef',
				title: 'Camera',
				subtitle: 'Cab, chase, orbit, ride, trackside, photo',
				keepOpen: true,
				onSelect: (): void => this.showCameraSheet(),
			},
			{
				badge: 'SET',
				badgeColor: '#f0a63f',
				title: 'Settings',
				subtitle: 'Driving, announcements, sound, graphics',
				keepOpen: true,
				onSelect: (): void => this.openSettingsSheet(),
			},
			// These two were only reachable from the old emoji strip. Hiding
			// that strip without rehoming them would have removed two real
			// features rather than tidying the screen.
			{
				badge: 'TIME',
				badgeColor: '#4fd996',
				title: 'Timetable',
				subtitle: 'When each stop is due, and how you are doing',
				keepOpen: true,
				onSelect: (): void => this.openTimetableSheet(),
			},
			{
				badge: 'INFO',
				badgeColor: '#4fb6ef',
				title: 'About this line',
				subtitle: 'How long it is, its longest run, who is waiting',
				keepOpen: true,
				onSelect: (): void => this.openLineFactsSheet(),
			},
			{
				badge: 'REV',
				badgeColor: '#8b7bef',
				title: 'Turn the train around',
				subtitle: 'Drive the line back the other way',
				onSelect: (): void => this.systemManager.getSystem(TrainSystem)?.reverseDirection(),
			},
			{
				badge: 'CITY',
				badgeColor: '#ef7b9c',
				title: 'Drive another map',
				subtitle: 'London, New York, Paris, Singapore — and everything else',
				keepOpen: true,
				onSelect: (): void => this.openWorldTourSheet(),
			},
			{
				badge: 'LOAD',
				badgeColor: '#8b7bef',
				title: 'Load a map by link',
				subtitle: 'Paste any MetroDreamin map or profile',
				onSelect: (): void => document.getElementById('game-map-select-btn')?.click(),
			},
			{
				badge: 'TRN',
				badgeColor: '#4fd996',
				title: 'Trains & sounds',
				subtitle: 'Pick the models and horns your train uses',
				onSelect: (): void => this.trainCustomiseEl?.click(),
			},
		]);
	}

	/**
	 * Camera and driving assists.
	 *
	 * Cycling blindly through views with a button told you nothing about where
	 * you would land; this names them. Simple/Advanced lives here too because
	 * it is the same decision — how much the game is doing for you.
	 */
	private openCameraSheet(): void {
		if (!this.cabSheet) return;

		if (this.cabSheet.isOpen()) {
			this.cabSheet.close();
			return;
		}

		this.showCameraSheet();
	}

	private showCameraSheet(): void {
		const current = this.systemManager.getSystem(GameCameraSystem)?.getModeLabel?.() ?? '';

		this.cabSheet?.show(`View — now ${current}`, this.cameraSheetRows());
	}

	/**
	 * The rows are rebuilt rather than mutated, because the driving row shows
	 * the mode it is currently in — after a tap it has to redraw as the other
	 * one, in place, while the sheet stays up.
	 */
	private cameraSheetRows(): SheetRow[] {
		const settings = this.systemManager.getSystem(SettingsSystem)?.settings;
		const simple = settings?.get('driveMode')?.statusValue === 'simple';

		return [
			{badge: 'CAB', badgeColor: '#4fb6ef', title: 'Cab', subtitle: 'From the driver\'s seat',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Cab)},
			{badge: 'CHA', badgeColor: '#4fd996', title: 'Chase', subtitle: 'Behind the train',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Chase)},
			{badge: 'ORB', badgeColor: '#f0a63f', title: 'Orbit', subtitle: 'Look around from outside',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Orbit)},
			{badge: 'RIDE', badgeColor: '#8b7bef', title: 'Ride', subtitle: 'A seat by the window, watching the city go by',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Ride)},
			{badge: 'SIDE', badgeColor: '#ef7b9c', title: 'Trackside', subtitle: 'Stand by the line and watch your train go past',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Trackside)},
			{badge: 'PHO', badgeColor: '#dfe6ee', title: 'Photo', subtitle: 'Free look with the controls out of the way',
				onSelect: (): void => this.setCameraMode(GameCameraMode.Photo)},
			{
				badge: simple ? 'SIM' : 'ADV',
				badgeColor: simple ? '#4fd996' : '#f0a63f',
				title: simple ? 'Simple driving' : 'Advanced driving',
				subtitle: simple
					? 'Gentler, eases back to the limit, nothing to lose — tap for Advanced'
					: 'Full control, the limit is yours to judge, runs are scored — tap for Simple',
				keepOpen: true,
				onSelect: (): void => {
					settings?.update('driveMode', {statusValue: simple ? 'advanced' : 'simple'});
					this.cabSheet?.setRows(this.cameraSheetRows());
				},
			},
		];
	}

	/** "NEXT STOP · DUE 09:14 · 2 MIN LATE" — state, schedule, standing. */
	private stationMetaLine(doorsOpen: boolean | undefined, arriving: boolean | undefined): string {
		const state = doorsOpen ? 'DOORS OPEN' : arriving ? 'ARRIVING' : 'NEXT STOP';
		const service = this.systemManager.getSystem(ServiceSystem);
		const due = service?.dueAtNext();

		if (due === null || due === undefined) return state;

		const late = service?.currentLateness() ?? null;
		const there = doorsOpen || arriving;

		// You cannot be EARLY until you have arrived — before that you have
		// simply not got there yet, and a board reading "6 MIN EARLY" halfway
		// down a leg is telling the driver something untrue. Running late IS
		// worth knowing while moving, because it is already the case.
		const show = there || (late !== null && late >= 45);
		const standing = show ? describeLateness(late) : '';

		return `${state} · DUE ${clockFace(due)}${standing ? ` · ${standing.toUpperCase()}` : ''}`;
	}

	/** The whole working timetable, due against actual. */
	private openTimetableSheet(): void {
		const service = this.systemManager.getSystem(ServiceSystem);
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();
		const stops = service?.timetable() ?? [];

		if (!ls || !this.cabSheet || stops.length === 0) return;

		const rows: SheetRow[] = stops.map(stop => {
			const actual = service?.actualFor(stop.stationIndex);
			const late = actual === undefined ? null : latenessSeconds(stop, actual);
			const name = ls.parsed.stations[stop.stationIndex]?.name ?? '—';

			return {
				badge: clockFace(stop.dueAt),
				badgeColor: actual === undefined
					? '#5d6f81'
					: late !== null && late >= 45 ? '#ef7b9c' : '#4fd996',
				title: name,
				subtitle: actual === undefined
					? 'Still to come'
					: `Arrived ${clockFace(actual)} — ${describeLateness(late)}`,
				readOnly: true,
				onSelect: (): void => undefined,
			};
		});

		this.cabSheet.show('Timetable', rows);
	}

	/**
	 * Every city on the home profile, to drive.
	 *
	 * The list is fetched live rather than written down here, for one reason:
	 * the maps are still being drawn. A hard-coded set of cities would be a
	 * snapshot that goes stale the moment another one is finished, and would
	 * mean guessing at map ids — which is how you end up importing a stranger's
	 * map because the id happened to be valid.
	 *
	 * Sorted biggest first, because the big ones are the famous ones.
	 */
	private openWorldTourSheet(): void {
		if (!this.cabSheet) return;

		this.cabSheet.show('Maps to drive', [{
			badge: '…', badgeColor: '#5d6f81',
			title: 'Looking up the maps…',
			subtitle: 'Fetching the latest list',
			readOnly: true,
			onSelect: (): void => undefined,
		}]);

		void this.loadWorldTourRows();
	}

	private async loadWorldTourRows(): Promise<void> {
		try {
			const response = await fetch(`/api/metrodreamin/user/${GameUISystem.HOME_PROFILE_ID}?limit=200`, {
				headers: {Accept: 'application/json'},
			});

			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json() as {
				username: string;
				maps: {id: string; title: string; numLines: number; numStations: number}[];
			};

			// A one-station sketch is not somewhere to drive.
			const worth = data.maps
				.filter(m => m.numStations >= 6 && m.numLines >= 1)
				.sort((a, b) => b.numStations - a.numStations);

			if (!this.cabSheet?.isOpen()) return;

			if (worth.length === 0) {
				this.cabSheet.setRows([{
					badge: '—', badgeColor: '#5d6f81', title: 'No maps big enough to drive yet',
					subtitle: `${data.username} has ${data.maps.length} maps, none with six stations`,
					readOnly: true, onSelect: (): void => undefined,
				}]);

				return;
			}

			this.cabSheet.setRows(worth.map(map => ({
				badge: String(map.numStations),
				badgeColor: map.numStations >= 200 ? '#ef7b9c' : map.numStations >= 60 ? '#f0a63f' : '#4fb6ef',
				title: map.title,
				subtitle: `${map.numLines} line${map.numLines === 1 ? '' : 's'} · ${map.numStations} stations`,
				onSelect: (): void => void this.driveAnotherCity(map.id, map.title),
			})));
		} catch (err) {
			if (!this.cabSheet?.isOpen()) return;

			this.cabSheet.setRows([{
				badge: '!', badgeColor: '#ef7b9c',
				title: 'Could not reach the map list',
				subtitle: err instanceof Error ? err.message : 'Check the connection and try again',
				readOnly: true,
				onSelect: (): void => undefined,
			}]);
		}
	}

	/** Load a different city and start driving it. */
	private async driveAnotherCity(mapId: string, title: string): Promise<void> {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem) return;

		this.cabSheet?.show('Maps to drive', [{
			badge: '…', badgeColor: '#4fb6ef', title: `Loading ${title}…`,
			subtitle: 'Drawing the lines and the streets around them',
			readOnly: true, onSelect: (): void => undefined,
		}]);

		try {
			const {fetchMetroDreaminMap, buildMapUrl} = await import('./data/MetroDreaminImporter');
			const url = buildMapUrl(mapId);
			const mapData = await fetchMetroDreaminMap(url);

			trainSystem.loadMap(mapData);
			this.currentMapUrl = url;
			this.saveMapEntry(url, mapData.name);

			// loadMap re-selects line 0 and moves the map camera; the follow
			// camera still has to be told the train is somewhere else entirely.
			const camera = this.systemManager.getSystem(GameCameraSystem);

			camera?.activate();
			camera?.snapToTrain();

			this.cabSheet?.close();
		} catch (err) {
			this.cabSheet?.setRows([{
				badge: '!', badgeColor: '#ef7b9c',
				title: `Could not load ${title}`,
				subtitle: err instanceof Error ? err.message : 'Try another city',
				readOnly: true, onSelect: (): void => undefined,
			}]);
		}
	}

	/**
	 * Facts about the line being driven.
	 *
	 * Every number here is computed from the line actually loaded — its track
	 * length, its real station spacing, the passengers waiting on it right now.
	 * Nothing is written down anywhere in advance, so it stays true for a map
	 * imported five minutes ago as much as for the built-in one.
	 */
	private openLineFactsSheet(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();

		if (!ls || !this.cabSheet) return;

		const km = (m: number): string => `${(m / 1000).toFixed(1)} km`;
		const stops = ls.parsed.stations.length;
		const length = ls.track.totalLength;

		// Gaps between consecutive stops, from the real distances along track.
		const gaps: number[] = [];

		for (let i = 1; i < ls.realStationDists.length; i++) {
			gaps.push(ls.realStationDists[i] - ls.realStationDists[i - 1]);
		}

		const longest = gaps.length ? Math.max(...gaps) : 0;
		const shortest = gaps.length ? Math.min(...gaps) : 0;
		const longestAt = gaps.indexOf(longest);
		const waiting = this.systemManager.getSystem(PassengerSystem)?.getTotalWaiting() ?? 0;
		const name = (i: number): string => ls.parsed.stations[i]?.name ?? '—';

		const limits = this.systemManager.getSystem(SpeedLimitSystem);
		const mode = lineModeInfo(limits?.lineMode);
		const topKmh = limits && limits.lineCeiling > 0
			? Math.round(limits.lineCeiling * 3.6)
			: mode.topKmh;

		const rows: SheetRow[] = [
			{
				badge: mode.icon, badgeColor: ls.parsed.color,
				title: mode.label,
				subtitle: `Runs up to ${topKmh} km/h on this line`,
				readOnly: true, onSelect: (): void => undefined,
			},
			{badge: 'LEN', badgeColor: '#4fb6ef', title: km(length), subtitle: 'End to end', readOnly: true, onSelect: (): void => undefined},
			{badge: 'STOP', badgeColor: '#4fd996', title: `${stops} stations`, subtitle:
				gaps.length ? `About ${km(length / gaps.length)} between stops` : 'A single stop', readOnly: true, onSelect: (): void => undefined},
		];

		if (gaps.length) {
			rows.push({
				badge: 'FAR', badgeColor: '#f0a63f',
				title: `Longest run ${km(longest)}`,
				subtitle: `${name(longestAt)} to ${name(longestAt + 1)}`,
				readOnly: true,
				onSelect: (): void => undefined,
			});
			rows.push({
				badge: 'NEAR', badgeColor: '#8b7bef',
				title: `Shortest hop ${km(shortest)}`,
				subtitle: 'The quickest stop to stop on the line',
				readOnly: true,
				onSelect: (): void => undefined,
			});
		}

		rows.push({
			badge: 'PAX', badgeColor: '#ef7b9c',
			title: `${waiting} people waiting`,
			subtitle: 'On platforms along this line right now',
			readOnly: true,
			onSelect: (): void => undefined,
		});

		if (ls.parsed.isLoop) {
			rows.push({
				badge: 'LOOP', badgeColor: '#4fd996', title: 'This line is a loop',
				subtitle: 'It comes back round to where it started',
				readOnly: true, onSelect: (): void => undefined,
			});
		}

		this.cabSheet.show(ls.parsed.name, rows);
	}

	/**
	 * Settings, in the game.
	 *
	 * The React settings modal is only reachable from the legacy nav panel,
	 * which the driving interface does not mount — so once the game started,
	 * EVERY setting was unreachable, including ones added for the player
	 * (driving mode, announcements). A setting nobody can change is not a
	 * setting. These are the five worth a player's attention; the rest stay
	 * developer surface.
	 */
	private openSettingsSheet(): void {
		if (!this.cabSheet) return;

		this.cabSheet.show('Settings', this.settingsSheetRows());
	}

	/**
	 * Move the world clock to the chosen part of the day.
	 *
	 * The engine already had all of this — `MapTimeSystem` computes the sun and
	 * moon from a timestamp and the real latitude, eases between them, and
	 * lights building windows after dark. It was simply unreachable, because
	 * the only control that set the time lived on the React panel the driving
	 * interface does not mount.
	 */
	private applyTimeOfDay(): void {
		const settings = this.systemManager.getSystem(SettingsSystem)?.settings;
		const choice = settings?.get('timeOfDay')?.statusValue ?? 'now';
		const ui = this.systemManager.getSystem(UISystem);

		if (!ui) return;

		// Every choice here, including "now", wants a real sun worked out from
		// the clock. Without this the world stays on whichever fixed light
		// preset was saved, and moving the time changes nothing on screen —
		// measured: the sun sat at exactly (-1,-1,-1) for 08:00 and 22:00 alike.
		ui.setMapTimeMode(0);

		if (choice === 'now') {
			ui.setMapTime(Date.now());
			return;
		}

		const hours: Record<string, number> = {morning: 8, midday: 13, evening: 18.5, night: 22};
		const hour = hours[choice];

		if (hour === undefined) return;

		// Today at that hour, local time — so the sun sits where the player
		// expects for the city they are driving in.
		const when = new Date();

		when.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
		ui.setMapTime(when.getTime());
	}

	private settingsSheetRows(): SheetRow[] {
		const settings = this.systemManager.getSystem(SettingsSystem)?.settings;
		const audio = this.systemManager.getSystem(AudioSystem);
		const rows: SheetRow[] = [];

		// One generic row per status setting: show where it is, tap to advance.
		const cycler = (key: string, title: string, badges: Record<string, string>): SheetRow | null => {
			const setting = settings?.get(key);
			const config = (Config.SettingsSchema as Record<string, {
				status?: string[];
				statusLabels?: string[];
			}>)[key];

			if (!setting || !config?.status) return null;

			const values = config.status;
			const at = Math.max(0, values.indexOf(setting.statusValue));
			const label = config.statusLabels?.[at] ?? values[at];

			return {
				badge: badges[values[at]] ?? values[at].toUpperCase().slice(0, 4),
				badgeColor: values[at] === 'off' ? '#7a8899' : '#4fd996',
				title,
				subtitle: `${label} — tap to change`,
				keepOpen: true,
				onSelect: (): void => {
					settings?.update(key, {statusValue: values[(at + 1) % values.length]});
					this.cabSheet?.setRows(this.settingsSheetRows());
				},
			};
		};

		const driving = cycler('driveMode', 'Driving', {simple: 'SIM', advanced: 'ADV'});
		const announce = cycler('announcements', 'Station announcements', {on: 'ON', off: 'OFF'});
		const time = cycler('timeOfDay', 'Time of day', {
			now: 'NOW', morning: 'AM', midday: 'NOON', evening: 'DUSK', night: 'NIGHT',
		});

		if (driving) rows.push(driving);
		if (time) {
			// The cycler only stores the value; the world clock has to be moved.
			const advance = time.onSelect;

			time.onSelect = (): void => {
				advance();
				this.applyTimeOfDay();
			};
			rows.push(time);
		}
		if (announce) rows.push(announce);

		const traffic = cycler('ambientTrains', 'Other trains', {on: 'ON', off: 'OFF'});

		if (traffic) rows.push(traffic);

		// Sound is the audio system's own state rather than a stored setting,
		// so it cannot go through the same cycler.
		rows.push({
			badge: audio?.isMuted() ? 'OFF' : 'ON',
			badgeColor: audio?.isMuted() ? '#7a8899' : '#4fd996',
			title: 'Sound',
			subtitle: audio?.isMuted() ? 'Muted — tap to turn on' : 'On — tap to mute',
			keepOpen: true,
			onSelect: (): void => {
				audio?.toggleMute();
				this.cabSheet?.setRows(this.settingsSheetRows());
			},
		});

		const graphics = cycler('performanceMode', 'Graphics', {
			low: 'LOW', medium: 'MED', high: 'HIGH', auto: 'AUTO', custom: 'CUST',
		});
		const fps = cycler('fpsLimit', 'Frame rate limit', {off: 'MAX', '30': '30', '60': '60'});

		if (graphics) rows.push(graphics);
		if (fps) rows.push(fps);

		return rows;
	}

	/** Cycle until the named mode comes up; the camera owns its own order. */
	private setCameraMode(target: GameCameraMode): void {
		const cam = this.systemManager.getSystem(GameCameraSystem);

		if (!cam) return;

		cam.setMode(target);
		this.applyPhotoMode();
	}

	/**
	 * Photo mode's whole purpose is a clean frame, so the interface goes away
	 * — but a control that hides every control has to leave a way back, or the
	 * only exit is reloading the page.
	 */
	private applyPhotoMode(): void {
		const photo = this.systemManager.getSystem(GameCameraSystem)?.isPhotoMode() ?? false;

		// Called every frame from the HUD update, so do nothing unless it moved.
		if (photo === this.photoModeApplied) return;

		this.photoModeApplied = photo;
		this.cabHud?.setVisible(!photo);

		if (!photo) {
			document.getElementById('photo-exit')?.remove();
			document.getElementById('photo-save')?.remove();

			return;
		}

		if (document.getElementById('photo-exit')) return;

		const exit = document.createElement('button');

		exit.id = 'photo-exit';
		exit.textContent = 'Leave photo mode';
		exit.style.cssText =
			'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:60;' +
			'padding:12px 20px;border:0;border-radius:999px;cursor:pointer;' +
			'font-family:ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif;font-weight:800;font-size:14px;' +
			'color:#08141d;background:linear-gradient(180deg,#f2f7fb,#c9d6e2);' +
			'box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 6px 18px rgba(0,0,0,.45)';
		exit.addEventListener('click', () => this.setCameraMode(GameCameraMode.Chase));

		const save = document.createElement('button');

		save.id = 'photo-save';
		save.textContent = 'Save picture';
		save.style.cssText = exit.style.cssText
			.replace('left:50%', 'left:calc(50% - 130px)')
			.replace('transform:translateX(-50%);', '')
			.replace('linear-gradient(180deg,#f2f7fb,#c9d6e2)', 'linear-gradient(180deg,#5cc8ff,#2b8fd0)')
			+ ';color:#04202f';
		save.addEventListener('click', () => void this.savePhoto(save));

		document.body.appendChild(save);
		document.body.appendChild(exit);
	}

	/**
	 * Keep the picture.
	 *
	 * Photo mode without this is just a view with the controls hidden — the
	 * point of pointing a camera at something is coming away with the picture.
	 */
	private async savePhoto(button: HTMLButtonElement): Promise<void> {
		const render = this.systemManager.getSystem(RenderSystem);
		const original = button.textContent;

		if (!render) return;

		button.textContent = 'Saving…';
		button.disabled = true;

		try {
			const dataUrl = await render.captureNextFrame();
			const link = document.createElement('a');
			const train = this.systemManager.getSystem(TrainSystem);
			const where = (train?.stationState?.stationName ?? train?.mapName ?? 'metrorider')
				.replace(/[^A-Za-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40) || 'metrorider';

			link.href = dataUrl;
			link.download = `metrorider-${where}.png`;
			document.body.appendChild(link);
			link.click();
			link.remove();

			button.textContent = 'Saved';
		} catch (err) {
			console.error('[GameUI] Could not save the picture:', err);
			button.textContent = 'Could not save';
		} finally {
			button.disabled = false;
			setTimeout(() => {
				if (button.isConnected) button.textContent = original;
			}, 1800);
		}
	}

	/**
	 * The line picker.
	 *
	 * This was a 24-row wall standing open over the right of the screen. It is
	 * the same list, opened when you want it and dismissed when you are done.
	 */
	private openLinePicker(): void {
		if (!this.cabSheet) return;

		if (this.cabSheet.isOpen()) {
			this.cabSheet.close();
			return;
		}

		this.showLinePicker();
	}

	private showLinePicker(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem || !this.cabSheet) return;

		this.cabSheet.show('Pick a line', trainSystem.lines.map((ls, idx) => {
			// The map usually says what kind of service a line runs; when it
			// does not, the line itself is read. Either way the player should
			// know they are about to drive a bus before they pick it.
			const mode = lineModeInfo(
				ls.parsed.mode ?? inferLineMode(
					ls.parsed.name, ls.track.totalLength, ls.parsed.stations.length,
				),
			);

			return {
				// The line CODE, which is the leading token of the name ("A1 - A2
				// Sharon Local"). parsed.id is a numeric index and means nothing
				// to a player.
				badge: (ls.parsed.name.match(/^([A-Z]{1,2}\d{1,2})/)?.[1]) ?? String(idx + 1),
				badgeColor: ls.parsed.color,
				title: ls.parsed.isLoop ? `${ls.parsed.name} ⟳` : ls.parsed.name,
				subtitleIcon: mode.icon,
				subtitle: `${mode.label} · ${ls.parsed.stations.length} stops`,
				onSelect: () => this.showStationPanel(trainSystem, idx),
			};
		}));
	}

	/** Feed the cab instruments from real game state. */
	private updateCabHud(trainSystem: TrainSystem, deltaTime: number): void {
		if (!this.cabHud) return;

		// The C key cycles views without going through the sheet, so photo mode
		// is reconciled here rather than only where it is chosen.
		this.applyPhotoMode();

		const limits = this.systemManager.getSystem(SpeedLimitSystem);
		const passengers = this.systemManager.getSystem(PassengerSystem);
		const ls = trainSystem.getCurrentLine();
		const stops = ls?.parsed.stations.length ?? 2;
		const physics = trainSystem.physicsState;
		const speed = Math.round(trainSystem.getSpeedKmH());
		const limit = limits && limits.limit > 0 ? Math.round(limits.signFace()) : 0;

		const total = ls?.track?.cumDist?.[ls.track.cumDist.length - 1] ?? 0;
		const progress = total > 0 ? Math.min(1, Math.max(0, (physics?.trainDist ?? 0) / total)) : 0;
		// stationState already resolves arriving-vs-next; reuse it rather than
		// recomputing a second, subtly different answer.
		const ss = trainSystem.stationState;
		const nextIdx = ss ? (ss.arriving ? ss.nearestStationIdx : ss.nextStationIdx) : -1;
		const name = ss?.stationName ?? '—';
		const waiting = passengers && nextIdx >= 0 ? passengers.waitingAt(nextIdx) : null;

		this.cabHud.update({
			speedKmh: speed,
			limitKmh: limit,
			dialMax: Math.max(120, Math.ceil((limit || 100) * 1.6 / 20) * 20),
			stationName: name,
			// The board says what the stop IS, then when it is due. Two separate
			// facts in one line, in that order, because the name is what you
			// look for and the time is what you check.
			stationMeta: this.stationMetaLine(physics?.doorsOpen, ss?.arriving),
			waiting: waiting === null || waiting === undefined ? null : waiting,
			progress,
			stopCount: stops,
			stopIndex: nextIdx,
			doorsOpen: !!physics?.doorsOpen,
			overLimit: limit > 0 && speed > limit,
			// The real handle positions, which now wind up and down through the
			// notches the lever is drawn with rather than jumping between off
			// and everything.
			power: physics?.powerNotch ?? 0,
			brake: physics?.brakeNotch ?? 0,
			lineName: ls?.parsed.id ?? 'LINE',
			simpleMode: this.systemManager.getSystem(SettingsSystem)
				?.settings.get('driveMode')?.statusValue === 'simple',
		});
	}

	private applyLineListVisibility(): void {
		if (this.lineListEl) {
			this.lineListEl.style.display = this.lineListExpanded ? 'flex' : 'none';
		}
		if (this.lineListToggle) {
			this.lineListToggle.textContent = this.lineListExpanded ? '\u25B2' : '\u25BC';
		}
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
			label.textContent = ls.parsed.isLoop ? `${ls.parsed.name} ⟳` : ls.parsed.name;

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
		if (this.lineListWrap) this.lineListWrap.style.display = 'none';

		if (this.stationPanelEl) {
			this.stationPanelEl.remove();
		}

		const ls = trainSystem.lines[lineIdx];
		if (!ls) {
			console.error(`[GameUI] Invalid line index for station panel: ${lineIdx}`);
			return;
		}

		const m = this.mobile;
		const stations = ls.parsed.stations;
		let selectedDir = 1;

		const panel = document.createElement('div');
		panel.style.cssText = `
			position: absolute; top: ${m ? 112 : 70}px; right: ${m ? 8 : 20}px;
			width: ${m ? 220 : 260}px; max-height: calc(100vh - ${m ? 160 : 120}px);
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

		const isLoop = ls.parsed.isLoop;
		const firstStation = isLoop ? 'Loop ⟲' : (stations[0]?.name ?? '?');
		const lastStation = isLoop ? 'Loop ⟳' : (stations[stations.length - 1]?.name ?? '?');

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

	private cameraToastEl: HTMLElement | null = null;
	private cameraToastTimer: number = 0;

	private showToast(text: string, durationMs: number = 1400): void {
		if (!this.container) return;
		if (!this.cameraToastEl) {
			this.cameraToastEl = document.createElement('div');
			this.cameraToastEl.style.cssText = `
				position: absolute; bottom: ${this.mobile ? 110 : 100}px; left: 50%;
				transform: translateX(-50%);
				background: rgba(0,0,0,0.8); color: #fff; padding: 8px 18px;
				border-radius: 8px; font-size: 14px; font-weight: 600;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15);
				pointer-events: none; transition: opacity 0.3s; z-index: 10;
				max-width: 80vw; text-align: center;
			`;
			this.container.appendChild(this.cameraToastEl);
		}
		this.cameraToastEl.textContent = text;
		this.cameraToastEl.style.opacity = '1';
		window.clearTimeout(this.cameraToastTimer);
		this.cameraToastTimer = window.setTimeout(() => {
			if (this.cameraToastEl) this.cameraToastEl.style.opacity = '0';
		}, durationMs);
	}

	private showCameraModeToast(label: string): void {
		this.showToast(`Camera: ${label}`);
	}

	private hideStationPanel(): void {
		if (this.stationPanelEl) {
			this.stationPanelEl.remove();
			this.stationPanelEl = null;
		}
		if (this.lineListWrap) this.lineListWrap.style.display = 'flex';
		this.applyLineListVisibility();
	}

	private updateLineColorIndicator(trainSystem: TrainSystem): void {
		const ls = trainSystem.getCurrentLine();
		if (this.lineColorEl && ls) {
			this.lineColorEl.style.background = ls.parsed.color;
			this.lineColorEl.style.display = 'block';
		}
	}

	private static readonly SAVED_MAPS_KEY = 'metrorider-saved-maps';
	/**
	 * The MetroDreamin profile the game's cities come from — the same one the
	 * default map belongs to (its id decodes to `<thisProfile>|16`).
	 */
	private static readonly HOME_PROFILE_ID = 'AT6WfHaZrPQ34MZpEKpheVGjGpO2';

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

	/**
	 * Scoring emits results; the UI renders them. The system deliberately knows
	 * nothing about the DOM, so the two are joined here.
	 */
	private bindScoring(): void {
		const scoring = this.systemManager.getSystem(ScoringSystem);
		if (!scoring) return;

		this.scoreUI = new ScoreUI(this.container);
		scoring.onStopScored = (result, stationName): void => {
			this.scoreUI?.showStopCard(result, stationName);
		};
		scoring.onRunFinished = (run, badges, isPersonalBest, best): void => {
			void this.scoreUI?.showRunCard(run, badges, isPersonalBest, best);
		};
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

		const closeBtn = document.createElement('div');
		closeBtn.style.cssText = `
			position: absolute; top: 10px; right: 14px;
			width: 28px; height: 28px; border-radius: 50%;
			display: flex; align-items: center; justify-content: center;
			cursor: pointer; font-size: 16px; color: #888;
			transition: color 0.15s, background 0.15s;
		`;
		closeBtn.textContent = '\u2715';
		closeBtn.title = 'Close';
		closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; closeBtn.style.background = 'rgba(255,255,255,0.1)'; });
		closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; closeBtn.style.background = 'transparent'; });
		closeBtn.addEventListener('click', () => {
			startBtn.style.display = 'none';
		});

		startBtn.style.position = 'absolute';
		startBtn.appendChild(closeBtn);

		const title = document.createElement('div');
		title.textContent = '\uD83D\uDE87 MetroRider';
		title.style.cssText = 'font-size: 22px; margin-bottom: 2px;';

		// Clickable version badge \u2014 reopens the release splash any time.
		const versionBadge = document.createElement('button');
		versionBadge.id = 'game-version-badge';
		versionBadge.textContent = releaseLabel();
		versionBadge.title = 'See what is new in this release';
		versionBadge.style.cssText = `
			font-size: 11px; font-weight: 600; color: #7fb2ff;
			background: rgba(127, 178, 255, 0.12);
			border: 1px solid rgba(127, 178, 255, 0.3);
			border-radius: 999px; padding: 3px 12px; margin-bottom: 10px;
			letter-spacing: 0.3px; cursor: pointer; pointer-events: auto;
		`;
		versionBadge.addEventListener('mouseenter', () => { versionBadge.style.background = 'rgba(127, 178, 255, 0.25)'; });
		versionBadge.addEventListener('mouseleave', () => { versionBadge.style.background = 'rgba(127, 178, 255, 0.12)'; });
		versionBadge.addEventListener('click', (ev) => {
			ev.stopPropagation();
			this.showReleaseSplash();
		});

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

		let defaultMapReady = false;

		const playBtn = document.createElement('div');
		playBtn.style.cssText = BTN_STYLE + 'background: rgba(34,197,94,0.7); color: #fff; margin-bottom: 10px; font-size: 16px; font-weight: 600; display: none;';
		playBtn.addEventListener('click', startGameFlow);

		const loadMapFromUrl = async (url: string, autoStart: boolean = true): Promise<void> => {
			statusEl.style.display = 'block';
			statusEl.textContent = 'Loading map...';
			playBtn.style.display = 'none';

			try {
				const {fetchMetroDreaminMap} = await import('./data/MetroDreaminImporter');
				const mapData = await fetchMetroDreaminMap(url);
				trainSystem.loadMap(mapData);
				this.currentMapUrl = url;
				this.closeMetroMapOverlay();
				this.saveMapEntry(url, mapData.name);
				statusEl.textContent = `Loaded: ${mapData.name}`;

				if (autoStart) {
					setTimeout(startGameFlow, 500);
				} else {
					defaultMapReady = true;
					playBtn.textContent = `\u25B6  Play: ${mapData.name}`;
					playBtn.style.display = 'block';
				}
			} catch (err) {
				statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
				console.error('[GameUI] Failed to load map:', err);
				playBtn.textContent = '\u25B6  Play Sample Map (Tel Aviv)';
				playBtn.style.display = 'block';
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
		startBtn.appendChild(versionBadge);
		startBtn.appendChild(subtitle);
		// "Who's driving?" — sits above the map controls so a player picks their
		// profile before a run, but never blocks playing as a guest.
		startBtn.appendChild(this.profileUI.createStartRow());
		startBtn.appendChild(playBtn);
		startBtn.appendChild(statusEl);
		startBtn.appendChild(urlInput);
		startBtn.appendChild(loadBtn);
		startBtn.appendChild(playDefaultBtn);
		startBtn.appendChild(savedSection);
		startBtn.appendChild(userMapsSection);
		this.container.appendChild(startBtn);

		loadMapFromUrl(DEFAULT_MAP_URL, false);
	}

	private createSettingsButton(): void {
		const m = this.mobile;
		const size = m ? 32 : 42;
		const btn = document.createElement('div');
		if (m) {
			btn.style.cssText = `
				width: ${size}px; height: ${size}px; border-radius: 8px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 15px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				transition: background 0.15s;
			`;
		} else {
			btn.style.cssText = `
				position: absolute; top: 20px; right: 76px;
				width: ${size}px; height: ${size}px; border-radius: 10px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 20px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				pointer-events: auto; transition: background 0.15s;
			`;
		}
		btn.textContent = '\ud83d\ude86';
		btn.title = 'Customize your train (models & sounds)';
		this.trainCustomiseEl = btn;
		btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.65)'; });
		btn.addEventListener('click', () => {
			window.location.href = '/settings.html';
		});

		if (m) {
			this.mobileTopBtns.push(btn);
		} else {
			this.container.appendChild(btn);
		}
	}

	private currentMapUrl: string | null = null;
	private metroMapOverlayEl: HTMLElement | null = null;
	private metroMapMarkerTimer: number = 0;

	private createMetroMapButton(trainSystem: TrainSystem): void {
		const m = this.mobile;
		const size = m ? 32 : 42;
		const btn = document.createElement('div');
		btn.id = 'game-metro-map-btn';
		if (m) {
			btn.style.cssText = `
				width: ${size}px; height: ${size}px; border-radius: 8px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 14px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				transition: background 0.15s;
			`;
		} else {
			btn.style.cssText = `
				position: absolute; top: 20px; right: 176px;
				width: ${size}px; height: ${size}px; border-radius: 10px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 18px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				pointer-events: auto; transition: background 0.15s;
			`;
		}
		btn.textContent = '🗺';
		btn.title = 'Metro map — see the original MetroDreamin map';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.65)'; });
		btn.addEventListener('click', () => {
			this.toggleMetroMapOverlay(trainSystem);
		});

		if (m) {
			this.mobileTopBtns.push(btn);
		} else {
			this.container.appendChild(btn);
		}
	}

	private closeMetroMapOverlay(): void {
		if (this.metroMapMarkerTimer) {
			window.clearInterval(this.metroMapMarkerTimer);
			this.metroMapMarkerTimer = 0;
		}
		if (this.metroMapOverlayEl) {
			this.metroMapOverlayEl.remove();
			this.metroMapOverlayEl = null;
		}
	}

	/**
	 * Schematic view of the loaded MetroDreamin map: every line in its color,
	 * station dots, the current line's station names, and a live marker for
	 * the train. Links out to the original metrodreamin.com page when the map
	 * was loaded from a URL.
	 */
	private toggleMetroMapOverlay(trainSystem: TrainSystem): void {
		if (this.metroMapOverlayEl) {
			this.closeMetroMapOverlay();
			return;
		}
		if (trainSystem.lines.length === 0) return;

		const SVG_NS = 'http://www.w3.org/2000/svg';
		const W = 1000;
		const H = 700;
		const PAD = 50;

		// Project lat/lng → local x/y (equirectangular with latitude correction).
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		let midLatSum = 0, midLatCount = 0;
		for (const ls of trainSystem.lines) {
			for (const pt of ls.parsed.allPoints) {
				midLatSum += pt.lat;
				midLatCount++;
			}
		}
		const cosLat = Math.cos((midLatSum / Math.max(1, midLatCount)) * Math.PI / 180);
		const proj = (lat: number, lng: number): [number, number] => [lng * cosLat, -lat];
		for (const ls of trainSystem.lines) {
			for (const pt of ls.parsed.allPoints) {
				const [x, y] = proj(pt.lat, pt.lng);
				if (x < minX) minX = x; if (x > maxX) maxX = x;
				if (y < minY) minY = y; if (y > maxY) maxY = y;
			}
		}
		const spanX = Math.max(1e-9, maxX - minX);
		const spanY = Math.max(1e-9, maxY - minY);
		const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
		const offX = (W - spanX * scale) / 2;
		const offY = (H - spanY * scale) / 2;
		const toSvg = (lat: number, lng: number): [number, number] => {
			const [x, y] = proj(lat, lng);
			return [(x - minX) * scale + offX, (y - minY) * scale + offY];
		};

		const overlay = document.createElement('div');
		overlay.id = 'metro-map-overlay';
		overlay.style.cssText = `
			position: fixed; inset: 0; z-index: 99998;
			background: rgba(8, 10, 18, 0.94); backdrop-filter: blur(6px);
			display: flex; flex-direction: column;
			pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		`;

		const header = document.createElement('div');
		header.style.cssText = `
			display: flex; align-items: center; gap: 12px;
			padding: 14px 18px; flex-shrink: 0;
			border-bottom: 1px solid rgba(255,255,255,0.1);
		`;

		const mapTitle = document.createElement('div');
		mapTitle.style.cssText = 'color: #fff; font-size: 15px; font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
		mapTitle.textContent = `🗺 ${trainSystem.mapName || 'Metro Map'}`;

		header.appendChild(mapTitle);

		if (this.currentMapUrl) {
			const link = document.createElement('a');
			link.href = this.currentMapUrl;
			link.target = '_blank';
			link.rel = 'noopener';
			link.textContent = 'Open on MetroDreamin ↗';
			link.style.cssText = `
				color: #7fb2ff; font-size: 12px; font-weight: 600;
				text-decoration: none; border: 1px solid rgba(127,178,255,0.35);
				border-radius: 999px; padding: 5px 12px; flex-shrink: 0;
			`;
			header.appendChild(link);
		}

		const closeBtn = document.createElement('div');
		closeBtn.id = 'metro-map-close';
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = `
			width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
			display: flex; align-items: center; justify-content: center;
			color: #aaa; cursor: pointer; font-size: 15px;
			border: 1px solid rgba(255,255,255,0.15);
		`;
		closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
		closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#aaa'; });
		closeBtn.addEventListener('click', () => this.closeMetroMapOverlay());
		header.appendChild(closeBtn);

		const svgWrap = document.createElement('div');
		svgWrap.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 8px;';

		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		svg.setAttribute('style', 'width: 100%; height: 100%; max-width: 1400px;');

		const currentIdx = trainSystem.currentLineIdx;

		// Lines (current line drawn last, on top).
		const order = trainSystem.lines.map((_, i) => i).sort((a, b) => (a === currentIdx ? 1 : 0) - (b === currentIdx ? 1 : 0));
		for (const i of order) {
			const ls = trainSystem.lines[i];
			const poly = document.createElementNS(SVG_NS, 'polyline');
			const pts = ls.parsed.allPoints.map(p => toSvg(p.lat, p.lng).join(',')).join(' ');
			poly.setAttribute('points', pts);
			poly.setAttribute('fill', 'none');
			poly.setAttribute('stroke', ls.parsed.color || '#888');
			poly.setAttribute('stroke-width', i === currentIdx ? '7' : '4.5');
			poly.setAttribute('stroke-opacity', i === currentIdx ? '1' : '0.55');
			poly.setAttribute('stroke-linejoin', 'round');
			poly.setAttribute('stroke-linecap', 'round');
			svg.appendChild(poly);
		}

		// Stations (dots for every line; names for the current line).
		for (let i = 0; i < trainSystem.lines.length; i++) {
			const ls = trainSystem.lines[i];
			const isCurrent = i === currentIdx;
			for (const st of ls.parsed.stations) {
				const [x, y] = toSvg(st.lat, st.lng);
				const dot = document.createElementNS(SVG_NS, 'circle');
				dot.setAttribute('cx', String(x));
				dot.setAttribute('cy', String(y));
				dot.setAttribute('r', isCurrent ? '5.5' : '3.5');
				dot.setAttribute('fill', '#fff');
				dot.setAttribute('stroke', ls.parsed.color || '#888');
				dot.setAttribute('stroke-width', isCurrent ? '3' : '2');
				dot.setAttribute('opacity', isCurrent ? '1' : '0.6');
				svg.appendChild(dot);

				if (isCurrent) {
					const label = document.createElementNS(SVG_NS, 'text');
					label.setAttribute('x', String(x + 9));
					label.setAttribute('y', String(y - 7));
					label.setAttribute('fill', '#ddd');
					label.setAttribute('font-size', '11');
					label.setAttribute('font-weight', '600');
					label.textContent = st.name;
					svg.appendChild(label);
				}
			}
		}

		// Live train marker (pulse + dot), updated while the overlay is open.
		const pulse = document.createElementNS(SVG_NS, 'circle');
		pulse.setAttribute('r', '13');
		pulse.setAttribute('fill', 'none');
		pulse.setAttribute('stroke', '#ffd747');
		pulse.setAttribute('stroke-width', '2.5');
		const pulseAnim = document.createElementNS(SVG_NS, 'animate');
		pulseAnim.setAttribute('attributeName', 'r');
		pulseAnim.setAttribute('values', '8;16;8');
		pulseAnim.setAttribute('dur', '1.6s');
		pulseAnim.setAttribute('repeatCount', 'indefinite');
		pulse.appendChild(pulseAnim);
		const marker = document.createElementNS(SVG_NS, 'circle');
		marker.setAttribute('r', '7');
		marker.setAttribute('fill', '#ffd747');
		marker.setAttribute('stroke', '#000');
		marker.setAttribute('stroke-width', '2');
		svg.appendChild(pulse);
		svg.appendChild(marker);

		const updateMarker = (): void => {
			const tp = trainSystem.trainPosition;
			if (!tp) {
				marker.setAttribute('opacity', '0');
				pulse.setAttribute('opacity', '0');
				return;
			}
			const [x, y] = toSvg(tp.lat, tp.lon);
			marker.setAttribute('opacity', '1');
			pulse.setAttribute('opacity', '1');
			marker.setAttribute('cx', String(x));
			marker.setAttribute('cy', String(y));
			pulse.setAttribute('cx', String(x));
			pulse.setAttribute('cy', String(y));
		};
		updateMarker();
		this.metroMapMarkerTimer = window.setInterval(updateMarker, 300);

		svgWrap.appendChild(svg);
		overlay.appendChild(header);
		overlay.appendChild(svgWrap);
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay) this.closeMetroMapOverlay();
		});
		document.body.appendChild(overlay);
		this.metroMapOverlayEl = overlay;
	}

	private createMapSelectionButton(trainSystem: TrainSystem): void {
		const m = this.mobile;
		const size = m ? 32 : 42;
		const btn = document.createElement('div');
		btn.id = 'game-map-select-btn';
		if (m) {
			btn.style.cssText = `
				width: ${size}px; height: ${size}px; border-radius: 8px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 14px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				transition: background 0.15s;
			`;
		} else {
			btn.style.cssText = `
				position: absolute; top: 20px; right: 126px;
				width: ${size}px; height: ${size}px; border-radius: 10px;
				background: rgba(0,0,0,0.65); color: #fff;
				display: flex; align-items: center; justify-content: center;
				font-size: 18px; cursor: pointer; user-select: none;
				backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
				pointer-events: auto; transition: background 0.15s;
			`;
		}
		btn.textContent = '\uD83C\uDFE0';
		btn.title = 'Menu \u2014 change map or line';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.65)'; });
		btn.addEventListener('click', () => {
			const startBtn = document.getElementById('game-start-btn');
			if (startBtn && startBtn.style.display !== 'none') {
				startBtn.style.display = 'none';
			} else {
				this.returnToMapSelection(trainSystem);
			}
		});

		if (m) {
			this.mobileTopBtns.push(btn);
		} else {
			this.container.appendChild(btn);
		}
	}

	private returnToMapSelection(trainSystem: TrainSystem): void {
		trainSystem.stopGame();

		const camSystem = this.systemManager.getSystem(GameCameraSystem);
		if (camSystem) {
			camSystem.deactivate();
		}

		if (this.infoPanelEl) this.infoPanelEl.style.display = 'none';
		if (this.stationEl?.parentElement) this.stationEl.parentElement.style.display = 'none';
		if (this.lineListWrap) this.lineListWrap.style.display = 'none';
		this.cabHud?.setVisible(false);
		this.hideStationPanel();

		const startBtn = document.getElementById('game-start-btn');
		if (startBtn) {
			startBtn.style.display = '';
		}
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

		// Backquote (`) — KeyD is taken by the door toggle (InputHandler KEY_MAP).
		window.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey && !e.altKey) {
				this.debugVisible = !this.debugVisible;
				if (this.debugEl) {
					this.debugEl.style.display = this.debugVisible ? 'block' : 'none';
				}
			}
		});
	}

	private showGameUI(): void {
		// The stacked readout and the station banner are both superseded by
		// the cab HUD, which shows the same facts as instruments. Raising them
		// here is what put the old panel back on screen over the new one.
		if (this.infoPanelEl) this.infoPanelEl.style.display = 'none';
		if (this.stationEl?.parentElement) this.stationEl.parentElement.style.display = 'none';
		// The wall is gone: the same list is now the summoned picker on the
		// menu button. Keeping it hidden rather than deleting the builder so
		// the station panel it opens keeps working unchanged.
		if (this.lineListWrap) this.lineListWrap.style.display = 'none';

		// The old emoji strip (🚆 🗺 🏠) duplicated the utility rail and used
		// emoji as navigation icons, which is not the icon set. Hidden rather
		// than deleted: the metro-map overlay and the map picker are still
		// opened by clicking these elements, and `click()` works on a hidden
		// element. Their functions are reachable from the menu sheet.
		for (const id of ['game-metro-map-btn', 'game-map-select-btn']) {
			const el = document.getElementById(id);

			if (el) el.style.display = 'none';
		}

		if (this.mobileTopStripEl) this.mobileTopStripEl.style.display = 'none';
		if (this.trainCustomiseEl) this.trainCustomiseEl.style.display = 'none';

		// The old control cluster (accelerate / brake / horn / reverse / doors /
		// camera) is entirely superseded by the cab console — except REVERSE,
		// which the console has no equivalent for, so that one is rehomed to
		// the menu rather than lost with the cluster.
		if (this.legacyControlsEl) this.legacyControlsEl.style.display = 'none';

		// Apply the saved time of day on entry, so a night drive stays a night
		// drive across a reload rather than snapping back to real time.
		this.applyTimeOfDay();

		this.cabHud?.setVisible(true);
	}

	private debugFrameCounter: number = 0;

	public update(deltaTime: number): void {
		if (!this.initialized) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) return;

		if (this.fpsEl && deltaTime > 0) {
			this.fpsEl.textContent = `${Math.round(1 / deltaTime)}`;
		}

		if (this.speedEl) {
			this.speedEl.textContent = `${Math.round(trainSystem.getSpeedKmH())} km/h`;
		}

		this.updateCabHud(trainSystem, deltaTime);

		const now = new Date();
		const currentMinute = now.getHours() * 60 + now.getMinutes();
		if (this.timeEl && currentMinute !== this.lastMinute) {
			this.lastMinute = currentMinute;
			const hh = String(now.getHours()).padStart(2, '0');
			const mm = String(now.getMinutes()).padStart(2, '0');
			this.timeEl.textContent = `${hh}:${mm}`;
		}

		if (this.limitEl) {
			const limits = this.systemManager.getSystem(SpeedLimitSystem);
			if (limits && limits.limit > 0) {
				const style = limits.sign;
				this.limitEl.textContent = String(limits.signFace());
				this.limitEl.title = `${style.name} — ${limits.countryCode} ${limits.mode}`;

				// Shape follows the country: square board, disc, or plate.
				this.limitEl.style.borderRadius = style.shape === 'disc' ? '50%'
					: style.shape === 'square' ? '4px' : '2px';
				this.limitEl.style.borderStyle = 'solid';
				this.limitEl.style.borderWidth = `${style.borderWidth}px`;
				this.limitEl.style.color = style.text;
				// The sign reacts when the driver is over it — the only
				// enforcement there is, since the train is never braked for them.
				this.limitEl.style.borderColor = limits.state === 'over' ? '#ff1744'
					: limits.state === 'approaching' ? '#f0b429' : style.border;
				this.limitEl.style.background = limits.state === 'over' ? '#ffe5e5' : style.background;

				if (this.limitAheadEl) {
					const change = limits.change;
					if (change && change.distance < 1200) {
						const next = limits.signFaceFor(change.limit);
						const how = change.distance < 100
							? `${Math.round(change.distance)} m`
							: `${(change.distance / 1000).toFixed(1)} km`;
						const arrow = change.limit < limits.limit ? '▼' : '▲';
						this.limitAheadEl.textContent = `${arrow} ${next} in ${how}`;
						this.limitAheadEl.style.color = change.limit < limits.limit ? '#f0b429' : '#8fd08f';
					} else {
						this.limitAheadEl.textContent = limits.state === 'over' ? 'Over the limit' : '';
						this.limitAheadEl.style.color = '#ff6b6b';
					}
				}
			} else {
				this.limitEl.textContent = '—';
			}
		}

		if (this.paxEl) {
			const passengers = this.systemManager.getSystem(PassengerSystem);
			if (passengers) {
				const snap = passengers.getSnapshot();
				// While the doors are open, show who is still on the platform
				// next to who is aboard — that is the number the driver acts on.
				this.paxEl.textContent = snap.boardingActive
					? `${snap.aboard} · ${snap.waitingHere} waiting`
					: `${snap.aboard}`;
			} else {
				this.paxEl.textContent = '0';
			}
		}

		if (this.stationEl && trainSystem.stationState) {
			const ss = trainSystem.stationState;
			// How many people are standing on THAT platform — the number the
			// driver acts on, next to the name of the station it belongs to.
			const passengers = this.systemManager.getSystem(PassengerSystem);
			const targetIdx = ss.arriving ? ss.nearestStationIdx : ss.nextStationIdx;
			const waiting = passengers && targetIdx >= 0 ? passengers.waitingAt(targetIdx) : 0;
			const waitingSuffix = waiting > 0 ? `  ·  ${waiting} waiting` : '';

			if (ss.arriving) {
				this.stationEl.textContent = `${ss.stationName}${waitingSuffix}`;
			} else if (ss.nextStationIdx >= 0) {
				this.stationEl.textContent = `Next: ${ss.stationName}${waitingSuffix}`;
			} else {
				this.stationEl.textContent = ss.stationName;
			}

			if (this.etaEl) {
				const speedMs = trainSystem.getSpeedKmH() / 3.6;
				const distM = ss.nextStationDist;
				if (ss.arriving) {
					this.etaEl.textContent = 'Arrived';
				} else if (distM < Infinity && distM > 0) {
					const distKm = distM / 1000;
					const distStr = distKm >= 1 ? `${distKm.toFixed(1)} km` : `${Math.round(distM)} m`;
					if (speedMs > 0.5) {
						const etaSec = distM / speedMs;
						const etaStr = etaSec >= 60
							? `~${Math.ceil(etaSec / 60)} min`
							: `~${Math.round(etaSec)}s`;
						this.etaEl.textContent = `${distStr} · ${etaStr}`;
					} else {
						this.etaEl.textContent = distStr;
					}
				} else {
					this.etaEl.textContent = '—';
				}
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
			const carsReady = trainRendering.carMeshes.filter(m => m.isMeshReady()).length;
			const stationCount = trainRendering.stationMeshes.length;
			lines.push(`Meshes:  cars=${carsReady}/${trainRendering.carMeshes.length} track=${trackReady ? 'OK' : 'NO'} stations=${stationCount}`);
		}

		lines.push('');
		lines.push('Press ` to hide');

		this.debugEl.textContent = lines.join('\n');
	}
}
