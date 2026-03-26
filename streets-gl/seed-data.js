const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const SEED_DIR = path.join(SCRIPT_DIR, 'data-seed');
const DATA_DIR = process.env.DATA_DIR || path.join(SCRIPT_DIR, 'data');

let seeded = 0;
let skipped = 0;

function seedRecursive(srcDir, destDir) {
	if (!fs.existsSync(srcDir)) {
		console.error(`[seed-data] Source directory not found: ${srcDir}`);
		process.exit(1);
	}

	fs.mkdirSync(destDir, {recursive: true});

	for (const entry of fs.readdirSync(srcDir, {withFileTypes: true})) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);

		if (entry.isDirectory()) {
			seedRecursive(srcPath, destPath);
		} else if (entry.isFile()) {
			if (fs.existsSync(destPath)) {
				skipped++;
			} else {
				fs.copyFileSync(srcPath, destPath);
				seeded++;
				console.log(`[seed-data] Seeded: ${path.relative(DATA_DIR, destPath)}`);
			}
		}
	}
}

console.log(`[seed-data] Seeding from ${SEED_DIR} -> ${DATA_DIR}`);
seedRecursive(SEED_DIR, DATA_DIR);
console.log(`[seed-data] Done. Seeded ${seeded} files, skipped ${skipped} (already exist).`);
