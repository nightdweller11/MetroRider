import ProfileClient, {PlayerProfile} from './ProfileClient';

/**
 * "Who's driving?" — the profile picker on the start card, plus the name chip
 * in the HUD.
 *
 * Deliberately tiny: names and a 4-digit PIN, no email, no password rules.
 * Everything works signed out; a profile only decides whether your best runs
 * follow you to another device.
 */

const CARD_BG = 'rgba(0,0,0,0.92)';

function button(label: string, primary = false): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.textContent = label;
	btn.style.cssText = `
		padding: 9px 16px; border-radius: 8px; cursor: pointer;
		font-size: 13px; font-weight: 600; border: none;
		background: ${primary ? '#2f6df6' : 'rgba(255,255,255,0.12)'};
		color: #fff; pointer-events: auto;
	`;
	return btn;
}

export default class ProfileUI {
	private readonly client = ProfileClient.get();
	private rowEl: HTMLElement | null = null;
	private chipEl: HTMLElement | null = null;
	private modalEl: HTMLElement | null = null;

	/** The "Who's driving?" row, to drop into the start card. */
	public createStartRow(): HTMLElement {
		const row = document.createElement('div');
		row.id = 'profile-row';
		row.style.cssText = `
			display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
			margin: 0 0 14px; padding: 10px 12px; border-radius: 10px;
			background: rgba(255,255,255,0.06); font-size: 12px; text-align: left;
		`;
		this.rowEl = row;
		this.renderRow();

		this.client.onChange(() => {
			this.renderRow();
			this.renderChip();
		});

		void this.client.restore();
		return row;
	}

	/** The name chip for the HUD (returns null when signed out). */
	public createHudChip(): HTMLElement {
		const chip = document.createElement('div');
		chip.id = 'profile-chip';
		chip.style.cssText = `
			position: absolute; bottom: 14px; left: 14px;
			background: rgba(0,0,0,0.62); color: #fff; padding: 5px 12px;
			border-radius: 999px; font-size: 12px; font-weight: 600;
			pointer-events: auto; cursor: pointer; display: none;
			border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);
		`;
		chip.title = 'Who is driving';
		chip.addEventListener('click', () => this.openModal());
		this.chipEl = chip;
		this.renderChip();
		return chip;
	}

	private renderChip(): void {
		if (!this.chipEl) return;
		const profile = this.client.getProfile();
		if (profile) {
			this.chipEl.textContent = `🧑‍✈️ ${profile.name}`;
			this.chipEl.style.display = 'block';
		} else {
			this.chipEl.style.display = 'none';
		}
	}

	private renderRow(): void {
		const row = this.rowEl;
		if (!row) return;
		row.innerHTML = '';

		const profile = this.client.getProfile();

		const label = document.createElement('div');
		label.style.cssText = 'color: #aaa; margin-right: 2px;';
		label.textContent = profile ? 'Driving as' : "Who's driving?";
		row.appendChild(label);

		if (profile) {
			const name = document.createElement('div');
			name.textContent = profile.name;
			name.style.cssText = 'font-weight: 700; font-size: 13px; color: #fff;';
			row.appendChild(name);

			const queued = this.client.getQueuedCount();
			if (queued > 0) {
				const pending = document.createElement('div');
				pending.textContent = `${queued} run${queued === 1 ? '' : 's'} waiting to save`;
				pending.style.cssText = 'color: #f0b429; font-size: 11px;';
				row.appendChild(pending);
			}

			const switchBtn = button('Switch');
			switchBtn.addEventListener('click', () => this.openModal());
			row.appendChild(switchBtn);
		} else {
			const hint = document.createElement('div');
			hint.textContent = 'Play as guest, or sign in so your best runs are saved.';
			hint.style.cssText = 'color: #888; flex: 1 1 100%; font-size: 11px;';

			const signIn = button('Sign in / New driver', true);
			signIn.addEventListener('click', () => this.openModal());
			row.appendChild(signIn);
			row.appendChild(hint);
		}
	}

	// ---- modal ----

	public openModal(): void {
		if (this.modalEl) return;

		const overlay = document.createElement('div');
		overlay.id = 'profile-modal';
		overlay.style.cssText = `
			position: fixed; inset: 0; background: rgba(0,0,0,0.6);
			display: flex; align-items: center; justify-content: center;
			z-index: 10000; pointer-events: auto; backdrop-filter: blur(3px);
		`;

		const card = document.createElement('div');
		card.style.cssText = `
			background: ${CARD_BG}; color: #fff; border-radius: 14px;
			padding: 22px; width: 340px; max-width: 92vw;
			border: 1px solid rgba(255,255,255,0.15);
			font-family: system-ui, -apple-system, sans-serif;
		`;

		const title = document.createElement('div');
		title.textContent = "Who's driving?";
		title.style.cssText = 'font-size: 18px; font-weight: 700; margin-bottom: 4px;';

		const sub = document.createElement('div');
		sub.textContent = 'A name and a 4-digit PIN. No email, nothing else.';
		sub.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 14px;';

		const existing = document.createElement('div');
		existing.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;';

		const nameInput = document.createElement('input');
		nameInput.type = 'text';
		nameInput.placeholder = 'Driver name';
		nameInput.maxLength = 24;
		nameInput.style.cssText = `
			width: 100%; box-sizing: border-box; padding: 9px 12px; margin-bottom: 8px;
			border-radius: 8px; border: 1px solid rgba(255,255,255,0.18);
			background: rgba(255,255,255,0.06); color: #fff; font-size: 14px;
		`;

		const pinInput = document.createElement('input');
		pinInput.type = 'password';
		pinInput.inputMode = 'numeric';
		pinInput.placeholder = '4-digit PIN';
		pinInput.maxLength = 4;
		pinInput.style.cssText = nameInput.style.cssText;

		const status = document.createElement('div');
		status.style.cssText = 'font-size: 12px; min-height: 18px; margin: 6px 0 10px; color: #f0b429;';

		const actions = document.createElement('div');
		actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

		const signInBtn = button('Sign in', true);
		const createBtn = button('New driver');
		const guestBtn = button('Play as guest');

		const close = (): void => {
			overlay.remove();
			this.modalEl = null;
		};

		const run = async (action: 'login' | 'create'): Promise<void> => {
			const name = nameInput.value.trim();
			const pin = pinInput.value.trim();
			if (!name || !pin) {
				status.textContent = 'Enter a name and a 4-digit PIN.';
				return;
			}
			status.style.color = '#9ad';
			status.textContent = action === 'login' ? 'Signing in…' : 'Creating…';
			try {
				const profile = action === 'login'
					? await this.client.login(name, pin)
					: await this.client.createProfile(name, pin);
				status.style.color = '#5ad07a';
				status.textContent = `Hello, ${profile.name}!`;
				const flushed = await this.client.flushQueue();
				const setup = await this.client.syncSetup();
				const notes: string[] = [];
				if (flushed > 0) notes.push(`saved ${flushed} earlier run${flushed === 1 ? '' : 's'}`);
				if (setup === 'restored') notes.push('restored your train setup');
				if (notes.length > 0) status.textContent = `Hello, ${profile.name} — ${notes.join(' and ')}.`;
				setTimeout(close, 700);
			} catch (err) {
				status.style.color = '#f0b429';
				status.textContent = err instanceof Error ? err.message : 'Could not sign in';
			}
		};

		signInBtn.addEventListener('click', () => void run('login'));
		createBtn.addEventListener('click', () => void run('create'));
		guestBtn.addEventListener('click', close);
		pinInput.addEventListener('keydown', ev => {
			if ((ev as KeyboardEvent).key === 'Enter') void run('login');
		});

		const current = this.client.getProfile();
		if (current) {
			const signOut = button('Sign out');
			signOut.addEventListener('click', () => {
				void this.client.logout().then(close);
			});
			actions.appendChild(signOut);
		}

		actions.appendChild(signInBtn);
		actions.appendChild(createBtn);
		actions.appendChild(guestBtn);

		card.appendChild(title);
		card.appendChild(sub);
		card.appendChild(existing);
		card.appendChild(nameInput);
		card.appendChild(pinInput);
		card.appendChild(status);
		card.appendChild(actions);
		overlay.appendChild(card);
		overlay.addEventListener('click', ev => {
			if (ev.target === overlay) close();
		});

		document.body.appendChild(overlay);
		this.modalEl = overlay;
		nameInput.focus();

		// One tap per driver already on this server — kids should not have to
		// type their own name correctly to get their scores back.
		void this.client.listProfiles().then((profiles: PlayerProfile[]) => {
			if (profiles.length === 0) return;
			const hint = document.createElement('div');
			hint.textContent = 'On this server:';
			hint.style.cssText = 'font-size: 11px; color: #888; flex: 1 1 100%;';
			existing.appendChild(hint);
			for (const p of profiles.slice(0, 8)) {
				const chip = button(p.name);
				chip.style.padding = '6px 12px';
				chip.addEventListener('click', () => {
					nameInput.value = p.name;
					pinInput.focus();
				});
				existing.appendChild(chip);
			}
		});
	}
}
