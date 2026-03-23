import { Game } from '@/core/Game';
import { MapSelector } from '@/ui/MapSelector';
import type { MetroMapData } from '@/data/RouteParser';

let game: Game | null = null;
let mapSelector: MapSelector | null = null;

function getElements() {
  return {
    selectorScreen: document.getElementById('map-selector-screen')!,
    loadingOverlay: document.getElementById('loading-overlay')!,
    canvas: document.getElementById('game-canvas') as HTMLCanvasElement,
  };
}

async function loadMap(data: MetroMapData) {
  const els = getElements();

  mapSelector?.hide();
  els.loadingOverlay.classList.remove('hidden');

  try {
    if (!game) {
      game = new Game(els.canvas);
    }

    await game.loadMap(data);
    game.start();

    setTimeout(() => {
      els.loadingOverlay.classList.add('hidden');
    }, 500);
  } catch (err) {
    console.error('Failed to load map:', err);
    const msg = err instanceof Error ? err.message : String(err);
    els.loadingOverlay.classList.add('hidden');
    mapSelector?.show();
    alert(`Failed to load map: ${msg}`);
  }
}

function showMapSelector() {
  const els = getElements();
  els.loadingOverlay.classList.add('hidden');

  if (game) {
    game.stop();
  }

  mapSelector?.show();
}

document.addEventListener('DOMContentLoaded', () => {
  const els = getElements();

  els.loadingOverlay.classList.add('hidden');

  mapSelector = new MapSelector(els.selectorScreen, (data) => {
    loadMap(data);
  });

  mapSelector.show();

  // Expose for the HUD "change map" button
  (window as unknown as Record<string, unknown>).__showMapSelector = showMapSelector;
});

// Drag-and-drop map upload (works globally, even during gameplay)
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file || !file.name.endsWith('.json')) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result as string);
      if (data.stations && data.lines) {
        await loadMap(data);
      } else {
        console.error('Invalid map file: missing stations or lines');
      }
    } catch (err) {
      console.error('Failed to parse map file:', err);
    }
  };
  reader.onerror = () => {
    console.error('Failed to read file:', reader.error);
  };
  reader.readAsText(file);
});
