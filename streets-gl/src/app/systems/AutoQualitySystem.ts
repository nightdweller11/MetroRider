import System from '../System';
import SettingsSystem from '~/app/systems/SettingsSystem';
import TrainSystem from '~/app/game/TrainSystem';
import {debugLog} from '~/app/game/debug';

/**
 * Quality tiers + the auto governor.
 *
 * ONE knob (the `performanceMode` setting) selects the graphics profile:
 *
 *   low / medium / high — fixed presets, applied (and saved) the moment the
 *   tier is picked. After that the game never touches your settings; tweak
 *   anything freely (the tier label flips to "custom").
 *
 *   auto — the governor owns the graphics settings: it measures the real
 *   frame rate while you play and finds the best quality that holds the
 *   target. It NEVER acts in any other tier, and manually changing any
 *   governed setting while in auto flips the tier to "custom" and stops it.
 *
 * Governor rules (designed against the v1.1.3 failure mode, where a capped
 * 60 could only ever average ≤60 and vsync-quantized frames tripped the
 * "too slow" check on machines that were actually fine):
 *
 *   - The metric is the MEDIAN of per-second frame counts over the last 8s —
 *     single hitches and tile-streaming bursts cannot trip it.
 *   - Quality steps DOWN only when the median stays below 90% of the target
 *     for two consecutive evaluations — meeting the target never reduces
 *     quality.
 *   - After every change (and on engage) there is a warm-up blackout so
 *     resize/streaming hitches caused by the change itself are not counted.
 *   - It strives for 60; only if the LOWEST rung cannot hold 60 does it
 *     re-target a steady 30 (and periodically retries 60). If the HIGHEST
 *     rung holds 60, it uncaps the frame rate — a fast machine ends up at
 *     max settings, uncapped.
 *
 * Governor changes are transient (never written to saved settings); the
 * converged rung is remembered per device for instant starts.
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

/** Fixed presets for the manual tiers (applied once, persisted). */
const TIER_PRESETS: Record<string, QualityRung & {fpsLimit: string}> = {
	low: {...RUNGS[7], renderScale: 0.75, fpsLimit: '30'},
	medium: {...RUNGS[1], fpsLimit: '60'},
	high: {...RUNGS[0], fpsLimit: 'off'},
};

const GOVERNED_KEYS = ['renderScale', 'shadows', 'shadowResolution', 'ssao', 'bloom', 'fpsLimit'];

type GovernorMode = 'strive60' | 'fallback30' | 'unlimited';

const STORAGE_KEY = 'metrorider-autoquality';

const WINDOW_BUCKETS = 8;         // seconds of history for the median
// Generous by design: under a cap the average can only sit AT or BELOW the
// target, and vsync quantization pushes it further down even when the game
// feels perfect — 85% is "genuinely struggling", not "slightly imperfect".
const DOWN_RATIO = 0.85;
const UP_RATIO = 0.97;            // median at/above target×this → holding
const DOWN_CONFIRM = 2;           // consecutive trouble evaluations before stepping down
const WARMUP = 8;                 // s ignored after any change (resize/streaming hitches)
const UP_HOLD = 12;               // s of holding before stepping up
const UNCAP_HOLD = 25;            // s of holding at rung 0 before uncapping
const RETRY_60_HOLD = 45;         // s of holding 30 at rung 0 before retrying 60
const FALLBACK_CONFIRM = 20;      // s failing at the floor before the 30-fps fallback
const OSCILLATION_LOCK = 120;     // s to forbid re-climbing a rung we just fell from
// A down-step must IMPROVE the median by at least this factor, or it gets
// reverted and down-stepping locks — if lowering quality doesn't raise fps,
// quality is not the bottleneck (streaming/CPU jitter) and degrading the
// visuals is pure loss. This is what prevents death spirals to the floor.
const STEP_EFFECT_MIN = 1.05;
const DOWN_LOCK_AFTER_INEFFECTIVE = 180; // s

export default class AutoQualitySystem extends System {
	private engaged: boolean = false;
	private rung: number = 1;
	private mode: GovernorMode = 'strive60';

	private buckets: number[] = [];
	private bucketDeltas: number[] = [];
	private bucketTime: number = 0;
	private now: number = 0;
	private warmupUntil: number = 0;
	private troubleCount: number = 0;
	private holdTimer: number = 0;
	private failTimer: number = 0;
	private lockedRungAbove: number = -1;
	private lockedUntil: number = 0;
	private applying: boolean = false;
	private announcedDownStep: boolean = false;
	private preStepMedian: number = 0;
	private checkingStepEffect: boolean = false;
	private downLockedUntil: number = 0;

	public postInit(): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		this.restoreState();

		settings.onChange('performanceMode', ({statusValue}) => {
			if (this.applying) return;
			this.onTierSelected(statusValue);
		}, true);

		// Manually changing any governed setting while in auto → the user wants
		// control: stop the governor and mark the tier as custom.
		for (const key of GOVERNED_KEYS) {
			settings.onChange(key, () => {
				if (this.engaged && !this.applying) {
					this.becomeCustom('Auto tuning off — you’re in manual control (tier: Custom)');
				}
			}, false);
		}
	}

	private onTierSelected(tier: string): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		if (tier === 'auto') {
			this.engage();
			return;
		}

		this.engaged = false;

		const preset = TIER_PRESETS[tier];
		if (preset) {
			// A tier pick is an explicit user choice — apply and SAVE the preset.
			this.applying = true;
			settings.update('renderScale', {numberValue: preset.renderScale});
			settings.update('shadows', {statusValue: preset.shadows});
			settings.update('shadowResolution', {statusValue: preset.shadowResolution});
			settings.update('ssao', {statusValue: preset.ssao});
			settings.update('bloom', {statusValue: preset.bloom});
			settings.update('fpsLimit', {statusValue: preset.fpsLimit});
			this.applying = false;
			this.toast(`Graphics preset applied: ${tier === 'low' ? 'Low-end' : tier === 'medium' ? 'Medium' : 'High-end'}`);
			debugLog(`[AutoQuality] Applied ${tier} preset`);
		}
		// tier === 'custom': nothing to do — pure manual.
	}

	private becomeCustom(message: string): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;
		this.engaged = false;
		this.applying = true;
		settings.update('performanceMode', {statusValue: 'custom'});
		this.applying = false;
		this.toast(message);
		debugLog('[AutoQuality] Disengaged → custom (manual override)');
	}

	public isEngaged(): boolean {
		return this.engaged;
	}

	public getStatusLabel(): string {
		if (!this.engaged) return 'off';
		const fps = this.mode === 'fallback30' ? '30' : this.mode === 'unlimited' ? 'uncapped' : '60';
		return `rung ${this.rung} → ${fps} fps`;
	}

	private lastMedian: number = 0;
	private lastP75Delta: number = 0;
	private recentDeltasSample: number[] = [];

	/** Debug/testing introspection. */
	public getDebugSnapshot(): Record<string, unknown> {
		return {
			engaged: this.engaged,
			rung: this.rung,
			mode: this.mode,
			buckets: [...this.buckets].map(b => Math.round(b * 10) / 10),
			lastMedian: Math.round(this.lastMedian * 10) / 10,
			lastP75Delta: Math.round(this.lastP75Delta * 100) / 100,
			recentDeltasMs: this.recentDeltasSample.map(d => Math.round(d * 100) / 100),
			now: Math.round(this.now * 10) / 10,
			warmupUntil: Math.round(this.warmupUntil * 10) / 10,
			troubleCount: this.troubleCount,
		};
	}

	private engage(): void {
		this.engaged = true;
		this.resetMeasurement();
		this.applyRung('engaged');
		debugLog(`[AutoQuality] Engaged at rung ${this.rung}, mode ${this.mode}`);
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
		this.rung = 1;
	}

	private persistState(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({rung: this.rung, mode: this.mode}));
		} catch {
			// storage unavailable — tuning just restarts next session
		}
	}

	private resetMeasurement(): void {
		this.buckets.length = 0;
		this.bucketDeltas.length = 0;
		this.bucketTime = 0;
		this.troubleCount = 0;
		this.holdTimer = 0;
		this.failTimer = 0;
		this.warmupUntil = this.now + WARMUP;
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
		debugLog(`[AutoQuality] rung ${this.rung}, mode ${this.mode} — ${reason}`);
	}

	private target(): number {
		return this.mode === 'fallback30' ? 30 : 60;
	}

	public update(deltaTime: number): void {
		if (!this.engaged) return;

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

		// Per-second buckets rated by their TRUE average fps (frames/time), then
		// the median across the window — stall-seconds can't dominate. Tab
		// hiccups (>0.5 s frames) reset the bucket.
		if (deltaTime > 0.5) {
			this.bucketDeltas.length = 0;
			this.bucketTime = 0;
			return;
		}
		this.bucketDeltas.push(deltaTime * 1000);
		this.bucketTime += deltaTime;
		if (this.bucketTime < 1) return;

		this.recentDeltasSample = this.bucketDeltas.slice(0, 30);
		const bucketFps = this.bucketDeltas.length / this.bucketTime;
		this.lastP75Delta = this.bucketTime * 1000 / this.bucketDeltas.length;
		this.bucketDeltas.length = 0;
		this.bucketTime = 0;

		if (this.now < this.warmupUntil) return;

		this.buckets.push(bucketFps);
		if (this.buckets.length > WINDOW_BUCKETS) this.buckets.shift();
		if (this.buckets.length < 4) return;

		const sorted = [...this.buckets].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		this.lastMedian = median;
		const target = this.target();

		// Effectiveness audit for the last down-step: if lowering quality did
		// not raise the frame rate, quality is not the bottleneck — undo the
		// step and stop degrading for a while.
		if (this.checkingStepEffect) {
			this.checkingStepEffect = false;
			if (median < this.preStepMedian * STEP_EFFECT_MIN && this.rung > 0) {
				this.rung--;
				this.downLockedUntil = this.now + DOWN_LOCK_AFTER_INEFFECTIVE;
				this.lockedRungAbove = -1; // the revert is intentional — allow future climbs
				this.applyRung(`step-down ineffective (median ${this.preStepMedian.toFixed(0)}→${median.toFixed(0)}) — reverting`);
				this.resetMeasurement();
				return;
			}
		}

		if (median < target * DOWN_RATIO) {
			this.holdTimer = 0;
			this.troubleCount++;
			if (this.troubleCount < DOWN_CONFIRM) return;
			this.troubleCount = 0;

			if (this.mode === 'unlimited') {
				// First response to trouble at max: re-cap to 60 before degrading.
				this.mode = 'strive60';
				this.applyRung('re-capping to 60');
				this.resetMeasurement();
			} else if (this.rung < RUNGS.length - 1 && this.now >= this.downLockedUntil) {
				this.lockedRungAbove = this.rung;
				this.lockedUntil = this.now + OSCILLATION_LOCK;
				this.preStepMedian = median;
				this.checkingStepEffect = true;
				this.rung++;
				this.applyRung(`median ${median.toFixed(0)} < ${Math.round(target * DOWN_RATIO)}`);
				if (!this.announcedDownStep) {
					this.announcedDownStep = true;
					this.toast('Auto quality: adjusted for smoother performance');
				}
				this.resetMeasurement();
			} else if (this.mode === 'strive60') {
				// Can't (or shouldn't) degrade further — at the floor, or quality
				// reduction was proven ineffective. If 60 still isn't happening,
				// the honest move is a lower TARGET, not lower quality.
				this.failTimer += 1;
				if (this.failTimer >= FALLBACK_CONFIRM) {
					this.mode = 'fallback30';
					this.downLockedUntil = 0; // new target — re-evaluate step effectiveness fresh
					this.applyRung('cannot hold 60 — targeting a steady 30');
					this.toast('Auto quality: targeting a steady 30 FPS on this device');
					this.resetMeasurement();
				}
			}
			return;
		}

		this.troubleCount = 0;
		this.failTimer = 0;

		// Meeting the target NEVER reduces quality. Holding it comfortably
		// earns a step up (or an uncap at the top).
		if (median >= target * UP_RATIO) {
			this.holdTimer += 1;

			const wantRung = this.rung - 1;
			const rungLocked = wantRung >= 0 && wantRung <= this.lockedRungAbove && this.now < this.lockedUntil;

			if (this.rung > 0 && !rungLocked && this.holdTimer >= UP_HOLD) {
				this.rung--;
				this.applyRung('headroom available');
				this.resetMeasurement();
			} else if (this.rung === 0 && this.mode === 'strive60' && this.holdTimer >= UNCAP_HOLD) {
				this.mode = 'unlimited';
				this.applyRung('max settings hold 60 — uncapping');
				this.resetMeasurement();
			} else if (this.rung === 0 && this.mode === 'fallback30' && this.holdTimer >= RETRY_60_HOLD) {
				this.mode = 'strive60';
				this.downLockedUntil = 0;
				this.applyRung('retrying 60 fps');
				this.resetMeasurement();
			}
		} else {
			// Between 90% and 97% of target: acceptable — hold position.
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
