/**
 * Shared setup for every observation probe: boot the game, silence audio,
 * grab the systems the probes need, and expose a small driving API.
 *
 * Kept in one place so a probe describes WHAT it observes, not how to start a
 * train.
 */

export async function openGame(browser, {url = 'http://localhost:3111/', telemetry = true, viewport = {width: 1280, height: 800}} = {}) {
	const ctx = await browser.newContext({viewport});
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
	page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });

	await page.goto(url + (telemetry ? '?telemetry=1' : ''), {waitUntil: 'domcontentloaded'});
	await page.waitForFunction(() => window.__trainSystem && window.__trainSystem.lines.length > 0, null, {timeout: 120000});
	await page.evaluate(() => { document.getElementById('release-splash-dismiss')?.click(); });
	await page.waitForFunction(
		() => [...document.querySelectorAll('#game-start-btn div')].some(x => x.textContent.startsWith('▶')),
		null, {timeout: 120000},
	);

	await page.evaluate(() => {
		const sm = window.__gameSystems;
		const handles = {};
		for (const [, v] of sm.systems) {
			if (v && v.settings && typeof v.settings.update === 'function') handles.settings = v.settings;
			if (v && typeof v.cycleMode === 'function' && typeof v.snapToTrain === 'function') handles.camera = v;
			if (v && v.objects && v.objects.camera) handles.scene = v;
			if (v && Array.isArray(v.carMeshes) && Array.isArray(v.stationMeshes)) handles.trainRender = v;
			if (v && Array.isArray(v.crowdMeshes)) handles.crowds = v;
			if (v && Array.isArray(v.signMeshes)) handles.signs = v;
			if (v && typeof v.waitingAt === 'function') handles.passengers = v;
			if (v && typeof v.signFace === 'function') handles.limits = v;
			if (v && v.terrainHeightProvider !== undefined) handles.terrain = v;
			if (v && v.ctx && typeof v.ctx.suspend === 'function') { try { v.ctx.suspend(); } catch {} }
		}
		window.__h = handles;
		handles.settings?.update('fpsLimit', {statusValue: 'off'});
	});

	return {ctx, page, errors};
}

export async function startDriving(page, {station = 3, line = 0} = {}) {
	await page.evaluate(() => {
		[...document.querySelectorAll('#game-start-btn div')].find(x => x.textContent.startsWith('▶'))?.click();
	});
	await page.waitForTimeout(8000);
	await page.evaluate(([l, s]) => window.__trainSystem.goToStation(l, s, 1), [line, station]);
	await page.waitForTimeout(4000);
}

export async function throttle(page, seconds) {
	await page.evaluate(async (s) => {
		const ts = window.__trainSystem;
		ts.setHUDThrottle(true);
		await new Promise(r => setTimeout(r, s * 1000));
		ts.setHUDThrottle(false);
	}, seconds);
}

export async function telemetryReport(page) {
	return await page.evaluate(() => window.__telemetry?.report() ?? {error: 'telemetry not installed'});
}

export async function markPhase(page, name) {
	await page.evaluate((n) => window.__telemetry?.markPhase(n), name);
}
