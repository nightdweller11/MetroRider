/**
 * Shared setup for every observation probe: boot the game, silence audio,
 * grab the systems the probes need, and expose a small driving API.
 *
 * Kept in one place so a probe describes WHAT it observes, not how to start a
 * train.
 */

/**
 * Open the game IN THE PAGE THE RUNNER ALREADY HAS.
 *
 * Probes used to create a fresh browser context and close it afterwards, which
 * pops a window to the front and steals focus every single run — unusable while
 * the operator is doing anything else. The existing page is reused and simply
 * parked on a blank page when the probe finishes.
 */
export async function openGame(page, {url = 'http://localhost:3111/', telemetry = true, viewport = {width: 1280, height: 800}} = {}) {
	const ctx = page.context();
	await page.setViewportSize(viewport);
	const errors = [];
	page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
	page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });

	// The HTML document is cacheable, so the browser will happily keep serving an
	// index.html that points at a bundle from two builds ago — and every
	// measurement taken through it is then a measurement of code that no longer
	// exists. This cost a whole diagnosis round on 2026-08-13. Bust the document
	// cache on every open, then PROVE the loaded bundle is the one on disk.
	const bust = `_b=${Date.now()}`;
	await page.goto(`${url}?${telemetry ? 'telemetry=1&' : ''}${bust}`, {waitUntil: 'domcontentloaded'});

	const served = await (await fetch(url, {cache: 'no-store'})).text();
	const expected = (served.match(/index\.[a-f0-9]+\.js/) ?? [])[0];
	const loaded = await page.evaluate(
		() => ([...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
			.find(s => /index\.[a-f0-9]+\.js/.test(s)) ?? '').replace('./js/', ''),
	);
	if (expected && loaded && expected !== loaded) {
		throw new Error(`stale bundle: page loaded ${loaded}, server serves ${expected}. Rebuild or hard-reload.`);
	}

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

/**
 * Finish a probe without disturbing the operator: leave the shared window on a
 * blank page rather than closing it (closing the last page tears the window
 * down and the next probe raises a new one to the front).
 */
export async function releaseGame(page) {
	try {
		await page.goto('about:blank', {waitUntil: 'domcontentloaded'});
	} catch {
		// A probe that already navigated away is fine.
	}
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
