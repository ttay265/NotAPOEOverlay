'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { loadCatalog, matchSkill, matchArchetype } = require('../src/merc/catalog');
const { headerInfo, mercFromOcr, mercFromText } = require('../src/merc/parse');
const { layout, binarize, encodeBmp, countSupports } = require('../src/merc/screen');
const { buildMercQuery, valueHints } = require('../src/merc/query');
const { MercReader } = require('../src/merc/reader');

const catalog = loadCatalog();
const fixture = () => PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'merc-window-1600p.png')));

test('skill names survive typical OCR noise', () => {
  const cases = {
    'BLADE TRAP': 'Blade Trap',
    'TRARTHAN AcIITY oo': 'Trarthan Agility',
    'SPECTRAL Heux OF TRARTHUS i': 'Spectral Helix of Trarthus',
    'SPECTRAL THROW OF TRARTHUS': 'Spectral Throw of Trarthus',
    'GRACE | oo': 'Grace',
    'FLAME DASH oo': 'Flame Dash',
    'SPECTRAL HELIX': 'Spectral Helix',
  };
  for (const [ocr, name] of Object.entries(cases)) assert.strictEqual(matchSkill(ocr, catalog)?.skill.name, name, ocr);
  assert.strictEqual(matchSkill('Orb of Alteration', catalog), null);
  assert.strictEqual(matchSkill('| |', catalog), null);
});

test('header: archetype, level, attributes, infamous', () => {
  const h = headerInfo('«Blade Ambusher ~~ LvI83 ~~ Dex/Int', catalog);
  assert.deepStrictEqual([h.archetype, h.level, h.attribute, h.infamous], ['Blade Ambusher', 83, 'Dex / Int', false]);
  const inf = headerInfo('Infamous Bladecaster Lvl 81 Dex / Int', catalog);
  assert.deepStrictEqual([inf.archetype, inf.level, inf.infamous], ['Bladecaster', 81, true]);
  assert.strictEqual(matchArchetype('Blade Ambusher', catalog).archetype.name, 'Blade Ambusher');
});

test('duplicate OCR lines give one skill each', () => {
  const m = mercFromOcr({ header: 'Eruptor Lvl 70', lines: [{ text: 'GRACE', y: 1 }, { text: 'GRACE |', y: 2 }] }, catalog);
  assert.strictEqual(m.skills.length, 1);
});

test('travel skill: query excludes travel skills only when the merc has none', () => {
  const blade = catalog.skillByName('Blade Trap');
  const dash = catalog.skillByName('Flame Dash');
  const noTravel = { skills: [{ ...blade }] };
  const q1 = buildMercQuery(noTravel, catalog);
  assert.deepStrictEqual(q1.query.stats[0], { type: 'and', filters: [{ id: blade.id }] });
  assert.strictEqual(q1.query.stats[1].type, 'not');
  assert.ok(q1.query.stats[1].filters.some((f) => f.id === dash.id));
  assert.strictEqual(q1.sort.price, 'asc');

  const withTravel = { skills: [{ ...blade }, { ...dash }] };
  const q2 = buildMercQuery(withTravel, catalog);
  assert.strictEqual(q2.query.stats.length, 1, 'no not-group');
  assert.deepStrictEqual(q2.query.stats[0].filters, [{ id: blade.id }], 'travel skill not required');
  assert.ok(valueHints(withTravel).some((h) => !h.good && /Flame Dash/.test(h.text)));
  assert.ok(valueHints(noTravel).some((h) => h.good && /No travel/.test(h.text)));
});

test('BMP encoder writes a valid header', () => {
  const bmp = encodeBmp({ width: 3, height: 2, gray: new Uint8Array([0, 255, 0, 255, 0, 255]) });
  assert.strictEqual(bmp.toString('ascii', 0, 2), 'BM');
  assert.strictEqual(bmp.readInt32LE(18), 3);
  assert.strictEqual(bmp.length, 54 + 12 * 2);
});

test('support gem count per skill row from the screenshot', () => {
  const img = fixture();
  const lay = layout(img.width, img.height);
  const rows = [912, 976, 1041, 1105, 1170, 1234];
  assert.deepStrictEqual(rows.map((y) => countSupports(img, lay, y)), [5, 2, 5, 5, 0, 2]);
  const b = binarize(img, lay.header);
  assert.strictEqual(b.gray.length, lay.header.w * 2 * lay.header.h * 2);
});

test('OCR reads the real hire window screenshot', async () => {
  const reader = new MercReader({ catalog });
  try {
    const m = await reader.read(fixture());
    assert.strictEqual(m.archetype, 'Blade Ambusher');
    assert.strictEqual(m.level, 83);
    assert.strictEqual(m.attribute, 'Dex / Int');
    assert.deepStrictEqual(m.skills.map((s) => [s.name, s.supports, s.travel]), [
      ['Blade Trap', 5, false], ['Trarthan Agility', 2, false], ['Spectral Helix of Trarthus', 5, false],
      ['Spectral Throw of Trarthus', 5, false], ['Grace', 0, false], ['Flame Dash', 2, true],
    ]);
  } finally {
    await reader.close();
  }
});

test('Ctrl+C warrant text (guessed format) is picked up', () => {
  const text = [
    'Item Class: Mercenary Warrants', 'Rarity: Normal', 'Mercenary Warrant', '--------',
    'Blade Ambusher', 'Level: 83', '--------', 'Blade Trap', 'Greater Multiple Traps (Tier 3)', 'Grace', 'Flame Dash',
  ].join('\n');
  const m = mercFromText(text, catalog);
  assert.ok(m);
  assert.strictEqual(m.archetype, 'Blade Ambusher');
  assert.deepStrictEqual(m.skills.map((s) => s.name), ['Blade Trap', 'Grace', 'Flame Dash']);
  assert.strictEqual(mercFromText('Rarity: Rare\nDoom Grip\nGrace', catalog), null);
});
