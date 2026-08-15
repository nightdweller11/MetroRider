/**
 * The controls for walking, on a screen with no keyboard.
 *
 * WASD is not a control scheme on an iPad, and the whole point of stepping off
 * the train is to wander — so movement gets a real thumbstick on the left, and
 * anywhere else you drag looks around. There is also a way back to the train
 * that is always on screen, because a walker who cannot find their train has
 * lost the game rather than explored it.
 *
 * Pointer events throughout: one path for a finger, a mouse and a pencil.
 */

const STYLE_ID = 'walk-pad-style';

const CSS = `
.walk-pad{position:fixed;inset:0;z-index:45;pointer-events:none;
  font-family:ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif;color:#e8f0f8;
  --tech:"DIN Alternate","Bahnschrift","Roboto Condensed",system-ui,sans-serif}
/* The look area is everything, so a drag anywhere that is not the stick turns
   your head. It sits UNDER the stick and the buttons in z-order. */
.walk-pad .look{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:grab}
.walk-pad .look:active{cursor:grabbing}

.walk-pad .stick{position:absolute;left:26px;bottom:26px;width:150px;height:150px;border-radius:50%;
  pointer-events:auto;touch-action:none;
  background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.10),rgba(0,0,0,.34));
  box-shadow:inset 0 0 0 1px rgba(160,190,220,.24),0 10px 26px rgba(0,0,0,.5)}
.walk-pad .stick .knob{position:absolute;left:50%;top:50%;width:62px;height:62px;border-radius:50%;
  transform:translate(-50%,-50%);
  background:linear-gradient(180deg,#e9f0f7,#93a5b8);
  box-shadow:0 4px 10px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.9)}
.walk-pad .stick .ring{position:absolute;inset:14px;border-radius:50%;
  box-shadow:inset 0 0 0 1px rgba(160,190,220,.14)}

.walk-pad .back{position:absolute;right:26px;bottom:26px;pointer-events:auto;touch-action:none;
  display:flex;align-items:center;gap:9px;padding:14px 20px;border-radius:13px;cursor:pointer;
  background:linear-gradient(180deg,#4ea8f5,#125a9f);color:#02121f;font-weight:800;font-size:15px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 10px 26px rgba(0,0,0,.5)}

.walk-pad .hint{position:absolute;left:50%;top:22px;transform:translateX(-50%);
  padding:9px 15px;border-radius:11px;font-size:13px;font-weight:600;
  background:rgba(8,12,18,.76);box-shadow:inset 0 0 0 1px rgba(160,190,220,.2);
  backdrop-filter:blur(7px);white-space:nowrap}
.walk-pad .hint.warn{background:rgba(70,40,8,.86);box-shadow:inset 0 0 0 1px rgba(255,180,58,.5)}

@media (max-width:520px){
  .walk-pad .stick{width:124px;height:124px;left:16px;bottom:16px}
  .walk-pad .stick .knob{width:52px;height:52px}
  .walk-pad .back{right:16px;bottom:16px;padding:13px 16px;font-size:14px}
}
`;

/** How far the knob travels before the stick reads as fully pushed, px. */
const STICK_RANGE = 46;
/** Radians of turn per pixel dragged. */
const LOOK_PER_PX = 0.0042;

export default class WalkPad {
	private root: HTMLElement | null = null;
	private knob: HTMLElement | null = null;
	private hintEl: HTMLElement | null = null;

	public constructor(
		private readonly parent: HTMLElement,
		private readonly onMove: (forward: number, strafe: number) => void,
		private readonly onLook: (deltaYaw: number, deltaPitch: number) => void,
		private readonly onBack: () => void,
	) {
		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');

			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
	}

	public isOpen(): boolean {
		return this.root !== null;
	}

	public show(): void {
		if (this.root) return;

		const root = document.createElement('div');

		root.className = 'walk-pad';
		root.innerHTML = `
			<div class="look"></div>
			<div class="stick"><div class="ring"></div><div class="knob"></div></div>
			<div class="back">🚆 Back to the train</div>
			<div class="hint">Drag to look around · use the stick to walk</div>`;

		this.parent.appendChild(root);
		this.root = root;
		this.knob = root.querySelector('.knob');
		this.hintEl = root.querySelector('.hint');

		this.wireLook(root.querySelector('.look') as HTMLElement);
		this.wireStick(root.querySelector('.stick') as HTMLElement);
		root.querySelector('.back')?.addEventListener('pointerdown', e => {
			e.preventDefault();
			this.onBack();
		});

		window.setTimeout(() => {
			if (this.hintEl && this.hintEl.textContent?.startsWith('Drag')) this.hintEl.style.display = 'none';
		}, 6000);
	}

	private wireLook(el: HTMLElement): void {
		let dragging = false;
		let lastX = 0;
		let lastY = 0;

		el.addEventListener('pointerdown', (e: PointerEvent) => {
			e.preventDefault();
			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
			try { el.setPointerCapture(e.pointerId); } catch { /* not captureable */ }
		});
		el.addEventListener('pointermove', (e: PointerEvent) => {
			if (!dragging) return;
			this.onLook((e.clientX - lastX) * LOOK_PER_PX, -(e.clientY - lastY) * LOOK_PER_PX);
			lastX = e.clientX;
			lastY = e.clientY;
		});

		const end = (): void => { dragging = false; };

		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
		window.addEventListener('blur', end);
	}

	private wireStick(el: HTMLElement): void {
		let active = false;

		const apply = (e: PointerEvent): void => {
			const r = el.getBoundingClientRect();
			const dx = e.clientX - (r.left + r.width / 2);
			const dy = e.clientY - (r.top + r.height / 2);
			const distance = Math.hypot(dx, dy);
			const clamped = Math.min(1, distance / STICK_RANGE);
			const nx = distance > 0 ? (dx / distance) * clamped : 0;
			const ny = distance > 0 ? (dy / distance) * clamped : 0;

			if (this.knob) {
				this.knob.style.transform =
					`translate(calc(-50% + ${(nx * STICK_RANGE).toFixed(1)}px), calc(-50% + ${(ny * STICK_RANGE).toFixed(1)}px))`;
			}

			// Pushing the stick away from you walks forward, so `forward` is the
			// negative of screen-down.
			this.onMove(-ny, nx);
		};

		el.addEventListener('pointerdown', (e: PointerEvent) => {
			e.preventDefault();
			active = true;
			try { el.setPointerCapture(e.pointerId); } catch { /* not captureable */ }
			apply(e);
		});
		el.addEventListener('pointermove', (e: PointerEvent) => { if (active) apply(e); });

		// Letting go must stop the walker. A stick left applied is the walking
		// equivalent of a stuck throttle.
		const release = (): void => {
			if (!active) return;
			active = false;
			if (this.knob) this.knob.style.transform = 'translate(-50%,-50%)';
			this.onMove(0, 0);
		};

		el.addEventListener('pointerup', release);
		el.addEventListener('pointercancel', release);
		window.addEventListener('blur', release);
	}

	/** Say how far the train is, once it is far enough to matter. */
	public setNotice(text: string | null, warn: boolean = false): void {
		if (!this.hintEl) return;

		if (!text) {
			this.hintEl.style.display = 'none';

			return;
		}

		this.hintEl.style.display = '';
		this.hintEl.textContent = text;
		this.hintEl.classList.toggle('warn', warn);
	}

	public hide(): void {
		this.onMove(0, 0);
		this.root?.remove();
		this.root = null;
		this.knob = null;
		this.hintEl = null;
	}
}
