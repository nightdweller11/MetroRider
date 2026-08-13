/**
 * V1/V2/V8 — what is actually CHANGING on screen, and where.
 *
 * Captures a burst of compositor frames and measures, per screen region:
 *   - meanDiff: average per-pixel change between consecutive frames
 *   - hotPct:   share of pixels changing by more than a visible threshold
 *   - flipRate: share of pixels whose change REVERSES direction frame to frame
 *               — the signature of shimmer//popping rather than smooth motion
 *
 * Smooth camera motion produces a high meanDiff with a LOW flip rate: the world
 * slides. Texture churn and popping produce a high flip rate: the same pixels
 * jump back and forth. That distinction is what a screenshot cannot make and
 * what I was missing.
 */
import {openGame, startDriving} from './lib-drive.mjs';

const REGIONS = {
	buildingsLeft: {x: 60, y: 120, w: 380, h: 260},
	buildingsRight: {x: 840, y: 120, w: 380, h: 260},
	trackAhead: {x: 480, y: 330, w: 320, h: 220},
	platform: {x: 120, y: 420, w: 520, h: 220},
	sky: {x: 480, y: 20, w: 320, h: 90},
};

export default async (page, options = {}) => {
	const {page: p, errors} = await openGame(page);
	const cdp = await p.context().newCDPSession(p);
	await startDriving(p);

	if (options.moveCamera !== false) {
		// Slow orbit: the operator's "moving the camera around at the station".
		await p.evaluate(async () => {
			const cam = window.__h.camera;
			for (let i = 0; i < 40; i++) {
				cam.userYawOffset += 0.03;
				await new Promise(r => setTimeout(r, 40));
			}
		});
	}

	const frames = [];
	const onFrame = async (ev) => {
		frames.push(ev.data);
		try { await cdp.send('Page.screencastFrameAck', {sessionId: ev.sessionId}); } catch {}
	};
	cdp.on('Page.screencastFrame', onFrame);
	await cdp.send('Page.startScreencast', {format: 'png', everyNthFrame: 1, maxWidth: 1280, maxHeight: 800});

	if (options.driveWhileCapturing !== false) {
		await p.evaluate(() => window.__trainSystem.setHUDThrottle(true));
	}
	await p.waitForTimeout(options.captureMs ?? 1500);
	await p.evaluate(() => window.__trainSystem.setHUDThrottle(false));
	await cdp.send('Page.stopScreencast');
	cdp.off('Page.screencastFrame', onFrame);

	const use = frames.slice(2, 14);
	const analysis = await p.evaluate(async ([images, regions]) => {
		const decoded = await Promise.all(images.map(b => new Promise(r => {
			const im = new Image();
			im.onload = () => r(im);
			im.src = 'data:image/png;base64,' + b;
		})));

		const out = {};
		for (const [name, r] of Object.entries(regions)) {
			const canvas = document.createElement('canvas');
			canvas.width = r.w; canvas.height = r.h;
			const g = canvas.getContext('2d', {willReadFrequently: true});
			let prev = null, prevDelta = null;
			let meanSum = 0, hotSum = 0, flipSum = 0, pairs = 0;

			for (const im of decoded) {
				g.clearRect(0, 0, r.w, r.h);
				g.drawImage(im, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
				const cur = g.getImageData(0, 0, r.w, r.h);
				if (prev) {
					const delta = new Float32Array(cur.data.length / 4);
					let sum = 0, hot = 0, flips = 0, counted = 0;
					for (let k = 0, px = 0; k < cur.data.length; k += 4, px++) {
						const d = (cur.data[k] - prev.data[k] + cur.data[k+1] - prev.data[k+1] + cur.data[k+2] - prev.data[k+2]) / 3;
						delta[px] = d;
						const m = Math.abs(d);
						sum += m;
						if (m > 12) hot++;
						if (prevDelta && Math.abs(prevDelta[px]) > 6 && m > 6 && Math.sign(prevDelta[px]) !== Math.sign(d)) flips++;
						counted++;
					}
					meanSum += sum / counted;
					hotSum += (hot / counted) * 100;
					flipSum += (flips / counted) * 100;
					pairs++;
					prevDelta = delta;
				}
				prev = cur;
			}

			out[name] = {
				meanDiff: +(meanSum / Math.max(pairs, 1)).toFixed(2),
				hotPct: +(hotSum / Math.max(pairs, 1)).toFixed(2),
				flipPct: +(flipSum / Math.max(pairs, 1)).toFixed(2),
				pairs,
			};
		}
		return out;
	}, [use, REGIONS]);

	const telemetry = await p.evaluate(() => window.__telemetry?.report());
	await releaseGame(p);
	return {analysis, telemetry, frames: frames.length, errors: errors.slice(0, 5)};
};
