import {StopResult, verdictLabel} from './StopScorer';
import {RunResult, Badge} from './RunScorer';
import ProfileClient, {BoardEntry} from '../profiles/ProfileClient';
import {describeGhostDelta} from '../replay/GhostTrace';

/**
 * The two cards the player actually sees: a quick verdict after each stop, and
 * a summary at the end of a run.
 *
 * Same visual language as the release splash (dark card, one big line, plain
 * words). Nothing here blocks driving — the stop card fades on its own.
 */

const VERDICT_EMOJI: Record<string, string> = {
	perfect: '🎯',
	great: '👏',
	good: '👍',
	off: '📏',
	passed: '💨',
};

const VERDICT_COLOR: Record<string, string> = {
	perfect: '#5ad07a',
	great: '#7fb2ff',
	good: '#9ad',
	off: '#f0b429',
	passed: '#888',
};

export default class ScoreUI {
	private container: HTMLElement;
	private stopCardEl: HTMLElement | null = null;
	private stopCardTimer = 0;

	public constructor(container: HTMLElement) {
		this.container = container;
	}

	// ---- stop card ----

	public showStopCard(result: StopResult, stationName: string): void {
		this.hideStopCard();

		const card = document.createElement('div');
		card.id = 'stop-card';
		card.style.cssText = `
			position: absolute; top: 88px; left: 50%; transform: translateX(-50%);
			background: rgba(0,0,0,0.86); color: #fff; padding: 14px 20px;
			border-radius: 12px; text-align: center; pointer-events: none;
			border: 1px solid rgba(255,255,255,0.14); backdrop-filter: blur(8px);
			font-family: system-ui, -apple-system, sans-serif; min-width: 240px;
			transition: opacity 0.35s; opacity: 0;
		`;

		const headline = document.createElement('div');
		headline.style.cssText = `font-size: 19px; font-weight: 700; color: ${VERDICT_COLOR[result.verdict]};`;
		headline.textContent = `${VERDICT_EMOJI[result.verdict]} ${verdictLabel(result.verdict)}`;

		const where = document.createElement('div');
		where.style.cssText = 'font-size: 12px; color: #bbb; margin-top: 2px;';
		where.textContent = stationName;

		const detail = document.createElement('div');
		detail.style.cssText = 'font-size: 12px; color: #ddd; margin-top: 8px; line-height: 1.5;';

		if (result.verdict === 'passed') {
			detail.textContent = 'No stop made here';
		} else {
			const off = Math.abs(result.errorM);
			const where2 = result.errorM > 0 ? 'past the mark' : 'short of the mark';
			const brake = result.smoothness === 'smooth' ? 'smooth braking'
				: result.smoothness === 'firm' ? 'firm braking' : 'rough braking';
			const doors = result.doorsOk ? 'doors on time'
				: result.doorsOpened ? 'doors opened while moving' : 'doors stayed shut';
			detail.innerHTML =
				`${off < 0.5 ? 'right on the mark' : `${off.toFixed(1)} m ${where2}`} · ${brake}<br>${doors}`;
		}

		const points = document.createElement('div');
		points.style.cssText = 'font-size: 22px; font-weight: 800; margin-top: 8px;';
		points.textContent = `+${result.points}`;

		card.appendChild(headline);
		card.appendChild(where);
		card.appendChild(detail);
		card.appendChild(points);
		this.container.appendChild(card);
		this.stopCardEl = card;

		requestAnimationFrame(() => { card.style.opacity = '1'; });

		this.stopCardTimer = window.setTimeout(() => {
			card.style.opacity = '0';
			window.setTimeout(() => this.hideStopCard(), 400);
		}, 3200);
	}

	private hideStopCard(): void {
		if (this.stopCardTimer) {
			window.clearTimeout(this.stopCardTimer);
			this.stopCardTimer = 0;
		}
		this.stopCardEl?.remove();
		this.stopCardEl = null;
	}

	// ---- run card ----

	public async showRunCard(
		run: RunResult,
		badges: Badge[],
		isPersonalBest: boolean,
		best: number | null,
		ghost: {delta: number | null; improved: boolean; hadGhost: boolean} = {
			delta: null, improved: false, hadGhost: false,
		},
	): Promise<void> {
		const overlay = document.createElement('div');
		overlay.id = 'run-card';
		overlay.style.cssText = `
			position: fixed; inset: 0; background: rgba(0,0,0,0.55);
			display: flex; align-items: center; justify-content: center;
			z-index: 9500; pointer-events: auto; backdrop-filter: blur(3px);
		`;

		const card = document.createElement('div');
		card.style.cssText = `
			background: rgba(0,0,0,0.92); color: #fff; border-radius: 16px;
			padding: 24px; width: 420px; max-width: 94vw; max-height: 86vh; overflow-y: auto;
			border: 1px solid rgba(255,255,255,0.15);
			font-family: system-ui, -apple-system, sans-serif;
		`;

		const title = document.createElement('div');
		title.style.cssText = 'font-size: 20px; font-weight: 800;';
		title.textContent = run.completedLine ? '🏁 Line complete' : '🚉 Run finished';

		const line = document.createElement('div');
		line.style.cssText = 'font-size: 13px; color: #bbb; margin-bottom: 12px;';
		line.textContent = run.lineName;

		const total = document.createElement('div');
		total.style.cssText = 'font-size: 40px; font-weight: 900; line-height: 1;';
		total.textContent = String(run.totalPoints);

		const totalLabel = document.createElement('div');
		totalLabel.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 10px;';
		totalLabel.textContent = 'points';

		const pb = document.createElement('div');
		if (isPersonalBest) {
			pb.style.cssText = 'font-size: 13px; font-weight: 700; color: #5ad07a; margin-bottom: 10px;';
			pb.textContent = '⭐ Personal best!';
		} else if (best !== null) {
			pb.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 10px;';
			pb.textContent = `Your best on this line: ${best}`;
		} else {
			pb.style.cssText = 'font-size: 12px; color: #f0b429; margin-bottom: 10px;';
			pb.textContent = 'Sign in to keep your best runs';
		}

		const summary = document.createElement('div');
		summary.style.cssText = 'font-size: 13px; color: #ddd; margin-bottom: 14px;';
		summary.textContent = run.summary;

		// Timekeeping gets its own line rather than a number buried in the
		// sentence: it is the one part of the score that is not about the stops.
		const timing = document.createElement('div');
		if (run.punctualityPercent !== null) {
			const good = run.punctualityPercent >= 90;
			timing.style.cssText = `
				display: flex; justify-content: space-between; align-items: baseline;
				font-size: 13px; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px;
				background: ${good ? 'rgba(90,208,122,0.12)' : 'rgba(240,180,41,0.12)'};
				border: 1px solid ${good ? 'rgba(90,208,122,0.28)' : 'rgba(240,180,41,0.28)'};
			`;
			const label = document.createElement('span');
			label.style.color = good ? '#5ad07a' : '#f0b429';
			label.textContent = `⏱️ ${run.punctualityPercent}% on time`;
			const bonus = document.createElement('span');
			bonus.style.cssText = 'color: #ddd; font-weight: 700;';
			bonus.textContent = run.punctualityBonus > 0 ? `+${run.punctualityBonus}` : '—';
			timing.appendChild(label);
			timing.appendChild(bonus);
		}

		// Racing yourself gets its own row for the same reason timekeeping does:
		// it is not a component of the score, it is a different question about
		// the same run — was that quicker than last time?
		const race = document.createElement('div');
		if (ghost.hadGhost || ghost.improved) {
			const won = ghost.improved;
			race.style.cssText = `
				display: flex; justify-content: space-between; align-items: baseline;
				font-size: 13px; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px;
				background: ${won ? 'rgba(90,208,122,0.12)' : 'rgba(255,255,255,0.06)'};
				border: 1px solid ${won ? 'rgba(90,208,122,0.28)' : 'rgba(255,255,255,0.12)'};
			`;
			const label = document.createElement('span');
			label.style.color = won ? '#5ad07a' : '#ddd';
			label.textContent = ghost.hadGhost
				? `👻 ${describeGhostDelta(ghost.delta)}`
				: '👻 First run on this journey — a time to beat';
			const mark = document.createElement('span');
			mark.style.cssText = 'color: #ddd; font-weight: 700;';
			mark.textContent = won ? 'NEW BEST' : '';
			race.appendChild(label);
			race.appendChild(mark);
		}

		const stopList = document.createElement('div');
		stopList.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px;';
		for (const stop of run.stops) {
			const row = document.createElement('div');
			row.style.cssText = `
				display: flex; justify-content: space-between; font-size: 12px;
				padding: 5px 9px; border-radius: 6px; background: rgba(255,255,255,0.05);
			`;
			const left = document.createElement('span');
			left.style.color = VERDICT_COLOR[stop.verdict];
			left.textContent = `${VERDICT_EMOJI[stop.verdict]} ${verdictLabel(stop.verdict)}`;
			const right = document.createElement('span');
			right.textContent = stop.verdict === 'passed' ? '0' : `${stop.points}`;
			row.appendChild(left);
			row.appendChild(right);
			stopList.appendChild(row);
		}

		card.appendChild(title);
		card.appendChild(line);
		card.appendChild(total);
		card.appendChild(totalLabel);
		card.appendChild(pb);
		card.appendChild(summary);
		if (run.punctualityPercent !== null) card.appendChild(timing);
		if (ghost.hadGhost || ghost.improved) card.appendChild(race);
		card.appendChild(stopList);

		if (badges.length > 0) {
			const badgeWrap = document.createElement('div');
			badgeWrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;';
			for (const badge of badges) {
				const chip = document.createElement('div');
				chip.title = badge.description;
				chip.style.cssText = `
					font-size: 12px; padding: 5px 10px; border-radius: 999px;
					background: rgba(127,178,255,0.16); border: 1px solid rgba(127,178,255,0.3);
				`;
				chip.textContent = badge.label;
				badgeWrap.appendChild(chip);
			}
			card.appendChild(badgeWrap);
		}

		const boardWrap = document.createElement('div');
		boardWrap.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 14px;';
		boardWrap.textContent = 'Loading the board…';
		card.appendChild(boardWrap);

		const close = document.createElement('button');
		close.textContent = 'Keep driving';
		close.style.cssText = `
			padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer;
			background: #2f6df6; color: #fff; font-size: 14px; font-weight: 700; width: 100%;
		`;
		close.addEventListener('click', () => overlay.remove());
		card.appendChild(close);

		overlay.appendChild(card);
		overlay.addEventListener('click', ev => {
			if (ev.target === overlay) overlay.remove();
		});
		document.body.appendChild(overlay);

		const board = await ProfileClient.get().getBoard(run.mapId, run.lineId, 'run-score');
		this.renderBoard(boardWrap, board);
	}

	private renderBoard(target: HTMLElement, board: BoardEntry[]): void {
		target.innerHTML = '';
		if (board.length === 0) {
			// "Posted", not "saved": the same card can now say "46s faster than
			// your best" two rows above, and "no saved runs yet" underneath it
			// reads as a flat contradiction. The board is scores other drivers
			// have put up; your best time is your own and is kept either way.
			target.textContent = 'No scores posted on this line yet — yours will be the first.';
			return;
		}

		const heading = document.createElement('div');
		heading.style.cssText = 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 6px;';
		heading.textContent = 'Best runs on this line';
		target.appendChild(heading);

		board.slice(0, 5).forEach((entry, i) => {
			const row = document.createElement('div');
			row.style.cssText = 'display: flex; justify-content: space-between; color: #ddd; padding: 3px 0;';
			const name = document.createElement('span');
			name.textContent = `${i + 1}. ${entry.profileName}`;
			const value = document.createElement('span');
			value.textContent = String(entry.value);
			row.appendChild(name);
			row.appendChild(value);
			target.appendChild(row);
		});
	}
}
