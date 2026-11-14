'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { clampOpacity, dockPosition, priceOffsetX } = require('../src/layout');

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
  assert.strictEqual(clampOpacity(0), 0.1);
  assert.strictEqual(clampOpacity(5), 1);
  assert.strictEqual(clampOpacity('abc'), 0.6);
});
