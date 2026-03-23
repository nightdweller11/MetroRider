/**
 * Window Texture Test Script
 * Tests the math and logic for procedural window texture generation.
 * Canvas rendering itself is browser-only; this validates the parameters and UV math.
 * Run with: node test-window-textures.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ──────────────────────────────────────────────────
// TEST 1: Texture dimension constants
// ──────────────────────────────────────────────────
function testTextureConstants() {
  console.log('\n══ TEST 1: Texture dimension constants ══');

  const TEX_W = 128;
  const TEX_H = 256;
  const WINDOW_COLS = 4;
  const WINDOW_ROWS = 8;
  const LIT_RATIO = 0.35;

  assert(TEX_W > 0 && TEX_H > 0, `Texture dimensions: ${TEX_W}x${TEX_H}`);
  assert(Number.isInteger(TEX_W) && Number.isInteger(TEX_H), 'Texture dimensions are integers');
  assert(WINDOW_COLS > 0 && WINDOW_ROWS > 0, `Window grid: ${WINDOW_COLS}x${WINDOW_ROWS}`);
  assert(LIT_RATIO >= 0 && LIT_RATIO <= 1, `Lit ratio: ${LIT_RATIO} is in [0,1]`);

  const cellW = TEX_W / WINDOW_COLS;
  const cellH = TEX_H / WINDOW_ROWS;
  assert(cellW === 32, `Cell width: ${cellW}px (expected 32)`);
  assert(cellH === 32, `Cell height: ${cellH}px (expected 32)`);

  const winW = cellW * 0.55;
  const winH = cellH * 0.5;
  assert(winW > 0 && winW < cellW, `Window width: ${winW}px < cell width ${cellW}px`);
  assert(winH > 0 && winH < cellH, `Window height: ${winH}px < cell height ${cellH}px`);

  const padX = (cellW - winW) / 2;
  const padY = (cellH - winH) * 0.45;
  assert(padX > 0, `Horizontal padding: ${padX}px`);
  assert(padY > 0, `Vertical padding: ${padY}px`);

  const totalWindows = WINDOW_COLS * WINDOW_ROWS;
  console.log(`  Total windows per texture tile: ${totalWindows}`);
  assert(totalWindows === 32, `Total windows: ${totalWindows} (expected 32)`);
}

// ──────────────────────────────────────────────────
// TEST 2: UV tiling math
// ──────────────────────────────────────────────────
function testUVTiling() {
  console.log('\n══ TEST 2: UV tiling math ══');

  // The texture.repeat values used in BuildingGenerator
  const repeatX = 0.08;
  const repeatY = 0.12;

  // For ExtrudeGeometry, side UVs are in shape coordinates (meters)
  // The texture tiles every 1/repeatX meters horizontally, 1/repeatY meters vertically
  const tileWidthM = 1 / repeatX;
  const tileHeightM = 1 / repeatY;

  console.log(`  Texture tile: ${tileWidthM.toFixed(1)}m wide x ${tileHeightM.toFixed(1)}m tall`);
  assert(tileWidthM > 5 && tileWidthM < 30, `Tile width ${tileWidthM.toFixed(1)}m is reasonable (5-30m)`);
  assert(tileHeightM > 3 && tileHeightM < 20, `Tile height ${tileHeightM.toFixed(1)}m is reasonable (3-20m)`);

  const WINDOW_COLS = 4;
  const WINDOW_ROWS = 8;
  const windowSpacingX = tileWidthM / WINDOW_COLS;
  const windowSpacingY = tileHeightM / WINDOW_ROWS;

  console.log(`  Window spacing: ${windowSpacingX.toFixed(1)}m horizontal, ${windowSpacingY.toFixed(1)}m vertical`);
  assert(windowSpacingX > 1 && windowSpacingX < 10, `Horizontal window spacing ${windowSpacingX.toFixed(1)}m is reasonable`);
  assert(windowSpacingY > 0.5 && windowSpacingY < 5, `Vertical window spacing ${windowSpacingY.toFixed(1)}m is reasonable`);

  // For a typical building with 12m height and 40m perimeter:
  const testHeight = 12;
  const testPerimeter = 40;
  const tilesH = testPerimeter * repeatX;
  const tilesV = testHeight * repeatY;
  console.log(`  For a ${testPerimeter}m perimeter, ${testHeight}m tall building:`);
  console.log(`    Horizontal tiles: ${tilesH.toFixed(1)}, vertical tiles: ${tilesV.toFixed(1)}`);
  console.log(`    Windows visible: ~${(tilesH * WINDOW_COLS).toFixed(0)} across, ~${(tilesV * WINDOW_ROWS).toFixed(0)} tall`);
  assert(tilesH > 0.5, 'Building shows at least half a horizontal tile');
  assert(tilesV > 0.3, 'Building shows at least a third of a vertical tile');
}

// ──────────────────────────────────────────────────
// TEST 3: Lit window statistics (Monte Carlo)
// ──────────────────────────────────────────────────
function testLitWindowStats() {
  console.log('\n══ TEST 3: Lit window statistics ══');

  const LIT_RATIO = 0.35;
  const TOTAL_WINDOWS = 32;
  const TRIALS = 10000;

  let totalLit = 0;
  for (let t = 0; t < TRIALS; t++) {
    let lit = 0;
    for (let w = 0; w < TOTAL_WINDOWS; w++) {
      if (Math.random() < LIT_RATIO) lit++;
    }
    totalLit += lit;
  }

  const avgLit = totalLit / TRIALS;
  const expectedLit = TOTAL_WINDOWS * LIT_RATIO;
  const tolerance = 1.0;

  console.log(`  Expected lit windows per tile: ${expectedLit.toFixed(1)}`);
  console.log(`  Average lit windows (${TRIALS} trials): ${avgLit.toFixed(1)}`);
  assert(Math.abs(avgLit - expectedLit) < tolerance, `Monte Carlo average (${avgLit.toFixed(1)}) matches expected (${expectedLit.toFixed(1)}) within ${tolerance}`);
}

// ──────────────────────────────────────────────────
// TEST 4: Material properties validation
// ──────────────────────────────────────────────────
function testMaterialProperties() {
  console.log('\n══ TEST 4: Material properties validation ══');

  const roughness = 0.8;
  const metalness = 0.05;
  const emissiveColor = 0xffe8a0;
  const emissiveIntensity = 0.06;

  assert(roughness > 0 && roughness <= 1, `Roughness ${roughness} is in valid range`);
  assert(metalness >= 0 && metalness <= 1, `Metalness ${metalness} is in valid range`);
  assert(emissiveIntensity > 0 && emissiveIntensity < 1, `Emissive intensity ${emissiveIntensity} is subtle`);

  // Verify emissive color is warm (high R, moderate G, low-medium B)
  const r = (emissiveColor >> 16) & 0xff;
  const g = (emissiveColor >> 8) & 0xff;
  const b = emissiveColor & 0xff;
  console.log(`  Emissive color RGB: (${r}, ${g}, ${b})`);
  assert(r > g && g > b, 'Emissive color is warm (R > G > B)');
}

// ──────────────────────────────────────────────────
// TEST 5: Color bucket coverage
// ──────────────────────────────────────────────────
function testColorBuckets() {
  console.log('\n══ TEST 5: Color bucket coverage ══');

  const DEFAULT_BUILDING_COLORS = [
    0xd4c9b8, 0xc8bfb0, 0xb8ada0, 0xe0d5c5,
    0xc0b8a8, 0xd0c8b8, 0xbcb4a4, 0xe8ddd0,
    0xccc4b4, 0xd8d0c0,
  ];

  assert(DEFAULT_BUILDING_COLORS.length === 10, `${DEFAULT_BUILDING_COLORS.length} default colors`);

  // All colors should be distinct
  const uniqueColors = new Set(DEFAULT_BUILDING_COLORS);
  assert(uniqueColors.size === DEFAULT_BUILDING_COLORS.length, 'All default colors are distinct');

  // All colors should be neutral/warm tones (R >= G >= B, roughly)
  for (const c of DEFAULT_BUILDING_COLORS) {
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    assert(r >= b, `Color 0x${c.toString(16)} has R(${r}) >= B(${b}) (neutral/warm)`);
  }
}

// ──────────────────────────────────────────────────
// RUN ALL TESTS
// ──────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════╗');
console.log('║   MetroRider Window Texture Test Suite        ║');
console.log('╚══════════════════════════════════════════════╝');

testTextureConstants();
testUVTiling();
testLitWindowStats();
testMaterialProperties();
testColorBuckets();

console.log('\n════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
