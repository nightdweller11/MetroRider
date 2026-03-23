export type InputAction =
  | 'accelerate'
  | 'brake'
  | 'emergency'
  | 'doors'
  | 'camera'
  | 'reverse'
  | 'line1' | 'line2' | 'line3' | 'line4' | 'line5'
  | 'line6' | 'line7' | 'line8' | 'line9';

const KEY_MAP: Record<string, InputAction | undefined> = {
  'w': 'accelerate',
  'arrowup': 'accelerate',
  's': 'brake',
  'arrowdown': 'brake',
  ' ': 'emergency',
  'd': 'doors',
  'c': 'camera',
  'r': 'reverse',
  '1': 'line1',
  '2': 'line2',
  '3': 'line3',
  '4': 'line4',
  '5': 'line5',
  '6': 'line6',
  '7': 'line7',
  '8': 'line8',
  '9': 'line9',
};

export class InputHandler {
  private held: Set<InputAction> = new Set();
  private justPressed: Set<InputAction> = new Set();

  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this.onKeyDown = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.key.toLowerCase()];
      if (action) {
        if (!this.held.has(action)) {
          this.justPressed.add(action);
        }
        this.held.add(action);
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.key.toLowerCase()];
      if (action) {
        this.held.delete(action);
      }
    };

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  wasJustPressed(action: InputAction): boolean {
    return this.justPressed.has(action);
  }

  /**
   * Call at end of frame to clear single-press events.
   */
  endFrame(): void {
    this.justPressed.clear();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }
}
