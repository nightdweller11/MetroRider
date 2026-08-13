/**
 * Render telemetry — the game reporting on itself.
 *
 * Unit tests check logic I already understood; a screenshot catches one frozen
 * instant. Neither can see a GPU buffer that was created and never deleted, a
 * building texture being re-uploaded every second, or a draw count that climbs
 * the longer you play. Those are the failures that actually reached the player,
 * so the game has to be able to say what it is doing.
 *
 * This patches the WebGL context's *resource* entry points — the ones that
 * create, delete and upload — and counts them. Hot paths (uniform writes,
 * state changes) are untouched, and nothing is installed at all unless the page
 * is opened with `?telemetry=1`, so the shipped game pays nothing.
 *
 * Usage from a probe:
 *   window.__telemetry.snapshot()   // counters right now
 *   window.__telemetry.series()     // one sample per second since start
 *   window.__telemetry.report()     // growth analysis, human readable
 *   window.__telemetry.markPhase('driving')
 */

export interface TelemetryCounters {
	/** Live = created − deleted. A number that only grows is a leak. */
	buffersLive: number;
	buffersCreated: number;
	buffersDeleted: number;
	texturesLive: number;
	texturesCreated: number;
	texturesDeleted: number;
	vertexArraysLive: number;
	vertexArraysCreated: number;
	vertexArraysDeleted: number;
	framebuffersLive: number;
	programsLive: number;
	/** Texture UPLOADS since start — re-uploading the same content is churn. */
	textureUploads: number;
	textureUploadBytes: number;
	/** Buffer uploads (bufferData), the crowd/sign rebuild cost. */
	bufferUploads: number;
	bufferUploadBytes: number;
	drawCalls: number;
	frames: number;
}

export interface TelemetrySample extends TelemetryCounters {
	t: number;
	phase: string;
	fps: number;
	/** JS heap in MB where the browser exposes it. */
	heapMB: number | null;
	/** Per-second rates, computed against the previous sample. */
	drawCallsPerFrame: number;
	textureUploadsPerSec: number;
	bufferUploadsPerSec: number;
}

interface GlLike {
	[key: string]: unknown;
}

const counters: TelemetryCounters = {
	buffersLive: 0, buffersCreated: 0, buffersDeleted: 0,
	texturesLive: 0, texturesCreated: 0, texturesDeleted: 0,
	vertexArraysLive: 0, vertexArraysCreated: 0, vertexArraysDeleted: 0,
	framebuffersLive: 0, programsLive: 0,
	textureUploads: 0, textureUploadBytes: 0,
	bufferUploads: 0, bufferUploadBytes: 0,
	drawCalls: 0, frames: 0,
};

const samples: TelemetrySample[] = [];

/**
 * Who is creating all this?
 *
 * Counting a leak proves it exists; it does not say which code causes it. Every
 * Nth resource creation captures a stack and the frames are tallied, so the
 * report can name the function responsible instead of leaving me to guess from
 * timing. Sampling keeps it cheap — one in twenty is more than enough to rank
 * callers.
 */
const ATTRIBUTION_SAMPLE_RATE = 20;
const attribution = new Map<string, number>();
let creationCounter = 0;

function attribute(kind: string): void {
	creationCounter++;
	if (creationCounter % ATTRIBUTION_SAMPLE_RATE !== 0) return;

	const stack = new Error().stack ?? '';
	const frames = stack.split('\n').slice(2, 14)
		.map(line => line.trim().replace(/^at\s+/, '').split(' (')[0])
		.filter(name => name && !name.includes('RenderTelemetry') && !name.includes('patched') && !/^https?:/.test(name));

	const key = `${kind} ← ${frames.slice(0, 5).join(' ← ') || 'unknown'}`;
	attribution.set(key, (attribution.get(key) ?? 0) + ATTRIBUTION_SAMPLE_RATE);
}
let phase = 'boot';
let installed = false;
let startedAt = 0;

function byteLengthOf(source: unknown): number {
	if (!source) return 0;
	const view = source as {byteLength?: number; width?: number; height?: number};
	if (typeof view.byteLength === 'number') return view.byteLength;
	if (typeof view.width === 'number' && typeof view.height === 'number') {
		return view.width * view.height * 4;
	}
	return 0;
}

/** Wrap one method, keeping the original behaviour exactly. */
function wrap(gl: GlLike, name: string, before: (args: unknown[]) => void): void {
	const original = gl[name];
	if (typeof original !== 'function') return;
	const fn = original as (...args: unknown[]) => unknown;
	gl[name] = function patched(this: unknown, ...args: unknown[]): unknown {
		try {
			before(args);
		} catch {
			// Telemetry must never break rendering.
		}
		return fn.apply(this, args);
	};
}

export function installRenderTelemetry(): void {
	if (installed) return;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	if (!new URLSearchParams(window.location.search).has('telemetry')) return;

	installed = true;
	startedAt = performance.now();

	const originalGetContext = HTMLCanvasElement.prototype.getContext;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(HTMLCanvasElement.prototype as any).getContext = function patchedGetContext(
		this: HTMLCanvasElement, type: string, ...rest: unknown[]
	): unknown {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ctx = (originalGetContext as any).call(this, type, ...rest);
		if (ctx && (type === 'webgl2' || type === 'webgl')) {
			instrument(ctx as unknown as GlLike);
		}
		return ctx;
	};

	console.log('[Telemetry] installed — window.__telemetry is available');
	installApi();
	startSampling();
}

function instrument(gl: GlLike): void {
	if ((gl as {__instrumented?: boolean}).__instrumented) return;
	(gl as {__instrumented?: boolean}).__instrumented = true;

	wrap(gl, 'createBuffer', () => { counters.buffersCreated++; counters.buffersLive++; attribute('buffer'); });
	wrap(gl, 'deleteBuffer', () => { counters.buffersDeleted++; counters.buffersLive--; });
	wrap(gl, 'createTexture', () => { counters.texturesCreated++; counters.texturesLive++; attribute('texture'); });
	wrap(gl, 'deleteTexture', () => { counters.texturesDeleted++; counters.texturesLive--; });
	wrap(gl, 'createVertexArray', () => { counters.vertexArraysCreated++; counters.vertexArraysLive++; attribute('vao'); });
	wrap(gl, 'deleteVertexArray', () => { counters.vertexArraysDeleted++; counters.vertexArraysLive--; });
	wrap(gl, 'createFramebuffer', () => { counters.framebuffersLive++; });
	wrap(gl, 'deleteFramebuffer', () => { counters.framebuffersLive--; });
	wrap(gl, 'createProgram', () => { counters.programsLive++; });
	wrap(gl, 'deleteProgram', () => { counters.programsLive--; });

	const countUpload = (args: unknown[]): void => {
		counters.textureUploads++;
		counters.textureUploadBytes += byteLengthOf(args[args.length - 1]);
	};
	wrap(gl, 'texImage2D', countUpload);
	wrap(gl, 'texSubImage2D', countUpload);
	wrap(gl, 'texImage3D', countUpload);
	wrap(gl, 'texSubImage3D', countUpload);
	wrap(gl, 'compressedTexImage2D', countUpload);

	wrap(gl, 'bufferData', (args) => {
		counters.bufferUploads++;
		counters.bufferUploadBytes += byteLengthOf(args[1]);
		// Uploads dwarf creations here (tens of thousands a second), and an
		// upload is what actually costs GPU time — so they get attributed too.
		attribute('bufferData');
	});
	wrap(gl, 'bufferSubData', (args) => {
		counters.bufferUploads++;
		counters.bufferUploadBytes += byteLengthOf(args[2]);
	});

	for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
		wrap(gl, name, () => { counters.drawCalls++; });
	}
}

let lastSample: TelemetrySample | null = null;
let framesAtLastSample = 0;

function startSampling(): void {
	const countFrame = (): void => {
		counters.frames++;
		requestAnimationFrame(countFrame);
	};
	requestAnimationFrame(countFrame);

	window.setInterval(() => {
		const now = performance.now();
		const dt = lastSample ? (now - startedAt - lastSample.t) / 1000 : 1;
		const framesSince = counters.frames - framesAtLastSample;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const memory = (performance as any).memory;

		const sample: TelemetrySample = {
			...counters,
			t: Math.round(now - startedAt),
			phase,
			fps: dt > 0 ? +(framesSince / dt).toFixed(1) : 0,
			heapMB: memory ? +(memory.usedJSHeapSize / 1048576).toFixed(1) : null,
			drawCallsPerFrame: framesSince > 0
				? +((counters.drawCalls - (lastSample?.drawCalls ?? 0)) / framesSince).toFixed(1)
				: 0,
			textureUploadsPerSec: lastSample
				? +((counters.textureUploads - lastSample.textureUploads) / Math.max(dt, 0.001)).toFixed(1)
				: 0,
			bufferUploadsPerSec: lastSample
				? +((counters.bufferUploads - lastSample.bufferUploads) / Math.max(dt, 0.001)).toFixed(1)
				: 0,
		};

		samples.push(sample);
		if (samples.length > 1800) samples.shift(); // 30 minutes at 1 Hz
		lastSample = sample;
		framesAtLastSample = counters.frames;
	}, 1000);
}

/** Linear growth per minute, by least squares — the leak signal. */
function growthPerMinute(values: number[], times: number[]): number {
	const n = values.length;
	if (n < 3) return 0;
	const meanT = times.reduce((a, b) => a + b, 0) / n;
	const meanV = values.reduce((a, b) => a + b, 0) / n;
	let num = 0, den = 0;
	for (let i = 0; i < n; i++) {
		num += (times[i] - meanT) * (values[i] - meanV);
		den += (times[i] - meanT) ** 2;
	}
	return den === 0 ? 0 : (num / den) * 60_000;
}

function installApi(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).__telemetry = {
		snapshot: (): TelemetryCounters => ({...counters}),
		series: (): TelemetrySample[] => samples.slice(),
		markPhase: (name: string): void => { phase = name; },
		reset: (): void => { samples.length = 0; attribution.clear(); },
		/** Who created the GPU resources, ranked. The leak's return address. */
		blame: (limit = 12): {caller: string; approxCount: number}[] =>
			[...attribution.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, limit)
				.map(([caller, approxCount]) => ({caller, approxCount})),
		report: (): Record<string, unknown> => {
			if (samples.length < 3) return {error: 'not enough samples yet'};
			const times = samples.map(s => s.t);
			const first = samples[0];
			const last = samples[samples.length - 1];
			return {
				windowSeconds: Math.round((last.t - first.t) / 1000),
				fps: {first: first.fps, last: last.fps},
				live: {
					buffers: last.buffersLive,
					textures: last.texturesLive,
					vertexArrays: last.vertexArraysLive,
				},
				growthPerMinute: {
					buffers: +growthPerMinute(samples.map(s => s.buffersLive), times).toFixed(1),
					textures: +growthPerMinute(samples.map(s => s.texturesLive), times).toFixed(1),
					vertexArrays: +growthPerMinute(samples.map(s => s.vertexArraysLive), times).toFixed(1),
					heapMB: +growthPerMinute(samples.map(s => s.heapMB ?? 0), times).toFixed(1),
					drawCallsPerFrame: +growthPerMinute(samples.map(s => s.drawCallsPerFrame), times).toFixed(2),
				},
				rates: {
					textureUploadsPerSec: last.textureUploadsPerSec,
					bufferUploadsPerSec: last.bufferUploadsPerSec,
					drawCallsPerFrame: last.drawCallsPerFrame,
				},
				totals: {
					buffersCreated: last.buffersCreated,
					buffersDeleted: last.buffersDeleted,
					texturesCreated: last.texturesCreated,
					texturesDeleted: last.texturesDeleted,
					textureUploadMB: +(last.textureUploadBytes / 1048576).toFixed(1),
					bufferUploadMB: +(last.bufferUploadBytes / 1048576).toFixed(1),
				},
			};
		},
	};
}
