/**
 * Sync the LIVE MetroRider server's data (asset catalog, config, asset files)
 * back into the repo's data-seed/ directory.
 *
 * WHY: the Railway service has NO persistent volume, so DATA_DIR is ephemeral.
 * Anything uploaded/saved on the live site (Sketchfab imports, admin config)
 * lives only inside the running container and is WIPED on the next deploy or
 * restart. Running this script before deploying captures the live state into
 * the repo so seed-data.js reproduces it on the next boot.
 *
 * Usage:  node scripts/sync-live-data.mjs [baseUrl]
 * Default baseUrl: https://metrorider-production.up.railway.app
 */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const BASE = process.argv[2] || 'https://metrorider-production.up.railway.app';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'data-seed');

async function getJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.json();
}

async function download(url, dest) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	const buf = Buffer.from(await res.arrayBuffer());
	fs.mkdirSync(path.dirname(dest), {recursive: true});
	fs.writeFileSync(dest, buf);
	return buf.length;
}

function collectEntries(catalog) {
	const out = [];
	for (const group of Object.values(catalog)) {
		if (typeof group !== 'object' || group === null) continue;
		for (const items of Object.values(group)) {
			if (!Array.isArray(items)) continue;
			for (const item of items) out.push(item);
		}
	}
	return out;
}

const catalog = await getJson(`${BASE}/api/assets/list`);
const config = await getJson(`${BASE}/api/config`);

let downloaded = 0;
let kept = 0;
let failed = 0;

for (const entry of collectEntries(catalog)) {
	if (!entry.path) continue;
	const dest = path.join(SEED, 'assets', entry.path);
	if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
		kept++;
		continue;
	}
	try {
		const bytes = await download(`${BASE}/data/assets/${entry.path}`, dest);
		console.log(`[sync-live-data] downloaded ${entry.path} (${(bytes / 1024).toFixed(0)} KB)`);
		downloaded++;
	} catch (err) {
		console.error(`[sync-live-data] FAILED ${entry.path}: ${err.message}`);
		failed++;
	}
}

fs.writeFileSync(path.join(SEED, 'assets', 'catalog.json'), JSON.stringify(catalog, null, 2));
fs.writeFileSync(path.join(SEED, 'config.json'), JSON.stringify(config, null, 2));

console.log(`[sync-live-data] catalog.json + config.json updated from ${BASE}`);
console.log(`[sync-live-data] files: ${downloaded} downloaded, ${kept} already present, ${failed} failed`);
if (failed > 0) process.exit(1);
