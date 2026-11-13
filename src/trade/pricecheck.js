'use strict';
// Glue between a copied item, the mod picker in the overlay, and the trade API.
// One TradePriceCheck instance lives in the main process.

const { parseMods, itemCategory } = require('./mods');
const { createFilters } = require('./filters');
const { buildQuery, defaultItemOptions, tradeSiteUrl, CATEGORY_TO_TRADE_ID } = require('./query');
const { TradeClient, StaleError } = require('./client');

// Trade API currency ids -> poe.ninja currency names (for converting listings to chaos).
const CURRENCY_NAMES = {
  chaos: 'Chaos Orb', divine: 'Divine Orb', exalted: 'Exalted Orb', alch: 'Orb of Alchemy', alt: 'Orb of Alteration',
  fusing: 'Orb of Fusing', chisel: "Cartographer's Chisel", vaal: 'Vaal Orb', regal: 'Regal Orb', chrome: 'Chromatic Orb',
  jewellers: "Jeweller's Orb", scour: 'Orb of Scouring', regret: 'Orb of Regret', gcp: "Gemcutter's Prism",
  annul: 'Orb of Annulment', mirror: 'Mirror of Kalandra', blessed: 'Blessed Orb', chance: 'Orb of Chance',
};

const PAGE = 10;

class TradePriceCheck {
  constructor({ league, prices, client, status = 'available', rangePercent = 10, minIntervalMs = 1000 }) {
    this.league = league;
    this.prices = prices; // PriceService (poe.ninja), for currency rates
    this.client = client || new TradeClient();
    this.status = status;
    this.rangePercent = rangePercent;
    this.minIntervalMs = minIntervalMs;
    this.current = null; // { key, item, filters, itemOpts, search, shown }
    this.gen = 0;
    this.lastSearchAt = 0;
  }

  // Can this item get a mod-based trade search?
  static supports(item) {
    if (!item || item.unidentified) return false;
    if (!['Rare', 'Magic', 'Unique'].includes(item.rarity)) return false;
    return !!CATEGORY_TO_TRADE_ID[itemCategory(item)] || item.rarity === 'Unique';
  }

  // Forget the current item (a different item was copied); queued requests for it get dropped.
  cancel() {
    this.current = null;
  }

  // Prepare the mod list for a newly copied item. No request is sent here.
  prepare(item) {
    const parsed = parseMods(item);
    const filters = createFilters(item, parsed, { rangePercent: this.rangePercent });
    const key = `${++this.gen}`;
    this.current = { key, item, filters, itemOpts: defaultItemOptions(item), search: null, shown: 0 };
    return {
      key,
      filters,
      itemOpts: this.current.itemOpts,
      unknown: parsed.unknown.map((u) => u.text),
      advanced: parsed.advanced,
      canAutoSearch: filters.some((f) => f.enabled && f.tradeable),
    };
  }

  // One search for one player action (copy or Search button). Returns the first page of listings.
  // onWait(sec) is called when the request is queued behind the rate limit.
  async search(key, selections, itemOpts, { onWait, auto = false } = {}) {
    const cur = this.current;
    if (!cur || cur.key !== key) throw new StaleError();
    const now = Date.now();
    if (!auto && now - this.lastSearchAt < this.minIntervalMs) throw new Error('Slow down: one search per second');
    this.lastSearchAt = now;
    const opts = { ...cur.itemOpts, ...(itemOpts || {}) };
    cur.itemOpts = opts;
    const body = buildQuery(cur.item, cur.filters, selections, opts, { status: this.status });
    const isStale = () => this.current !== cur;
    const res = await this.client.search(this.league, body, { isStale, onWait });
    cur.search = res;
    cur.shown = 0;
    const listings = await this.client.fetchListings(res.id, res.result.slice(0, PAGE), { isStale, onWait });
    cur.shown = Math.min(PAGE, res.result.length);
    return this.view(cur, listings, res.cached);
  }

  async more(key, { onWait } = {}) {
    const cur = this.current;
    if (!cur || cur.key !== key || !cur.search) throw new StaleError();
    const ids = cur.search.result.slice(cur.shown, cur.shown + PAGE);
    const isStale = () => this.current !== cur;
    const listings = await this.client.fetchListings(cur.search.id, ids, { isStale, onWait });
    cur.shown += ids.length;
    return this.view(cur, listings, false);
  }

  async view(cur, listings, cached) {
    const rates = await this.rates().catch(() => ({ chaos: 1 }));
    const priced = listings.map((l) => ({ ...l, chaos: l.amount != null && rates[l.currency] ? l.amount * rates[l.currency] : null }));
    return {
      total: cur.search.total,
      shown: cur.shown,
      canLoadMore: cur.shown < cur.search.result.length,
      tradeUrl: tradeSiteUrl(this.league, cur.search.id),
      listings: priced,
      summary: summarise(priced, rates.divine),
      cached: !!cached,
    };
  }

  async rates() {
    const out = { chaos: 1 };
    if (!this.prices) return out;
    const lines = await this.prices.lines('Currency');
    for (const [id, name] of Object.entries(CURRENCY_NAMES)) {
      const l = lines.find((x) => x.name === name);
      if (l && l.chaos) out[id] = l.chaos;
    }
    return out;
  }
}

// Cheapest and median of the listings we could convert to chaos.
function summarise(listings, divine) {
  const values = listings.map((l) => l.chaos).filter((v) => v != null).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return { cheapest: values[0], median, count: values.length, divine: divine || null };
}

module.exports = { TradePriceCheck, summarise, CURRENCY_NAMES };
