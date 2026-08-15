/**
 * The window you are looking out of, in Cab view.
 *
 * The cab instruments shipped in 2.1.0 — dial, lever, tell-tales — but as the
 * permanent HUD in EVERY view, so Cab was not a cab. It was the same console
 * over a camera that happened to be at the front of the train, with nothing
 * around the view to say you were inside anything.
 *
 * This is the frame: pillars down each side, a roof with a sun visor, a
 * windscreen rubber, and the top of the desk across the bottom. Drawn in CSS
 * over the scene rather than modelled, for the reason the console is: it has
 * to sit exactly on the edges of the screen at any size, which a mesh in a
 * 40-degree lens does not.
 */

const STYLE_ID = 'cab-windscreen-style';

const CSS = `
.cab-screen{position:fixed;inset:0;z-index:38;pointer-events:none;
  opacity:0;transition:opacity .28s ease-out}
.cab-screen.on{opacity:1}

/* The pillars. Angled slightly, as a cab front is. */
.cab-screen .pillar{position:absolute;top:0;bottom:0;width:5.6%;
  background:linear-gradient(90deg,#2a323c,#171d25 55%,#0e131a);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.cab-screen .pillar.l{left:0;clip-path:polygon(0 0,100% 0,72% 100%,0 100%)}
.cab-screen .pillar.r{right:0;clip-path:polygon(0 0,100% 0,100% 100%,28% 100%)}

/* The roof, with the visor pulled down a little across the top. */
.cab-screen .roof{position:absolute;left:0;right:0;top:0;height:9%;
  background:linear-gradient(180deg,#141a22,#1d242e 62%,rgba(29,36,46,0));
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.05)}
.cab-screen .visor{position:absolute;left:6%;right:6%;top:0;height:5.4%;
  border-radius:0 0 10px 10px;background:linear-gradient(180deg,#39434f,#222a34);
  box-shadow:0 3px 10px rgba(0,0,0,.5),inset 0 -1px 0 rgba(255,255,255,.07)}

/* The desk. Kept shallow: the console already occupies a corner, and a deep
   dash would leave a letterbox to drive through. */
.cab-screen .desk{position:absolute;left:0;right:0;bottom:0;height:11%;
  background:linear-gradient(180deg,rgba(20,26,34,0),#1b222b 42%,#10161d);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}

/* The rubber the glass sits in — what actually reads as a window rather than
   a vignette. */
.cab-screen .rubber{position:absolute;left:5%;right:5%;top:8%;bottom:10%;
  border-radius:14px;box-shadow:0 0 0 7px rgba(16,21,28,.92),0 0 0 8px rgba(255,255,255,.05)}

/* A wiper parked across the bottom of the glass. */
.cab-screen .wiper{position:absolute;left:14%;bottom:12.5%;width:34%;height:4px;
  border-radius:3px;background:linear-gradient(90deg,#39434f,#0f141a);
  transform-origin:left center;transform:rotate(-3.5deg);
  box-shadow:0 1px 3px rgba(0,0,0,.6)}

/* Dirt in the corners of the glass, which is what a windscreen has. */
.cab-screen .grime{position:absolute;left:5%;right:5%;top:8%;bottom:10%;border-radius:14px;
  background:
    radial-gradient(120% 90% at 0% 0%,rgba(190,200,210,.07),transparent 46%),
    radial-gradient(120% 90% at 100% 0%,rgba(190,200,210,.06),transparent 46%)}

/* Portrait has far less width to give away, so the pillars narrow. */
@media (max-aspect-ratio:1/1){
  .cab-screen .pillar{width:3.6%}
  .cab-screen .desk{height:8%}
}
`;

export default class CabWindscreen {
	private root: HTMLElement | null = null;

	public constructor(private readonly parent: HTMLElement) {
		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');

			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
	}

	public setVisible(visible: boolean): void {
		if (visible && !this.root) this.mount();

		// Faded rather than switched: the C key cycles through views, and a
		// frame that snaps in and out on every press is a flicker.
		if (this.root) this.root.classList.toggle('on', visible);
	}

	private mount(): void {
		const root = document.createElement('div');

		root.className = 'cab-screen';
		root.innerHTML = `
			<div class="grime"></div>
			<div class="rubber"></div>
			<div class="pillar l"></div>
			<div class="pillar r"></div>
			<div class="roof"></div>
			<div class="visor"></div>
			<div class="wiper"></div>
			<div class="desk"></div>`;

		this.parent.appendChild(root);
		this.root = root;
	}

	public dispose(): void {
		this.root?.remove();
		this.root = null;
	}
}
