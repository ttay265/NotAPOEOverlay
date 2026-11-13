'use strict';
// Price lookup against poe.ninja's public JSON (the same endpoints its website uses).
// Data is fetched per category on first need and cached for `ttlMs`.

const CURRENCY_TYPES = ['Currency', 'Fragment'];
const ITEM_TYPES = [
  'DivinationCard', 'SkillGem', 'UniqueWeapon', 'UniqueArmour', 'UniqueAccessory',
  'UniqueFlask', 'UniqueJewel', 'UniqueMap', 'Map', 'Essence', 'Fossil', 'Resonator',
  'Scarab', 'Oil', 'DeliriumOrb', 'Incubator', 'Artifact', 'Omen', 'Tattoo', 'Invitation',
];

// Which poe.ninja categories to search for a parsed item.
function categoriesFor(item) {
  const c = item.itemClass || '';
  if (item.rarity === 'Divination Card') return ['DivinationCard'];
  if (item.rarity === 'Gem') return ['SkillGem'];
  if (c === 'Maps') return item.rarity === 'Unique' ? ['UniqueMap'] : ['Map'];
  if (item.rarity === 'Unique') {
    if (/Flask/.test(c)) return ['UniqueFlask'];
    if (/Jewel/.test(c)) return ['UniqueJewel'];
    if (/Amulet|Ring|Belt|Trinket/.test(c)) return ['UniqueAccessory'];
    if (/Armour|Helmet|Glove|Boot|Shield|Quiver/.test(c)) return ['UniqueArmour'];
    return ['UniqueWeapon'];
  }
  if (item.rarity === 'Currency' || /Fragment|Currency|Scarab|Incubator|Omen|Essence|Oil|Fossil|Resonator|Delirium/.test(c)) {
    return [...CURRENCY_TYPES, 'Essence', 'Fossil', 'Resonator', 'Scarab', 'Oil', 'DeliriumOrb', 'Incubator', 'Artifact', 'Omen', 'Tattoo', 'Invitation'];
  }
  return [];
}

class PriceService {
  constructor({ league, baseUrl = 'https://poe.ninja/api/data', ttlMs = 30 * 60 * 1000, fetchImpl = globalThis.fetch }) {
    this.league = league;
    this.baseUrl = baseUrl;
    this.ttlMs = ttlMs;
    this.fetch = fetchImpl;
    this.cache = new Map(); // type -> { at, lines }
  }

  async lines(type) {
    const hit = this.cache.get(type);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.lines;
    const kind = CURRENCY_TYPES.includes(type) ? 'currencyoverview' : 'itemoverview';
    const url = `${this.baseUrl}/${kind}?league=${encodeURIComponent(this.league)}&type=${type}`;
    const res = await this.fetch(url, { headers: { 'User-Agent': 'poe-overlay-prototype' } });
    if (!res.ok) throw new Error(`poe.ninja ${type}: HTTP ${res.status}`);
    const json = await res.json();
    const lines = (json.lines || []).map((l) => normalise(l, type));
    this.cache.set(type, { at: Date.now(), lines });
    return lines;
  }

  async divineChaos() {
    const line = (await this.lines('Currency')).find((l) => l.name === 'Divine Orb');
    return line ? line.chaos : null;
  }

  // Returns { chaos, divine, total, matchedName, category, confidence, note } or null.
  async price(item) {
    for (const type of categoriesFor(item)) {
      const lines = await this.lines(type);
      const match = pick(item, lines, type);
      if (match) {
        const div = await this.divineChaos().catch(() => null);
        const total = match.chaos * (item.stackSize || 1);
        return {
          chaos: match.chaos,
          divine: div ? match.chaos / div : null,
          total,
          totalDivine: div ? total / div : null,
          matchedName: match.label,
          category: type,
          confidence: match.lowConfidence ? 'low' : 'ok',
          listings: match.listings,
        };
      }
    }
    return null;
  }
}

function normalise(l, type) {
  if (CURRENCY_TYPES.includes(type)) {
    return { name: l.currencyTypeName, chaos: l.chaosEquivalent, listings: l.receive && l.receive.listing_count };
  }
  return {
    name: l.name, baseType: l.baseType, chaos: l.chaosValue, links: l.links || 0,
    gemLevel: l.gemLevel, gemQuality: l.gemQuality || 0, corrupted: !!l.corrupted,
    mapTier: l.mapTier, variant: l.variant, listings: l.listingCount, lowConfidence: (l.listingCount || 0) < 5,
  };
}

function pick(item, lines, type) {
  if (type === 'SkillGem') {
    const same = lines.filter((l) => l.name === item.baseType && l.corrupted === item.corrupted);
    if (!same.length) return null;
    // Closest level, then closest quality.
    same.sort((a, b) =>
      Math.abs(a.gemLevel - item.gemLevel) - Math.abs(b.gemLevel - item.gemLevel) ||
      Math.abs(a.gemQuality - item.quality) - Math.abs(b.gemQuality - item.quality));
    const g = same[0];
    return { ...g, label: `${g.name} ${g.gemLevel}/${g.gemQuality}${g.corrupted ? ' corrupted' : ''}` };
  }
  if (type === 'Map') {
    const base = item.baseType.replace(/^(Superior|Blighted|Blight-ravaged) /, '');
    const m = lines.find((l) => l.baseType === base && (!item.mapTier || l.mapTier === item.mapTier)) ||
      lines.find((l) => l.name === base);
    return m ? { ...m, label: `${m.name} T${m.mapTier}` } : null;
  }
  if (item.rarity === 'Unique') {
    const named = lines.filter((l) => l.name === item.name && (!l.baseType || l.baseType === item.baseType));
    const wantLinks = item.links >= 5 ? item.links : 0;
    const m = named.find((l) => l.links === wantLinks) || named.find((l) => !l.links);
    return m ? { ...m, label: m.name + (m.links ? ` ${m.links}L` : '') + (m.variant ? ` (${m.variant})` : '') } : null;
  }
  const m = lines.find((l) => l.name === item.baseType || l.name === item.name);
  return m ? { ...m, label: m.name } : null;
}

// Link to the official trade site, pre-filled with this item. The trade site accepts ?q=<query JSON>.
function tradeSearchUrl(item, league) {
  const query = { status: { option: 'online' }, stats: [{ type: 'and', filters: [] }] };
  if (item.rarity === 'Unique') { query.name = item.name; query.type = item.baseType; }
  else if (item.rarity === 'Rare' || item.rarity === 'Magic') query.type = item.baseType; // no mod filters yet
  else query.type = item.baseType;
  const q = encodeURIComponent(JSON.stringify({ query, sort: { price: 'asc' } }));
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${q}`;
}

module.exports = { PriceService, categoriesFor, tradeSearchUrl };
