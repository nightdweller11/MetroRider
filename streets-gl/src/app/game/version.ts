/**
 * MetroRider release identity + changelog.
 *
 * To ship a new release: add an entry to the TOP of CHANGELOG (version,
 * codename, date, changes) and bump package.json to match. The newest entry
 * drives the version badge, the settings header, and the release splash —
 * which is announced once per version (localStorage-tracked) and lists the
 * full changelog below the current highlights.
 */

export interface ReleaseEntry {
	version: string;
	codename: string;
	date: string;
	summary: string;
	changes: string[];
	/** Emoji shown at the top of the release splash. */
	emblem?: string;
}

export const CHANGELOG: ReleaseEntry[] = [
	{
		version: '1.1.4',
		codename: 'The Gearbox Update',
		date: '2026-08-12',
		emblem: '⚙️🚄',
		summary: 'Auto quality, rebuilt: one tier control, and tuning that actually finds your machine’s best.',
		changes: [
			'One Graphics tier control: Low / Medium / High / Auto / Custom. Picking a tier applies its settings immediately — High-end means max settings and uncapped FPS.',
			'Auto mode rebuilt: it never lowers quality while the frame-rate target is met, and if a reduction doesn’t actually improve performance it puts the quality back. No more creeping downgrades on fast machines.',
			'Auto touches nothing unless it’s the selected tier; changing any graphics setting yourself switches the tier to Custom and leaves you in full control.',
			'Frame-rate limiter rebuilt (again, properly): "60" no longer runs at ~48 on 120 Hz displays, and "30" is a true 30.',
		],
	},
	{
		version: '1.1.3',
		codename: 'The Express Update',
		date: '2026-08-12',
		emblem: '⚡🚄',
		summary: 'Faster everywhere: the game now tunes its own graphics to your machine.',
		changes: [
			'Auto quality tuning: the game measures its own frame rate and adjusts graphics live — striving for 60 FPS, falling back to a steady 30 on slow machines, and going all the way to max settings + uncapped FPS on fast ones.',
			'Change any graphics setting yourself and auto-tuning steps aside (switch it back on any time).',
			'New Device tier setting (Low-end / Standard / High-end) as the tuning starting point.',
			'Frame-rate limits are accurate now — "30 FPS" used to run at ~20 and "60" under 60.',
			'Big under-the-hood speedup: about 30% more FPS on slower machines and 60% fewer memory-cleanup stutters while driving.',
		],
	},
	{
		version: '1.1.2',
		codename: 'The Navigator Update',
		date: '2026-08-12',
		emblem: '🗺️🚇',
		summary: 'Find your way around: the original MetroDreamin map, right inside the game.',
		changes: [
			'New map button (🗺) shows the original MetroDreamin map — every line in its color, all stations, and your train moving on it live.',
			'A link from the map view opens the real MetroDreamin page.',
			'The menu button is now a house (🏠) — tap it to change map or line.',
		],
	},
	{
		version: '1.1.1',
		codename: 'The Conductor’s Log',
		date: '2026-08-12',
		emblem: '📜🚆',
		summary: 'Know your train, know your history.',
		changes: [
			'The train customization button is now a train (🚆) instead of a gear.',
			'Full changelog inside the release splash — every version, codename and its changes.',
		],
	},
	{
		version: '1.1.0',
		codename: 'The Circle Update',
		date: '2026-08-11',
		summary:
			'This update is all about going in circles — in a good way. ' +
			'Circular metro lines finally work like real loop services, and your ' +
			'train got a whole lot more customizable.',
		changes: [
			'Loop lines! Circular lines now run round and round — no more dead ends.',
			'Rotate any train car 180° with the ↻ button in the train composer.',
			'The follow camera is now always on when you drive, with a camera-mode indicator.',
			'Trains start with a proper locomotive-led consist by default.',
			'Much lighter on memory — long rides no longer eat all your RAM.',
			'Phones load reliably now (and show a clear message if graphics fail).',
			'Sound picks apply to a running game without a reload.',
			'Version badge + this release splash, so you always know what changed.',
		],
	},
	{
		version: '1.0.5',
		codename: 'The Workshop Update',
		date: '2026-04-01',
		summary: 'Build your own train and make it sound right.',
		changes: [
			'Train composer: build a consist from independent car slots.',
			'Import 3D train, track and station models from Sketchfab.',
			'Import horns, chimes and ambience from Freesound.',
			'Animated train doors (GLTF door animations).',
			'Big rendering performance pass: batched drawing, faster loading.',
			'Mobile HUD layout and low-memory mode for phones and tablets.',
		],
	},
	{
		version: '1.0.0',
		codename: 'First Departure',
		date: '2026-03-23',
		summary: 'The first release of MetroRider.',
		changes: [
			'Drive trains on any MetroDreamin map, on a real 3D OpenStreetMap world.',
			'Browse a MetroDreamin user profile and pick any of their maps.',
			'Throttle, brakes, doors, horn — with station stops and arrival chimes.',
			'Chase, cab and orbit cameras.',
			'Built-in Tel Aviv sample map.',
		],
	},
];

const CURRENT = CHANGELOG[0];

export const RELEASE_VERSION = CURRENT.version;
export const RELEASE_CODENAME = CURRENT.codename;
export const RELEASE_SUMMARY = CURRENT.summary;
export const RELEASE_HIGHLIGHTS: string[] = CURRENT.changes;
export const RELEASE_EMBLEM = CURRENT.emblem ?? '🚇';

export const LAST_SEEN_VERSION_KEY = 'metrorider-last-seen-version';

export function releaseLabel(): string {
	return `v${RELEASE_VERSION} · “${RELEASE_CODENAME}”`;
}

export function isReleaseAnnouncementUnseen(): boolean {
	try {
		return localStorage.getItem(LAST_SEEN_VERSION_KEY) !== RELEASE_VERSION;
	} catch {
		return false;
	}
}

export function markReleaseAnnouncementSeen(): void {
	try {
		localStorage.setItem(LAST_SEEN_VERSION_KEY, RELEASE_VERSION);
	} catch {
		// storage unavailable — the announcement will simply show again
	}
}
