import AdmZip from 'adm-zip';

/**
 * Extracts a .glb file from a ZIP archive (Sketchfab download format).
 * Sketchfab glTF downloads are ZIP archives containing a .gltf + .bin + textures.
 * If a .glb is found directly, it is returned as-is.
 * If only .gltf + .bin is found, returns null (manual conversion needed).
 */
export async function extractGLBFromArchive(archiveBuffer: Buffer): Promise<Buffer | null> {
	try {
		const zip = new AdmZip(archiveBuffer);
		const entries = zip.getEntries();

		const glbEntry = entries.find(e =>
			!e.isDirectory && e.entryName.toLowerCase().endsWith('.glb')
		);
		if (glbEntry) {
			console.log(`[ArchiveExtract] Found GLB in archive: ${glbEntry.entryName}`);
			return glbEntry.getData();
		}

		const gltfEntry = entries.find(e =>
			!e.isDirectory && e.entryName.toLowerCase().endsWith('.gltf')
		);
		if (gltfEntry) {
			console.log(`[ArchiveExtract] Found glTF (not GLB) in archive: ${gltfEntry.entryName}`);
			console.log(`[ArchiveExtract] Archive contents: ${entries.map(e => e.entryName).join(', ')}`);
			return convertGltfToGlb(zip, gltfEntry);
		}

		console.warn(`[ArchiveExtract] No .glb or .gltf found. Archive entries: ${entries.map(e => e.entryName).join(', ')}`);
		return null;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[ArchiveExtract] Failed to process archive: ${msg}`);
		return null;
	}
}

function convertGltfToGlb(zip: AdmZip, gltfEntry: AdmZip.IZipEntry): Buffer | null {
	try {
		const gltfJson = JSON.parse(gltfEntry.getData().toString('utf-8'));
		const gltfDir = gltfEntry.entryName.includes('/')
			? gltfEntry.entryName.substring(0, gltfEntry.entryName.lastIndexOf('/') + 1)
			: '';

		const bufferChunks: Buffer[] = [];
		let currentOffset = 0;

		for (let i = 0; i < (gltfJson.buffers || []).length; i++) {
			const buf = gltfJson.buffers[i];
			if (!buf.uri) continue;

			if (buf.uri.startsWith('data:')) {
				const base64Start = buf.uri.indexOf(',') + 1;
				const binData = Buffer.from(buf.uri.substring(base64Start), 'base64');
				bufferChunks.push(binData);
				buf.byteLength = binData.length;
			} else {
				const binPath = gltfDir + buf.uri;
				const binEntry = zip.getEntry(binPath);
				if (!binEntry) {
					console.warn(`[ArchiveExtract] Binary buffer not found in archive: ${binPath}`);
					return null;
				}
				const binData = binEntry.getData();
				bufferChunks.push(binData);
				buf.byteLength = binData.length;
			}
			delete buf.uri;
		}

		for (let i = 0; i < (gltfJson.images || []).length; i++) {
			const img = gltfJson.images[i];
			if (!img.uri || img.uri.startsWith('data:')) continue;

			const imgPath = gltfDir + img.uri;
			const imgEntry = zip.getEntry(imgPath);
			if (!imgEntry) {
				console.warn(`[ArchiveExtract] Image not found in archive: ${imgPath}`);
				continue;
			}

			const imgData = imgEntry.getData();
			const ext = img.uri.toLowerCase();
			let mimeType = 'application/octet-stream';
			if (ext.endsWith('.png')) mimeType = 'image/png';
			else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) mimeType = 'image/jpeg';
			else if (ext.endsWith('.webp')) mimeType = 'image/webp';

			const bufferViewIdx = gltfJson.bufferViews ? gltfJson.bufferViews.length : 0;
			if (!gltfJson.bufferViews) gltfJson.bufferViews = [];

			const totalBinSoFar = bufferChunks.reduce((sum, b) => sum + b.length, 0);
			let padded = imgData;
			while (padded.length % 4 !== 0) {
				padded = Buffer.concat([padded, Buffer.from([0])]);
			}

			gltfJson.bufferViews.push({
				buffer: 0,
				byteOffset: totalBinSoFar,
				byteLength: imgData.length,
			});
			bufferChunks.push(padded);

			delete img.uri;
			img.bufferView = bufferViewIdx;
			img.mimeType = mimeType;
		}

		const mergedBin = Buffer.concat(bufferChunks);

		if (gltfJson.buffers && gltfJson.buffers.length > 0) {
			gltfJson.buffers = [{byteLength: mergedBin.length}];
		} else {
			gltfJson.buffers = [{byteLength: mergedBin.length}];
		}

		for (const bv of (gltfJson.bufferViews || [])) {
			if (bv.buffer !== undefined && bv.buffer > 0) {
				bv.buffer = 0;
			}
		}

		let jsonStr = JSON.stringify(gltfJson);
		while (Buffer.byteLength(jsonStr, 'utf-8') % 4 !== 0) {
			jsonStr += ' ';
		}
		const jsonBuf = Buffer.from(jsonStr, 'utf-8');

		let binPadded = mergedBin;
		while (binPadded.length % 4 !== 0) {
			binPadded = Buffer.concat([binPadded, Buffer.from([0])]);
		}

		const headerSize = 12;
		const jsonChunkSize = 8 + jsonBuf.length;
		const binChunkSize = 8 + binPadded.length;
		const totalSize = headerSize + jsonChunkSize + binChunkSize;

		const glb = Buffer.alloc(totalSize);
		let w = 0;
		glb.writeUInt32LE(0x46546C67, w); w += 4;
		glb.writeUInt32LE(2, w); w += 4;
		glb.writeUInt32LE(totalSize, w); w += 4;

		glb.writeUInt32LE(jsonBuf.length, w); w += 4;
		glb.writeUInt32LE(0x4E4F534A, w); w += 4;
		jsonBuf.copy(glb, w); w += jsonBuf.length;

		glb.writeUInt32LE(binPadded.length, w); w += 4;
		glb.writeUInt32LE(0x004E4942, w); w += 4;
		binPadded.copy(glb, w);

		console.log(`[ArchiveExtract] Converted glTF to GLB: ${totalSize} bytes`);
		return glb;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[ArchiveExtract] glTF-to-GLB conversion failed: ${msg}`);
		return null;
	}
}
