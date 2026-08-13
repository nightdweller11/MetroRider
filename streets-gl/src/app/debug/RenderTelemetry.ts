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
	/** A texture-array layer rewritten with different dimensions than before. */
	layerReassignments: number;
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
	drawCalls: 0, frames: 0, layerReassignments: 0,
};

/** Per texture-array layer: what was written there and how often. */
const layerWrites = new Map<string, {
	signature: string; writes: number; unpackAlignment: number; shearRisk: boolean;
}>();
let currentUnpackAlignment = 4;
let unpackAlignmentChanges = 0;
let unpackFlipYChanges = 0;

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
/**
 * Sampling rate PER KIND, not across all kinds.
 *
 * This used to be one global counter sampling one call in twenty of the whole
 * stream. That silently destroys exactly the signal this is for: `bufferSubData`
 * fires ~11,500 times a second and `createBuffer` around ten, so creations are
 * ~0.1% of events and almost every sampling slot went to a uniform upload. A
 * leak — the rare event — was the one guaranteed to be invisible. Resource
 * creations are rare and are the leak signal, so every one is captured; the
 * per-draw traffic stays sampled because it is ranked, not hunted.
 */
const KIND_SAMPLE_RATES: Record<string, number> = {
	buffer: 1,
	texture: 1,
	vao: 1,
	bufferData: 20,
	bufferSubData: 20,
	texUpload: 20,
};
const DEFAULT_SAMPLE_RATE = 20;

const attribution = new Map<string, number>();
const kindCounters = new Map<string, number>();
/** Every kind seen this run, so an unknown query can be answered honestly. */
const kindsSeen = new Set<string>();

function attribute(kind: string): void {
	kindsSeen.add(kind);

	const rate = KIND_SAMPLE_RATES[kind] ?? DEFAULT_SAMPLE_RATE;
	const seen = (kindCounters.get(kind) ?? 0) + 1;

	kindCounters.set(kind, seen);

	if (rate > 1 && seen % rate !== 0) return;

	const stack = new Error().stack ?? '';
	const frames = stack.split('\n').slice(2, 14)
		.map(line => line.trim().replace(/^at\s+/, '').split(' (')[0])
		.filter(name => name && !name.includes('RenderTelemetry') && !name.includes('patched') && !/^https?:/.test(name));

	const key = `${kind} ← ${frames.slice(0, 5).join(' ← ') || 'unknown'}`;
	attribution.set(key, (attribution.get(key) ?? 0) + rate);
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
		// Attributed separately from texture CREATION: the symptom reported was
		// textures changing on structures as the camera moves, which is a
		// re-upload onto an existing texture, not a new one.
		attribute('texUpload');
	};
	wrap(gl, 'texImage2D', countUpload);
	wrap(gl, 'texSubImage2D', countUpload);
	wrap(gl, 'texImage3D', countUpload);
	wrap(gl, 'compressedTexImage2D', countUpload);

	/**
	 * Texture ARRAY writes, tracked per layer.
	 *
	 * A building atlas is a texture array with a fixed number of layers, handed
	 * out to tiles as they stream in. Two symptoms point straight at this:
	 * "the texture changes every time" (a layer reassigned while a tile still
	 * samples it) and "applied diagonally" (a write whose row stride does not
	 * match the layer's width shears the image). Counting writes per layer, and
	 * noting when a layer is REWRITTEN with different dimensions, makes both
	 * visible instead of a matter of opinion.
	 */
	wrap(gl, 'texSubImage3D', (args) => {
		countUpload(args);
		const zOffset = typeof args[4] === 'number' ? (args[4] as number) : -1;
		const width = typeof args[5] === 'number' ? (args[5] as number) : -1;
		const height = typeof args[6] === 'number' ? (args[6] as number) : -1;
		const key = String(zOffset);
		const previous = layerWrites.get(key);
		const signature = `${width}x${height}`;

		if (previous && previous.signature !== signature) {
			counters.layerReassignments++;
		}
		layerWrites.set(key, {
			signature,
			writes: (previous?.writes ?? 0) + 1,
			unpackAlignment: currentUnpackAlignment,
			shearRisk: width > 0 && (width * 4) % currentUnpackAlignment !== 0,
		});
	});

	// Row stride comes from UNPACK_ALIGNMENT; a mismatch is exactly what makes
	// an uploaded image look sheared. Track it so the shear question is
	// answerable rather than arguable.
	wrap(gl, 'pixelStorei', (args) => {
		const pname = args[0] as number;
		const value = args[1] as number;
		if (pname === 0x0CF5) { // UNPACK_ALIGNMENT
			currentUnpackAlignment = value;
			unpackAlignmentChanges++;
		}
		if (pname === 0x9240) { // UNPACK_FLIP_Y_WEBGL
			unpackFlipYChanges++;
		}
	});

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
		// Attributed too. Leaving it out made blame() lie by omission: the
		// visible callers looked dominant only because the biggest source of
		// uploads was not being sampled at all.
		attribute('bufferSubData');
	});

	for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
		wrap(gl, name, () => { counters.drawCalls++; openGpuQueryForFrame(); });
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyGl = gl as any;

	if (typeof anyGl.getExtension === 'function' && typeof anyGl.createQuery === 'function') {
		const ext = anyGl.getExtension('EXT_disjoint_timer_query_webgl2');

		if (ext) {
			timerExt = ext;
			timerGl = anyGl;
		}
	}
}

let lastSample: TelemetrySample | null = null;
let framesAtLastSample = 0;

/**
 * GPU time per frame, in milliseconds.
 *
 * FRAME RATE IS NOT A THROUGHPUT MEASURE HERE. `requestAnimationFrame` is
 * vsync-locked, so fps cannot exceed the display refresh however much headroom
 * the frame has — and with the frame limiter set (a persisted graphics setting)
 * it is pinned lower still. A "74 → 77 fps" reading was quoted as evidence of a
 * win on 2026-08-13 when both numbers were sitting at a cap, while the in-game
 * HUD read 120 at the same moment.
 *
 * `EXT_disjoint_timer_query_webgl2` measures what actually matters: how long the
 * GPU spends on a frame. A query opens at one animation frame and closes at the
 * next, bracketing exactly one frame of submitted work. Results are polled
 * without blocking, and disjoint results are discarded as the spec requires.
 */
const gpuTimings: number[] = [];
let timerExt: {TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number} | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let timerGl: any = null;
let openQuery: WebGLQuery | null = null;
const pendingQueries: WebGLQuery[] = [];

function pollGpuQueries(): void {
	if (!timerGl || !timerExt) return;

	const disjoint = timerGl.getParameter(timerExt.GPU_DISJOINT_EXT);

	for (let i = pendingQueries.length - 1; i >= 0; i--) {
		const query = pendingQueries[i];

		if (!timerGl.getQueryParameter(query, 0x8867 /* QUERY_RESULT_AVAILABLE */)) continue;

		if (!disjoint) {
			const ns = timerGl.getQueryParameter(query, 0x8866 /* QUERY_RESULT */);

			gpuTimings.push(ns / 1e6);
			if (gpuTimings.length > 4000) gpuTimings.shift();
		}

		timerGl.deleteQuery(query);
		pendingQueries.splice(i, 1);
	}
}

/**
 * Open a query on the FIRST draw of a frame and close it as soon as that
 * frame's synchronous render has finished.
 *
 * The first attempt opened at one animation frame and closed at the next,
 * which brackets the render AND the idle gap that follows it. Validated by
 * varying `renderScale`: quartering the pixel count left the number flat at
 * ~13 ms, i.e. it was reporting the vsync period, not the render. Any verdict
 * from it would have been noise.
 *
 * The engine renders synchronously inside its rAF callback, so a microtask
 * queued from the first draw call runs the moment that callback's JS stack
 * unwinds — after every draw, before the browser idles. That brackets the
 * command stream and nothing else.
 */
function openGpuQueryForFrame(): void {
	if (!timerGl || !timerExt || openQuery !== null) return;

	pollGpuQueries();

	// Keep the in-flight set bounded if the driver stops answering.
	if (pendingQueries.length > 240) return;

	const query = timerGl.createQuery();

	if (!query) return;

	timerGl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
	openQuery = query;

	queueMicrotask(() => {
		if (openQuery === null) return;

		timerGl.endQuery(timerExt.TIME_ELAPSED_EXT);
		pendingQueries.push(openQuery);
		openQuery = null;
	});
}

function startSampling(): void {
	const countFrame = (): void => {
		counters.frames++;
		pollGpuQueries();
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

/** Per-frame mesh rebuilds, by class — filled by RenderSystem when enabled. */
const meshRebuilds = new Map<string, number>();
let meshRebuildFrames = 0;

/**
 * Called from the renderer's "objects that need a mesh" loop.
 *
 * An object should build its mesh ONCE. One that appears here every frame is
 * being rebuilt continuously — new GPU buffers, new VAO, re-bound textures —
 * which is both the cost and the most likely cause of textures flickering on
 * the objects concerned.
 */
export function noteMeshRebuild(className: string): void {
	if (!installed) return;
	meshRebuilds.set(className, (meshRebuilds.get(className) ?? 0) + 1);
}

export function noteMeshRebuildFrame(): void {
	if (!installed) return;
	meshRebuildFrames++;
}

/**
 * Tile lifecycle.
 *
 * Everything downstream — building meshes rebuilt, buildings hidden and shown
 * as their holder tile changes, textures appearing to swap — follows from tiles
 * being created and destroyed. Counting them directly turns "the tile system
 * seems too aggressive" into a number that can be compared before and after a
 * change, instead of inferred from buffer churn.
 */
const tileEvents = {created: 0, removed: 0};
/**
 * Removals BY REASON.
 *
 * "152 tiles were destroyed" does not say which policy destroyed them, and I
 * guessed wrong twice. Every call site names itself, so the breakdown reads
 * like an answer instead of a riddle.
 */
const tileRemovalReasons = new Map<string, number>();

export function noteTileCreated(): void {
	if (installed) tileEvents.created++;
}

export function noteTileRemoved(reason = 'unknown'): void {
	if (!installed) return;
	tileEvents.removed++;
	tileRemovalReasons.set(reason, (tileRemovalReasons.get(reason) ?? 0) + 1);
}

function installApi(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).__telemetry = {
		snapshot: (): TelemetryCounters => ({...counters}),
		series: (): TelemetrySample[] => samples.slice(),
		markPhase: (name: string): void => { phase = name; },
		reset: (): void => {
			samples.length = 0;
			attribution.clear();
			kindCounters.clear();
			gpuTimings.length = 0;
			// kindsSeen deliberately survives reset: it describes what this
			// build can record, not what happened in the last window, and
			// blameKind must not start rejecting valid kinds after a reset.
			meshRebuilds.clear();
			meshRebuildFrames = 0;
			tileEvents.created = 0;
			tileEvents.removed = 0;
			tileRemovalReasons.clear();
			layerWrites.clear();
			counters.layerReassignments = 0;
			unpackAlignmentChanges = 0;
			unpackFlipYChanges = 0;
		},
		/** Tiles created and destroyed since the last reset. */
		tileChurn: (): {
			created: number; removed: number; perSecond: number;
			removalsByReason: Record<string, number>;
		} => {
			const seconds = Math.max(1, (performance.now() - startedAt) / 1000);
			const windowSeconds = samples.length > 1
				? Math.max(1, (samples[samples.length - 1].t - samples[0].t) / 1000)
				: seconds;
			return {
				created: tileEvents.created,
				removed: tileEvents.removed,
				perSecond: +((tileEvents.created + tileEvents.removed) / windowSeconds).toFixed(1),
				removalsByReason: Object.fromEntries(
					[...tileRemovalReasons.entries()].sort((a, b) => b[1] - a[1]),
				),
			};
		},
		/** Which classes rebuild their mesh, and how often per frame. */
		meshChurn: (): {className: string; total: number; perFrame: number}[] =>
			[...meshRebuilds.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([className, total]) => ({
					className,
					total,
					perFrame: +(total / Math.max(1, meshRebuildFrames)).toFixed(2),
				})),
		/**
		 * Who created the GPU work, ranked — the leak's return address.
		 *
		 * Reports the share of the TOTAL, not of the listed rows. Ranking the
		 * top ten and quoting a percentage of those ten reads as "89% of all
		 * uploads" when it may be 89% of 0.6% of them; that mistake sent me
		 * after the wrong code once already.
		 */
		blame: (limit = 12): {
			caller: string; approxCount: number; shareOfAllPct: number;
		}[] => {
			let total = 0;
			for (const n of attribution.values()) total += n;
			const everything = Math.max(total, 1);
			return [...attribution.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, limit)
				.map(([caller, approxCount]) => ({
					caller,
					approxCount,
					shareOfAllPct: +((approxCount / everything) * 100).toFixed(1),
				}));
		},
		/**
		 * Blame for ONE kind of work.
		 *
		 * Uniform-block writes (one `bufferSubData` per draw) legitimately
		 * dominate the raw count, and they drown out the thing that actually
		 * leaks — a `createBuffer` that is never matched by a delete. Filtering
		 * by kind is what separates "expensive by design" from "wrong".
		 */
		blameKind: (kind: string, limit = 10): {caller: string; approxCount: number}[] => {
			// An unknown kind used to return [], which reads identically to
			// "this work never happened" — and did: `blameKind('createBuffer')`
			// came back empty for a whole diagnosis round because the kind is
			// named 'buffer'. That was taken as evidence the buffer growth was
			// unattributable. Fail loudly instead of answering a question that
			// was never asked.
			if (!kindsSeen.has(kind)) {
				throw new Error(
					`blameKind: no such kind "${kind}". Kinds recorded this run: ` +
					`${[...kindsSeen].sort().join(', ') || '(none yet)'}.`
				);
			}

			return [...attribution.entries()]
				.filter(([key]) => key.startsWith(`${kind} ←`))
				.sort((a, b) => b[1] - a[1])
				.slice(0, limit)
				.map(([caller, approxCount]) => ({caller, approxCount}));
		},
		/**
		 * GPU milliseconds per frame — the metric to judge a render change by.
		 *
		 * Median and p95 rather than a mean, because occasional tile-upload
		 * frames skew an average badly. `supported: false` means the browser
		 * withheld the timer extension, and there is NO substitute: report the
		 * work counts and say the GPU cost was not measured. Do not fall back
		 * to frame rate — under vsync and a frame limiter that measures the
		 * cap, not the renderer.
		 */
		gpuFrameMs: (): Record<string, unknown> => {
			if (!timerExt) {
				return {supported: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable', samples: 0};
			}

			const sorted = [...gpuTimings].sort((a, b) => a - b);

			if (sorted.length === 0) {
				return {supported: true, samples: 0, note: 'no completed queries yet'};
			}

			const at = (q: number): number =>
				+sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(3);

			return {
				supported: true,
				samples: sorted.length,
				medianMs: at(0.5),
				p95Ms: at(0.95),
				minMs: +sorted[0].toFixed(3),
				maxMs: +sorted[sorted.length - 1].toFixed(3),
			};
		},
		/** What `blameKind` will accept, and how often each kind is sampled. */
		kinds: (): {kind: string; observed: number; sampledOneIn: number}[] =>
			[...kindsSeen].sort().map(kind => ({
				kind,
				observed: kindCounters.get(kind) ?? 0,
				sampledOneIn: KIND_SAMPLE_RATES[kind] ?? DEFAULT_SAMPLE_RATE,
			})),
		/**
		 * The texture-array picture: which layers are being written, how often,
		 * whether any layer changed shape (a reassignment a tile may not know
		 * about), and whether any write has a row stride that would shear it.
		 */
		textures: (): Record<string, unknown> => {
			const layers = [...layerWrites.entries()]
				.map(([layer, v]) => ({layer: Number(layer), ...v}))
				.sort((a, b) => b.writes - a.writes);
			return {
				distinctLayers: layers.length,
				layerReassignments: counters.layerReassignments,
				shearRiskLayers: layers.filter(l => l.shearRisk).length,
				unpackAlignment: currentUnpackAlignment,
				unpackAlignmentChanges,
				unpackFlipYChanges,
				rewrittenLayers: layers.filter(l => l.writes > 1).length,
				busiestLayers: layers.slice(0, 8),
			};
		},
		/** How much of the sampled work the top `limit` rows actually explain. */
		blameCoverage: (limit = 12): {rows: number; distinctCallers: number; coveredPct: number} => {
			const values = [...attribution.values()].sort((a, b) => b - a);
			const total = values.reduce((a, b) => a + b, 0) || 1;
			const covered = values.slice(0, limit).reduce((a, b) => a + b, 0);
			return {
				rows: Math.min(limit, values.length),
				distinctCallers: values.length,
				coveredPct: +((covered / total) * 100).toFixed(1),
			};
		},
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
