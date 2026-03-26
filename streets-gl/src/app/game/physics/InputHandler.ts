type KeyAction = 'throttle' | 'brake' | 'emergency' | 'horn' | 'doors' | 'reverse' | 'camera';

const KEY_MAP: Record<string, KeyAction> = {
	'ArrowUp': 'throttle',
	'KeyW': 'throttle',
	'ArrowDown': 'brake',
	'KeyS': 'brake',
	'Space': 'emergency',
	'KeyH': 'horn',
	'KeyD': 'doors',
	'KeyR': 'reverse',
	'KeyC': 'camera',
};

export class InputHandler {
	private held: Set<KeyAction> = new Set();
	private pressed: Set<KeyAction> = new Set();
	private enabled: boolean = false;

	public constructor() {
		window.addEventListener('keydown', (e: KeyboardEvent) => this.onKeyDown(e));
		window.addEventListener('keyup', (e: KeyboardEvent) => this.onKeyUp(e));
	}

	public enable(): void {
		this.enabled = true;
	}

	public disable(): void {
		this.enabled = false;
		this.held.clear();
		this.pressed.clear();
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (!this.enabled) return;

		const action = KEY_MAP[e.code];
		if (action) {
			if (!this.held.has(action)) {
				this.pressed.add(action);
			}
			this.held.add(action);
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (!this.enabled) return;

		const action = KEY_MAP[e.code];
		if (action) {
			this.held.delete(action);
		}
	}

	public isHeld(action: KeyAction): boolean {
		return this.held.has(action);
	}

	public wasPressed(action: KeyAction): boolean {
		return this.pressed.has(action);
	}

	public setHeld(action: KeyAction, value: boolean): void {
		if (value) {
			this.held.add(action);
		} else {
			this.held.delete(action);
		}
	}

	public consumePressed(): void {
		this.pressed.clear();
	}
}
