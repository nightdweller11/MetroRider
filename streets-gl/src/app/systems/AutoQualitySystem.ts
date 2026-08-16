import System from '../System';
import SettingsSystem from '~/app/systems/SettingsSystem';
import AssetConfigSystem, {CrowdLevel} from '~/app/game/assets/AssetConfigSystem';
import TrainSystem from '~/app/game/TrainSystem';
import {debugLog} from '~/app/game/debug';
import RenderSystem from '~/app/systems/RenderSystem';

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
	/**
	 * Platform crowds — the governor's newest lever. A rigged character is
	 * ~5,000 vertices and a busy platform draws up to 40 of them, so thinning
	 * the crowd buys frames the way dropping shadows does. It is pulled EARLY
	 * (rung 2, before render scale drops far) because fewer people on a
	 * platform costs the player far less than a blurrier picture.
	 */
	crowdLevel: 'off' | 'few' | 'normal' | 'busy';
}

const RUNGS: QualityRung[] = [
	/* 0 — max     */ {renderScale: 1.0, shadows: 'high', shadowResolution: '2048', ssao: 'on', bloom: 'on', crowdLevel: 'busy'},
	/* 1 — default */ {renderScale: 1.0, shadows: 'medium', shadowResolution: '2048', ssao: 'on', bloom: 'on', crowdLevel: 'normal'},
	/* 2 */ {renderScale: 0.85, shadows: 'medium', shadowResolution: '1024', ssao: 'on', bloom: 'on', crowdLevel: 'normal'},
	/* 3 */ {renderScale: 0.85, shadows: 'low', shadowResolution: '1024', ssao: 'on', bloom: 'on', crowdLevel: 'few'},
	/* 4 */ {renderScale: 0.75, shadows: 'low', shadowResolution: '512', ssao: 'off', bloom: 'on', crowdLevel: 'few'},
	/* 5 */ {renderScale: 0.75, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off', crowdLevel: 'few'},
	/* 6 */ {renderScale: 0.65, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off', crowdLevel: 'off'},
	/* 7 — floor  */ {renderScale: 0.5, shadows: 'off', shadowResolution: '512', ssao: 'off', bloom: 'off', crowdLevel: 'off'},
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

/**
 * GPU headroom thresholds, as a fraction of the frame budget.
 *
 * Frame rate alone cannot answer the question this governor actually asks.
 * Under a cap the rate can only sit AT the target, so "median >= target" is
 * true whether the GPU is 30% busy or 99% busy — the up-step therefore used to
 * climb blind until the frame rate finally broke, then step back down, which
 * guarantees oscillation around the edge and a visible stutter each time round.
 * It also could not see a machine that was holding 60 only just, so it would
 * happily raise quality on hardware with nothing to spare.
 *
 * GPU milliseconds per frame answers it directly and keeps working under any
 * cap: measured against the frame budget it IS utilisation. Measured on this
 * scene 2026-08-13, the frame is FILL-RATE bound — halving the render scale
 * halved GPU time, while cutting draw calls by 46% changed it by ~1% — which is
 * why render scale is the ladder's strongest lever and why a governor steering
 * on GPU cost will pull the right one.
 */
const GPU_TIGHT = 0.90;        // above this fraction of budget → no headroom
const GPU_COMFORTABLE = 0.65;  // below this → genuinely room to raise quality
const GPU_TIGHT_CONFIRM = 3;   // consecutive tight evaluations before acting

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
	/** GPU cost before the last down-step, for the effectiveness audit. */
	private preStepGpuMs: number | null = null;
	private checkingStepEffect: boolean = false;
	private downLockedUntil: number = 0;

	public postInit(): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		this.restoreState();

		settings.onChange('performanceMode', ({statusValue}) => {
			if (this.applying) return;
			this.onTierSelected(statusValue);
		}, true);

		// Manually changing any governed setting means the settings are no
		// longer the tier that is named on the label — whether or not the
		// governor was running. The doc above has always said the label flips
		// to Custom; the code only did it while auto was engaged, so tweaking
		// a shadow on "High-end" left the label claiming a preset it no longer
		// matched. Nobody could see that until the controls became reachable.
		for (const key of GOVERNED_KEYS) {
			settings.onChange(key, () => {
				if (this.applying) return;

				if (this.engaged) {
					this.becomeCustom('Auto tuning off — you’re in manual control (tier: Custom)');
				} else if (settings.get('performanceMode')?.statusValue !== 'custom') {
					this.becomeCustom('Picture settings are your own now');
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
			// Picking a tier is an explicit choice, so crowds follow it exactly
			// (up or down) and become the new baseline auto may thin from.
			this.playerCrowdLevel = preset.crowdLevel;
			this.systemManager.getSystem(AssetConfigSystem)?.setUserConfig({crowdLevel: preset.crowdLevel});
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

	private gpuTightCount: number = 0;
	private lastGpuMs: number | null = null;

	/**
	 * GPU cost of a frame as a fraction of the frame budget, or null when the
	 * timer extension is unavailable (in which case the governor falls back to
	 * frame rate alone, exactly as it behaved before).
	 */
	private gpuLoad(): number | null {
		const timer = this.systemManager.getSystem(RenderSystem).gpuFrameTimer;
		const ms = timer?.medianMs() ?? null;

		this.lastGpuMs = ms;

		if (ms === null) return null;

		// Budget comes from the TARGET rate, not the observed one: the question
		// is whether the frame fits in the time we are aiming for.
		const budget = 1000 / (this.mode === 'fallback30' ? 30 : 60);

		return ms / budget;
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
			gpuMs: this.lastGpuMs === null ? null : Math.round(this.lastGpuMs * 100) / 100,
			gpuTightCount: this.gpuTightCount,
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
		this.gpuTightCount = 0;
		// The old cost describes the old settings — averaging it across a
		// change would have the governor react to a frame it no longer renders.
		this.systemManager.getSystem(RenderSystem).gpuFrameTimer?.reset();
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
		// Crowds live in the asset config, not the graphics settings, so they
		// are set through their own system — and only DOWNWARD from what the
		// player chose, so auto never makes a platform busier than they asked.
		this.applyCrowdLevel(r.crowdLevel);
		this.persistState();
		debugLog(`[AutoQuality] rung ${this.rung}, mode ${this.mode} — ${reason}`);
	}

	/** Never raise the player's crowd setting; only thin it out. */
	private applyCrowdLevel(level: 'off' | 'few' | 'normal' | 'busy'): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) return;

		const order: CrowdLevel[] = ['off', 'few', 'normal', 'busy'];
		const current = assetConfig.getConfig().crowdLevel;
		const chosen = this.playerCrowdLevel ?? current;
		const wanted = order.indexOf(level) <= order.indexOf(chosen) ? level : chosen;

		if (wanted !== current) {
			// Remember what the player actually asked for, so a later UP-rung
			// restores it instead of leaving them stuck on the thinned value.
			if (this.playerCrowdLevel === null) this.playerCrowdLevel = current;
			assetConfig.setUserConfig({crowdLevel: wanted});
		}
	}

	private playerCrowdLevel: CrowdLevel | null = null;

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

			// Did lowering quality actually make the frame cheaper?
			//
			// This used to ask the frame RATE, which cannot answer under a cap:
			// 30 fps before and 30 fps after means every down-step is judged
			// useless, gets reverted, and down-stepping locks for three minutes
			// — so a capped game could never shed load however hard the GPU was
			// working. Observed live at 4x pixels: GPU at 215% of budget, rate
			// pinned at 30, governor stepping down and immediately undoing it.
			// GPU cost answers the question directly and works under any cap.
			const gpuNow = this.gpuLoad() === null ? null : this.lastGpuMs;
			const ineffective = (this.preStepGpuMs !== null && gpuNow !== null)
				? gpuNow > this.preStepGpuMs / STEP_EFFECT_MIN
				: median < this.preStepMedian * STEP_EFFECT_MIN;

			// An ineffective step means one of two very different things.
			//
			// If the GPU has headroom, quality was not the bottleneck (CPU,
			// tile streaming, a hitch) and degrading the picture is pure loss —
			// revert and stop, which is what this audit was built for.
			//
			// If the GPU is still over budget, quality IS the bottleneck and
			// the step simply was not big enough. Reverting there strands the
			// player at an unplayable setting: observed live at 4x pixels, the
			// governor stepped 0→1 (which changes only shadows and crowds —
			// both rungs render at full scale), measured no gain on a
			// fill-rate-bound frame, reverted, and then sat at 215% of budget
			// for three minutes refusing to act. Keep descending instead; the
			// ladder drops render scale a rung or two further down, and that is
			// the lever that actually moves this frame.
			const gpuOverBudget = gpuNow !== null && this.preStepGpuMs !== null
				&& gpuNow > (1000 / (this.mode === 'fallback30' ? 30 : 60)) * GPU_TIGHT;

			if (ineffective && gpuOverBudget && this.rung < RUNGS.length - 1) {
				this.applyRung(`step-down insufficient (gpu ${gpuNow.toFixed(1)}ms still over budget) — descending further`);
				this.rung++;
				this.checkingStepEffect = true;
				this.preStepGpuMs = gpuNow;
				this.preStepMedian = median;
				this.resetMeasurement();
				return;
			}

			if (ineffective && this.rung > 0) {
				this.rung--;
				this.downLockedUntil = this.now + DOWN_LOCK_AFTER_INEFFECTIVE;
				this.lockedRungAbove = -1; // the revert is intentional — allow future climbs
				this.applyRung(
					this.preStepGpuMs !== null && gpuNow !== null
						? `step-down ineffective (gpu ${this.preStepGpuMs.toFixed(1)}→${gpuNow.toFixed(1)}ms) — reverting`
						: `step-down ineffective (median ${this.preStepMedian.toFixed(0)}→${median.toFixed(0)}) — reverting`
				);
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
				this.preStepGpuMs = this.gpuLoad() === null ? null : this.lastGpuMs;
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

		const gpuLoad = this.gpuLoad();

		// The frame rate is being met — but a capped rate is met identically at
		// 30% and 99% GPU. If the GPU is at the edge, the next tile stream or
		// busy platform is a visible stutter, so step down BEFORE the player
		// sees it rather than after.
		if (gpuLoad !== null && gpuLoad > GPU_TIGHT) {
			this.gpuTightCount++;

			if (
				this.gpuTightCount >= GPU_TIGHT_CONFIRM &&
				this.rung < RUNGS.length - 1 &&
				this.now >= this.downLockedUntil
			) {
				this.gpuTightCount = 0;
				this.lockedRungAbove = this.rung;
				this.lockedUntil = this.now + OSCILLATION_LOCK;
				this.preStepMedian = median;
				this.preStepGpuMs = this.lastGpuMs;
				this.checkingStepEffect = true;
				this.rung++;
				this.applyRung(`gpu ${(gpuLoad * 100).toFixed(0)}% of budget — no headroom`);
				this.resetMeasurement();
			}

			this.holdTimer = 0;
			return;
		}

		this.gpuTightCount = 0;

		// Meeting the target NEVER reduces quality. Holding it comfortably
		// earns a step up (or an uncap at the top).
		if (median >= target * UP_RATIO) {
			this.holdTimer += 1;

			const wantRung = this.rung - 1;
			const rungLocked = wantRung >= 0 && wantRung <= this.lockedRungAbove && this.now < this.lockedUntil;
			// Under a cap the rate sits at the target whatever the GPU is
			// doing, so "target met" is not evidence of room. Require measured
			// headroom before spending it; with no GPU timer, fall back to the
			// old rate-only behaviour rather than refusing to climb at all.
			const hasHeadroom = gpuLoad === null || gpuLoad < GPU_COMFORTABLE;

			if (this.rung > 0 && !rungLocked && hasHeadroom && this.holdTimer >= UP_HOLD) {
				this.rung--;
				this.applyRung('headroom available');
				this.resetMeasurement();
			} else if (this.rung === 0 && this.mode === 'strive60' && hasHeadroom && this.holdTimer >= UNCAP_HOLD) {
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
