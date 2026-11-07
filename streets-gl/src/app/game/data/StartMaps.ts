import type {MetroMapData} from './RouteParser';
import {TEL_AVIV_METRO} from './SampleRoutes';

/**
 * The map behind "Play Sample Map (Tel Aviv)": the three-line Tel Aviv metro
 * that ships inside the game, not anything fetched from MetroDreamin.
 *
 * The button used to just start whatever map was loaded — and since the start
 * screen began auto-loading the Israel Railways MetroDreamin map, that was
 * always the MetroDreamin one, so the "sample" never opened the sample.
 */
export const SAMPLE_MAP: MetroMapData = TEL_AVIV_METRO;

/**
 * Latest-wins guard for map loads started from the start screen.
 *
 * The MetroDreamin map is fetched in the background as soon as the screen
 * opens. If the player picks the sample before that fetch returns, the fetch
 * must not land afterwards and swap the sample back out from under them.
 */
export class LatestLoad {
	private seq = 0;

	/** Start a load; returns the ticket that load checks before applying. */
	public begin(): number {
		return ++this.seq;
	}

	/** Whether the load holding this ticket is still the one the player wants. */
	public isCurrent(ticket: number): boolean {
		return ticket === this.seq;
	}
}
