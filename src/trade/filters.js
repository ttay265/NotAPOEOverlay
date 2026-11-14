'use strict';
// Builds the list of mod filters shown in the price-check panel, with default min/max and
// which ones start ticked. Pseudo totals (total resistances, total life, ...) and default roll
// ranges follow Awakened PoE Trade's renderer/src/web/price-check/filters/create-stat-filters.ts
// and pseudo/index.ts (MIT, (c) 2020 Alexander Drozdov, https://github.com/SnosMe/awakened-poe-trade).

const { statData } = require('./stats');

const RES = [
  { ref: '+#% to All Resistances', el: ['fire', 'cold', 'lightning'], chaos: true },
  { ref: '+#% to all Elemental Resistances', el: ['fire', 'cold', 'lightning'] },
  { ref: '+#% to Fire Resistance', el: ['fire'] },
  { ref: '+#% to Cold Resistance', el: ['cold'] },
  { ref: '+#% to Lightning Resistance', el: ['lightning'] },
  { ref: '+#% to Fire and Lightning Resistances', el: ['fire', 'lightning'] },
  { ref: '+#% to Fire and Cold Resistances', el: ['fire', 'cold'] },
  { ref: '+#% to Cold and Lightning Resistances', el: ['cold', 'lightning'] },
  { ref: '+#% to Chaos Resistance', el: [], chaos: true },
  { ref: '+#% to Fire and Chaos Resistances', el: ['fire'], chaos: true },
  { ref: '+#% to Cold and Chaos Resistances', el: ['cold'], chaos: true },
  { ref: '+#% to Lightning and Chaos Resistances', el: ['lightning'], chaos: true },
];
const ATTR = [
  { ref: '+# to all Attributes', at: ['str', 'dex', 'int'] },
  { ref: '+# to Strength', at: ['str'] },
  { ref: '+# to Dexterity', at: ['dex'] },
  { ref: '+# to Intelligence', at: ['int'] },
  { ref: '+# to Strength and Intelligence', at: ['str', 'int'] },
  { ref: '+# to Strength and Dexterity', at: ['str', 'dex'] },
  { ref: '+# to Dexterity and Intelligence', at: ['dex', 'int'] },
];

const one = (ref) => ({ stats: [{ ref }] });
const PSEUDO_RULES = [
  { pseudo: '+#% total Elemental Resistance', enabled: true, stats: RES.filter((r) => r.el.length).map((r) => ({ ref: r.ref, multiplier: r.el.length })) },
  { pseudo: '+#% total to Fire Resistance', stats: RES.filter((r) => r.el.includes('fire')).map((r) => ({ ref: r.ref })) },
  { pseudo: '+#% total to Cold Resistance', stats: RES.filter((r) => r.el.includes('cold')).map((r) => ({ ref: r.ref })) },
  { pseudo: '+#% total to Lightning Resistance', stats: RES.filter((r) => r.el.includes('lightning')).map((r) => ({ ref: r.ref })) },
  { pseudo: '+#% total to Chaos Resistance', enabled: 'unless-only-crafted', stats: RES.filter((r) => r.chaos).map((r) => ({ ref: r.ref })) },
  { pseudo: '+# total to Strength', stats: ATTR.filter((a) => a.at.includes('str')).map((a) => ({ ref: a.ref })) },
  { pseudo: '+# total to Dexterity', stats: ATTR.filter((a) => a.at.includes('dex')).map((a) => ({ ref: a.ref })) },
  { pseudo: '+# total to Intelligence', stats: ATTR.filter((a) => a.at.includes('int')).map((a) => ({ ref: a.ref })) },
  {
    pseudo: '+# total maximum Life', enabled: true,
    stats: [{ ref: '+# to maximum Life', required: true }, ...ATTR.filter((a) => a.at.includes('str')).map((a) => ({ ref: a.ref, multiplier: 0.5, keep: true }))],
  },
  {
    pseudo: '+# total maximum Mana',
    stats: [{ ref: '+# to maximum Mana', required: true }, ...ATTR.filter((a) => a.at.includes('int')).map((a) => ({ ref: a.ref, multiplier: 0.5, keep: true }))],
  },
  { pseudo: '+# total maximum Energy Shield', ...one('+# to maximum Energy Shield'), globalOnly: true },
  { pseudo: '#% total increased maximum Energy Shield', ...one('#% increased maximum Energy Shield') },
  { pseudo: '+#% total Attack Speed', ...one('#% increased Attack Speed'), globalOnly: true },
  { pseudo: '+#% total Cast Speed', ...one('#% increased Cast Speed') },
  { pseudo: '#% increased Movement Speed', ...one('#% increased Movement Speed') },
  { pseudo: '+#% Global Critical Strike Multiplier', ...one('+#% to Global Critical Strike Multiplier') },
  { pseudo: '+#% Global Critical Strike Chance', ...one('#% increased Global Critical Strike Chance') },
  { pseudo: '#% increased Spell Damage', ...one('#% increased Spell Damage') },
  { pseudo: '#% increased Elemental Damage', ...one('#% increased Elemental Damage') },
  { pseudo: '# Life Regenerated per Second', ...one('Regenerate # Life per second') },
  { pseudo: '#% increased Mana Regeneration Rate', ...one('#% increased Mana Regeneration Rate') },
];

const LOCAL_ON_ARMOUR_OR_WEAPON = /\bstat_(4052037485|210067635)\b/; // local max ES, local attack speed

// Sum stats with the same ref and mod type (e.g. two "+# to maximum Life" lines).
function sumByType(mods) {
  const out = [];
  for (const mod of mods) {
    // Fractured mods are searched as explicit, so they match fractured and normal copies.
    const type = mod.info.type === 'fractured' ? 'explicit' : mod.info.type;
    for (const ps of mod.stats) {
      let calc = out.find((c) => c.stat.ref === ps.stat.ref && c.type === type && sameIds(c.stat, ps.stat, type));
      if (!calc) out.push((calc = { stat: ps.stat, type, sources: [] }));
      calc.sources.push({ mod, stat: ps, contributes: ps.roll && { value: ps.roll.value, min: ps.roll.min, max: ps.roll.max } });
    }
  }
  return out;
}

function sameIds(a, b, type) {
  return String(a.trade.ids[type] || '') === String(b.trade.ids[type] || '');
}

function total(sources) {
  if (sources.every((s) => !s.contributes)) return undefined;
  return sources.reduce((sum, s) => {
    const c = s.contributes || { value: 1, min: 1, max: 1 };
    return { value: sum.value + c.value, min: sum.min + c.min, max: sum.max + c.max };
  }, { value: 0, min: 0, max: 0 });
}

// ---- rounding helpers, from APT filters/util.ts ----
function decimalPlaces(value, dp) {
  if (!dp || Math.abs(value) >= 10) return 0;
  return Math.abs(value) < 2.3 ? 2 : 1;
}
function roundRoll(value, dp) {
  const r = Math.pow(10, decimalPlaces(value, dp));
  return Math.trunc(value * r) / r;
}
function percentRoll(value, p, method, dp) {
  const res = value + (Math.abs(value) * p) / 100;
  const r = Math.pow(10, decimalPlaces(value, dp));
  return method((res + Number.EPSILON) * r) / r;
}

function formatText(matcherString, value, dp, ref) {
  const s = matcherString.trim();
  if (value == null) return s;
  const v = roundRoll(value, dp);
  // Matchers drop the leading "+" ("# to maximum Life") but the stat ref keeps it.
  const plus = s.startsWith('#') && ref.startsWith('+#') && v >= 0 ? '+' : '';
  return s.replace('#', plus + v);
}

function pickMatcher(stat, value) {
  const ms = stat.matchers;
  if (value == null) return ms.find((m) => m.value == null) || ms[0];
  return ms.find((m) => m.value === value) ||
    ms.find((m) => m.value == null && !!m.negate === value < 0) ||
    ms.find((m) => m.value == null) || ms[0];
}

let nextId = 1;
function toFilter(calc, opts, item) {
  const { stat, type, sources } = calc;
  const roll = total(sources);
  const tradeIds = stat.trade.ids[type] || null;
  const dp = !!stat.dp || sources.some((s) => s.stat.roll && s.stat.roll.dp);
  const matcher = pickMatcher(stat, roll && roll.value);
  const tags = new Set(sources.map((s) => s.mod.info.type));
  const filter = {
    id: nextId++,
    ref: stat.ref,
    type,
    tag: tags.has('fractured') ? 'fractured' : type,
    text: type !== 'pseudo' && sources.length === 1 ? sources[0].stat.text : formatText(matcher.string, matcher.value != null ? null : roll && (matcher.negate ? -roll.value : roll.value), dp, stat.ref),
    tradeIds,
    tradeable: !!(tradeIds && tradeIds.length),
    inverted: !!stat.trade.inverted,
    option: !!stat.trade.option,
    better: stat.better,
    dp,
    value: roll ? roundRoll(roll.value, dp) : null,
    bounds: roll && roll.min !== roll.max ? { min: roll.min, max: roll.max } : null,
    min: null,
    max: null,
    enabled: false,
    tier: type !== 'pseudo' && sources.length === 1 ? sources[0].mod.info.tier : undefined,
  };
  if (roll && !filter.option && stat.better !== 0) {
    const pct = item.rarity === 'Unique' && filter.bounds && roll.value >= roll.max ? 0 : opts.rangePercent;
    if (stat.better === -1) filter.max = percentRoll(roll.value, +pct, Math.ceil, dp);
    else filter.min = percentRoll(roll.value, -pct, Math.floor, dp);
    // Small whole numbers ("+1 to Level of Socketed Gems") have no room for slack.
    if (!dp && Math.abs(roll.value) < 10) {
      if (filter.min != null) filter.min = roundRoll(roll.value, dp);
      if (filter.max != null) filter.max = roundRoll(roll.value, dp);
    }
  } else if (roll && stat.better === 0 && !filter.option) {
    filter.min = filter.value;
    filter.max = filter.value;
  }
  return filter;
}

// Returns filters in display order: pseudo totals first, then implicits, explicits, crafted.
function createFilters(item, parsed, opts = {}, data = statData()) {
  const o = { rangePercent: 10, ...opts };
  let stats = sumByType(parsed.mods);
  const filters = [];
  const consumed = new Set();

  for (const rule of PSEUDO_RULES) {
    const sources = [];
    for (const calc of stats) {
      if (calc.type === 'enchant' || calc.type === 'pseudo') continue;
      const info = rule.stats.find((s) => s.ref === calc.stat.ref);
      if (!info) continue;
      if (rule.globalOnly && LOCAL_ON_ARMOUR_OR_WEAPON.test(String(calc.stat.trade.ids.explicit || calc.stat.trade.ids[calc.type]))) continue;
      const m = info.multiplier || 1;
      for (const s of calc.sources) {
        if (!s.contributes) continue;
        sources.push({ ...s, calc, contributes: { value: s.contributes.value * m, min: s.contributes.min * m, max: s.contributes.max * m } });
      }
    }
    if (!sources.length) continue;
    if (rule.stats.some((s) => s.required && !sources.some((src) => src.stat.stat.ref === s.ref))) continue;
    if (item.rarity === 'Unique' && sources.filter((s) => s.mod.info.type === 'explicit').length < 2) continue;

    const pseudoStat = data.pseudoByRef(rule.pseudo);
    if (!pseudoStat || !pseudoStat.trade.ids.pseudo) continue;
    const f = toFilter({ stat: pseudoStat, type: 'pseudo', sources }, o, item);
    f.tag = 'pseudo';
    if (rule.enabled === true) f.enabled = true;
    else if (rule.enabled === 'unless-only-crafted') f.enabled = !(sources.length === 1 && sources[0].mod.info.type === 'crafted');
    // A single-source "total" equal to the stat itself is still useful: it also matches
    // items that roll the same total from other mods.
    filters.push(f);
    for (const src of sources) {
      const info = rule.stats.find((s) => s.ref === src.stat.stat.ref);
      if (!(info.keep && item.rarity === 'Unique')) consumed.add(src.calc);
    }
  }

  // Rares and magic items: stats folded into a pseudo total are hidden, like in APT.
  // Uniques keep them, since their exact mods matter.
  if (item.rarity !== 'Unique') stats = stats.filter((c) => !consumed.has(c));

  const order = { implicit: 1, enchant: 0, explicit: 2, crafted: 3, scourge: 4 };
  stats.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  for (const calc of stats) filters.push(toFilter(calc, o, item));

  // Uniques: ticking everything would only find the same unique; leave all unticked.
  if (item.rarity === 'Unique') filters.forEach((f) => { f.enabled = false; });
  return filters;
}

module.exports = { createFilters, sumByType, percentRoll, roundRoll, PSEUDO_RULES };
