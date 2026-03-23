# MetroRider

A 3D transit simulator that renders metro/bus/tram routes on Google Photorealistic 3D Tiles. Built with Three.js and TypeScript.

## Prerequisites

- Node.js 18+
- A [Google Maps API key](https://developers.google.com/maps/documentation/tile/get-api-key) with the **Map Tiles API** enabled

## Quick Start

```bash
cd app
npm install
npm run dev
```

Open `http://localhost:3000`, paste your Google Maps API key, and hit Launch.

## Controls

| Key | Action |
|-----|--------|
| W / Arrow Up | Accelerate |
| S / Arrow Down | Brake |
| Space | Emergency brake |
| D | Open/close doors |
| C | Cycle camera mode (Cab / Chase / Orbit / Overview) |
| R | Reverse direction |
| 1-9 | Switch line |

## Camera Modes

- **Cab View** — first-person from the front of the train
- **Chase Cam** — third-person behind the train
- **Orbit** — automatically orbits around the train
- **Overview** — free camera controlled by mouse (GlobeControls)

## Loading Custom Maps

Drag and drop a MetroDreamin'-format JSON file onto the game window. The format is:

```json
{
  "name": "My Metro",
  "stations": {
    "s1": { "name": "Station A", "lat": 32.07, "lng": 34.78 },
    "s2": { "name": "Station B", "lat": 32.08, "lng": 34.79 }
  },
  "lines": [
    {
      "id": "line1",
      "name": "Red Line",
      "color": "#e61e25",
      "stationIds": ["s1", "s2"]
    }
  ]
}
```

## Project Structure

```
src/
  core/          Game loop, coordinate transforms
  world/         Tile loading, track geometry
  vehicles/      Train model, multi-car articulation
  camera/        Camera modes and transitions
  gameplay/      Station management, passengers
  ui/            HUD, input handling, settings
  data/          Route parsing, sample data
```

## Tech Stack

- **Three.js** — 3D rendering
- **3DTilesRendererJS** — Google Photorealistic 3D Tiles
- **TypeScript** — type safety
- **Vite** — build tool with HMR
