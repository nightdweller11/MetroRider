import type { MetroMapData } from '@/data/RouteParser';
import { TEL_AVIV_METRO } from '@/data/SampleRoutes';
import { fetchMetroDreaminMap } from '@/data/MetroDreaminImporter';

const RECENT_MAPS_KEY = 'metrorider_recent_maps';
const MAX_RECENT = 5;

interface RecentMap {
  name: string;
  data: MetroMapData;
  timestamp: number;
}

export class MapSelector {
  private container: HTMLElement;
  private onMapSelected: (data: MetroMapData) => void;
  private errorEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    onMapSelected: (data: MetroMapData) => void,
  ) {
    this.container = container;
    this.onMapSelected = onMapSelected;
    this.render();
  }

  show(): void {
    this.container.classList.remove('hidden');
    this.refreshRecent();
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="map-selector">
        <div class="ms-header">
          <h1>MetroRider</h1>
          <p class="ms-sub">A 3D transit simulator with OSM-generated cities</p>
        </div>

        <div class="ms-section">
          <h2>Built-in Maps</h2>
          <div class="ms-cards" id="ms-builtin"></div>
        </div>

        <div class="ms-section">
          <h2>Import from MetroDreamin'</h2>
          <div class="ms-import-row">
            <input type="text" id="ms-md-url" placeholder="Paste MetroDreamin share URL..." />
            <button id="ms-md-load">Load</button>
          </div>
        </div>

        <div class="ms-section">
          <h2>Upload JSON Map</h2>
          <div class="ms-drop-zone" id="ms-drop-zone">
            <p>Drop a .json map file here or click to browse</p>
            <input type="file" id="ms-file-input" accept=".json" />
          </div>
        </div>

        <div class="ms-section" id="ms-recent-section">
          <h2>Recent Maps</h2>
          <div class="ms-cards" id="ms-recent"></div>
        </div>

        <div class="ms-loading hidden" id="ms-loading">
          <div class="loader"></div>
          <span>Loading map...</span>
        </div>

        <div class="ms-error" id="ms-error"></div>
      </div>
    `;

    this.errorEl = this.container.querySelector('#ms-error');
    this.loadingEl = this.container.querySelector('#ms-loading');

    this.renderBuiltinMaps();
    this.refreshRecent();
    this.attachEvents();
  }

  private renderBuiltinMaps(): void {
    const el = this.container.querySelector('#ms-builtin');
    if (!el) return;

    const builtins: { name: string; description: string; data: MetroMapData }[] = [
      {
        name: 'Tel Aviv Metro',
        description: '3 lines, 25 stations',
        data: TEL_AVIV_METRO,
      },
    ];

    el.innerHTML = builtins.map((m, i) => `
      <div class="ms-card" data-builtin="${i}">
        <div class="ms-card-name">${m.name}</div>
        <div class="ms-card-desc">${m.description}</div>
      </div>
    `).join('');

    el.querySelectorAll('.ms-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-builtin') || '0', 10);
        this.selectMap(builtins[idx].data);
      });
    });
  }

  private refreshRecent(): void {
    const section = this.container.querySelector('#ms-recent-section') as HTMLElement;
    const el = this.container.querySelector('#ms-recent');
    if (!el || !section) return;

    const recent = this.getRecentMaps();
    if (recent.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    el.innerHTML = recent.map((m, i) => {
      const ago = this.timeAgo(m.timestamp);
      const lineCount = m.data.lines?.length ?? 0;
      const stationCount = Object.keys(m.data.stations ?? {}).length;
      return `
        <div class="ms-card" data-recent="${i}">
          <div class="ms-card-name">${this.escapeHtml(m.name)}</div>
          <div class="ms-card-desc">${lineCount} lines, ${stationCount} stations &middot; ${ago}</div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.ms-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-recent') || '0', 10);
        this.selectMap(recent[idx].data);
      });
    });
  }

  private attachEvents(): void {
    const mdLoadBtn = this.container.querySelector('#ms-md-load');
    const mdUrlInput = this.container.querySelector('#ms-md-url') as HTMLInputElement;

    mdLoadBtn?.addEventListener('click', () => this.loadMetroDreamin(mdUrlInput?.value));
    mdUrlInput?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.loadMetroDreamin(mdUrlInput.value);
    });

    const dropZone = this.container.querySelector('#ms-drop-zone');
    const fileInput = this.container.querySelector('#ms-file-input') as HTMLInputElement;

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      (dropZone as HTMLElement).classList.add('ms-drag-over');
    });
    dropZone?.addEventListener('dragleave', () => {
      (dropZone as HTMLElement).classList.remove('ms-drag-over');
    });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      (dropZone as HTMLElement).classList.remove('ms-drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this.loadFile(file);
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.loadFile(file);
    });
  }

  private async loadMetroDreamin(url: string | undefined): Promise<void> {
    if (!url || !url.trim()) {
      this.showError('Please paste a MetroDreamin share URL');
      return;
    }

    this.showLoading(true);
    this.showError('');

    try {
      const data = await fetchMetroDreaminMap(url.trim());
      this.selectMap(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MapSelector] MetroDreamin import failed:', msg);
      this.showError(`Import failed: ${msg}`);
      this.showLoading(false);
    }
  }

  private loadFile(file: File): void {
    if (!file.name.endsWith('.json')) {
      this.showError('Please select a .json file');
      return;
    }

    this.showLoading(true);
    this.showError('');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as MetroMapData;
        if (!data.stations || !data.lines) {
          throw new Error('Invalid map file: missing stations or lines');
        }
        this.selectMap(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MapSelector] File parse failed:', msg);
        this.showError(`Failed to parse file: ${msg}`);
        this.showLoading(false);
      }
    };
    reader.onerror = () => {
      console.error('[MapSelector] File read error:', reader.error);
      this.showError('Failed to read file');
      this.showLoading(false);
    };
    reader.readAsText(file);
  }

  private selectMap(data: MetroMapData): void {
    this.showLoading(false);
    this.showError('');
    this.saveRecentMap(data);
    this.onMapSelected(data);
  }

  private showError(msg: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = msg;
      this.errorEl.classList.toggle('hidden', !msg);
    }
  }

  private showLoading(show: boolean): void {
    if (this.loadingEl) {
      this.loadingEl.classList.toggle('hidden', !show);
    }
  }

  private getRecentMaps(): RecentMap[] {
    try {
      const raw = localStorage.getItem(RECENT_MAPS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as RecentMap[];
    } catch {
      return [];
    }
  }

  private saveRecentMap(data: MetroMapData): void {
    try {
      const recent = this.getRecentMaps();
      const existing = recent.findIndex(r => r.name === data.name);
      if (existing >= 0) recent.splice(existing, 1);
      recent.unshift({ name: data.name, data, timestamp: Date.now() });
      while (recent.length > MAX_RECENT) recent.pop();
      localStorage.setItem(RECENT_MAPS_KEY, JSON.stringify(recent));
    } catch (err) {
      console.error('[MapSelector] Failed to save recent map:', err);
    }
  }

  private timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
