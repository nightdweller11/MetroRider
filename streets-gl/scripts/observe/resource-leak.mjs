/**
 * V3 — does the game leak GPU resources while you play?
 *
 * Drives for several minutes and reports the growth per minute of live WebGL
 * objects, heap and per-frame draw calls. A leak shows up as a straight line
 * that never comes down; healthy churn oscillates around a level.
 *
 * PASS: live buffers/textures/VAOs grow by < 5 per minute after warm-up.
 */
import {openGame, startDriving, throttle, telemetryReport, markPhase} from './lib-drive.mjs';

export default async (page) => {
	const {ctx, page: p, errors} = await openGame(page.context().browser());
	await startDriving(p);

	await markPhase(p, 'warmup');
	await p.waitForTimeout(20000);
	await p.evaluate(() => window.__telemetry.reset());

	const phases = [];
	for (let i = 0; i < 4; i++) {
		await markPhase(p, `drive-${i}`);
		await throttle(p, 25);
		await p.waitForTimeout(5000);
		phases.push(await p.evaluate(() => {
			const s = window.__telemetry.series();
			const last = s[s.length - 1];
			return {t: last.t, buffers: last.buffersLive, textures: last.texturesLive, vaos: last.vertexArraysLive, heapMB: last.heapMB, fps: last.fps, drawPerFrame: last.drawCallsPerFrame};
		}));
	}

	const report = await telemetryReport(p);
	await p.close();
	await ctx.close();

	const g = report.growthPerMinute ?? {};
	const verdict = {
		buffersLeak: (g.buffers ?? 0) > 5,
		texturesLeak: (g.textures ?? 0) > 5,
		vaoLeak: (g.vertexArrays ?? 0) > 5,
		heapGrowsMBPerMin: g.heapMB ?? 0,
	};
	return {verdict, report, phases, errors: errors.slice(0, 5)};
};
