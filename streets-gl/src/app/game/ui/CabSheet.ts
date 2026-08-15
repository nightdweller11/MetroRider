/**
 * A summoned panel.
 *
 * The rule this exists to enforce: a panel is opened, used and dismissed —
 * it never stands permanently over the scene, and it never covers the driving
 * controls. When one is open the cab console steps aside; when it closes the
 * console comes back.
 *
 * Landscape docks it to the right edge; portrait and phone raise it from the
 * bottom. That is a stylesheet decision, not per-element coordinates.
 *
 * Design + mocks: `docs/features/ui-2.1/`.
 */

const STYLE_ID = 'cab-sheet-style';

const CSS = `
/* pointer-events MUST be restored here. The sheet is mounted inside the
   game HUD container, which is pointer-events:none so the world can be
   dragged through it — every real control inside it has to opt back in. Without
   this line the panel painted correctly and was completely dead: the menu
   opened (its button is a .cab-btn, which does opt in) and then not one row
   inside it could be clicked. That is the "I can't click on anything" report —
   Pick a line, Camera, Settings, Timetable and every other sheet at once. */
.cab-sheet{position:fixed;display:flex;flex-direction:column;overflow:hidden;z-index:50;pointer-events:auto;
  background:linear-gradient(180deg,#212a35,#0e141a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 0 0 1px rgba(120,150,180,.16),0 22px 50px rgba(0,0,0,.6);
  font-family:ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif;color:#e8f0f8;
  --tech:"DIN Alternate","Bahnschrift","Roboto Condensed",system-ui,sans-serif}
.cab-sheet .grab{width:38px;height:4px;border-radius:2px;background:rgba(255,255,255,.2);margin:8px auto 0}
.cab-sheet header{display:flex;align-items:center;gap:10px;padding:14px 16px 12px;
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.08)}
.cab-sheet header h3{margin:0;font-family:var(--tech);font-size:15px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
.cab-sheet header .x{margin-left:auto;width:38px;height:38px;border-radius:8px;display:grid;place-items:center;cursor:pointer;
  background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09)}
.cab-sheet header .x svg{width:14px;height:14px;stroke:#94a7ba;stroke-width:2;fill:none;stroke-linecap:round}
.cab-sheet .body{padding:11px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;flex:1;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}

.cab-sheet .row-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:11px;cursor:pointer;
  background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.018));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06);text-align:left;border:0;color:inherit;font:inherit}
.cab-sheet .row-item:hover{background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.04))}
/* A stated fact, not a control: no lift on hover, no pointer, full opacity
   (a disabled button must not read as a control that is switched off). */
.cab-sheet .row-item.fact{cursor:default;opacity:1}
.cab-sheet .row-item.fact:hover{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.018))}
.cab-sheet .row-item .pill{min-width:46px;height:32px;border-radius:7px;display:grid;place-items:center;
  font-family:var(--tech);font-weight:700;font-size:14px;letter-spacing:.06em;color:#05121c;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 3px 8px rgba(0,0,0,.45);flex:0 0 auto}
.cab-sheet .row-item .t{font-weight:800;font-size:14px;
  /* Titles come from user-authored maps and some run to a paragraph. Two
     lines keeps every row the same shape and the list scannable. */
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cab-sheet .row-item .s{color:#5d6f81;font-size:11.5px;font-weight:600}
.cab-sheet .row-item .s .ic{font-size:15px;line-height:1;opacity:1;margin-right:4px;vertical-align:-2px}
.cab-sheet .row-item .go{margin-left:auto;color:#5d6f81;font-size:17px}

/* landscape: docked right, full height */
.cab-sheet[data-o="land"]{right:20px;top:20px;bottom:20px;width:min(400px,35%);border-radius:20px}
/* portrait + phone: raised from the bottom edge */
.cab-sheet[data-o="port"]{left:0;right:0;bottom:0;height:56%;border-radius:20px 20px 0 0}
.cab-sheet[data-o="phone"]{left:0;right:0;bottom:0;height:62%;border-radius:20px 20px 0 0}

/* the console steps aside rather than being covered */
.cab.sheet-open[data-o="land"] .cab-con{right:calc(20px + min(400px,35%) + 12px)}
.cab.sheet-open[data-o="land"] .cab-util{right:calc(20px + min(400px,35%) + 12px)}
/* The ribbon already sits under the board; with the sheet open it just has
   less room to run in. */
.cab.sheet-open[data-o="land"] .cab-rib{width:min(460px,calc(100% - 40px - min(400px,35%) - 12px))}
.cab.sheet-open[data-o="port"] .cab-con,
.cab.sheet-open[data-o="phone"] .cab-con{display:none}
.cab.sheet-open[data-o="port"] .cab-mini,
.cab.sheet-open[data-o="phone"] .cab-mini{display:none}
`;

export interface SheetRow {
	/** Short code shown in the coloured pill, e.g. a line number. */
	badge?: string;
	badgeColor?: string;
	title: string;
	subtitle?: string;
	/**
	 * A glyph placed in front of the subtitle, at a readable size.
	 *
	 * Inline in the subtitle string it inherits 11.5 px muted grey and reads as
	 * a smudge — measured on the line picker, three different mode icons were
	 * indistinguishable from each other at that size. It gets its own span so
	 * it can be bigger and fully opaque while the words stay quiet.
	 */
	subtitleIcon?: string;
	/**
	 * Leave the sheet up after the tap. Choosing a view is a departure — the
	 * sheet has done its job and gets out of the way. Flipping a switch is not:
	 * dismissing on tap would hide the very thing that just changed.
	 */
	keepOpen?: boolean;
	/**
	 * A row that states something rather than doing something. It loses the
	 * chevron, the hover and the pointer: an arrow on a row that goes nowhere
	 * is a promise the interface cannot keep.
	 */
	readOnly?: boolean;
	onSelect: () => void;
}

export default class CabSheet {
	private el: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private open = false;

	public constructor(private readonly parent: HTMLElement) {
		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');

			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
	}

	public isOpen(): boolean {
		return this.open;
	}

	/** Landscape / portrait / phone, from the viewport rather than the device. */
	private orientation(): string {
		const w = window.innerWidth;

		if (w < 520) return 'phone';

		return w >= window.innerHeight ? 'land' : 'port';
	}

	public show(title: string, rows: SheetRow[]): void {
		this.close();

		const el = document.createElement('div');

		el.className = 'cab-sheet';
		el.dataset.o = this.orientation();
		el.innerHTML = `
			<div class="grab"></div>
			<header><h3>${title}</h3>
				<span class="x"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
			</header>
			<div class="body"></div>`;

		el.querySelector('.x')?.addEventListener('click', () => this.close());

		const body = el.querySelector('.body') as HTMLElement;

		for (const row of rows) {
			const item = document.createElement('button');

			item.className = row.readOnly ? 'row-item fact' : 'row-item';

			// Built as elements with textContent rather than innerHTML: these
			// rows now carry titles authored by other people (map names pulled
			// from MetroDreamin, and any profile a player pastes in). A map
			// called `<img src=x onerror=…>` must be a silly name, not script.
			if (row.badge) {
				const pill = document.createElement('span');
				const colour = row.badgeColor ?? '#4fb6ef';

				pill.className = 'pill';
				pill.style.background = `linear-gradient(180deg,${colour},${colour}bb)`;
				pill.textContent = row.badge;
				item.appendChild(pill);
			}

			const text = document.createElement('span');
			const title = document.createElement('span');

			title.className = 't';
			title.textContent = row.title;
			text.appendChild(title);

			if (row.subtitle || row.subtitleIcon) {
				const sub = document.createElement('span');

				sub.className = 's';

				if (row.subtitleIcon) {
					const ic = document.createElement('span');

					ic.className = 'ic';
					ic.textContent = row.subtitleIcon;
					sub.appendChild(ic);
				}

				if (row.subtitle) {
					sub.appendChild(document.createTextNode(row.subtitle));
				}

				text.appendChild(document.createElement('br'));
				text.appendChild(sub);
			}

			item.appendChild(text);

			if (!row.readOnly) {
				const go = document.createElement('span');

				go.className = 'go';
				go.textContent = '›';
				item.appendChild(go);
			}

			if (row.readOnly) {
				item.disabled = true;
			} else {
				item.addEventListener('click', () => {
					row.onSelect();
					if (!row.keepOpen) this.close();
				});
			}
			body.appendChild(item);
		}

		this.parent.appendChild(el);
		this.el = el;
		this.bodyEl = body;
		this.open = true;

		document.querySelector('.cab')?.classList.add('sheet-open');
	}

	/** Replace the contents without closing — used when the list changes underneath. */
	public setRows(rows: SheetRow[]): void {
		if (!this.open || !this.bodyEl) return;

		const title = this.el?.querySelector('h3')?.textContent ?? '';

		this.show(title, rows);
	}

	public close(): void {
		this.el?.remove();
		this.el = null;
		this.bodyEl = null;
		this.open = false;

		document.querySelector('.cab')?.classList.remove('sheet-open');
	}

	public toggle(title: string, rows: SheetRow[]): void {
		if (this.open) {
			this.close();
			return;
		}

		this.show(title, rows);
	}
}
