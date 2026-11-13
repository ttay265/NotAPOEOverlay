'use strict';
// Builds the JSON body for POST https://www.pathofexile.com/api/trade/search/<league>.
// Stat-id handling (count groups, inverted stats, {div_by_100}/{empty} prefixes) follows
// Awakened PoE Trade's renderer/src/web/price-check/trade/pathofexile-trade.ts
// (MIT, (c) 2020 Alexander Drozdov, https://github.com/SnosMe/awakened-poe-trade).

const { itemCategory } = require('./mods');

const CATEGORY_TO_TRADE_ID = {
  'Map': 'map', 'Abyss Jewel': 'jewel.abyss', 'Amulet': 'accessory.amulet', 'Belt': 'accessory.belt',
  'Body Armour': 'armour.chest', 'Boots': 'armour.boots', 'Bow': 'weapon.bow', 'Claw': 'weapon.claw',
  'Dagger': 'weapon.dagger', 'Fishing Rod': 'weapon.rod', 'Flask': 'flask', 'Gloves': 'armour.gloves',
  'Helmet': 'armour.helmet', 'Jewel': 'jewel', 'One-Handed Axe': 'weapon.oneaxe', 'One-Handed Mace': 'weapon.onemace',
  'One-Handed Sword': 'weapon.onesword', 'Quiver': 'armour.quiver', 'Ring': 'accessory.ring',
  'Rune Dagger': 'weapon.runedagger', 'Sceptre': 'weapon.sceptre', 'Shield': 'armour.shield', 'Staff': 'weapon.staff',
  'Two-Handed Axe': 'weapon.twoaxe', 'Two-Handed Mace': 'weapon.twomace', 'Two-Handed Sword': 'weapon.twosword',
  'Wand': 'weapon.wand', 'Warstaff': 'weapon.warstaff', 'Cluster Jewel': 'jewel.cluster', 'Trinket': 'accessory.trinket',
  'Sanctum Relic': 'sanctum.relic', 'Tincture': 'tincture',
};

// Item-level search options shown under the mod list. Defaults are picked per item.
function defaultItemOptions(item) {
  return {
    baseType: item.rarity === 'Unique', // rares: search the whole category unless ticked
    itemLevel: false,
    itemLevelMin: item.itemLevel || null,
    links: item.links >= 5,
    linksMin: item.links >= 5 ? item.links : null,
    corrupted: !!item.corrupted, // only matters when the item itself is corrupted
    onlineOnly: true,
  };
}

// selections: [{ id, enabled, min, max }] keyed by filter id; filters: from createFilters.
function buildQuery(item, filters, selections, itemOpts, opts = {}) {
  const status = itemOpts.onlineOnly ? (opts.status || 'available') : 'any';
  const query = { status: { option: status }, stats: [{ type: 'and', filters: [] }], filters: {} };
  const set = (group, key, value) => {
    query.filters[group] = query.filters[group] || { filters: {} };
    query.filters[group].filters[key] = value;
  };

  if (item.rarity === 'Unique') {
    query.name = item.name;
    query.type = item.baseType;
  } else {
    const cat = CATEGORY_TO_TRADE_ID[itemCategory(item)];
    if (itemOpts.baseType || !cat) query.type = item.baseType;
    if (cat) set('type_filters', 'category', { option: cat });
    set('type_filters', 'rarity', { option: 'nonunique' });
  }
  if (itemOpts.itemLevel && itemOpts.itemLevelMin) set('misc_filters', 'ilvl', { min: +itemOpts.itemLevelMin });
  if (itemOpts.links && itemOpts.linksMin) set('socket_filters', 'links', { min: +itemOpts.linksMin });
  if (item.corrupted && itemOpts.corrupted) set('misc_filters', 'corrupted', { option: 'true' });

  const byId = new Map(selections.map((s) => [s.id, s]));
  const and = query.stats[0];
  for (const f of filters) {
    const sel = byId.get(f.id);
    if (!sel || !sel.enabled || !f.tradeable) continue;
    const stat = { ...f, min: numOrNull(sel.min), max: numOrNull(sel.max) };
    if (f.tradeIds.length === 1) {
      and.filters.push(tradeIdToQuery(f.tradeIds[0], stat));
    } else {
      query.stats.push({ type: 'count', value: { min: 1 }, filters: f.tradeIds.map((id) => tradeIdToQuery(id, stat)) });
    }
  }

  return { query, sort: { price: 'asc' } };
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tradeIdToQuery(id, stat) {
  let min = stat.min;
  let max = stat.max;
  let div = 1;
  if (id.startsWith('{div_by_100}')) div = 100;
  if (id.startsWith('{empty}') || (id.startsWith('{empty_if_100}') && stat.value === 100)) { min = null; max = null; }
  if (id.startsWith('{')) id = id.slice(id.indexOf('}') + 1);

  const value = {};
  if (stat.option) {
    if (stat.value != null) value.option = stat.value;
  } else {
    const sign = stat.inverted ? -1 : 1;
    let a = min != null ? (min * sign) / div : undefined;
    let b = max != null ? (max * sign) / div : undefined;
    if (stat.inverted) [a, b] = [b, a];
    if (a !== undefined) value.min = a;
    if (b !== undefined) value.max = b;
  }
  return Object.keys(value).length ? { id, value } : { id };
}

function tradeSiteUrl(league, searchId) {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}`;
}

module.exports = { buildQuery, defaultItemOptions, tradeSiteUrl, CATEGORY_TO_TRADE_ID };
