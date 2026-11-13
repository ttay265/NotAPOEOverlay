const test = require('node:test');
const assert = require('node:assert');
const { parseItem } = require('../src/parser');
const { parseMods } = require('../src/trade/mods');
const { createFilters } = require('../src/trade/filters');
const { buildQuery, defaultItemOptions } = require('../src/trade/query');
const { LimitSet, RateLimiter } = require('../src/trade/ratelimit');
const { TradeClient, RateLimitError, StaleError } = require('../src/trade/client');
const { TradePriceCheck, summarise } = require('../src/trade/pricecheck');
const rares = require('./fixtures/rares');

const prep = (text) => {
  const item = parseItem(text);
  const parsed = parseMods(item);
  return { item, parsed, filters: createFilters(item, parsed) };
};
const byText = (filters, re) => filters.find((f) => re.test(f.text));

test('plain Ctrl+C rare: mods, types and trade ids', () => {
  const { parsed } = prep(rares.ringPlain);
  assert.equal(parsed.advanced, false);
  const flat = parsed.mods.flatMap((m) => m.stats.map((s) => [m.info.type, s.stat.ref, s.roll && s.roll.value]));
  assert.deepEqual(flat, [
    ['implicit', '+#% to Fire and Cold Resistances', 12],
    ['explicit', '+# to maximum Life', 52],
    ['explicit', '+#% to Fire Resistance', 38],
    ['explicit', '+#% to Cold Resistance', 41],
    ['explicit', 'Adds # to # Physical Damage to Attacks', 5],
    ['crafted', '+#% to Chaos Resistance', 25],
  ]);
  assert.deepEqual(parsed.unknown, []);
});

test('pseudo totals include implicits and are ticked by default', () => {
  const { filters } = prep(rares.ringPlain);
  const ele = byText(filters, /total Elemental Resistance/);
  assert.equal(ele.value, 24 + 38 + 41);
  assert.equal(ele.enabled, true);
  assert.equal(ele.min, 92); // 10% below
  assert.deepEqual(ele.tradeIds, ['pseudo.pseudo_total_elemental_resistance']);
  assert.equal(byText(filters, /total maximum Life/).enabled, true);
  // Only-crafted chaos res stays unticked
  assert.equal(byText(filters, /total to Chaos Resistance/).enabled, false);
  // Individual res lines are folded into pseudo totals; the attack damage stays, unticked
  assert.equal(byText(filters, /^\+38% to Fire Resistance/), undefined);
  const phys = byText(filters, /Adds 3 to 7 Physical Damage/);
  assert.equal(phys.enabled, false);
  assert.equal(phys.min, 5); // trade uses the average of two-value stats
});

test('advanced Ctrl+Alt+C: ranges, tiers, local vs global ES, fractured', () => {
  const { parsed, filters } = prep(rares.helmetAdvanced);
  assert.equal(parsed.advanced, true);
  const life = parsed.mods.find((m) => m.info.name === 'Hale');
  assert.equal(life.info.tier, 4);
  assert.equal(life.info.generation, 'prefix');
  assert.deepEqual([life.stats[0].roll.min, life.stats[0].roll.max], [50, 59]);
  const es = byText(filters, /maximum Energy Shield/);
  assert.equal(es.tag, 'fractured');
  assert.deepEqual(es.tradeIds, ['explicit.stat_4052037485']); // local ES, searched as explicit
  assert.equal(es.text, '+92 to maximum Energy Shield');
  // Local ES on a helmet must not count toward the global ES pseudo
  assert.equal(byText(filters, /total maximum Energy Shield/), undefined);
  assert.equal(byText(filters, /total Elemental Resistance/).value, 42);
  assert.equal(byText(filters, /total to Chaos Resistance/).enabled, false);
  // +1 gem level: no slack below
  assert.equal(byText(filters, /Socketed Minion Gems/).min, 1);
});

test('strength adds to total life on rares', () => {
  const { filters } = prep(rares.bootsPlain);
  assert.equal(byText(filters, /total maximum Life/).value, 70 + 24);
  assert.ok(byText(filters, /Movement Speed/));
});

test('buildQuery: category search, ticked mods with min/max, item options', () => {
  const { item, filters } = prep(rares.ringPlain);
  const sel = filters.map((f) => ({ id: f.id, enabled: f.enabled, min: f.min, max: f.max }));
  const phys = byText(filters, /Physical Damage/);
  sel.find((s) => s.id === phys.id).enabled = true;
  sel.find((s) => s.id === phys.id).max = '9';
  const opts = { ...defaultItemOptions(item), itemLevel: true };
  const body = buildQuery(item, filters, sel, opts);
  assert.equal(body.query.type, undefined);
  assert.deepEqual(body.query.filters.type_filters.filters, { category: { option: 'accessory.ring' }, rarity: { option: 'nonunique' } });
  assert.deepEqual(body.query.filters.misc_filters.filters.ilvl, { min: 84 });
  assert.equal(body.query.status.option, 'available');
  assert.deepEqual(body.query.stats[0].filters, [
    { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 92 } },
    { id: 'pseudo.pseudo_total_life', value: { min: 46 } },
    { id: 'explicit.stat_3032590688', value: { min: 5, max: 9 } },
  ]);
  const withBase = buildQuery(item, filters, sel, { ...opts, baseType: true, onlineOnly: false });
  assert.equal(withBase.query.type, 'Two-Stone Ring');
  assert.equal(withBase.query.status.option, 'any');
});

test('mods without a trade id are never sent', () => {
  const { item, filters } = prep(rares.helmetAdvanced);
  // Crafted chaos res has no "crafted" trade id; it only feeds the chaos res total.
  assert.equal(filters.some((f) => f.tag === 'crafted'), false);
  assert.equal(byText(filters, /total to Chaos Resistance/).value, 20);
  const fake = [{ id: -1, tradeable: false, tradeIds: null }];
  const body = buildQuery(item, fake, [{ id: -1, enabled: true, min: 1 }], defaultItemOptions(item));
  assert.deepEqual(body.query.stats[0].filters, []);
});

// ---- rate limiting ----

const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });

test('LimitSet adopts server rules and syncs used hits', () => {
  const ls = new LimitSet(undefined, { latencySec: 0 });
  ls.adjust(headers({
    'x-rate-limit-rules': 'Ip',
    'x-rate-limit-ip': '8:10:60,15:60:300',
    'x-rate-limit-ip-state': '3:10:0,3:60:0',
  }), 0);
  assert.deepEqual(ls.limiters.map((l) => [l.max, l.window, l.max - l.available(0)]), [[8, 10, 3], [15, 60, 3]]);
  assert.equal(ls.waitMs(0), 0);
  for (let i = 0; i < 5; i++) ls.take(0);
  assert.equal(ls.waitMs(0), 10000); // 8 of 8 used in the 10 s window
  assert.equal(ls.waitMs(10000), 0);
});

test('LimitSet honours restricted state from headers', () => {
  const ls = new LimitSet(undefined, { latencySec: 0 });
  ls.adjust(headers({ 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '9:10:60' }), 1000);
  assert.equal(ls.waitMs(1000), 60000);
});

test('estimateMs simulates a queue', () => {
  const ls = new LimitSet([new RateLimiter(2, 10)], { latencySec: 0 });
  assert.equal(ls.estimateMs(2, 0), 0);
  assert.equal(ls.estimateMs(3, 0), 10000);
});

function fakeApi({ status = 200, rateHeaders = {}, retryAfter } = {}) {
  let t = 0;
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, at: t, body: init.body });
    const h = { 'x-rate-limit-rules': 'Ip', ...rateHeaders };
    if (retryAfter) h['retry-after'] = String(retryAfter);
    const isSearch = url.includes('/search/');
    const json = isSearch
      ? { id: 'Q1', total: 25, result: Array.from({ length: 25 }, (_, i) => 'r' + i) }
      : { result: url.split('/fetch/')[1].split('?')[0].split(',').map((id, i) => ({
        id, item: { ilvl: 84 }, listing: { indexed: '2026-11-13T10:00:00Z', price: { amount: 10 + i, currency: i % 2 ? 'divine' : 'chaos', type: '~price' }, account: { name: 'a' + i, online: {} } },
      })) };
    return { ok: status === 200, status, headers: headers(h), json: async () => json };
  };
  const client = new TradeClient({ fetchImpl, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, latencySec: 0 });
  return { client, calls, sleeps, tick: (ms) => { t += ms; } };
}

test('client queues requests to stay under the limit', async () => {
  const api = fakeApi({ rateHeaders: { 'x-rate-limit-ip': '2:10:60', 'x-rate-limit-ip-state': '1:10:0' } });
  await api.client.search('Standard', { a: 1 });
  await api.client.search('Standard', { a: 2 });
  await api.client.search('Standard', { a: 3 }); // third in 10 s must wait
  assert.deepEqual(api.calls.map((c) => c.at), [0, 0, 10000]);
  assert.deepEqual(api.sleeps, [10000]);
});

test('client refuses instead of queueing for too long', async () => {
  const api = fakeApi({ rateHeaders: { 'x-rate-limit-ip': '1:60:60', 'x-rate-limit-ip-state': '1:60:0' } });
  await api.client.search('Standard', { a: 1 });
  await assert.rejects(api.client.search('Standard', { a: 2 }), (e) => e instanceof RateLimitError && e.retryInSec === 60);
  assert.equal(api.calls.length, 1);
});

test('429 + Retry-After blocks further requests', async () => {
  const api = fakeApi({ status: 429, retryAfter: 30, rateHeaders: { 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '9:10:30' } });
  await assert.rejects(api.client.search('Standard', { a: 1 }), RateLimitError);
  await assert.rejects(api.client.search('Standard', { a: 2 }), RateLimitError);
  assert.equal(api.calls.length, 1);
});

test('same search is served from cache', async () => {
  const api = fakeApi();
  await api.client.search('Standard', { a: 1 });
  api.tick(6000);
  const again = await api.client.search('Standard', { a: 1 });
  assert.equal(again.cached, true);
  assert.equal(api.calls.length, 1);
});

test('stale request is dropped before it is sent', async () => {
  const api = fakeApi({ rateHeaders: { 'x-rate-limit-ip': '1:5:60', 'x-rate-limit-ip-state': '1:5:0' } });
  await api.client.search('Standard', { a: 1 });
  await assert.rejects(api.client.search('Standard', { a: 2 }, { isStale: () => true }), StaleError);
  assert.equal(api.calls.length, 1);
});

test('price check: one copy = one search + one fetch of 10, then load more', async () => {
  const api = fakeApi({ rateHeaders: { 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '1:10:0' } });
  const prices = { lines: async () => [{ name: 'Divine Orb', chaos: 200 }] };
  const pc = new TradePriceCheck({ league: 'Standard', prices, client: api.client });
  const item = parseItem(rares.ringPlain);
  assert.equal(TradePriceCheck.supports(item), true);
  const p = pc.prepare(item);
  assert.equal(p.canAutoSearch, true);
  const sel = p.filters.map((f) => ({ id: f.id, enabled: f.enabled, min: f.min, max: f.max }));
  const r = await pc.search(p.key, sel, null, { auto: true });
  assert.equal(api.calls.length, 2);
  assert.match(api.calls[1].url, /\/fetch\/r0,r1,r2,r3,r4,r5,r6,r7,r8,r9\?query=Q1$/);
  assert.equal(r.listings.length, 10);
  assert.equal(r.listings[1].chaos, 11 * 200);
  assert.equal(r.tradeUrl, 'https://www.pathofexile.com/trade/search/Standard/Q1');
  assert.equal(r.canLoadMore, true);
  const m = await pc.more(p.key);
  assert.equal(m.shown, 20);
  assert.match(api.calls[2].url, /fetch\/r10,/);
  // A newer copy makes the old key stale
  pc.prepare(item);
  await assert.rejects(pc.more(p.key), StaleError);
});

test('summarise: median and cheapest in chaos', () => {
  assert.deepEqual(summarise([{ chaos: 5 }, { chaos: null }, { chaos: 1 }, { chaos: 3 }], 200), { cheapest: 1, median: 3, count: 3, divine: 200 });
  assert.equal(summarise([{ chaos: null }]), null);
});
