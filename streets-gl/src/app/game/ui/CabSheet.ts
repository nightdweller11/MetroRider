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
.cab-sheet{position:fixed;display:flex;flex-direction:column;overflow:hidden;z-index:50;
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
.cab-sheet .row-item .t{font-weight:800;font-size:14px}
.cab-sheet .row-item .s{color:#5d6f81;font-size:11.5px;font-weight:600}
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
			item.innerHTML =
				(row.badge ? `<span class="pill" style="background:linear-gradient(180deg,${row.badgeColor ?? '#4fb6ef'},${row.badgeColor ?? '#4fb6ef'}bb)">${row.badge}</span>` : '') +
				`<span><span class="t">${row.title}</span>${row.subtitle ? `<br><span class="s">${row.subtitle}</span>` : ''}</span>` +
				(row.readOnly ? '' : '<span class="go">›</span>');

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
