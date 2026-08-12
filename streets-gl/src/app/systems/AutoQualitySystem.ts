import System from '../System';
import SettingsSystem from '~/app/systems/SettingsSystem';
import TrainSystem from '~/app/game/TrainSystem';
import {debugLog} from '~/app/game/debug';

/**
 * Auto quality governor.
 *
 * Measures real frame times while the game is being played and walks a quality
 * ladder in BOTH directions:
 *
 *   - Strives for 60 FPS. If frames run long, it steps quality down one rung
 *     at a time (render scale, shadows, SSAO, bloom).
 *   - If even the lowest rung cannot hold ~45 FPS, it re-targets 30 FPS and
 *     climbs back up to the best quality that holds 30.
 *   - If the TOP rung holds 60 comfortably, it uncaps the frame rate
 *     ("unlimited" mode, max settings) — a high-end machine ends up maxed out
 *     regardless of what device class it booted as.
 *
 * The governor's changes are TRANSIENT (never written to localStorage), so the
 * user's saved preferences survive. Manually changing any governed setting
 * turns the governor off — manual control always wins. The chosen rung/mode is
 * remembered per device so the next session starts where this one settled.
 */

interface QualityRung {
	renderScale: number;
	shadows: 'off' | 'low' | 'medium' | 'high';
	shadowResolution: '512' | '1024' | '2048';
	ssao: 'on' | 'off';
	bloom: 'on' | 'off';
}

const RUNGS: QualityRung[] = [
	/* 0 — max     */ {renderScale: 1.0, shadows: 'high', shadowResolution: '2048', ssao: 'on', bloom: 'on'},
	/* 1 — default */ {renderScale: 1.0, shadows: 'medium', shadowResolution: '2048', ssao: 'on', bloom: 'on'},
	/* 2 */ {renderScale: 0.85, shadows: 'medium', shadowResolution: '1024', ssao: 'on', bloom: 'on'},
	/* 3 */ {renderScale: 0.85, shadows: 'low', shadowResolution: '1024', ssao: 'on', bloom: 'on'},
	/* 4 */ {renderScale: 0.75, shadows: 'low', shadowResolution: '512', ssao: 'off', bloom: 'on'},
	/* 5 */ {renderScale: 0.75, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off'},
	/* 6 */ {renderScale: 0.65, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off'},
	/* 7 — floor  */ {renderScale: 0.5, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off'},
];

const GOVERNED_KEYS = ['renderScale', 'shadows', 'shadowResolution', 'ssao', 'bloom', 'fpsLimit'];

type GovernorMode = 'strive60' | 'fallback30' | 'unlimited';

const BUDGET_60 = 1000 / 60;
const BUDGET_30 = 1000 / 30;
const STORAGE_KEY = 'metrorider-autoquality';

const EVAL_INTERVAL = 1.0;        // seconds between evaluations
const WINDOW_SIZE = 240;          // ~4s of frames at 60fps
const MIN_SAMPLES = 45;
const DOWN_FACTOR = 1.18;         // p75 above budget×this → step down
const UP_FACTOR = 1.04;           // p75 within budget×this → eligible to step up
const DOWN_COOLDOWN = 4;          // s between down-steps
const UP_HOLD = 12;               // s of holding target before stepping up
const RETRY_60_HOLD = 45;         // s holding 30 at rung 0 before retrying 60
const FALLBACK_HOLD = 20;         // s of failing at the floor before 30-fps fallback
const OSCILLATION_LOCK = 90;      // s to forbid re-climbing a rung we just fell from

export default class AutoQualitySystem extends System {
	private enabled: boolean = false;
	private rung: number = 1;
	private mode: GovernorMode = 'strive60';

	private deltas: number[] = [];
	private evalTimer: number = 0;
	private holdTimer: number = 0;
	private failTimer: number = 0;
	private now: number = 0;
	private cooldownUntil: number = 0;
	private lockedRungAbove: number = -1;
	private lockedUntil: number = 0;
	private applying: boolean = false;
	private announcedDownStep: boolean = false;

	public postInit(): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		this.restoreState();

		settings.onChange('autoQuality', ({statusValue}) => {
			const on = statusValue === 'on';
			if (on && !this.enabled) {
				this.engage();
			} else if (!on) {
				this.enabled = false;
			}
		}, true);

		// Manual change to any governed setting → the user wants control.
		for (const key of GOVERNED_KEYS) {
			settings.onChange(key, () => {
				if (this.enabled && !this.applying) {
					this.disengage('Auto quality off — you’re in manual control');
				}
			}, false);
		}

		// Device-tier changes reseed the ladder but keep the governor engaged.
		settings.onChange('performanceMode', ({statusValue}) => {
			if (!this.enabled) return;
			this.rung = statusValue === 'low' ? 5 : statusValue === 'high' ? 0 : 1;
			this.mode = statusValue === 'high' ? 'unlimited' : 'strive60';
			this.resetMeasurement();
			this.applyRung('device tier changed');
		}, false);
	}

	public isEngaged(): boolean {
		return this.enabled;
	}

	public getStatusLabel(): string {
		if (!this.enabled) return 'off';
		const fps = this.mode === 'fallback30' ? '30' : this.mode === 'unlimited' ? 'uncapped' : '60';
		return `rung ${this.rung} → ${fps} fps`;
	}

	private engage(): void {
		this.enabled = true;
		this.resetMeasurement();
		this.applyRung('engaged');
		debugLog(`[AutoQuality] Engaged at rung ${this.rung}, mode ${this.mode}`);
	}

	private disengage(message: string): void {
		this.enabled = false;
		const settings = this.systemManager.getSystem(SettingsSystem).settings;
		this.applying = true;
		settings.update('autoQuality', {statusValue: 'off'});
		this.applying = false;
		this.toast(message);
		debugLog('[AutoQuality] Disengaged (manual override)');
	}

	private restoreState(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const s = JSON.parse(raw);
				if (typeof s.rung === 'number' && s.rung >= 0 && s.rung < RUNGS.length) this.rung = s.rung;
				if (s.mode === 'strive60' || s.mode === 'fallback30' || s.mode === 'unlimited') this.mode = s.mode;
				return;
			}
		} catch {
			// fall through to defaults
		}
		// First run: seed from the device tier.
		const settings = this.systemManager.getSystem(SettingsSystem).settings;
		const tier = settings.get('performanceMode')?.statusValue;
		this.rung = tier === 'low' ? 5 : tier === 'high' ? 0 : 1;
	}

	private persistState(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({rung: this.rung, mode: this.mode}));
		} catch {
			// storage unavailable — tuning just restarts next session
		}
	}

	private resetMeasurement(): void {
		this.deltas.length = 0;
		this.holdTimer = 0;
		this.failTimer = 0;
		this.evalTimer = 0;
	}

	private applyRung(reason: string): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;
		const r = RUNGS[this.rung];
		this.applying = true;
		settings.update('renderScale', {numberValue: r.renderScale}, false);
		settings.update('shadows', {statusValue: r.shadows}, false);
		settings.update('shadowResolution', {statusValue: r.shadowResolution}, false);
		settings.update('ssao', {statusValue: r.ssao}, false);
		settings.update('bloom', {statusValue: r.bloom}, false);
		settings.update('fpsLimit', {statusValue: this.mode === 'unlimited' ? 'off' : this.mode === 'fallback30' ? '30' : '60'}, false);
		this.applying = false;
		this.persistState();
		debugLog(`[AutoQuality] rung ${this.rung} (${JSON.stringify(r)}), mode ${this.mode} — ${reason}`);
	}

	private budget(): number {
		return this.mode === 'fallback30' ? BUDGET_30 : BUDGET_60;
	}

	public update(deltaTime: number): void {
		if (!this.enabled) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) {
			this.resetMeasurement();
			return;
		}
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
			this.resetMeasurement();
			return;
		}

		this.now += deltaTime;

		const ms = deltaTime * 1000;
		if (ms < 500) { // ignore tab-switch hiccups
			this.deltas.push(ms);
			if (this.deltas.length > WINDOW_SIZE) this.deltas.shift();
		}

		this.evalTimer += deltaTime;
		if (this.evalTimer < EVAL_INTERVAL || this.deltas.length < MIN_SAMPLES) return;
		this.evalTimer = 0;

		const sorted = [...this.deltas].sort((a, b) => a - b);
		const p75 = sorted[Math.floor(sorted.length * 0.75)];
		const budget = this.budget();

		if (p75 > budget * DOWN_FACTOR) {
			this.holdTimer = 0;
			if (this.rung < RUNGS.length - 1 && this.now >= this.cooldownUntil) {
				if (this.mode === 'unlimited') {
					// First response to trouble in unlimited: re-cap to 60.
					this.mode = 'strive60';
					this.applyRung('re-capping to 60');
				} else {
					this.lockedRungAbove = this.rung;
					this.lockedUntil = this.now + OSCILLATION_LOCK;
					this.rung++;
					this.applyRung('frame times over budget');
					if (!this.announcedDownStep) {
						this.announcedDownStep = true;
						this.toast('Auto quality: adjusted for smoother performance');
					}
				}
				this.cooldownUntil = this.now + DOWN_COOLDOWN;
				this.resetMeasurement();
			} else if (this.rung >= RUNGS.length - 1 && this.mode === 'strive60') {
				// At the floor and still failing 60 — count toward the 30-fps fallback.
				this.failTimer += EVAL_INTERVAL;
				if (this.failTimer >= FALLBACK_HOLD) {
					this.mode = 'fallback30';
					// 30 fps affords better quality: climb happens organically from here.
					this.applyRung('targeting 30 fps');
					this.toast('Auto quality: targeting a steady 30 FPS on this device');
					this.resetMeasurement();
				}
			}
			return;
		}

		this.failTimer = 0;

		if (p75 <= budget * UP_FACTOR) {
			this.holdTimer += EVAL_INTERVAL;

			const wantRung = this.rung - 1;
			const rungLocked = wantRung >= 0 && wantRung <= this.lockedRungAbove && this.now < this.lockedUntil;

			if (this.rung > 0 && !rungLocked && this.holdTimer >= UP_HOLD) {
				this.rung--;
				this.applyRung('headroom available');
				this.resetMeasurement();
			} else if (this.rung === 0 && this.mode === 'strive60' && this.holdTimer >= UP_HOLD * 2) {
				this.mode = 'unlimited';
				this.applyRung('max settings hold 60 — uncapping');
				this.resetMeasurement();
			} else if (this.rung === 0 && this.mode === 'fallback30' && this.holdTimer >= RETRY_60_HOLD) {
				this.mode = 'strive60';
				this.applyRung('retrying 60 fps');
				this.resetMeasurement();
			}
		} else {
			this.holdTimer = 0;
		}
	}

	private toast(message: string): void {
		try {
			window.dispatchEvent(new CustomEvent('mr-toast', {detail: message}));
		} catch {
			// no DOM — headless tests
		}
	}
}
