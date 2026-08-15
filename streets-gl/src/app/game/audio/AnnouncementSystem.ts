import System from '../../System';
import SettingsSystem from '../../systems/SettingsSystem';
import AudioSystem from './AudioSystem';

/**
 * Station announcements, spoken.
 *
 * The voice is the browser's own (`speechSynthesis`) — no audio assets, no
 * download, and it already speaks whatever language the device is set up for.
 * That matters more here than fidelity: the point is a child hearing their
 * station named as they pull in.
 *
 * Two rules the implementation exists to keep:
 *
 * 1. **Never queue.** `speechSynthesis` has an internal queue that does not
 *    drop anything, so a train running through stations faster than the voice
 *    can speak would build a backlog and end up announcing a station several
 *    stops after leaving it. Every announcement cancels what is still speaking.
 * 2. **Never speak the noise.** Station names in this data carry the local name
 *    and a short code alongside the Latin one ("Rosh ha'Ayin north <hebrew> RAN").
 *    An English voice reads the code letter by letter and mangles the rest, so
 *    only the Latin portion is spoken.
 */

/** Let the arrival chime land before the voice starts, as on a real train. */
const CHIME_HEADROOM_MS = 1100;

export default class AnnouncementSystem extends System {
	private readonly supported: boolean =
		typeof window !== 'undefined' && 'speechSynthesis' in window;

	private pendingTimer: ReturnType<typeof setTimeout> | null = null;
	private lastSpoken: string = '';

	public postInit(): void {
		// Nothing to unlock: unlike an AudioContext, speech synthesis is created
		// per utterance. iOS still wants a gesture first, which the start button
		// already provides long before the first station.
	}

	public update(): void {
		// Event-driven; nothing to do per frame.
	}

	/**
	 * Rolling in, while still moving. Deliberately NOT tied to the station
	 * state's `arriving` flag, which means `speed < 2 m/s` — i.e. already
	 * stopped at the platform. Announcing there is announcing a station you
	 * are looking at.
	 */
	public announceApproach(name: string, isTerminus: boolean, changeFor: string = ''): void {
		const stop = this.speakable(name);

		if (!stop) return;

		// "Change here for the B1-B2 and C6-C5 lines" — the sentence the
		// announcement has always been shaped to carry and never had.
		const head = isTerminus
			? `Now approaching ${stop}. This is the last stop.`
			: `Now approaching ${stop}.`;

		this.speakAfter(changeFor ? `${head} ${changeFor}` : head, CHIME_HEADROOM_MS);
	}

	/** Pulling away — what is coming up. */
	public announceNext(name: string): void {
		const stop = this.speakable(name);

		if (!stop) return;

		this.speakAfter(`The next station is ${stop}.`, 0);
	}

	public announceDoors(open: boolean): void {
		this.speakAfter(open ? 'Doors opening.' : 'Doors closing.', 0);
	}

	public cancel(): void {
		if (this.pendingTimer !== null) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
		}

		if (this.supported) {
			try {
				window.speechSynthesis.cancel();
			} catch {
				// A cancel that fails is not worth breaking a train journey over.
			}
		}
	}

	private enabled(): boolean {
		if (!this.supported) return false;

		const settings = this.systemManager.getSystem(SettingsSystem)?.settings;

		if (settings?.get('announcements')?.statusValue === 'off') return false;

		// Announcements are sound; muting the game mutes them too.
		return !this.systemManager.getSystem(AudioSystem)?.isMuted();
	}

	private speakAfter(text: string, delayMs: number): void {
		if (!this.enabled()) return;

		// The same line twice running is the sign of a state machine flapping,
		// not something a passenger needs to hear twice.
		if (text === this.lastSpoken) return;

		this.lastSpoken = text;
		this.cancel();

		const speak = (): void => {
			this.pendingTimer = null;

			if (!this.enabled()) return;

			try {
				const utterance = new SpeechSynthesisUtterance(text);

				// A shade under conversational: station announcements are slow
				// on purpose, and a child is listening for a name they know.
				utterance.rate = 0.95;
				utterance.pitch = 1.0;
				window.speechSynthesis.speak(utterance);
			} catch {
				// No voice available is a quiet failure, not a broken game.
			}
		};

		if (delayMs <= 0) {
			speak();
			return;
		}

		this.pendingTimer = setTimeout(speak, delayMs);
	}

	/**
	 * The part of a station name a voice can actually read: Latin letters and
	 * digits, minus a trailing short code.
	 */
	private speakable(name: string): string {
		if (!name) return '';

		const latin = name
			.replace(/[^A-Za-z0-9\s'’.\-]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		// Station codes ("RAN") and interchange markers ("C6", "A1") are for
		// reading, not for saying — "Tel aviv savidor central C6 B4 E3 P2" is a
		// sentence no announcer has ever spoken. Stripped repeatedly, because
		// removing one exposes the next: "Ben Gurion Airport (TLV) … BGN" loses
		// BGN and is then left ending in TLV.
		//
		// The separator trim has to run INSIDE the loop, not after it. Where the
		// local-language half of a name carries its own hyphen ("Hamifratz
		// Central - Terminating I2 <hebrew - hebrew> HMC"), removing the Hebrew
		// leaves that hyphen stranded at the end; dropping HMC then exposes a
		// dash rather than the next code, the loop stops, and I2 survives into
		// the announcement.
		let out = this.trimSeparators(latin);

		for (let i = 0; i < 6; i++) {
			const stripped = this.trimSeparators(
				out.replace(/\s+(?:[A-Z]{2,4}|[A-Z]{1,2}\d{1,2})$/, ''),
			);

			if (stripped === out || !stripped) break;

			out = stripped;
		}

		return out || latin;
	}

	/** Collapse the separator runs that removing a name's other half leaves. */
	private trimSeparators(text: string): string {
		return text
			.replace(/(?:\s*[-–—]\s*){2,}/g, ' - ')
			.replace(/^[\s.\-–—]+/, '')
			.replace(/[\s.\-–—]+$/, '')
			.trim();
	}
}
