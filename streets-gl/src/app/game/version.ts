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
		version: '2.13.0',
		codename: 'Your Colours',
		date: '2026-08-14',
		emblem: '🎨🚆',
		summary: 'Paint your train whatever colour you like — a car at a time, or all of it.',
		changes: [
			'PAINT YOUR TRAIN — In Trains & sounds there is a row of colours under your carriages. Pick a car, pick a colour. There is a button to paint the whole train at once, and an "Original" swatch to put a car back the way it was.',
			'Every car can be different, so you can run a red engine with yellow carriages if you want to.',
			'The paint keeps the shape of the train: windows stay dark, the grille and the panel lines still show, and the shading still works. It is paint, not a flat colour sprayed over everything.',
			'Your colours are saved with the rest of your train, so they are still there next time.',
		],
	},
	{
		version: '2.12.0',
		codename: 'Bus, Tram, Train',
		date: '2026-08-14',
		emblem: '🚌🚋🚆',
		summary: 'The game knows what kind of line you picked, and drives it like one.',
		changes: [
			'EVERY LINE SAYS WHAT IT IS — Pick a line and it tells you: bus, tram, light rail, metro, regional train, high-speed train, ferry, cable car. The map already knew; the game was throwing it away and treating every line as the same railway.',
			'AND IT DRIVES LIKE ONE — A bus route tops out at 50, a tram at 60, a metro at 90, a regional train at 160, a high-speed line at 300. The speedometer changes with it, so a bus has a bus\'s dial.',
			'Stops last the right time too: a bus stop is quick, a ferry berth is slow, and the timetable is worked out from that instead of from a train\'s figure for everything.',
			'This makes hundreds of maps playable the way the person who drew them meant. On one map alone the lines are now correctly a mix of regional trains, metros and a light railway, each with its own speeds.',
		],
	},
	{
		version: '2.11.0',
		codename: 'Red and Green',
		date: '2026-08-14',
		emblem: '🚦🚆',
		summary: 'Signals stand along the line beside you, and they mean what signals mean.',
		changes: [
			'BLOCK SIGNALS — Colour-light signals stand along the track the other trains run on. One shows red while a train is in the stretch of line beyond it, and turns green the moment that train is clear.',
			'Watch for it when a train is coming the other way: the signal ahead of it is red, and as the train goes by it changes to green.',
			'They are on the OTHER track on purpose. A signal only means something if something can be behind it — a red light on your own line that never stops you would teach the opposite of what a signal is.',
			'They come and go with the other trains: turn those off in Settings and the signals go too, because there would be nothing for them to protect.',
		],
	},
	{
		version: '2.10.0',
		codename: 'Keep the Picture',
		date: '2026-08-14',
		emblem: '📸🚉',
		summary: 'Photo mode can save the picture now.',
		changes: [
			'SAVE PICTURE — In Photo mode there is a button that saves what you are looking at as a picture, named after the station you are at. Line up your train, take the photo, keep it.',
			'Photo mode without it was just a view with the controls hidden — the point of pointing a camera at something is coming away with the picture.',
		],
	},
	{
		version: '2.9.0',
		codename: 'Notch by Notch',
		date: '2026-08-14',
		emblem: '🎚️🚆',
		summary: 'The power handle works like a real one: it winds up through its notches instead of jumping straight to full.',
		changes: [
			'THE LEVER MEANS SOMETHING NOW — Hold the throttle and the handle walks up through P1, P2, P3, P4 over about a second and a half, and the train pulls away the way a train does instead of leaping off the platform. Let go and it drops off quickly, the way it does in a cab.',
			'The brake handle works the same way, and the emergency brake goes over fast — that is the point of it.',
			'Until now the lever was drawn with all its notches but only ever showed "off" or "everything". It was an instrument that did not tell you anything.',
		],
	},
	{
		version: '2.8.0',
		codename: 'Anywhere',
		date: '2026-08-14',
		emblem: '🌍🚇',
		summary: 'Drive any of your own maps without leaving the game — London, New York, Paris, Singapore and a hundred more.',
		changes: [
			'DRIVE ANOTHER MAP — A new page in the menu lists every map on your MetroDreamin profile, biggest first, with how many lines and stations each one has. Tap one and you are driving it: the London Underground is 56 lines and 500 stations.',
			'The list is fetched fresh every time, so a map you finished this morning is there this afternoon without anything being updated in the game.',
			'Everything follows you to the new city — the passing trains take the new line\'s colour, and a new timetable is worked out for the stops on your new route.',
			'Pasting a map or profile link still works, now under "Load a map by link".',
		],
	},
	{
		version: '2.7.2',
		codename: 'Keepable',
		date: '2026-08-14',
		emblem: '⏱️✅',
		summary: 'The timetable is now written for the speeds your line actually allows, so Simple driving can keep it.',
		changes: [
			'The schedule used to assume 70 km/h everywhere. That is fine on fast track and impossible where the limit is 40 — and Simple driving holds the limit exactly, so driving properly would have left you further behind at every stop through no fault of your own.',
			'Each leg is now timed from the real speed limits along it. Driving three stops in a row on Simple — accelerate, brake in gently, open the doors, wait, go — stays comfortably inside the schedule instead of falling behind.',
		],
	},
	{
		version: '2.7.1',
		codename: 'Right Way Round',
		date: '2026-08-14',
		emblem: '🔁🕗',
		summary: 'The timetable now follows you when you turn the train around, and stops claiming you are early before you have arrived.',
		changes: [
			'TURN AROUND AND THE TIMETABLE TURNS WITH YOU — Driving back the other way gives you a new service for the stops actually ahead of you. Before this, reversing left you running the old schedule backwards, with every stop ahead due at a time that had already gone.',
			'The service starts from where your train IS, not from the end of the line, so the first stop is the next one you will reach.',
			'The board no longer says "6 MIN EARLY" while you are still driving towards a stop — you cannot be early until you get there. It shows the due time on the way, and how you did once you arrive. Running late still shows straight away, because that part is already true.',
		],
	},
	{
		version: '2.7.0',
		codename: 'The 08:06',
		date: '2026-08-14',
		emblem: '🕗🚉',
		summary: 'You are running a real service now: every stop is due at a time, and the board tells you whether you are early, on time or late.',
		changes: [
			'A TIMETABLE — Every station on your line has a time it is due. The board above the route strip shows the next one — "NEXT STOP · DUE 08:06 · ON TIME" — and updates as you drive.',
			'THE WHOLE SCHEDULE is in the menu under Timetable: what time each stop is due, what time you actually got there, and how you did. Stops you have made turn green, or pink if you were late.',
			'The times are worked out from the real distances between YOUR line\'s stations, not a flat few minutes each — one line in the game has a 1.3 km hop and a 15 km run on the same route, and a schedule that ignored that would be nonsense at both ends.',
			'The service runs on the same clock as the time of day, so an evening drive is an evening service.',
		],
	},
	{
		version: '2.6.0',
		codename: 'Know Your Line',
		date: '2026-08-14',
		emblem: '📏🚉',
		summary: 'Find out about the railway you are driving: how long it is, its longest run between stops, and how many people are waiting on it right now.',
		changes: [
			'ABOUT THIS LINE — A new page in the menu: the length end to end, how many stations, the average distance between stops, the longest run and which two stations it is between, the shortest hop, and a live count of everyone waiting on the platforms.',
			'Every number is worked out from the line you actually loaded, so it is just as true for a map you imported yourself as for the one that comes with the game.',
		],
	},
	{
		version: '2.5.0',
		codename: 'Traffic',
		date: '2026-08-14',
		emblem: '🚂🚃',
		summary: 'You are not the only train on the railway any more — other services come the other way and go past your window.',
		changes: [
			'OTHER TRAINS — Services run towards you on the line and pass on the track alongside, in the colour of the line you are driving. Watch for them out of the cab window, or switch to Trackside and let one go past you.',
			'They run on the track BESIDE you rather than down the middle of your own rails, so a train coming the other way passes you properly instead of going through you.',
			'It costs nothing: the game runs exactly as fast with other trains on the line as without them.',
			'Turn them off in Settings if you would rather have the railway to yourself.',
		],
	},
	{
		version: '2.4.0',
		codename: 'Golden Hour',
		date: '2026-08-14',
		emblem: '🌅🌃',
		summary: 'Drive in the morning, at midday, in the golden light of evening, or at night with the city lit up.',
		changes: [
			'TIME OF DAY — Choose Morning, Midday, Evening or Night in Settings, or leave it on Now and drive at whatever time it really is. The sun is worked out from the actual position of the city you are driving in, so a low evening sun falls where it should and shadows stretch the right way.',
			'AT NIGHT the sun is properly below the horizon and the windows of the city come on.',
			'The light does not jump when you change it — it slides round to the new time over a few seconds.',
		],
	},
	{
		version: '2.3.0',
		codename: 'Mind the Doors',
		date: '2026-08-14',
		emblem: '📢🚉',
		summary: 'Your stations are announced out loud, the way they are on a real train.',
		changes: [
			'STATIONS ARE ANNOUNCED — As you come up to a stop, a voice names it: "Now approaching Raanana." Pull away and it tells you what is next: "The next station is Hod hasharon." The last stop on the line says so, and the doors are called as they open and close.',
			'The announcer says the station name and nothing else — no platform codes, no letters spelled out one at a time. All 84 stations on the map were checked.',
			'SETTINGS, IN THE GAME — Driving, announcements, sound, graphics and the frame rate limit now have a Settings screen you can actually reach, from the menu button. Until now the settings screen only existed on the old interface, so once you started driving there was no way in.',
			'The menu button opens a menu — pick a line, turn the train around, change city, choose your trains and sounds, change the camera, or open settings — rather than going straight to the line list.',
			'TIDIED UP — The old row of emoji buttons left over from the previous interface is gone from the screen. Everything they did has a proper home in the menu, including turning the train around at the end of the line, which had no other way to do it.',
		],
	},
	{
		version: '2.2.0',
		codename: 'Six Ways to Watch',
		date: '2026-08-14',
		emblem: '📷🚆',
		summary: 'Three new ways to watch your train: from a window seat, from the side of the line, and with the controls out of the way.',
		changes: [
			'RIDE — Take a seat by the window two cars back. The train\'s side runs away down the frame and the city sweeps past it, the way it looks when you lean on the glass.',
			'TRACKSIDE — Stand beside the line and let your own train come past you, the way you would watch a real one. The camera stays put while the train arrives and recedes, then goes and stands further up the line when it has gone.',
			'PHOTO — Free look with the whole interface out of the way, for a clean picture. One button brings the controls back.',
			'Views are chosen by name now instead of pressing a button until you land on the one you wanted, and the route strip no longer runs underneath the station name on a wide screen.',
		],
	},
	{
		version: '2.1.0',
		codename: 'Cab',
		date: '2026-08-14',
		emblem: '🎛️🚊',
		summary: 'The controls became a driver\'s desk, the list of lines stopped covering the city, and you can pick how much the train does for you.',
		changes: [
			'A DRIVER\'S DESK — Speed is a real dial with a needle and a marked limit, so how close you are reads as a shape instead of two numbers to compare against each other. The arc runs blue up to the limit and red only for the excess. Power is a notched lever with the brake as its own gauge beside it, and DOORS and LIMIT are lamps that light up rather than labels that change colour.',
			'THE CITY IS BACK — The list of 24 lines used to stand permanently over the screen, covering about a third of it while you drove, to offer a choice you make once. It is now summoned from the menu and dismissed, and when any panel opens the controls step aside instead of being buried.',
			'A MAP IN THE CORNER — A small live map of your line sits in the corner with your train moving along it and the next stop named.',
			'SIMPLE OR ADVANCED — Simple driving accelerates gently and eases the train back whenever it runs past the line limit, so holding the throttle down cannot end at 200 km/h in a curve, and nothing is scored against you. Advanced leaves the limit as information only and scores the run. Switch it any time from the camera button.',
			'BUILT FOR THE iPAD FIRST — The layout is designed per shape of screen rather than one layout scaled down: controls sit in the bottom corners in landscape, in a band across the bottom in portrait, and the phone gets a shorter route strip. Buttons are bigger throughout, and bigger again in Simple driving.',
		],
	},
	{
		version: '2.0.0',
		codename: 'The Line',
		date: '2026-08-13',
		emblem: '🚇✨',
		summary: 'Everything since 1.1, gathered up: a line you drive, a crowd you carry, and a world that holds still while you look at it.',
		changes: [
			'PEOPLE — Passengers are individuals now. They wait on the platform, walk to the doors when you open them, and step aboard; arrivals walk out into the station. A crowd built from one character used to be that character repeated, so everybody now gets their own clothes, hair and skin. They stand on the floor rather than hovering above it.',
			'THE TRAIN — Your train wears its real livery: model textures were being averaged down to a single colour per corner, smearing stripes, windows and logos into a wash. Trains, track and stations are drawn sharp while moving, not just while parked.',
			'THE LINE — Speed limits are worked out from the track itself, account for banked curves, and are yours to obey or not: the limit informs, it never brakes for you. Lineside boards stand where each limit starts, in the style of the country you are driving in, with a yellow warning triangle before a reduction and the number repeated through long stretches.',
			'THE JOB — Every stop is scored: punctuality, smooth driving, and how many people you actually carried. Sign in with an email and password, and your best runs follow you.',
			'THE WORLD — Buildings stop vanishing and reappearing as you drive or turn the camera, and the map holds still: stations no longer wobble, and the world does not rebuild itself behind you.',
			'PERFORMANCE — The game no longer gets heavier the longer you play; every vertex buffer it created was previously kept forever. It also stopped drawing every station on the line, and every crowd, on every single frame. Auto quality now measures how hard your graphics card is actually working instead of guessing from frame rate, so it can tell a machine that is coasting from one barely keeping up — and it can finally lower quality when you have set a frame-rate limit.',
			'FINDING YOUR WAY — The original MetroDreamin map is inside the game, with your own line drawn on it.',
		],
	},
	{
		version: '1.2.0',
		codename: 'Platform Life',
		date: '2026-08-13',
		emblem: '🚶‍♂️🚉',
		summary: 'People walk on and off the train, the crowd stops being clones, and the game stops leaking memory as you play.',
		changes: [
			'Passengers walk. Boarding used to be a number going down; now people cross the platform to the doors and step aboard, and arrivals walk out into the station.',
			'The crowd is a crowd. Everyone on a platform had the same hair and one of two skin tones — a quirk of how the figures were picked meant the palette collapsed. There are now 24 distinct people, with five hair colours, five skin tones and eight coats between them.',
			'People stand on the floor. Their height used to be measured once at the middle of the platform and given to everybody, so figures hovered; each person is now placed on the surface actually under their feet.',
			'The train wears its real livery. Model textures were being averaged down to one colour per corner, which smeared stripes, windows and logos into a wash — they are now drawn properly.',
			'Lineside signs are readable and varied: bigger boards, a yellow warning triangle before a speed reduction (the triangle had never actually been drawn), and the number repeated through long stretches instead of only where the limit changes.',
			'The game stops getting heavier the longer you play. Every vertex buffer it ever created was being kept forever; that is fixed, along with drawing every station on the line each frame whether or not it was on screen.',
			'Auto quality now measures how hard the graphics card is working instead of guessing from frame rate, so it can tell a machine coasting from one barely keeping up — and it can finally lower quality when you have set a frame rate limit.',
		],
	},
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
