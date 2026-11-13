const test = require('node:test');
const assert = require('node:assert');
const { parseItem } = require('../src/parser');
const { PriceService, tradeSearchUrl } = require('../src/pricing');
const items = require('./fixtures/items');
const ninja = require('./fixtures/ninja');

function fakeFetch(calls) {
  return async (url) => {
    calls.push(url);
    const type = new URL(url).searchParams.get('type');
    return { ok: true, json: async () => ninja[type] || { lines: [] } };
  };
}
const svc = (calls = []) => new PriceService({ league: 'Settlers', fetchImpl: fakeFetch(calls) });

test('currency stack total + divine', async () => {
  const p = await svc().price(parseItem(items.divine));
  assert.equal(p.chaos, 150);
  assert.equal(p.total, 1050);
  assert.equal(p.totalDivine, 7);
});
test('6L unique picks 6-link price and flags low listings', async () => {
  const p = await svc().price(parseItem(items.unique6l));
  assert.equal(p.chaos, 600);
  assert.equal(p.confidence, 'low');
});
test('unlinked unique picks base price', async () => {
  assert.equal((await svc().price(parseItem(items.uniqueUnlinked))).chaos, 30);
});
test('corrupted gem matches corrupted 20/20', async () => {
  assert.equal((await svc().price(parseItem(items.gem))).chaos, 3);
});
test('div card stack', async () => {
  const p = await svc().price(parseItem(items.card));
  assert.equal(p.total, 1800);
  assert.equal(p.totalDivine, 12);
});
test('rare map priced by base + tier', async () => {
  assert.equal((await svc().price(parseItem(items.map))).chaos, 2);
});
test('rare ring has no ninja price', async () => {
  assert.equal(await svc().price(parseItem(items.rareAdvanced)), null);
});
test('requests are cached and use league + endpoint', async () => {
  const calls = [];
  const s = svc(calls);
  await s.price(parseItem(items.divine));
  await s.price(parseItem(items.divine));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /currencyoverview\?league=Settlers&type=Currency/);
});
test('trade url', () => {
  const u = tradeSearchUrl(parseItem(items.unique6l), 'Settlers');
  assert.ok(u.startsWith('https://www.pathofexile.com/trade/search/Settlers?q='));
  const q = JSON.parse(decodeURIComponent(u.split('?q=')[1]));
  assert.equal(q.query.name, "Kaom's Heart");
});
