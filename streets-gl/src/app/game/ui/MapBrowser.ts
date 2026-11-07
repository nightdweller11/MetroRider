/**
 * The start screen's map lists: Featured, and Recent.
 *
 * Each map is shown as what it is — a small picture of its own lines
 * (`renderMapThumbnail`), drawn from data the game already holds, never a
 * fetch per row. Featured is a row of cards you can swipe along; Recent is a
 * list that says when you last drove each map and how much of it you have
 * driven.
 *
 * The start screen is the first thing a nine-year-old sees, so both stay
 * quiet: one picture, one name, one or two short lines of grey under it.
 *
 * DOM only; every decision about what to show is made by the caller from the
 * pure modules (`MapLibrary`, `FeaturedMaps`).
 */

import {renderMapThumbnail, type MapSketch} from '../data/MapThumbnail';
import type {FeaturedCardModel, RecentRowModel} from '../data/MapBrowserModel';

const STYLE_ID = 'map-browser-style';

const CSS = `
.mb-head{font-size:11px;font-weight:700;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px}
.mb-rail{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent;-webkit-overflow-scrolling:touch}
.mb-card{flex:0 0 108px;scroll-snap-align:start;display:flex;flex-direction:column;gap:5px;padding:6px;
  border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);
  cursor:pointer;color:#ddd;text-align:left;font:inherit;transition:background .12s,border-color .12s}
.mb-card:hover,.mb-card:focus-visible{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.4);outline:none}
.mb-card .mb-name{font-size:12px;font-weight:600;line-height:1.25;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mb-card .mb-meta{font-size:10.5px;color:#888;font-weight:500}
.mb-thumb{display:block;flex:0 0 auto;line-height:0;border-radius:7px;overflow:hidden}
.mb-thumb svg{display:block}
.mb-list{max-height:220px;overflow-y:auto}
.mb-row{display:flex;align-items:center;gap:10px;padding:6px 8px;margin-bottom:3px;border-radius:8px;
  background:rgba(255,255,255,.05);cursor:pointer;transition:background .12s}
.mb-row:hover{background:rgba(59,130,246,.15)}
.mb-row.user:hover{background:rgba(168,85,247,.15)}
.mb-row .mb-text{flex:1;min-width:0}
.mb-row .mb-name{font-size:13px;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mb-row .mb-meta{font-size:11px;color:#888;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mb-row .mb-driven{color:#7fc8a3}
.mb-row .mb-tag{font-size:10px;font-weight:700;color:#a855f7;background:rgba(168,85,247,.15);
  padding:2px 6px;border-radius:4px;flex-shrink:0}
.mb-row .mb-x{font-size:12px;color:#666;cursor:pointer;padding:6px 8px;border-radius:4px;flex-shrink:0}
.mb-row .mb-x:hover{color:#ef4444}
`;

function ensureStyle(): void {
	if (document.getElementById(STYLE_ID)) return;

	const style = document.createElement('style');

	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

/**
 * A map's picture as an element. The markup comes from our own renderer,
 * which writes only numbers, sanitised colours and its own counts — no text
 * from the map — so it is safe as innerHTML.
 */
export function thumbElement(sketch: MapSketch | null, width: number, height: number): HTMLElement {
	const el = document.createElement('span');

	el.className = 'mb-thumb';
	el.style.width = `${width}px`;
	el.style.height = `${height}px`;

	if (sketch) {
		el.innerHTML = renderMapThumbnail(sketch, width, height);
	} else {
		// Not driven yet and not Featured: nothing true to draw, so a plain
		// tile rather than a made-up picture.
		el.style.background = '#0e1720';
		el.setAttribute('aria-hidden', 'true');
	}

	return el;
}

type FeaturedCard = Pick<FeaturedCardModel, 'key' | 'title' | 'sketch' | 'meta'>;

export function featuredRail(cards: readonly FeaturedCard[], onPick: (key: string) => void): HTMLElement {
	ensureStyle();

	const section = document.createElement('div');

	section.id = 'start-featured';
	section.style.cssText = 'margin-top: 14px; text-align: left;';

	const head = document.createElement('div');

	head.className = 'mb-head';
	head.textContent = 'Featured';
	section.appendChild(head);

	const rail = document.createElement('div');

	rail.className = 'mb-rail';

	for (const card of cards) {
		const button = document.createElement('button');

		button.type = 'button';
		button.className = 'mb-card';
		button.dataset.key = card.key;
		button.title = card.title;
		button.appendChild(thumbElement(card.sketch, 96, 64));

		const name = document.createElement('span');

		name.className = 'mb-name';
		name.textContent = card.title;
		button.appendChild(name);

		const meta = document.createElement('span');

		meta.className = 'mb-meta';
		meta.textContent = card.meta;
		button.appendChild(meta);

		button.addEventListener('click', () => onPick(card.key));
		rail.appendChild(button);
	}

	section.appendChild(rail);

	return section;
}

type RecentRow = RecentRowModel;

/** Fills `section` with the Recent list (or leaves it empty when there is none). */
export function renderRecentList(
	section: HTMLElement,
	rows: readonly RecentRow[],
	onPick: (row: RecentRow) => void,
	onRemove: (row: RecentRow) => void,
): void {
	ensureStyle();
	section.innerHTML = '';
	section.id = 'start-recents';

	if (rows.length === 0) return;

	const head = document.createElement('div');

	head.className = 'mb-head';
	head.textContent = 'Recent';
	section.appendChild(head);

	const list = document.createElement('div');

	list.className = 'mb-list';

	for (const row of rows) {
		const el = document.createElement('div');

		el.className = row.isUser ? 'mb-row user' : 'mb-row';
		el.dataset.key = row.key;

		if (row.isUser) {
			const tag = document.createElement('span');

			tag.className = 'mb-tag';
			tag.textContent = 'USER';
			el.appendChild(tag);
		} else {
			el.appendChild(thumbElement(row.sketch, 52, 36));
		}

		const text = document.createElement('div');

		text.className = 'mb-text';

		const name = document.createElement('div');

		name.className = 'mb-name';
		name.textContent = row.name;
		name.title = row.name;
		text.appendChild(name);

		// One line of facts, two at most: what the map is, then what you did
		// on it. Either is left out when there is nothing true to say.
		for (const [line, cls] of [[row.counts, 'mb-meta'], [row.driven, 'mb-meta mb-driven']] as const) {
			if (!line) continue;

			const meta = document.createElement('div');

			meta.className = cls;
			meta.textContent = line;
			text.appendChild(meta);
		}

		el.appendChild(text);

		const remove = document.createElement('div');

		remove.className = 'mb-x';
		remove.textContent = '✕';
		remove.title = 'Remove from recent';
		remove.addEventListener('click', (ev) => {
			ev.stopPropagation();
			onRemove(row);
		});
		el.appendChild(remove);

		el.addEventListener('click', () => onPick(row));
		list.appendChild(el);
	}

	section.appendChild(list);
}
