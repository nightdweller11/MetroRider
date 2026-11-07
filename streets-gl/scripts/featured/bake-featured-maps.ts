/**
 * Bake the Featured maps' thumbnails, and prove each one loads.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs"}' \
 *     scripts/featured/bake-featured-maps.ts [--check] <id> [<id> …]
 *
 * For every MetroDreamin id: fetch the real page (straight from
 * metrodreamin.com, the way the game's server proxy does), run it through the
 * game's own importer and route parser, and report what a player would get —
 * lines, stations, the shortest drivable line. Without `--check` it also
 * writes `src/app/game/data/FeaturedSketches.ts`: each map's sketch, so the
 * start screen can draw a Featured map before anyone has loaded it.
 *
 * A map that fails to import, or has a line with fewer than two stops, is
 * reported and left out — a Featured map that does not drive is worse than
 * none.
 */

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import {parseNextData, convertToMetroMapData} from '../../src/app/game/data/MetroDreaminImporter';
import {parseMetroMap} from '../../src/app/game/data/RouteParser';
import {sketchMap} from '../../src/app/game/data/MapThumbnail';

function get(url: string, redirects = 3): Promise<string> {
	return new Promise((resolve, reject) => {
		https.get(url, {headers: {'User-Agent': 'Mozilla/5.0 MetroRider featured-bake', Accept: 'text/html'}}, res => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
				res.resume();
				resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
				return;
			}
			if (res.statusCode !== 200) {
				res.resume();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			let body = '';
			res.setEncoding('utf8');
			res.on('data', c => { body += c; });
			res.on('end', () => resolve(body));
		}).on('error', reject);
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const ids = args.filter(a => a !== '--check');
	const out: Record<string, unknown> = {};

	for (const id of ids) {
		try {
			const html = await get(`https://metrodreamin.com/view/${encodeURIComponent(id)}`);
			const map = convertToMetroMapData(parseNextData(html));
			const lines = parseMetroMap(map);
			const stops = lines.map(l => l.stations.length);
			const sketch = sketchMap(map);
			const ok = lines.length > 0 && Math.min(...stops) >= 2;

			console.log(`${ok ? 'OK  ' : 'BAD '} ${id}  "${map.name}"  lines=${lines.length} stations=${sketch.stationCount} `
				+ `minStops=${Math.min(...stops)} sketchPts=${sketch.lines.reduce((n, l) => n + l.p.length / 2, 0)} `
				+ `bytes=${JSON.stringify(sketch).length}`);

			if (ok) out[id] = sketch;
		} catch (err) {
			console.log(`FAIL ${id}  ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (check) return;

	const target = path.join(__dirname, '../../src/app/game/data/FeaturedSketches.ts');
	const body = '/**\n * Featured maps\' sketches, baked by scripts/featured/bake-featured-maps.ts\n'
		+ ' * from the real maps on ' + new Date().toISOString().slice(0, 10) + '. Generated: do not edit by hand.\n'
		+ ' * A map\'s own load replaces its baked sketch in the cache, so a map that\n'
		+ ' * has changed since shows its new shape the first time it is driven.\n */\n\n'
		+ 'import type {MapSketch} from \'./MapThumbnail\';\n\n'
		+ 'export const FEATURED_SKETCHES: Record<string, MapSketch> = '
		+ JSON.stringify(out) + ';\n';

	fs.writeFileSync(target, body);
	console.log(`wrote ${target} (${body.length} bytes)`);
}

void main();
