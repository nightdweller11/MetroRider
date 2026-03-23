import type { ParsedLine } from '@/data/RouteParser';
import type { CameraMode } from '@/camera/CameraController';

export class HUD {
  private speedNum: HTMLElement;
  private speedArc: SVGCircleElement;
  private stationDiv: HTMLElement;
  private lineNameEl: HTMLElement;
  private lineDotEl: HTMLElement;
  private directionEl: HTMLElement;
  private camLabelEl: HTMLElement;
  private linesContainer: HTMLElement;
  private hudEl: HTMLElement;
  private passengerCountEl: HTMLElement;
  private accelBtn: HTMLElement;
  private brakeBtn: HTMLElement;
  private doorsBtn: HTMLElement;
  private toastContainer: HTMLElement;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentToast: HTMLElement | null = null;

  private onLineSelect: ((idx: number) => void) | null = null;
  private onCameraToggle: (() => void) | null = null;
  private onDoorsToggle: (() => void) | null = null;

  constructor() {
    this.speedNum = this.el('speed-num');
    this.speedArc = this.el('speed-arc') as unknown as SVGCircleElement;
    this.stationDiv = this.el('hud-station');
    this.lineNameEl = this.el('hud-line-name');
    this.lineDotEl = this.el('hud-line-dot');
    this.directionEl = this.el('hud-direction');
    this.camLabelEl = this.el('cam-label');
    this.linesContainer = this.el('hud-lines');
    this.hudEl = this.el('hud');
    this.passengerCountEl = this.el('passenger-count');
    this.accelBtn = this.el('btn-accel');
    this.brakeBtn = this.el('btn-brake');
    this.doorsBtn = this.el('btn-doors');
    this.toastContainer = this.el('toast-container');

    this.el('btn-camera').addEventListener('click', () => this.onCameraToggle?.());
    this.doorsBtn.addEventListener('click', () => this.onDoorsToggle?.());

    this.el('btn-change-map').addEventListener('click', () => {
      const showSelector = (window as unknown as Record<string, unknown>).__showMapSelector;
      if (typeof showSelector === 'function') {
        (showSelector as () => void)();
        this.hide();
      }
    });

    this.setupTouchButtons();
  }

  private el(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`HUD element #${id} not found`);
    return element;
  }

  private setupTouchButtons(): void {
    const setupBtn = (el: HTMLElement, key: string) => {
      const handler = (active: boolean) => {
        const ev = new KeyboardEvent(active ? 'keydown' : 'keyup', { key });
        document.dispatchEvent(ev);
      };
      el.addEventListener('mousedown', () => handler(true));
      el.addEventListener('mouseup', () => handler(false));
      el.addEventListener('mouseleave', () => handler(false));
      el.addEventListener('touchstart', (e) => { e.preventDefault(); handler(true); });
      el.addEventListener('touchend', (e) => { e.preventDefault(); handler(false); });
    };
    setupBtn(this.accelBtn, 'w');
    setupBtn(this.brakeBtn, 's');
  }

  setCallbacks(opts: {
    onLineSelect: (idx: number) => void;
    onCameraToggle: () => void;
    onDoorsToggle: () => void;
  }): void {
    this.onLineSelect = opts.onLineSelect;
    this.onCameraToggle = opts.onCameraToggle;
    this.onDoorsToggle = opts.onDoorsToggle;
  }

  show(): void {
    this.hudEl.classList.remove('hidden');
  }

  hide(): void {
    this.hudEl.classList.add('hidden');
  }

  buildLineSelector(lines: ParsedLine[]): void {
    this.linesContainer.innerHTML = '';
    lines.forEach((line, i) => {
      const btn = document.createElement('div');
      btn.className = 'line-btn';
      btn.style.setProperty('--lc', line.color);
      btn.dataset.idx = String(i);
      btn.innerHTML = `<span class="dot" style="background:${line.color}"></span>${line.name}`;
      btn.addEventListener('click', () => this.onLineSelect?.(i));
      this.linesContainer.appendChild(btn);
    });
  }

  setActiveLine(idx: number, line: ParsedLine, terminalName: string): void {
    this.lineNameEl.textContent = line.name;
    this.lineDotEl.style.color = line.color;
    this.directionEl.textContent = `\u2192 ${terminalName}`;

    const buttons = this.linesContainer.querySelectorAll('.line-btn');
    buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
  }

  setDirection(terminalName: string): void {
    this.directionEl.textContent = `\u2192 ${terminalName}`;
  }

  updateSpeed(speedMs: number, lineColor: string): void {
    const kmh = Math.round(speedMs * 3.6);
    this.speedNum.textContent = String(kmh);
    const pct = Math.min(kmh / 80, 1);
    (this.speedArc as unknown as SVGElement).style.strokeDashoffset = String(283 - pct * 213);
    const arcColor = pct > 0.8 ? '#ff4444' : pct > 0.5 ? '#ffaa00' : lineColor;
    (this.speedArc as unknown as SVGElement).style.stroke = arcColor;
  }

  updateStation(
    stationName: string,
    distAhead: number,
    arriving: boolean,
  ): void {
    if (arriving) {
      this.stationDiv.innerHTML = `
        <div class="station-arriving">
          <div class="label">Now Arriving</div>
          <div class="name">${stationName}</div>
        </div>`;
    } else if (stationName) {
      this.stationDiv.innerHTML = `
        <div class="station-next">
          <div class="label">Next Station</div>
          <div class="name">${stationName}</div>
          <div class="dist">${Math.round(distAhead)}m ahead</div>
        </div>`;
    }
  }

  updateControls(accel: boolean, brake: boolean, doors: boolean): void {
    this.accelBtn.classList.toggle('active', accel);
    this.brakeBtn.classList.toggle('active', brake);
    this.doorsBtn.classList.toggle('active', doors);
  }

  setCameraLabel(label: string): void {
    this.camLabelEl.textContent = label;
  }

  setPassengerCount(count: number): void {
    this.passengerCountEl.textContent = String(count);
  }

  showToast(big: string, small: string): void {
    if (this.currentToast) {
      this.currentToast.remove();
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="big">${big}</div><div class="small">${small}</div>`;
    this.toastContainer.appendChild(toast);
    this.currentToast = toast;

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.remove();
      this.currentToast = null;
    }, 2500);
  }

  showPersistentError(message: string): void {
    let banner = document.getElementById('error-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'error-banner';
      banner.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 300; max-width: 600px; padding: 24px 32px; border-radius: 12px;
        background: rgba(20,10,10,0.95); border: 1px solid rgba(255,60,60,0.4);
        backdrop-filter: blur(16px); font-family: monospace; text-align: center;
        pointer-events: auto;
      `;
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div style="color:#ff6666;font-size:14px;font-weight:600;margin-bottom:8px;">Tile Loading Failed</div>
      <div style="color:#aaa;font-size:12px;line-height:1.6;">${message}</div>
      <div style="color:#666;font-size:11px;margin-top:12px;">
        The game engine is running &mdash; controls, HUD, and physics are all active.<br>
        Fix the API key to see photorealistic 3D tiles.
      </div>
    `;
  }
}
