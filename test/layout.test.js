'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clampOpacity, clampPanelOpacity, dockPosition, priceOffsetX } = require('../src/layout');
const { OverlaySettings } = require('../src/settings');

const area = { x: 0, y: 0, width: 1920, height: 1040 };

test('docks to the top-left corner by default', () => {
  assert.deepStrictEqual(dockPosition(area, [340, 460]), { x: 8, y: 8 });
  assert.deepStrictEqual(dockPosition(area, [340, 460], 'bogus'), { x: 8, y: 8 });
});

test('docks to the other corners and respects work area offset', () => {
  assert.deepStrictEqual(dockPosition(area, [340, 460], 'top-right'), { x: 1572, y: 8 });
  assert.deepStrictEqual(dockPosition(area, [340, 460], 'bottom-left'), { x: 8, y: 572 });
  assert.deepStrictEqual(dockPosition({ x: 1920, y: 40, width: 1920, height: 1000 }, [340, 200], 'top-left'), { x: 1928, y: 48 });
});

test('offset pushes the panel beside another one but stays on screen', () => {
  assert.deepStrictEqual(dockPosition(area, [440, 220], 'top-left', { offsetX: 348 }), { x: 356, y: 8 });
  assert.deepStrictEqual(dockPosition(area, [440, 2000], 'top-left'), { x: 8, y: 0 });
});

test('price panel moves aside only when the leveling panel shares its corner', () => {
  assert.strictEqual(priceOffsetX('top-left', { enabled: true, corner: 'top-left' }), 348);
  assert.strictEqual(priceOffsetX('top-left', { enabled: false, corner: 'top-left' }), 0);
  assert.strictEqual(priceOffsetX('top-left', { corner: 'top-right' }), 0);
  assert.strictEqual(priceOffsetX('top-left', {}), 348);
  assert.strictEqual(priceOffsetX('top-left', undefined), 0);
});

test('opacity is clamped to a usable range', () => {
  assert.strictEqual(clampOpacity(0.6), 0.6);
  assert.strictEqual(clampOpacity(0), 0);
  assert.strictEqual(clampOpacity(-1), 0);
  assert.strictEqual(clampOpacity(5), 1);
  assert.strictEqual(clampOpacity('abc'), 0.35);
  assert.strictEqual(clampOpacity(0.123), 0.12);
  assert.strictEqual(clampPanelOpacity(0), 0.2);
  assert.strictEqual(clampPanelOpacity(undefined), 1);
  assert.strictEqual(clampPanelOpacity(0.5), 0.5);
});

test('overlay settings start from config, save slider changes and reload them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
  const file = path.join(dir, 'overlay-settings.json');
  const a = new OverlaySettings(file, { opacity: 0.5 });
  assert.deepStrictEqual(a.get(), { bgOpacity: 0.5, panelOpacity: 1 });
  assert.deepStrictEqual(a.set({ bgOpacity: 0.2, junk: 1 }), { bgOpacity: 0.2, panelOpacity: 1 });
  assert.deepStrictEqual(a.set({ panelOpacity: 0.05 }), { bgOpacity: 0.2, panelOpacity: 0.2 });
  a.flush();
  const b = new OverlaySettings(file, { opacity: 0.9 });
  assert.deepStrictEqual(b.get(), { bgOpacity: 0.2, panelOpacity: 0.2 });
  fs.writeFileSync(file, 'not json');
  assert.deepStrictEqual(new OverlaySettings(file, {}).get(), { bgOpacity: 0.35, panelOpacity: 1 });
  fs.rmSync(dir, { recursive: true });
});
