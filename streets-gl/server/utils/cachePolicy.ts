/**
 * How long a browser may keep a file from the built frontend.
 *
 * Everything used to be `max-age=3600`, the page included. So for an hour
 * after a deploy, anyone who had opened the game kept getting the OLD page,
 * which names the OLD script — the fix was live and the player could not see
 * it (2.48.0 was reported as "not fixed" exactly this way).
 *
 * - Pages and the unhashed stylesheet: always ask the server first. With an
 *   ETag that is a 304 of a few hundred bytes, so it costs nothing to be right.
 * - Scripts named by their content hash (`js/index.<hash>.js`): a new build is
 *   a new name, so the old file can be kept forever.
 * - Everything else (models, textures, sounds): an hour, as before.
 */
export function cacheControlFor(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');

	if (/\.(html|css)$/i.test(normalized)) {
		return 'no-cache';
	}

	if (/\/js\/[^/]+\.[0-9a-f]{16,}\.js$/i.test(normalized)) {
		return 'public, max-age=31536000, immutable';
	}

	return 'public, max-age=3600';
}
