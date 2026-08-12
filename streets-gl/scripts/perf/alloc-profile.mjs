async (page) => {
	const ctx = await page.context().browser().newContext({viewport: {width: 1100, height: 750}});
	const p = await ctx.newPage();
	const cdp = await ctx.newCDPSession(p);

	await p.goto('http://localhost:3111/', {waitUntil: 'domcontentloaded'});
	await p.waitForFunction(() => (window).__trainSystem && (window).__trainSystem.lines.length > 0, null, {timeout: 90000});
	await p.evaluate(() => {
		const d = document.getElementById('release-splash-dismiss');
		if (d) d.click();
	});
	await p.waitForFunction(() => [...document.querySelectorAll('#game-start-btn div')].some(x => x.textContent.startsWith('▶')), null, {timeout: 60000});
	await p.evaluate(() => { [...document.querySelectorAll('#game-start-btn div')].find(x => x.textContent.startsWith('▶')).click(); });
	await p.waitForTimeout(10000);
	await p.evaluate(() => (window).__trainSystem.setHUDThrottle(true));
	await p.waitForTimeout(2000);

	await cdp.send('HeapProfiler.enable');
	await cdp.send('HeapProfiler.startSampling', {samplingInterval: 16384});
	await p.waitForTimeout(20000);
	const {profile} = await cdp.send('HeapProfiler.stopSampling');
	await p.evaluate(() => (window).__trainSystem.setHUDThrottle(false));

	// Aggregate self-size by function (callFrame), walk the tree
	const byFn = new Map();
	const walk = (node) => {
		const cf = node.callFrame;
		const key = `${cf.functionName || '(anonymous)'} @ ${cf.url.split('/').pop()}:${cf.lineNumber}`;
		byFn.set(key, (byFn.get(key) || 0) + node.selfSize);
		for (const c of node.children || []) walk(c);
	};
	walk(profile.head);

	const total = [...byFn.values()].reduce((s, v) => s + v, 0);
	const top = [...byFn.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 18)
		.map(([k, v]) => `${(v / 1048576).toFixed(1)}MB (${(v / total * 100).toFixed(0)}%) ${k}`);

	await p.close();
	await ctx.close();
	return {totalSampledMB: Math.round(total / 1048576), top};
}
