async (page) => {
	// ==== RUN CONFIG (rewritten per run by the driver) ====
	const CONFIG = {
		label: 'RUN_LABEL',
		url: 'http://localhost:3111/RUN_QUERY',
		cpuThrottle: RUN_THROTTLE,
		durationMs: 60000,
		settleMs: 12000,
		fpsLimitOff: RUN_FPSOFF,
		autoQuality: RUN_AUTOQ,
	};
	// ======================================================

	const ctx = await page.context().browser().newContext({viewport: {width: 1100, height: 750}});
	const p = await ctx.newPage();
	const cdp = await ctx.newCDPSession(p);

	await p.goto(CONFIG.url, {waitUntil: 'domcontentloaded'});

	// Wait for game systems + default map
	await p.waitForFunction(() => (window).__trainSystem && (window).__trainSystem.lines.length > 0, null, {timeout: 90000});

	// Kill splash if present, set fps limit / auto-quality knobs
	await p.evaluate((cfg) => {
		const splash = document.getElementById('release-splash-dismiss');
		if (splash) splash.click();
		const sm = (window).__gameSystems;
		let settingsSystem = null;
		for (const [, v] of sm.systems) {
			if (v && v.settings && typeof v.settings.update === 'function' && typeof v.settings.get === 'function') settingsSystem = v;
		}
		(window).__settings = settingsSystem.settings;
		if (cfg.fpsLimitOff) settingsSystem.settings.update('fpsLimit', {statusValue: 'off'});
		if (cfg.autoQuality) {
			try { settingsSystem.settings.update('autoQuality', {statusValue: cfg.autoQuality}); } catch (e) { /* setting may not exist in baseline build */ }
		}
	}, CONFIG);

	// Start the game via the real Play button
	await p.waitForFunction(() => [...document.querySelectorAll('#game-start-btn div')].some(d => d.textContent.startsWith('▶')), null, {timeout: 60000});
	await p.evaluate(() => {
		[...document.querySelectorAll('#game-start-btn div')].find(d => d.textContent.startsWith('▶')).click();
	});
	await p.waitForTimeout(CONFIG.settleMs);

	// CPU throttle AFTER load/settle so we measure gameplay, not loading
	if (CONFIG.cpuThrottle > 1) {
		await cdp.send('Emulation.setCPUThrottlingRate', {rate: CONFIG.cpuThrottle});
	}

	// Start driving + install the collector
	await p.evaluate(() => {
		(window).__trainSystem.setHUDThrottle(true);
		const c = {
			deltas: [],
			longTasks: 0,
			longTaskMs: 0,
			heap: [],
			last: performance.now(),
			raf: 0,
			heapTimer: 0,
			po: null,
		};
		const loop = (t) => {
			c.deltas.push(t - c.last);
			c.last = t;
			c.raf = requestAnimationFrame(loop);
		};
		c.raf = requestAnimationFrame(loop);
		try {
			c.po = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) { c.longTasks++; c.longTaskMs += e.duration; }
			});
			c.po.observe({entryTypes: ['longtask']});
		} catch (e) { /* longtask unsupported */ }
		c.heapTimer = setInterval(() => {
			c.heap.push(performance.memory ? performance.memory.usedJSHeapSize : 0);
		}, 500);
		(window).__collector = c;
	});

	// Drive for the duration, auto-reversing at line ends
	const tEnd = Date.now() + CONFIG.durationMs;
	while (Date.now() < tEnd) {
		await p.waitForTimeout(5000);
		await p.evaluate(() => {
			const ts = (window).__trainSystem;
			const L = ts.lines[ts.currentLineIdx].track.totalLength;
			ts.setHUDThrottle(true);
			if (ts.physicsState.trainDist > L - 500 && ts.physicsState.direction === 1) ts.setDirection(-1);
			else if (ts.physicsState.trainDist < 500 && ts.physicsState.direction === -1) ts.setDirection(1);
		});
	}

	// Stop + summarize
	const summary = await p.evaluate(() => {
		const c = (window).__collector;
		cancelAnimationFrame(c.raf);
		clearInterval(c.heapTimer);
		if (c.po) c.po.disconnect();
		(window).__trainSystem.setHUDThrottle(false);

		const d = c.deltas.slice(5); // skip warmup frames
		d.sort((a, b) => a - b);
		const pct = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
		const total = d.reduce((s, v) => s + v, 0);

		// heap: allocation rate = sum of positive deltas; GC = drops > 5MB
		let alloc = 0, gcDrops = 0, gcFreed = 0;
		for (let i = 1; i < c.heap.length; i++) {
			const dh = c.heap[i] - c.heap[i - 1];
			if (dh > 0) alloc += dh;
			else if (dh < -5 * 1048576) { gcDrops++; gcFreed += -dh; }
		}
		const secs = total / 1000;

		// current governed settings snapshot (for auto-quality runs)
		const s = (window).__settings;
		const snap = {};
		for (const k of ['renderScale', 'shadows', 'ssao', 'bloom', 'fpsLimit', 'autoQuality']) {
			const v = s.get(k);
			if (v) snap[k] = v.statusValue !== undefined ? v.statusValue : v.numberValue;
		}

		let autoq = 'n/a';
		try {
			const sm2 = (window).__gameSystems;
			for (const [, v] of sm2.systems) {
				if (v && typeof v.isEngaged === 'function' && typeof v.getStatusLabel === 'function') autoq = v.getStatusLabel();
			}
		} catch (e) { /* baseline build */ }

		return {
			autoq,
			frames: d.length,
			seconds: Math.round(secs * 10) / 10,
			avgFps: Math.round(d.length / secs * 10) / 10,
			frameMs: {
				p50: Math.round(pct(0.5) * 100) / 100,
				p75: Math.round(pct(0.75) * 100) / 100,
				p95: Math.round(pct(0.95) * 100) / 100,
				p99: Math.round(pct(0.99) * 100) / 100,
				max: Math.round(d[d.length - 1] * 100) / 100,
			},
			longTasks: c.longTasks,
			longTaskMs: Math.round(c.longTaskMs),
			allocMBperSec: Math.round(alloc / 1048576 / secs * 10) / 10,
			gcDrops,
			gcFreedMB: Math.round(gcFreed / 1048576),
			heapEndMB: Math.round((c.heap[c.heap.length - 1] || 0) / 1048576),
			settings: snap,
		};
	});

	if (CONFIG.cpuThrottle > 1) {
		await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
	}
	await p.close();
	await ctx.close();
	return {label: CONFIG.label, throttle: CONFIG.cpuThrottle, ...summary};
}
