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
		version: '1.1.14',
		codename: 'Lineside',
		date: '2026-08-13',
		emblem: '🪧🛤️',
		summary: 'Real speed boards, standing beside the track, in the right country’s style.',
		changes: [
			'Speed limits now have physical boards along the line — at the point each limit starts, on the driver’s side, facing you as you approach.',
			'The signs match the railway you are driving on: a German main line shows a square board in tens of km/h, France a round TIV, Britain a plate in mph, Israel and most others the full number in km/h.',
			'Trams are signed like the street they run in (a road disc with a red ring); metros get a plain staff board. A railway is not a road, and the game no longer pretends it is.',
			'The HUD sign changes shape and units to match, and says what kind of sign it is if you hover it.',
		],
	},
	{
		version: '1.1.13',
		codename: 'The Driver Decides',
		date: '2026-08-13',
		emblem: '🚸🚄',
		summary: 'The limit is a sign, not a leash — and the numbers are realistic now.',
		changes: [
			'The train is never braked for you any more. The limit is information: you choose whether to follow it, and ignoring it costs points on the run card.',
			'Speed limits are realistic. They now account for canted (banked) track and are measured over a proper length of line instead of between neighbouring points — the typical limit on the Israel map went from 45 to 90 km/h, with fast running where the track is straight.',
			'The limit is shown as a proper lineside sign — a white disc with a red ring — that turns amber as you approach it and red when you are over.',
			'Taking a curve far too fast now costs more than drifting slightly over on a straight.',
		],
	},
	{
		version: '1.1.12',
		codename: 'The Line Speed',
		date: '2026-08-13',
		emblem: '🚦🚄',
		summary: 'The line has speed limits now — and the curves decide them.',
		changes: [
			'Every line has real speed limits, worked out from the track itself: tight city curves are slow, long suburban straights are fast.',
			'The HUD shows the limit you are under and counts down to the next change, so you know when to start braking.',
			'Go too far over and the train intervenes: traction is cut and it brakes back to the limit, the way a real overspeed system does.',
			'Time spent over the limit costs points on the run card — capped, so a messy run is still a run.',
		],
	},
	{
		version: '1.1.11',
		codename: 'The Season Ticket',
		date: '2026-08-13',
		emblem: '📧🎟️',
		summary: 'Sign in with an email and password — and crowds that pay their way.',
		changes: [
			'Sign in the normal way: email and password. Your profile, best runs and train setup follow you to any device.',
			'Kids keep the simple path: a name and a 4-digit PIN, no email needed. Both work side by side.',
			'Distant platforms now draw simple figures instead of the detailed character — the crowds you can actually see stay detailed, the ones 200 m away stop costing you frames.',
			'Auto quality can now thin the crowds as well as adjusting the picture, and it never makes a platform busier than you asked for.',
		],
	},
	{
		version: '1.1.10',
		codename: 'The Commuters',
		date: '2026-08-13',
		emblem: '🚶‍♂️🚉',
		summary: 'Real people are waiting for your train.',
		changes: [
			'The passengers on the platform are now proper 3D characters from a model library — a person in a shirt and trousers, not a stack of boxes.',
			'They are animated: the character is rigged, and the game plays its waiting animation, with each person out of step with their neighbours so a platform looks alive.',
			'Any rigged human model you import into the People category gets the same treatment automatically — its animation is used, and it is scaled to human height.',
			'The built-in simple figure stays as a fallback, so crowds still work with no downloaded models at all.',
		],
	},
	{
		version: '1.1.9',
		codename: 'The Steady Platform',
		date: '2026-08-13',
		emblem: '🏗️🧍',
		summary: 'Stations stop wobbling, and the people on them look like people.',
		changes: [
			'Fixed stations drifting and shaking as you drive past — their shape was stored in world coordinates too large for the graphics precision, so every station shimmered against the moving world. They are rock solid now.',
			'Passengers redrawn with human proportions — head, hair, shoulders, arms and legs instead of a stack of boxes.',
			'The people on the platform now move: they shift their weight and turn to look for the train.',
			'The waiting count is on screen where you need it: the station banner reads "Hod Hasharon · 28 waiting" as you approach.',
		],
	},
	{
		version: '1.1.8',
		codename: 'The Stopwatch Update',
		date: '2026-08-13',
		emblem: '🎯🚉',
		summary: 'Driving well is now the point: every stop is scored.',
		changes: [
			'Every station stop is rated: how close you stopped to the mark, how smoothly you braked, and whether the doors were handled properly. A card pops up with the verdict and the points.',
			'A run summary at the end of the line: total points, every stop listed, and "Personal best!" when you beat your own record.',
			'Best runs on each line are listed on the run card, so the family can see who is the better driver.',
			'Badges for records worth remembering — perfect stops, a full line driven, nobody left behind, the night service. Nothing is ever locked behind them.',
			'Missing a station is never punished with a failure screen: it simply scores nothing and the run carries on.',
		],
	},
	{
		version: '1.1.7',
		codename: 'The Roster Update',
		date: '2026-08-12',
		emblem: '🧑‍✈️🎫',
		summary: 'Say who is driving — and your best runs follow you.',
		changes: [
			'Driver profiles: pick a name and a 4-digit PIN on the start screen. No email, no passwords to remember, nothing else asked.',
			'Your best runs, badges and train setup are saved to your profile on the server, so they survive a new device or a browser that clears its storage.',
			'Everyone on the server appears as a one-tap button, so kids do not have to spell their own name to get their scores back.',
			'Playing as a guest still works exactly as before — a profile only decides whether your results are kept.',
			'Anything you earn while signed out or offline is saved locally and uploaded the next time you sign in.',
		],
	},
	{
		version: '1.1.6',
		codename: 'The Rush Hour Update',
		date: '2026-08-12',
		emblem: '🧍‍♂️🚉',
		summary: 'Your platforms have people on them — and they get on your train.',
		changes: [
			'Passengers are real. Every station gathers people while you are away, and the number is now driven by the actual neighbourhood the station sits in: the busy centre of a city fills its platform far faster than a rural halt.',
			'You can SEE them: figures stand on the platform waiting for you. Open the doors and the platform empties as they board — the count in the HUD and the crowd on the platform are the same people.',
			'PAX in the HUD finally works: it shows who is on board, and while the doors are open it also shows how many are still waiting.',
			'New Passengers settings: how crowded platforms get (Off / Few / Normal / Busy), how busy the line is (Calm / Normal / Rush hour), and which figure models the crowd is made of.',
			'Passenger figures are part of the model library like trains and stations — upload your own, or import them from Sketchfab into the new "People" category. Any human model works; it is scaled to human height automatically.',
		],
	},
	{
		version: '1.1.5',
		codename: 'The Crystal Update',
		date: '2026-08-12',
		emblem: '🔎🚄',
		summary: 'The moving train is finally as sharp as the standing one.',
		changes: [
			'Fixed the camera micro-shake: the follow camera used a frame-time-sensitive smoothing filter that made it oscillate a few centimeters against the train every frame. It now tracks the train position exactly (smoothing stays on rotation and height), so the train holds perfectly steady on screen.',
			'Fixed the train\'s motion data fed to the anti-aliasing: the world re-centers itself around the camera every frame, and the train\'s "where was I last frame" bookkeeping missed that shift — so the anti-aliasing blended every train pixel with history fetched from the wrong place. The train was the only thing on screen suffering from this, which is why only it looked fuzzy in motion.',
			'Upgraded the anti-aliasing itself to variance clipping (the technique modern engines use), which keeps thin details like railings and grills from sizzling.',
			'Measured result: frame-to-frame pixel churn on the moving train body dropped to a third of what it was — now lower than with anti-aliasing off, and the standing image stays rock solid.',
		],
	},
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
