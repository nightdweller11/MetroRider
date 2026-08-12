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
}

export const CHANGELOG: ReleaseEntry[] = [
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
