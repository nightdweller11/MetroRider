/**
 * The driving HUD, as cab instruments.
 *
 * Replaces the stacked FPS/SPEED/TIME/PAX/NEXT text block. That block, and
 * the permanent line list beside it, covered roughly a third of an iPad
 * portrait screen between them — measured on 2.0.0 — to show numbers you
 * compare in your head and a route list you choose from once.
 *
 * What is here instead:
 *   - a real dial, where the arc runs accent up to the line limit and RED
 *     for the excess, so your margin is a shape rather than two numbers;
 *   - a console the controls sit in, rather than buttons floating over the
 *     scene;
 *   - cab tell-tales that light;
 *   - a minimap of the ground around the train, north up.
 *
 * Layout comes from a stylesheet with real breakpoints — landscape puts the
 * console in the bottom corner where a thumb rests, portrait gives it a band
 * across the bottom — not from inline coordinates per element.
 *
 * Design + mocks: `docs/features/ui-2.1/`.
 */

import {describeSpan, type MiniMapView} from './MiniMap';

export interface CabHudState {
	speedKmh: number;
	limitKmh: number;
	/** Highest number the dial scale shows. */
	dialMax: number;
	stationName: string;
	stationMeta: string;
	waiting: number | null;
	/** 0..1 along the current line. */
	progress: number;
	stopCount: number;
	stopIndex: number;
	/**
	 * What is around the train, already projected into the minimap's viewBox.
	 *
	 * Absent means the caller has nothing to show yet and the map draws its
	 * "no map" state — NOT a decorative placeholder. The panel used to render a
	 * fixed diagonal with five dots whenever real geometry was missing, which is
	 * exactly what it did on every line in every city, because the geometry was
	 * never passed in at all.
	 */
	miniView?: MiniMapView;
	/** Which way the train is pointing, degrees clockwise from north. */
	heading?: number;
	doorsOpen: boolean;
	/** Simple driving: bigger targets and a calmer console. */
	simpleMode: boolean;
	overLimit: boolean;
	/** Power 0..1 and brake 0..1, for the lever and the gauge. */
	power: number;
	brake: number;
	lineName: string;
}

const STYLE_ID = 'cab-hud-style';

/** Notch labels top-to-bottom, power above neutral, brake below. */
/**
 * The controller scale, top to bottom: full power down through neutral to full
 * brake. One handle for both, the way a train's master controller works — and
 * the way this panel has always been LABELLED, long before it was wired.
 */
const NOTCHES = ['P4', 'P3', 'P2', 'P1', 'N', 'B1', 'B2'];
/** Where neutral sits in that list. */
const NEUTRAL_INDEX = 4;

/** Where a notch sits down the lever, as a percentage of its height. */
function notchPercent(i: number): number {
	return 17 + i * 11.5;
}

/**
 * What a notch asks the train for.
 *
 * Power is quartered so P1 is a gentle start rather than everything at once —
 * the whole reason a real controller has steps. The brake has two: enough to
 * hold a stop, and everything.
 */
export function notchDemand(i: number): {power: number; brake: number} {
	if (i < NEUTRAL_INDEX) return {power: (NEUTRAL_INDEX - i) / NEUTRAL_INDEX, brake: 0};
	if (i > NEUTRAL_INDEX) return {power: 0, brake: i === NEUTRAL_INDEX + 1 ? 0.55 : 1};

	return {power: 0, brake: 0};
}

const CSS = `
.cab{position:fixed;inset:0;pointer-events:none;z-index:40;
  --ink:#e8f0f8;--ink-2:#94a7ba;--ink-3:#5d6f81;--accent:#57b6ff;--red:#ff5346;--amber:#ffb43a;
  --tech:"DIN Alternate","Bahnschrift","Roboto Condensed",system-ui,sans-serif;
  --milled:inset 0 1px 0 rgba(255,255,255,.16),inset 0 -1px 0 rgba(0,0,0,.65);
  --ring:0 0 0 1px rgba(120,150,180,.16);
  --lift:0 10px 26px rgba(0,0,0,.55),0 2px 5px rgba(0,0,0,.5);
  font-family:ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif;color:var(--ink)}
.cab > *{pointer-events:auto}
.cab .micro{font-family:var(--tech);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-3);font-weight:700}
.cab .panel{position:absolute;background:linear-gradient(180deg,#39434f,#232b35 42%,#161d25);
  box-shadow:var(--milled),var(--ring),var(--lift);border-radius:15px;overflow:hidden}

/* destination board */
.cab-dest{display:flex;align-items:stretch}
.cab-dest .strip{width:5px;background:linear-gradient(180deg,#ff6f9c,#c53c68)}
.cab-dest .in{padding:9px 14px;display:flex;align-items:center;gap:12px}
.cab-dest .nm{font-weight:800;font-size:15px}
.cab-dest .mt{font-family:var(--tech);font-size:10px;letter-spacing:.16em;color:var(--ink-3);margin-top:2px}
.cab-dest .pax{padding:6px 10px;border-radius:8px;font-family:var(--tech);font-size:12px;font-weight:700;color:#cfe8ff;
  background:linear-gradient(180deg,rgba(87,182,255,.2),rgba(87,182,255,.07));box-shadow:inset 0 0 0 1px rgba(110,185,255,.28)}

/* route ribbon */
.cab-rib{display:flex;align-items:center;padding:9px 14px;border-radius:999px}
.cab-rib .sg{flex:1;height:3px;background:rgba(255,255,255,.13)}
.cab-rib .sg.on{background:linear-gradient(90deg,#1a6bbd,var(--accent));box-shadow:0 0 9px rgba(87,182,255,.5)}
.cab-rib .st{width:8px;height:8px;border-radius:50%;background:#b9c9d9;margin:0 -3px;box-shadow:0 0 0 2px #0c1219}
.cab-rib .st.now{width:14px;height:14px;background:radial-gradient(circle at 50% 35%,#ffd489,var(--amber));
  box-shadow:0 0 0 3px #0c1219,0 0 14px rgba(255,180,58,.9)}

/* minimap */
.cab-mini{display:flex;flex-direction:column}
.cab-mini .cap{display:flex;align-items:center;padding:7px 10px 5px}
.cab-mini .plot{position:relative;flex:1;background:linear-gradient(180deg,#080d13,#050a0f);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 0 18px rgba(0,0,0,.8)}
.cab-mini .plot svg{position:absolute;inset:0;width:100%;height:100%}
/* A wedge, not a dot: the map is north-up and does not turn, so the marker is
   the only thing that can say which way the train is facing. */
.cab-mini .you{position:absolute;width:0;height:0;transform:translate(-50%,-50%);
  border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:13px solid var(--amber);
  filter:drop-shadow(0 0 6px rgba(255,180,58,.95))}
.cab-mini .foot{padding:6px 10px 8px;font-family:var(--tech);font-size:10px;letter-spacing:.08em;color:var(--ink-2)}

/* console */
.cab-con{position:absolute;background:linear-gradient(180deg,#2c353f,#1d242d 30%,#12181f);border-radius:20px;overflow:hidden;
  box-shadow:var(--milled),var(--ring),0 22px 50px rgba(0,0,0,.6)}
.cab-con .grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:overlay;
  background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.055) 0 1px,transparent 1px 3px)}
.cab-con .inner{position:relative;display:flex;align-items:center;gap:14px;padding:12px 14px}

.cab-dial{position:relative;flex:0 0 auto}
.cab-dial svg{position:absolute;inset:0;width:100%;height:100%}
.cab-dial .read{position:absolute;left:0;right:0;top:56%;text-align:center}
.cab-dial .v{font-family:var(--tech);font-size:34px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.cab-dial .u{font-family:var(--tech);font-size:9px;letter-spacing:.26em;color:var(--ink-3);margin-top:1px}
.cab-dial .lim{margin-top:5px;display:inline-block;font-family:var(--tech);font-size:10px;letter-spacing:.14em;
  color:#ff9184;padding:3px 7px;border-radius:5px;background:rgba(255,83,70,.12);box-shadow:inset 0 0 0 1px rgba(255,83,70,.32)}
.cab-dial .lim.over{color:#ffd0c9;background:rgba(255,83,70,.26);box-shadow:inset 0 0 0 1px rgba(255,83,70,.6),0 0 12px rgba(255,83,70,.4)}

.cab-lamps{display:flex;gap:8px}
.cab-lamp{width:50px;height:40px;border-radius:8px;display:grid;place-items:center;
  background:linear-gradient(180deg,#1a212a,#10151b);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 2px 5px rgba(0,0,0,.5)}
.cab-lamp b{font-family:var(--tech);font-size:9px;letter-spacing:.14em;color:#41505f}
.cab-lamp.on-g{background:linear-gradient(180deg,#123d2c,#0b241a);box-shadow:inset 0 1px 0 rgba(120,255,200,.28),0 0 16px rgba(61,220,154,.4)}
.cab-lamp.on-g b{color:#7dffc8}
.cab-lamp.on-a{background:linear-gradient(180deg,#4a3411,#2a1d09);box-shadow:inset 0 1px 0 rgba(255,215,140,.3),0 0 16px rgba(255,180,58,.42)}
.cab-lamp.on-a b{color:#ffd28a}

/* Every control in the cab is press-and-hold on a touch screen, so it must
   opt out of the browser's own gestures. Without touch-action:none an iPad
   treats a finger held on the power lever as the start of a scroll or a
   pinch, cancels the press, and the train does not move — which is exactly
   how this shipped: the lever and the brake were gauges with no handlers at
   all, and the only way to drive was a keyboard the iPad does not have. */
.cab-btn,.cab-lever,.cab-brake{touch-action:none;-webkit-tap-highlight-color:transparent;
  user-select:none;-webkit-user-select:none}
.cab-lever,.cab-brake{cursor:pointer}
.cab-lever.held,.cab-brake.held{box-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 0 18px rgba(0,0,0,.9),0 0 0 2px rgba(87,182,255,.55)}
.cab-btn.held{filter:brightness(1.25)}

.cab-brake{width:48px;height:132px;border-radius:9px;position:relative;overflow:hidden;
  background:linear-gradient(180deg,#141a22,#0c1016);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 14px rgba(0,0,0,.8)}
.cab-brake .f{position:absolute;left:5px;right:5px;bottom:5px;border-radius:6px;
  background:linear-gradient(180deg,#ff8a5c,#c73f13);box-shadow:0 0 14px rgba(255,120,70,.35),inset 0 1px 0 rgba(255,255,255,.3)}
.cab-brake .cap{position:absolute;left:0;right:0;top:5px;text-align:center}

.cab-lever{width:94px;height:180px;border-radius:11px;position:relative;overflow:hidden;
  background:linear-gradient(180deg,#161d25,#0c1116);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 16px rgba(0,0,0,.75)}
.cab-lever .n{position:absolute;left:7px;right:7px;height:1px;background:rgba(255,255,255,.1)}
.cab-lever .n b{position:absolute;left:2px;top:-6px;font-family:var(--tech);font-size:8px;color:#5a6b7d;letter-spacing:.08em}
.cab-lever .n.at b{color:#e8f0f8}
.cab-lever .f{position:absolute;left:6px;right:24px;bottom:6px;border-radius:8px;
  background:linear-gradient(180deg,rgba(72,230,160,.95),rgba(20,128,88,.95));box-shadow:0 0 20px rgba(61,220,154,.35),inset 0 1px 0 rgba(255,255,255,.4)}
.cab-lever .cap{position:absolute;left:0;right:0;top:7px;text-align:center}
/* A handle you can see and grab, running in a slot.
   The scale has always read P4·P3·P2·P1·N·B1·B2 — a real combined controller,
   where you SET a notch and leave it. It was wired as a dead-man button you
   had to hold instead, with nothing drawn to grab: a tap moved the notch about
   six percent and let it fall straight back, so tapping it did visibly
   nothing, and there was no lever on the screen to explain why. */
.cab-lever .slot{position:absolute;left:50%;top:26px;bottom:10px;width:11px;transform:translateX(-50%);
  border-radius:5px;background:linear-gradient(90deg,#05080c,#0e141b 45%,#05080c);
  box-shadow:inset 0 0 6px rgba(0,0,0,.95),inset 0 1px 0 rgba(0,0,0,.9)}
.cab-lever .knob{position:absolute;left:50%;width:70px;height:30px;
  transform:translate(-50%,-50%);transition:top .08s ease-out;pointer-events:none}
/* the grip */
.cab-lever .knob i{position:absolute;inset:0;border-radius:7px;display:block;
  background:linear-gradient(180deg,#fdfefe 0%,#cfdae6 38%,#8ea1b5 62%,#5c6d80 100%);
  box-shadow:0 4px 9px rgba(0,0,0,.75),0 1px 0 rgba(255,255,255,.95) inset,
    0 -3px 5px rgba(0,0,0,.35) inset,0 0 0 1px rgba(0,0,0,.55)}
/* the milling on the grip */
.cab-lever .knob i::after{content:'';position:absolute;left:9px;right:9px;top:50%;height:9px;
  transform:translateY(-50%);border-radius:2px;
  background:repeating-linear-gradient(180deg,rgba(50,63,77,.85) 0 1.5px,transparent 1.5px 3.5px)}
/* the stem that ties the grip to the slot, so it reads as a lever and not a chip */
.cab-lever .knob u{position:absolute;left:50%;top:50%;width:17px;height:40px;
  transform:translate(-50%,-50%);border-radius:4px;background:linear-gradient(90deg,#4a5a6b,#93a5b8 45%,#41505f);
  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 2px 6px rgba(0,0,0,.6);z-index:-1}
.cab-lever.held .knob i{box-shadow:0 4px 9px rgba(0,0,0,.75),0 1px 0 rgba(255,255,255,.95) inset,
  0 -3px 5px rgba(0,0,0,.35) inset,0 0 0 2px rgba(87,182,255,.95),0 0 16px rgba(87,182,255,.6)}

.cab-btn{min-width:62px;min-height:62px;display:grid;place-items:center;border-radius:11px;cursor:pointer;
  background:linear-gradient(180deg,#39434f,#161d25);box-shadow:var(--milled),var(--ring),var(--lift);color:var(--ink)}
.cab-btn svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.cab-btn.lg{min-width:80px;min-height:80px;border-radius:14px}
.cab-btn.lg svg{width:30px;height:30px}
.cab-btn.doors{background:linear-gradient(180deg,#4ea8f5,#125a9f);color:#02121f;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 0 0 1px rgba(110,185,255,.5),0 10px 24px rgba(15,80,155,.5)}
.cab-btn.horn{background:linear-gradient(180deg,#ff7d55,#c33b12);color:#180701;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 0 0 1px rgba(255,140,95,.45),0 10px 24px rgba(150,50,12,.48)}
.cab-util{position:absolute;display:flex;gap:9px}

/* ---- landscape: console bottom-right, minimap bottom-left ---- */
.cab[data-o="land"] .cab-dest{left:20px;top:20px}
/* Under the destination board, not beside it. The board's width follows the
   station name, so a centred ribbon collided with long names — measured
   covering the waiting-passenger count at 1180px on a Hebrew/English stop.
   Portrait and phone already stack them; landscape was the odd one out. */
.cab[data-o="land"] .cab-rib{left:20px;top:76px;width:min(460px,36%)}
.cab[data-o="land"] .cab-util{right:20px;top:20px}
.cab[data-o="land"] .cab-con{right:20px;bottom:20px}
/* Under the ribbon in the left-hand column, NOT the bottom-left corner. The
   engine's own control cluster (time of day among them) lives down there and
   occupies about 323x200 of it, so a map anchored to the bottom sat straight on
   top of the time control and swallowed its clicks. */
.cab[data-o="land"] .cab-mini{left:20px;top:120px;width:200px;height:172px}

/* ---- portrait: board and ribbon across the top, console across the bottom ---- */
.cab[data-o="port"] .cab-dest{left:18px;right:18px;top:18px}
.cab[data-o="port"] .cab-rib{left:18px;right:18px;top:92px}
.cab[data-o="port"] .cab-util{left:18px;top:150px;flex-direction:column}
.cab[data-o="port"] .cab-con{left:18px;right:18px;bottom:18px}
.cab[data-o="port"] .cab-mini{right:18px;top:150px;width:184px;height:158px}

/* Simple driving: everything you press while moving gets bigger. A child
   aiming at a moving screen needs the target, not the density. */
.cab.simple .cab-btn.lg{min-width:98px;min-height:98px;border-radius:18px}
.cab.simple .cab-btn.lg svg{width:38px;height:38px}
.cab.simple .cab-btn{min-width:70px;min-height:70px}
.cab.simple .cab-lever{width:108px}

/* ---- phone: tighter, minimap stands down ---- */
.cab[data-o="phone"] .cab-dest{left:11px;right:11px;top:11px}
.cab[data-o="phone"] .cab-rib{left:11px;right:11px;top:82px}
.cab[data-o="phone"] .cab-util{left:11px;top:132px;flex-direction:column}
.cab[data-o="phone"] .cab-con{left:11px;right:11px;bottom:11px}
.cab[data-o="phone"] .cab-mini{display:none}
.cab[data-o="phone"] .cab-btn.lg{min-width:66px;min-height:66px}
.cab[data-o="phone"] .cab-lever{width:78px;height:148px}
.cab[data-o="phone"] .cab-brake{width:40px;height:104px}
`;

const ICONS: Record<string, string> = {
	doors: '<path d="M4 3.5v17M20 3.5v17"/><path d="M8.6 9 6 12l2.6 3M15.4 9 18 12l-2.6 3"/><path d="M10.6 12h2.8"/>',
	horn: '<path d="M4 10v4h3l5 3.5v-11L7 10H4Z"/><path d="M16 9.5a4 4 0 0 1 0 5M18.6 7.4a7 7 0 0 1 0 9.2"/>',
	map: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z"/><path d="M9 4v13M15 6.5v13"/>',
	cam: '<rect x="2.5" y="7" width="13" height="10" rx="2.5"/><path d="M15.5 11.5 21.5 8v8l-6-3.5Z"/>',
	menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

function icon(name: string): string {
	return `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`;
}

/** Where a value sits on the dial, in degrees. */
function angleFor(value: number, max: number): number {
	return 145 + (395 - 145) * Math.min(1, Math.max(0, value / Math.max(1, max)));
}

function polar(angleDeg: number, radius: number): [number, number] {
	const a = (angleDeg * Math.PI) / 180;
	return [98 + radius * Math.cos(a), 98 + radius * Math.sin(a)];
}

function arcPath(from: number, to: number, radius: number): string {
	const s = polar(from, radius);
	const e = polar(to, radius);
	const large = to - from > 180 ? 1 : 0;

	return `M${s[0].toFixed(1)} ${s[1].toFixed(1)} A${radius} ${radius} 0 ${large} 1 ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
}

export default class CabHud {
	private root: HTMLElement | null = null;
	private dialEl: HTMLElement | null = null;
	private destName: HTMLElement | null = null;
	private destMeta: HTMLElement | null = null;
	private destPax: HTMLElement | null = null;
	private ribbonEl: HTMLElement | null = null;
	private miniYou: HTMLElement | null = null;
	private miniFoot: HTMLElement | null = null;
	private lampDoors: HTMLElement | null = null;
	private lampLimit: HTMLElement | null = null;
	private leverFill: HTMLElement | null = null;
	private brakeFill: HTMLElement | null = null;
	private lastRibbonStops = -1;
	private lastOrientation = '';
	private onResize: (() => void) | null = null;
	/** Where the master controller handle is sitting. Starts at neutral. */
	private notch = NEUTRAL_INDEX;

	public constructor(
		private readonly parent: HTMLElement,
		private readonly onAction: (action: 'map' | 'camera' | 'menu' | 'doors' | 'horn') => void,
		/** Held down or released — the horn sounds for as long as it is held. */
		private readonly onHorn: (down: boolean) => void,
		/**
		 * The power lever and the brake, held rather than tapped.
		 *
		 * These are the only way to drive on a tablet: there is no keyboard, and
		 * the old on-screen accelerate/brake buttons went away with the legacy
		 * chrome. Shipping the console without them made the game unplayable on
		 * the device it was built for.
		 */
		/**
		 * What the master controller is asking for: power 0–1 and brake 0–1,
		 * never both. Called when the handle moves, not every frame.
		 */
		private readonly onLever: (power: number, brake: number) => void = (): void => undefined,
	) {
		this.mount();
	}

	private mount(): void {
		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');

			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		const root = document.createElement('div');

		root.className = 'cab';
		root.innerHTML = `
			<div class="panel cab-dest">
				<div class="strip"></div>
				<div class="in"><div><div class="nm">—</div><div class="mt"></div></div><span class="pax"></span></div>
			</div>
			<div class="panel cab-rib"></div>
			<div class="panel cab-mini">
				<div class="cap"><span class="micro"></span></div>
				<div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div class="you"></div></div>
				<div class="foot"></div>
			</div>
			<div class="cab-util">
				<div class="cab-btn" data-a="map">${icon('map')}</div>
				<div class="cab-btn" data-a="camera">${icon('cam')}</div>
				<div class="cab-btn" data-a="menu">${icon('menu')}</div>
			</div>
			<div class="cab-con">
				<div class="grain"></div>
				<div class="inner">
					<div class="cab-dial"></div>
					<div style="display:flex;flex-direction:column;gap:9px;align-items:center">
						<div class="cab-lamps">
							<span class="cab-lamp" data-l="doors"><b>DOORS</b></span>
							<span class="cab-lamp" data-l="limit"><b>LIMIT</b></span>
						</div>
						<div style="display:flex;gap:10px;align-items:flex-end">
							<div class="cab-brake"><div class="cap"><span class="micro">BRK</span></div><div class="f"></div></div>
							<div class="cab-lever"><div class="cap"><span class="micro">Drive</span></div><div class="slot"></div>${
								NOTCHES.map((n, i) => `<div class="n" data-i="${i}" style="top:${notchPercent(i)}%"><b>${n}</b></div>`).join('')
							}<div class="knob"><u></u><i></i></div></div>
							<div style="display:flex;flex-direction:column;gap:9px">
								<div class="cab-btn lg horn" data-a="horn">${icon('horn')}</div>
								<div class="cab-btn lg doors" data-a="doors">${icon('doors')}</div>
							</div>
						</div>
					</div>
				</div>
			</div>`;

		root.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;

			// The horn is held, not clicked — it runs on press/release below.
			if (btn && btn.dataset.a !== 'horn') this.onAction(btn.dataset.a as never);
		});

		// Press-and-hold, for anything that is held rather than tapped.
		//
		// Pointer events, not mouse+touch pairs: one path covers a mouse, a
		// finger and a pencil, and `setPointerCapture` means the press keeps
		// following that finger even when it slides off the control — which is
		// what a thumb on a moving train actually does. The release is bound on
		// every way a press can end (up, cancel, and the window losing focus),
		// because a stuck throttle is worse than an unresponsive one.
		const hold = (el: Element | null, onChange: (down: boolean) => void): void => {
			if (!el) return;

			let active = false;
			const start = (e: Event): void => {
				e.preventDefault();
				if (active) return;
				active = true;
				el.classList.add('held');
				const pe = e as PointerEvent;

				if (pe.pointerId !== undefined) {
					try { (el as HTMLElement).setPointerCapture(pe.pointerId); } catch { /* not captureable */ }
				}
				onChange(true);
			};
			const end = (): void => {
				if (!active) return;
				active = false;
				el.classList.remove('held');
				onChange(false);
			};

			el.addEventListener('pointerdown', start);
			el.addEventListener('pointerup', end);
			el.addEventListener('pointercancel', end);
			// With pointer capture the press ends on release rather than on
			// leaving, but an uncaptured pointer (an old browser) still needs it.
			el.addEventListener('pointerleave', end);
			window.addEventListener('blur', end);
		};

		hold(root.querySelector('[data-a="horn"]'), down => this.onHorn(down));

		// The master controller: grab the handle and move it, or tap the notch
		// you want. It STAYS where you put it — that is the difference between a
		// controller and a button, and it is why a tap on the old one did
		// nothing you could see.
		const lever = root.querySelector('.cab-lever') as HTMLElement | null;

		if (lever) {
			const notchAt = (clientY: number): number => {
				const r = lever.getBoundingClientRect();
				const frac = ((clientY - r.top) / r.height) * 100;
				let best = 0;
				let bestGap = Infinity;

				for (let i = 0; i < NOTCHES.length; i++) {
					const gap = Math.abs(notchPercent(i) - frac);

					if (gap < bestGap) { bestGap = gap; best = i; }
				}

				return best;
			};

			let dragging = false;

			lever.addEventListener('pointerdown', (e: Event) => {
				const pe = e as PointerEvent;

				pe.preventDefault();
				dragging = true;
				lever.classList.add('held');
				try { lever.setPointerCapture(pe.pointerId); } catch { /* not captureable */ }
				this.setNotch(notchAt(pe.clientY));
			});
			lever.addEventListener('pointermove', (e: Event) => {
				if (!dragging) return;
				this.setNotch(notchAt((e as PointerEvent).clientY));
			});

			const release = (): void => { dragging = false; lever.classList.remove('held'); };

			lever.addEventListener('pointerup', release);
			lever.addEventListener('pointercancel', release);
			window.addEventListener('blur', release);
		}

		// The brake gauge beside it stays a gauge — it reads what the controller
		// is asking for. Two handles for one decision is how you end up applying
		// power and brake together.

		// EVERY panel's position comes from a `.cab[data-o="…"]` rule, so the
		// attribute has to exist before the element is on screen. It used to be
		// written only inside `update()`, which meant that until the first frame
		// of a RUNNING game not one rule matched: `.cab-dest`, `.cab-rib`,
		// `.cab-util`, `.cab-con` and `.cab-mini` are all `position:absolute`
		// with no offsets of their own, so they stacked in the top-left corner,
		// on top of each other and on top of the time-of-day control underneath.
		// The whole interface was unclickable before you started driving.
		root.dataset.o = this.orientation();
		this.lastOrientation = root.dataset.o;

		// Hidden until the game says otherwise. The HUD is built during startup,
		// long before anybody is driving; showing it over the start screen put a
		// cab console on top of the menu.
		root.style.display = 'none';

		// Turning a phone changes which layout applies, and a paused game gets no
		// frames to notice it in.
		this.onResize = (): void => { this.applyOrientation(); };
		window.addEventListener('resize', this.onResize);
		window.addEventListener('orientationchange', this.onResize);

		this.parent.appendChild(root);
		this.root = root;

		// Put the handle at neutral before anyone looks at it. Without this the
		// knob has no `top` at all and sits at the very top of the slot — over
		// the label, and reading as full power on a train that is stationary.
		this.renderNotch();
		this.dialEl = root.querySelector('.cab-dial');
		this.destName = root.querySelector('.cab-dest .nm');
		this.destMeta = root.querySelector('.cab-dest .mt');
		this.destPax = root.querySelector('.cab-dest .pax');
		this.ribbonEl = root.querySelector('.cab-rib');
		this.miniYou = root.querySelector('.cab-mini .you');
		this.miniFoot = root.querySelector('.cab-mini .foot');
		this.lampDoors = root.querySelector('[data-l="doors"]');
		this.lampLimit = root.querySelector('[data-l="limit"]');
		this.leverFill = root.querySelector('.cab-lever .f');
		this.brakeFill = root.querySelector('.cab-brake .f');
	}

	/** Landscape / portrait / phone — chosen from the viewport, not the device. */
	private orientation(): string {
		const w = window.innerWidth;
		const h = window.innerHeight;

		if (w < 520) return 'phone';

		return w >= h ? 'land' : 'port';
	}

	/**
	 * Move the handle to a notch and tell the train what that means.
	 *
	 * The handle position is the truth: it does not spring back, and nothing
	 * else moves it, so what the player set is what the train is doing.
	 */
	private setNotch(index: number): void {
		const i = Math.max(0, Math.min(NOTCHES.length - 1, Math.round(index)));

		if (i === this.notch) return;

		this.notch = i;
		this.renderNotch();

		const demand = notchDemand(i);

		this.onLever(demand.power, demand.brake);
	}

	/** Put the handle where the notch says, and light that notch's label. */
	private renderNotch(): void {
		const knob = this.root?.querySelector<HTMLElement>('.cab-lever .knob');

		if (knob) knob.style.top = `${notchPercent(this.notch)}%`;

		this.root?.querySelectorAll<HTMLElement>('.cab-lever .n').forEach(n => {
			n.classList.toggle('at', Number(n.dataset.i) === this.notch);
		});
	}

	/** Back to neutral — used when a run is reset rather than by the player. */
	public resetNotch(): void {
		this.notch = NEUTRAL_INDEX;
		this.renderNotch();
		this.onLever(0, 0);
	}

	/** Put the layout the viewport currently calls for onto the root. */
	private applyOrientation(): string {
		const o = this.orientation();

		if (this.root && o !== this.lastOrientation) {
			this.lastOrientation = o;
			this.root.dataset.o = o;
		}

		return o;
	}

	public setVisible(visible: boolean): void {
		if (!this.root) return;

		// Re-assert the layout on the way in: the window may have been resized
		// while the console was put away.
		if (visible) this.applyOrientation();

		this.root.style.display = visible ? '' : 'none';
	}

	public update(s: CabHudState): void {
		if (!this.root) return;

		const o = this.applyOrientation();

		this.renderDial(s, o);

		if (this.destName) this.destName.textContent = s.stationName;
		if (this.destMeta) this.destMeta.textContent = s.stationMeta;
		if (this.destPax) {
			this.destPax.textContent = s.waiting === null ? '' : `${s.waiting} WAITING`;
			this.destPax.style.display = s.waiting === null ? 'none' : '';
		}

		this.renderRibbon(s);

		this.renderMiniRoute(s);

		// The map moves under the train, so the train is always the middle of it.
		// It used to slide along a fixed diagonal by percentage-of-route, which
		// is why it drifted across the panel independently of the drawn line.
		if (this.miniYou) {
			this.miniYou.style.left = '50%';
			this.miniYou.style.top = '50%';
			this.miniYou.style.transform = `translate(-50%,-50%) rotate(${(s.heading ?? 0).toFixed(0)}deg)`;
		}

		const cap = this.root.querySelector('.cab-mini .micro');

		if (cap) cap.textContent = s.lineName;

		this.root.classList.toggle('simple', s.simpleMode);

		this.lampDoors?.classList.toggle('on-g', s.doorsOpen);
		this.lampLimit?.classList.toggle('on-a', s.overLimit);

		if (this.leverFill) this.leverFill.style.height = `${Math.max(4, s.power * 100).toFixed(0)}%`;
		if (this.brakeFill) this.brakeFill.style.height = `${Math.max(4, s.brake * 100).toFixed(0)}%`;
	}

	private renderDial(s: CabHudState, o: string): void {
		if (!this.dialEl) return;

		const size = o === 'phone' ? 132 : o === 'land' ? 176 : 158;

		this.dialEl.style.width = `${size}px`;
		this.dialEl.style.height = `${size}px`;

		const R = 72;
		const max = Math.max(s.dialMax, s.limitKmh + 20, 60);
		const speed = Math.max(0, s.speedKmh);
		const over = speed > s.limitKmh && s.limitKmh > 0;
		let ticks = '';

		for (let v = 0; v <= max; v += 20) {
			const a = angleFor(v, max);
			const major = v % 40 === 0;
			const p1 = polar(a, major ? R - 11 : R - 7);
			const p2 = polar(a, R - 2);

			ticks += `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}"
				stroke="${major ? '#93a8bc' : '#465666'}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`;

			if (major) {
				const q = polar(a, R - 23);

				ticks += `<text x="${q[0].toFixed(1)}" y="${(q[1] + 3.2).toFixed(1)}" text-anchor="middle"
					font-family="DIN Alternate,Bahnschrift,sans-serif" font-size="9" fill="#5b6d80">${v}</text>`;
			}
		}

		const na = angleFor(speed, max);
		const tip = polar(na, R - 14);
		const tail = polar(na + 180, 12);
		const la = angleFor(s.limitKmh, max);
		const l1 = polar(la, R + 3);
		const l2 = polar(la, R + 11);

		this.dialEl.innerHTML = `
			<svg viewBox="0 0 196 196">
				<defs>
					<radialGradient id="cabBez" cx=".5" cy=".28"><stop offset=".84" stop-color="#1e252d"/><stop offset="1" stop-color="#48525e"/></radialGradient>
					<radialGradient id="cabFace" cx=".5" cy=".26"><stop offset="0" stop-color="#1a212a"/><stop offset="1" stop-color="#080c11"/></radialGradient>
					<linearGradient id="cabNdl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff9c78"/><stop offset="1" stop-color="#ff4632"/></linearGradient>
				</defs>
				<circle cx="98" cy="98" r="93" fill="url(#cabBez)"/>
				<circle cx="98" cy="98" r="85" fill="url(#cabFace)"/>
				<path d="${arcPath(145, 395, R)}" stroke="#1d252e" stroke-width="6" fill="none" stroke-linecap="round"/>
				<path d="${arcPath(la, 395, R + 7)}" stroke="rgba(255,83,70,.42)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
				<path d="${arcPath(145, angleFor(Math.min(speed, s.limitKmh || speed), max), R)}"
					stroke="#57b6ff" stroke-width="6" fill="none" stroke-linecap="round"
					style="filter:drop-shadow(0 0 7px rgba(87,182,255,.65))"/>
				${over ? `<path d="${arcPath(la, na, R)}" stroke="#ff5346" stroke-width="6" fill="none" stroke-linecap="round"
					style="filter:drop-shadow(0 0 8px rgba(255,83,70,.85))"/>` : ''}
				<line x1="${l1[0].toFixed(1)}" y1="${l1[1].toFixed(1)}" x2="${l2[0].toFixed(1)}" y2="${l2[1].toFixed(1)}"
					stroke="#ff5346" stroke-width="3.4" stroke-linecap="round"/>
				${ticks}
				<line x1="${tail[0].toFixed(1)}" y1="${tail[1].toFixed(1)}" x2="${tip[0].toFixed(1)}" y2="${tip[1].toFixed(1)}"
					stroke="url(#cabNdl)" stroke-width="3.2" stroke-linecap="round"/>
				<circle cx="98" cy="98" r="8.5" fill="#28313b" stroke="#4a5865" stroke-width="1.3"/>
				<circle cx="98" cy="98" r="3.2" fill="#7d8fa1"/>
			</svg>
			<div class="read">
				<div class="v" style="color:${over ? '#ff9184' : '#eaf4ff'}">${Math.round(speed)}</div>
				<div class="u">KM/H</div>
				${s.limitKmh > 0 ? `<div class="lim ${over ? 'over' : ''}">LIMIT ${s.limitKmh}</div>` : ''}
			</div>`;
	}

	/**
	 * The route itself. Left empty this was a black box with a dot in it —
	 * a minimap with no map.
	 */
	private renderMiniRoute(s: CabHudState): void {
		const svg = this.root?.querySelector<SVGSVGElement>('.cab-mini .plot svg');

		if (!svg) return;

		const view = s.miniView;

		if (!view || view.paths.length === 0) {
			// Say so rather than drawing something. A placeholder that looks like
			// a route is worse than an empty panel: it cannot be told apart from
			// a real one, which is how a decorative diagonal survived in here for
			// nine releases.
			if (svg.dataset.k !== 'empty') {
				svg.dataset.k = 'empty';
				svg.innerHTML = '';
			}

			if (this.miniFoot) this.miniFoot.textContent = 'NO MAP YET';

			return;
		}

		// Rebuilt only when the picture actually changed. The caller throttles by
		// distance travelled, so this is a cheap second guard rather than the
		// main one.
		const key = `${view.paths.map(p => p.d.length).join(',')}|${view.stations.length}|${Math.round(s.heading ?? 0)}`;

		if (svg.dataset.k === key) return;

		svg.dataset.k = key;

		const lines = view.paths.map(p => {
			const width = p.current ? 3.4 : 2;
			const opacity = p.current ? 1 : 0.45;

			return `<path d="${p.d}" stroke="${p.color}" stroke-width="${width}" stroke-opacity="${opacity}"`
				+ ' fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
		}).join('');

		const stations = view.stations
			.map(st => `<circle cx="${st.x}" cy="${st.y}" r="1.9" fill="#0b1017" stroke="#c2d2e2" stroke-width="1"/>`)
			.join('');

		svg.innerHTML = lines + stations;

		if (this.miniFoot) this.miniFoot.textContent = describeSpan(view.spanM).toUpperCase();
	}

	private renderRibbon(s: CabHudState): void {
		if (!this.ribbonEl) return;

		const stops = Math.max(2, Math.min(s.stopCount, 12));

		// Rebuilt only when the shape changes; the marker moves by class alone.
		if (stops !== this.lastRibbonStops) {
			this.lastRibbonStops = stops;

			let html = '';

			for (let i = 0; i < stops; i++) {
				if (i > 0) html += '<span class="sg"></span>';
				html += '<span class="st"></span>';
			}

			this.ribbonEl.innerHTML = html;
		}

		const dots = this.ribbonEl.querySelectorAll('.st');
		const segs = this.ribbonEl.querySelectorAll('.sg');
		const here = Math.round(s.progress * (stops - 1));

		dots.forEach((d, i) => d.classList.toggle('now', i === here));
		segs.forEach((g, i) => g.classList.toggle('on', i < here));
	}

	public dispose(): void {
		if (this.onResize) {
			window.removeEventListener('resize', this.onResize);
			window.removeEventListener('orientationchange', this.onResize);
			this.onResize = null;
		}
		this.root?.remove();
		this.root = null;
	}
}
