const test = require('node:test');
const assert = require('node:assert');
const { parseItem, maxLinks } = require('../src/parser');
const items = require('./fixtures/items');

test('currency stack', () => {
  const i = parseItem(items.divine);
  assert.equal(i.rarity, 'Currency');
  assert.equal(i.baseType, 'Divine Orb');
  assert.equal(i.stackSize, 7);
});
test('6-link unique', () => {
  const i = parseItem(items.unique6l);
  assert.equal(i.name, "Kaom's Heart");
  assert.equal(i.baseType, 'Glorious Plate');
  assert.equal(i.links, 6);
  assert.equal(i.itemLevel, 84);
});
test('gem level, quality, corruption (requirement Level ignored)', () => {
  const i = parseItem(items.gem);
  assert.equal(i.gemLevel, 20);
  assert.equal(i.quality, 20);
  assert.equal(i.corrupted, true);
});
test('map tier', () => assert.equal(parseItem(items.map).mapTier, 16));
test('advanced copy (Ctrl+Alt+C) ignores { } lines', () => {
  const i = parseItem(items.rareAdvanced);
  assert.equal(i.baseType, 'Amethyst Ring');
  assert.equal(i.name, 'Storm Loop');
});
test('Windows line endings', () => assert.equal(parseItem(items.divine.replace(/\n/g, '\r\n')).stackSize, 7));
test('non-item text is ignored', () => assert.equal(parseItem(items.notItem), null));
test('maxLinks', () => {
  assert.equal(maxLinks('R-R R-R G B'), 2);
  assert.equal(maxLinks('R-G-B-B-R'), 5);
});
