/**
 * MetroRider release identity — bump these together on every release.
 *
 * The version + codename show on the start screen and the settings page;
 * RELEASE_HIGHLIGHTS is announced once per version in a "What's new" box on
 * the start screen (dismissed state is tracked in localStorage).
 */

export const RELEASE_VERSION = '1.1.0';
export const RELEASE_CODENAME = 'The Circle Update';

export const RELEASE_HIGHLIGHTS: string[] = [
	'Loop lines! Circular lines now run round and round — no more dead ends.',
	'Rotate any train car 180° with the ↻ button in the train composer.',
	'The follow camera is now always on when you drive, with a camera-mode indicator.',
	'Much lighter on memory and smoother on phones.',
];

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
