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

	public playHorn(): void {
		if (!this.ctx || !this.masterGain) return;

		if (this.samples.horn) {
			const src = this.ctx.createBufferSource();
			src.buffer = this.samples.horn;
			const gain = this.ctx.createGain();
			gain.gain.value = 0.7;
			src.connect(gain);
			gain.connect(this.masterGain);
			src.start();
		} else {
			this.playProceduralHorn();
		}
	}

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

	public update(deltaTime: number): void {
		if (!this.ctx || !this.masterGain) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) return;

		if (this.ctx.state === 'suspended') {
			this.ctx.resume().catch(() => {});
		}

		const speed = trainSystem.physicsState.trainSpeed;
		const input = trainSystem.getInput();
		const throttle = input.isHeld('throttle');
		const braking = input.isHeld('brake');
		const emergency = input.isHeld('emergency');

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
