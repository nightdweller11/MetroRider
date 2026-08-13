/**
 * How long the GPU actually spends on a frame.
 *
 * The auto-quality governor used to steer on frame rate alone, which cannot
 * answer the only question it needs answered: how much headroom is left.
 * `requestAnimationFrame` is vsync-locked and a frame limiter pins the rate on
 * top of that, so 60 fps is reported identically whether the GPU is 30% busy or
 * 99% busy and one hitch away from stuttering. Steering on it means the
 * governor cannot step up on a machine with room to spare, and cannot step down
 * on a machine that is barely holding on behind a cap.
 *
 * GPU milliseconds per frame answers it directly, and stays meaningful under
 * any cap. Measured against the frame budget it IS utilisation: 8.8 ms of a
 * 16.67 ms budget is 53%.
 *
 * Validated on 2026-08-13 by varying real work — halving the render scale
 * halved the reading (10.26 → 5.29 ms), turning shadows off moved it 10.06 →
 * 8.88 ms, and repeat runs agree to about 1%.
 */

const WINDOW = 120;
/** Stop issuing queries if the driver stops answering. */
const MAX_IN_FLIGHT = 8;

const QUERY_RESULT_AVAILABLE = 0x8867;
const QUERY_RESULT = 0x8866;

export default class GpuFrameTimer {
	private readonly gl: WebGL2RenderingContext;
	private readonly ext: {TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number} | null;
	private readonly samples: number[] = [];
	private readonly pending: WebGLQuery[] = [];
	private open: WebGLQuery | null = null;
	private sortScratch: number[] = [];

	public constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.ext = (gl as any).getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
	}

	public get supported(): boolean {
		return this.ext !== null;
	}

	public begin(): void {
		if (!this.ext || this.open !== null || this.pending.length >= MAX_IN_FLIGHT) {
			return;
		}

		const query = this.gl.createQuery();

		if (!query) return;

		this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
		this.open = query;
	}

	public end(): void {
		if (!this.ext || this.open === null) return;

		this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		this.pending.push(this.open);
		this.open = null;

		this.collect();
	}

	private collect(): void {
		if (!this.ext) return;

		const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);

		for (let i = this.pending.length - 1; i >= 0; i--) {
			const query = this.pending[i];

			if (!this.gl.getQueryParameter(query, QUERY_RESULT_AVAILABLE)) continue;

			// A disjoint result is garbage by definition — the GPU was reset or
			// the clock changed underneath the query. Drop it rather than let it
			// drag the median around and make the governor act on noise.
			if (!disjoint) {
				this.samples.push(this.gl.getQueryParameter(query, QUERY_RESULT) / 1e6);
				if (this.samples.length > WINDOW) this.samples.shift();
			}

			this.gl.deleteQuery(query);
			this.pending.splice(i, 1);
		}
	}

	/** Median GPU milliseconds over the recent window, or null if unknown. */
	public medianMs(): number | null {
		if (this.samples.length < 20) return null;

		this.sortScratch = this.samples.slice().sort((a, b) => a - b);

		return this.sortScratch[this.sortScratch.length >> 1];
	}

	public sampleCount(): number {
		return this.samples.length;
	}

	/** Forget history — call after a quality change so the old cost is not averaged in. */
	public reset(): void {
		this.samples.length = 0;
	}
}
