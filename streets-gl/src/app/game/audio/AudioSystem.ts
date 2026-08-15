import System from '~/app/System';
import TrainSystem from '~/app/game/TrainSystem';
import AssetConfigSystem from '~/app/game/assets/AssetConfigSystem';

const MAX_SPEED_REF = 55;

interface SampleBuffers {
	horn: AudioBuffer | null;
	engine: AudioBuffer | null;
	rail: AudioBuffer | null;
	wind: AudioBuffer | null;
	brake: AudioBuffer | null;
	doorChime: AudioBuffer | null;
	stationChime: AudioBuffer | null;
}

export default class AudioSystem extends System {
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private muted: boolean = false;
	private unlocked: boolean = false;

	private samples: SampleBuffers = {
		horn: null, engine: null, rail: null,
		wind: null, brake: null, doorChime: null, stationChime: null,
	};

	private tractionOsc1: OscillatorNode | null = null;
	private tractionOsc2: OscillatorNode | null = null;
	private tractionGain: GainNode | null = null;
	private compressorOsc: OscillatorNode | null = null;
	private compressorGain: GainNode | null = null;
	private railSource: AudioBufferSourceNode | null = null;
	private railGain: GainNode | null = null;
	private railFilter: BiquadFilterNode | null = null;
	private clatterSource: AudioBufferSourceNode | null = null;
	private clatterGain: GainNode | null = null;
	private windSource: AudioBufferSourceNode | null = null;
	private windGain: GainNode | null = null;
	private brakeSource: AudioBufferSourceNode | null = null;
	private brakeGain: GainNode | null = null;

	private engineSampleSource: AudioBufferSourceNode | null = null;
	private engineSampleGain: GainNode | null = null;

	private squealSource: AudioBufferSourceNode | null = null;
	private squealFilter: BiquadFilterNode | null = null;
	private squealGain: GainNode | null = null;

	public postInit(): void {
		const handler = (): void => {
			this.unlock();
			window.removeEventListener('click', handler);
			window.removeEventListener('keydown', handler);
			window.removeEventListener('touchstart', handler);
		};
		window.addEventListener('click', handler);
		window.addEventListener('keydown', handler);
		window.addEventListener('touchstart', handler);

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (assetConfig) {
			assetConfig.onChange(() => this.loadSamplesFromConfig());
		}
	}

	public unlock(): void {
		if (this.unlocked) return;
		try {
			this.ctx = new AudioContext();
			this.masterGain = this.ctx.createGain();
			this.masterGain.gain.value = this.muted ? 0 : 1;
			this.masterGain.connect(this.ctx.destination);
			this.startContinuousLayers();
			this.unlocked = true;
			console.log('[AudioSystem] Audio context unlocked');
			this.loadSamplesFromConfig();
		} catch (err) {
			console.error('[AudioSystem] Failed to create AudioContext:', err);
		}
	}

	private async loadSamplesFromConfig(): Promise<void> {
		if (!this.ctx) return;

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) return;

		const config = assetConfig.getConfig();
		const catalog = assetConfig.getCatalog();
		if (!catalog) return;

		const soundCategories: (keyof SampleBuffers)[] = ['horn', 'engine', 'rail', 'wind', 'brake', 'doorChime', 'stationChime'];

		for (const category of soundCategories) {
			const soundId = config.sounds[category];
			if (!soundId || soundId === 'procedural') {
				this.samples[category] = null;
				continue;
			}

			const entries = catalog.sounds[category] || [];
			const entry = entries.find((e: any) => e.id === soundId);
			if (!entry || !entry.path) {
				this.samples[category] = null;
				continue;
			}

			try {
				const url = assetConfig.getAssetUrl(entry.path);
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status} for ${url}`);
				}
				const arrayBuffer = await response.arrayBuffer();
				this.samples[category] = await this.ctx.decodeAudioData(arrayBuffer);
				console.log(`[AudioSystem] Loaded sample for ${category}: ${entry.name}`);
			} catch (err) {
				console.error(`[AudioSystem] Failed to load ${category} sample:`, err);
				this.samples[category] = null;
			}
		}
	}

	/*
	 * The horn sounds for as long as the button is held.
	 *
	 * A fixed two-second blast is the one thing a child will find within a
	 * minute and then use for the next ten, so it has to behave like a horn:
	 * lean on it and it keeps going, let go and it stops. A tap still gets a
	 * proper short pip rather than a click, because releasing after 40 ms
	 * should not cut the attack off mid-ramp.
	 */
	private hornNodes: {sources: AudioScheduledSourceNode[]; gain: GainNode} | null = null;
	private hornStartedAt: number = 0;
	private hornStopTimer: ReturnType<typeof setTimeout> | null = null;

	/** Ramp on, ramp off — a hard start or stop on a loud tone clicks. */
	private static readonly HornAttackS: number = 0.06;
	private static readonly HornReleaseS: number = 0.18;
	/** A tap still gets this much horn. */
	private static readonly HornMinS: number = 0.35;
	/** A stuck button, or a tab that loses the pointer-up, cannot blare forever. */
	private static readonly HornMaxS: number = 8;

	public hornDown(): void {
		if (!this.ctx || !this.masterGain || this.hornNodes) return;

		const t = this.ctx.currentTime;
		const gain = this.ctx.createGain();

		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(0.7, t + AudioSystem.HornAttackS);
		gain.connect(this.masterGain);

		const sources: AudioScheduledSourceNode[] = [];

		if (this.samples.horn) {
			const src = this.ctx.createBufferSource();

			src.buffer = this.samples.horn;
			// Looped so holding the button sustains rather than stopping dead
			// at the end of the recording.
			src.loop = true;
			src.connect(gain);
			src.start();
			sources.push(src);
		} else {
			// A chord rather than a tone: a two-note horn is what a train has.
			for (const freq of [220, 277, 330]) {
				const osc = this.ctx.createOscillator();

				osc.type = 'sawtooth';
				osc.frequency.value = freq;

				const filter = this.ctx.createBiquadFilter();

				filter.type = 'lowpass';
				filter.frequency.value = 600;

				osc.connect(filter);
				filter.connect(gain);
				osc.start(t);
				sources.push(osc);
			}
		}

		this.hornNodes = {sources, gain};
		this.hornStartedAt = t;

		if (this.hornStopTimer) clearTimeout(this.hornStopTimer);
		this.hornStopTimer = setTimeout((): void => this.hornUp(), AudioSystem.HornMaxS * 1000);
	}

	public hornUp(): void {
		if (!this.ctx || !this.hornNodes) return;

		const nodes = this.hornNodes;

		// Claimed immediately: the release is scheduled ahead in audio time, and
		// a second press arriving during it must start a NEW horn rather than
		// find this one still parked here and do nothing.
		this.hornNodes = null;

		if (this.hornStopTimer) {
			clearTimeout(this.hornStopTimer);
			this.hornStopTimer = null;
		}

		const held = this.ctx.currentTime - this.hornStartedAt;
		const startRelease = this.hornStartedAt + Math.max(held, AudioSystem.HornMinS);
		const end = startRelease + AudioSystem.HornReleaseS;

		nodes.gain.gain.cancelScheduledValues(startRelease);
		nodes.gain.gain.setValueAtTime(0.7, startRelease);
		nodes.gain.gain.linearRampToValueAtTime(0.0001, end);

		for (const src of nodes.sources) {
			try {
				src.stop(end);
			} catch {
				// Already stopped — nothing to do.
			}
		}
	}

	/** A short press, for callers that have no press/release to give. */
	/**
	 * Flange squeal — the noise a train makes leaning into a tight curve.
	 *
	 * A continuous voice whose loudness follows how hard the curve is being
	 * taken, rather than a sample fired at a threshold: the sound of a curve is
	 * that it builds and falls away, and a clip that starts at a trigger line
	 * announces the curve instead of being it.
	 *
	 * Synthesised, because it is a narrow band of noise around 2 kHz and that
	 * is cheaper to make than to ship.
	 */
	public setFlangeSqueal(intensity: number): void {
		if (!this.ctx || !this.masterGain) return;

		const level = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));

		if (level <= 0.01) {
			// Faded, not cut: silence arriving in one frame is a click.
			if (this.squealGain) {
				this.squealGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
			}

			return;
		}

		if (!this.squealGain) this.startSqueal();
		if (!this.squealGain || !this.squealFilter) return;

		// Quiet even at its loudest. This is a detail heard over the ride, not
		// an effect played at the player.
		this.squealGain.gain.setTargetAtTime(level * 0.06, this.ctx.currentTime, 0.09);
		// Tighter curves ring higher, which is the part that reads as a flange
		// rather than as wind.
		this.squealFilter.frequency.setTargetAtTime(1500 + level * 1400, this.ctx.currentTime, 0.2);
	}

	/** Build the squeal voice once, and leave it running silently. */
	private startSqueal(): void {
		if (!this.ctx || !this.masterGain) return;

		// Two seconds of noise, looped. Long enough not to hear the seam.
		const frames = Math.floor(this.ctx.sampleRate * 2);
		const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
		const data = buffer.getChannelData(0);

		for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

		const src = this.ctx.createBufferSource();

		src.buffer = buffer;
		src.loop = true;

		const filter = this.ctx.createBiquadFilter();

		filter.type = 'bandpass';
		filter.Q.value = 14;
		filter.frequency.value = 2000;

		const gain = this.ctx.createGain();

		gain.gain.value = 0;

		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain);
		src.start();

		this.squealSource = src;
		this.squealFilter = filter;
		this.squealGain = gain;
	}

	public playHorn(): void {
		this.hornDown();
		setTimeout((): void => this.hornUp(), AudioSystem.HornMinS * 1000);
	}

	/** @deprecated Superseded by the sustained horn; kept for reference. */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private playProceduralHorn(): void {
		if (!this.ctx || !this.masterGain) return;
		const t = this.ctx.currentTime;

		const fundamentals = [220, 277, 330];
		for (const freq of fundamentals) {
			const osc = this.ctx.createOscillator();
			osc.type = 'sawtooth';
			osc.frequency.value = freq;

			const gain = this.ctx.createGain();
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.03, t + 0.1);
			gain.gain.setValueAtTime(0.03, t + 1.5);
			gain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);

			const filter = this.ctx.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 600;

			osc.connect(filter);
			filter.connect(gain);
			gain.connect(this.masterGain);
			osc.start(t);
			osc.stop(t + 2.0);
		}
	}

	public playDoorOpen(): void {
		if (this.samples.doorChime) {
			this.playSampleOneShot(this.samples.doorChime, 0.5);
		} else {
			this.playDoorChime(true);
		}
	}

	public playDoorClose(): void {
		if (this.samples.doorChime) {
			this.playSampleOneShot(this.samples.doorChime, 0.5);
		} else {
			this.playDoorChime(false);
		}
	}

	public playStationChime(): void {
		if (this.samples.stationChime) {
			this.playSampleOneShot(this.samples.stationChime, 0.5);
		} else {
			this.playProceduralStationChime();
		}
	}

	private playSampleOneShot(buffer: AudioBuffer, volume: number): void {
		if (!this.ctx || !this.masterGain) return;
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		const gain = this.ctx.createGain();
		gain.gain.value = volume;
		src.connect(gain);
		gain.connect(this.masterGain);
		src.start();
	}

	private playProceduralStationChime(): void {
		if (!this.ctx || !this.masterGain) return;
		const t = this.ctx.currentTime;

		const pairs = [[880, 1109], [1109, 880]];
		pairs.forEach((chord, i) => {
			chord.forEach((freq) => {
				const osc = this.ctx.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = freq;

				const gain = this.ctx.createGain();
				const start = t + i * 0.5;
				gain.gain.setValueAtTime(0, start);
				gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
				gain.gain.setValueAtTime(0.06, start + 0.3);
				gain.gain.exponentialRampToValueAtTime(0.001, start + 0.48);

				osc.connect(gain);
				gain.connect(this.masterGain);
				osc.start(start);
				osc.stop(start + 0.5);
			});
		});
	}

	public setMuted(muted: boolean): void {
		this.muted = muted;
		if (this.masterGain) {
			this.masterGain.gain.value = muted ? 0 : 1;
		}
	}

	public toggleMute(): boolean {
		this.setMuted(!this.muted);
		return this.muted;
	}

	/**
	 * Spoken announcements go through the browser's voice rather than this
	 * context's gain, so they have to ask whether the game is muted instead of
	 * inheriting it.
	 */
	public isMuted(): boolean {
		return this.muted;
	}

	public update(deltaTime: number): void {
		if (!this.ctx || !this.masterGain) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) return;

		if (this.ctx.state === 'suspended') {
			this.ctx.resume().catch(() => {});
		}

		const speed = trainSystem.physicsState.trainSpeed;
		// What the TRAIN is doing, not what a key is doing. These read the
		// keyboard, which stopped being how anyone drives when the master
		// controller shipped — so a player working the lever heard no traction
		// and no brake at all, and one working the keys heard them only for the
		// instant a key was down.
		const throttle = trainSystem.physicsState.powerNotch > 0.02;
		const braking = trainSystem.physicsState.brakeNotch > 0.02;
		const emergency = trainSystem.getInput().isHeld('emergency');

		const t = this.ctx.currentTime;
		const speedPct = Math.min(speed / MAX_SPEED_REF, 1);

		this.updateTraction(speedPct, throttle, t);
		this.updateRail(speedPct, t);
		this.updateClatter(speedPct, t);
		this.updateWind(speedPct, t);
		this.updateBrake(braking, emergency, speedPct, t);
	}

	private startContinuousLayers(): void {
		if (!this.ctx || !this.masterGain) return;

		const noiseBuffer = this.createNoiseBuffer(4);

		this.tractionOsc1 = this.ctx.createOscillator();
		this.tractionOsc1.type = 'sawtooth';
		this.tractionOsc1.frequency.value = 100;
		this.tractionOsc2 = this.ctx.createOscillator();
		this.tractionOsc2.type = 'square';
		this.tractionOsc2.frequency.value = 150;

		this.tractionGain = this.ctx.createGain();
		this.tractionGain.gain.value = 0;

		const tractionFilter = this.ctx.createBiquadFilter();
		tractionFilter.type = 'bandpass';
		tractionFilter.frequency.value = 400;
		tractionFilter.Q.value = 2;

		this.tractionOsc1.connect(tractionFilter);
		this.tractionOsc2.connect(tractionFilter);
		tractionFilter.connect(this.tractionGain);
		this.tractionGain.connect(this.masterGain);
		this.tractionOsc1.start();
		this.tractionOsc2.start();

		this.compressorOsc = this.ctx.createOscillator();
		this.compressorOsc.type = 'sine';
		this.compressorOsc.frequency.value = 60;
		this.compressorGain = this.ctx.createGain();
		this.compressorGain.gain.value = 0.008;
		const compFilter = this.ctx.createBiquadFilter();
		compFilter.type = 'lowpass';
		compFilter.frequency.value = 150;
		this.compressorOsc.connect(compFilter);
		compFilter.connect(this.compressorGain);
		this.compressorGain.connect(this.masterGain);
		this.compressorOsc.start();

		this.railSource = this.ctx.createBufferSource();
		this.railSource.buffer = noiseBuffer;
		this.railSource.loop = true;
		this.railGain = this.ctx.createGain();
		this.railGain.gain.value = 0;
		this.railFilter = this.ctx.createBiquadFilter();
		this.railFilter.type = 'lowpass';
		this.railFilter.frequency.value = 300;
		this.railFilter.Q.value = 1.5;
		this.railSource.connect(this.railFilter);
		this.railFilter.connect(this.railGain);
		this.railGain.connect(this.masterGain);
		this.railSource.start();

		this.clatterSource = this.ctx.createBufferSource();
		this.clatterSource.buffer = this.createClatterBuffer();
		this.clatterSource.loop = true;
		this.clatterGain = this.ctx.createGain();
		this.clatterGain.gain.value = 0;
		const clatterFilter = this.ctx.createBiquadFilter();
		clatterFilter.type = 'bandpass';
		clatterFilter.frequency.value = 1200;
		clatterFilter.Q.value = 1;
		this.clatterSource.connect(clatterFilter);
		clatterFilter.connect(this.clatterGain);
		this.clatterGain.connect(this.masterGain);
		this.clatterSource.start();

		this.windSource = this.ctx.createBufferSource();
		this.windSource.buffer = noiseBuffer;
		this.windSource.loop = true;
		this.windGain = this.ctx.createGain();
		this.windGain.gain.value = 0;
		const windFilter = this.ctx.createBiquadFilter();
		windFilter.type = 'highpass';
		windFilter.frequency.value = 2500;
		windFilter.Q.value = 0.3;
		this.windSource.connect(windFilter);
		windFilter.connect(this.windGain);
		this.windGain.connect(this.masterGain);
		this.windSource.start();

		this.brakeSource = this.ctx.createBufferSource();
		this.brakeSource.buffer = noiseBuffer;
		this.brakeSource.loop = true;
		this.brakeGain = this.ctx.createGain();
		this.brakeGain.gain.value = 0;
		const brakeFilter = this.ctx.createBiquadFilter();
		brakeFilter.type = 'bandpass';
		brakeFilter.frequency.value = 4000;
		brakeFilter.Q.value = 8;
		this.brakeSource.connect(brakeFilter);
		brakeFilter.connect(this.brakeGain);
		this.brakeGain.connect(this.masterGain);
		this.brakeSource.start();
	}

	private updateTraction(speedPct: number, throttle: boolean, t: number): void {
		if (!this.tractionGain || !this.tractionOsc1 || !this.tractionOsc2) return;
		const baseFreq = 80 + speedPct * 800;
		this.tractionOsc1.frequency.setTargetAtTime(baseFreq, t, 0.3);
		this.tractionOsc2.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.3);
		const vol = throttle ? 0.015 + speedPct * 0.025 : speedPct * 0.005;
		this.tractionGain.gain.setTargetAtTime(vol, t, throttle ? 0.08 : 0.5);
	}

	private updateRail(speedPct: number, t: number): void {
		if (!this.railGain || !this.railFilter) return;
		const vol = speedPct > 0.02 ? 0.02 + speedPct * 0.06 : 0;
		this.railGain.gain.setTargetAtTime(vol, t, 0.2);
		this.railFilter.frequency.setTargetAtTime(200 + speedPct * 400, t, 0.2);
	}

	private updateClatter(speedPct: number, t: number): void {
		if (!this.clatterGain || !this.clatterSource) return;
		const vol = speedPct > 0.05 ? speedPct * 0.04 : 0;
		this.clatterGain.gain.setTargetAtTime(vol, t, 0.15);
		this.clatterSource.playbackRate.setTargetAtTime(0.4 + speedPct * 1.6, t, 0.2);
	}

	private updateWind(speedPct: number, t: number): void {
		if (!this.windGain) return;
		const vol = speedPct > 0.15 ? (speedPct - 0.15) * 0.035 : 0;
		this.windGain.gain.setTargetAtTime(vol, t, 0.4);
	}

	private updateBrake(braking: boolean, emergency: boolean, speedPct: number, t: number): void {
		if (!this.brakeGain) return;
		let vol = 0;
		if (braking && speedPct > 0.05) {
			vol = emergency ? speedPct * 0.06 : speedPct * 0.03;
		}
		this.brakeGain.gain.setTargetAtTime(vol, t, braking ? 0.05 : 0.2);
	}

	private createNoiseBuffer(durationSec: number): AudioBuffer {
		const length = this.ctx.sampleRate * durationSec;
		const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) {
			data[i] = Math.random() * 2 - 1;
		}
		return buffer;
	}

	private createClatterBuffer(): AudioBuffer {
		const sr = this.ctx.sampleRate;
		const duration = 2;
		const length = sr * duration;
		const buffer = this.ctx.createBuffer(1, length, sr);
		const data = buffer.getChannelData(0);

		const jointInterval = sr * 0.25;
		const clickLen = Math.floor(sr * 0.004);
		const secondClickDelay = Math.floor(sr * 0.03);

		for (let i = 0; i < length; i++) {
			const posInInterval = i % Math.floor(jointInterval);
			if (posInInterval < clickLen || (posInInterval >= secondClickDelay && posInInterval < secondClickDelay + clickLen)) {
				data[i] = (Math.random() * 2 - 1) * 0.9;
			} else {
				data[i] = (Math.random() * 2 - 1) * 0.02;
			}
		}
		return buffer;
	}

	private playDoorChime(opening: boolean): void {
		if (!this.ctx || !this.masterGain) return;
		const t = this.ctx.currentTime;

		const freqs = opening ? [880, 1047, 1319] : [1319, 1047, 880];
		freqs.forEach((freq, i) => {
			const osc = this.ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = freq;

			const gain = this.ctx.createGain();
			const start = t + i * 0.1;
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);

			osc.connect(gain);
			gain.connect(this.masterGain);
			osc.start(start);
			osc.stop(start + 0.3);
		});

		const noiseLen = 0.8;
		const buf = this.createNoiseBuffer(noiseLen);
		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		const gain = this.ctx.createGain();
		const slideStart = t + 0.3;
		gain.gain.setValueAtTime(0, slideStart);
		gain.gain.linearRampToValueAtTime(0.025, slideStart + 0.06);
		gain.gain.setValueAtTime(0.025, slideStart + noiseLen - 0.15);
		gain.gain.linearRampToValueAtTime(0, slideStart + noiseLen);

		const filter = this.ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 500;
		filter.Q.value = 0.8;

		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain);
		src.start(slideStart);
		src.stop(slideStart + noiseLen);
	}
}
