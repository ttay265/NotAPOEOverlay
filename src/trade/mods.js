'use strict';
// Turns the mod lines of a copied item into trade API stats with their rolls.
//
// The stat-matching logic (placeholder generation, group resolution, roll bounds) is ported
// from Awakened PoE Trade's renderer/src/parser/stat-translations.ts and advanced-mod-desc.ts
// (MIT, (c) 2020 Alexander Drozdov, https://github.com/SnosMe/awakened-poe-trade).
//
// Works with both copy formats:
//  - Ctrl+C: plain mod lines; crafted / fractured / implicit / enchant lines carry a suffix.
//  - Ctrl+Alt+C (advanced): "{ Prefix Modifier "Hale" (Tier: 4) — Life }" headers and roll
//    ranges like "+52(50-59) to maximum Life". This gives better default min values.

const { statData } = require('./stats');

const SEP = '--------';
const UNSCALABLE = ' — Unscalable Value';
const TYPE_SUFFIXES = [
  [' (implicit)', 'implicit'],
  [' (enchant)', 'enchant'],
  [' (crafted)', 'crafted'],
  [' (fractured)', 'fractured'],
  [' (scourge)', 'scourge'],
];
const MODIFIER_LINE = /^(?<type>[^"]+?)(?:\s+"(?<name>[^"]*)")?(?:\s+\(Tier: (?<tier>\d+)\))?(?:\s+\(Rank: (?<rank>\d+)\))?$/;

// Item Class (as copied from the game) -> APT item category, used to pick local vs global stats.
const CLASS_TO_CATEGORY = {
  'Helmets': 'Helmet', 'Body Armours': 'Body Armour', 'Gloves': 'Gloves', 'Boots': 'Boots', 'Shields': 'Shield',
  'Amulets': 'Amulet', 'Belts': 'Belt', 'Rings': 'Ring', 'Quivers': 'Quiver', 'Trinkets': 'Trinket',
  'Jewels': 'Jewel', 'Abyss Jewels': 'Abyss Jewel',
  'Claws': 'Claw', 'Bows': 'Bow', 'Sceptres': 'Sceptre', 'Wands': 'Wand', 'Fishing Rods': 'Fishing Rod',
  'Staves': 'Staff', 'Warstaves': 'Warstaff', 'Daggers': 'Dagger', 'Rune Daggers': 'Rune Dagger',
  'One Hand Axes': 'One-Handed Axe', 'Two Hand Axes': 'Two-Handed Axe',
  'One Hand Maces': 'One-Handed Mace', 'Two Hand Maces': 'Two-Handed Mace',
  'One Hand Swords': 'One-Handed Sword', 'Thrusting One Hand Swords': 'One-Handed Sword', 'Two Hand Swords': 'Two-Handed Sword',
  'Life Flasks': 'Flask', 'Mana Flasks': 'Flask', 'Hybrid Flasks': 'Flask', 'Utility Flasks': 'Flask',
  'Tinctures': 'Tincture', 'Maps': 'Map', 'Sanctum Relics': 'Sanctum Relic',
};
const WEAPON = new Set(['Fishing Rod', 'Bow', 'Wand', 'One-Handed Axe', 'One-Handed Mace', 'One-Handed Sword', 'Claw', 'Dagger',
  'Rune Dagger', 'Sceptre', 'Two-Handed Axe', 'Two-Handed Mace', 'Two-Handed Sword', 'Staff', 'Warstaff']);
const ARMOUR = new Set(['Body Armour', 'Boots', 'Gloves', 'Helmet', 'Shield']);

function itemCategory(item) {
  if (item.itemClass === 'Jewels' && /Cluster Jewel$/.test(item.baseType || '')) return 'Cluster Jewel';
  return CLASS_TO_CATEGORY[item.itemClass];
}

// ---- sections -------------------------------------------------------------------------------

function isModInfoLine(line) {
  return line.startsWith('{') && line.endsWith('}');
}

function parseModInfoLine(line) {
  const [modText] = line.slice(1, -1).split('—').map((s) => s.trim());
  const m = modText.match(MODIFIER_LINE);
  const kind = m ? m.groups.type.trim() : modText;
  let type = 'explicit';
  if (/Implicit Modifier$/.test(kind) || /Eater of Worlds|Searing Exarch/.test(kind)) type = 'implicit';
  else if (/^Fractured/.test(kind)) type = 'fractured';
  else if (/^Master Crafted/.test(kind)) type = 'crafted';
  else if (/^Enchant/.test(kind)) type = 'enchant';
  const generation = /Prefix/.test(kind) ? 'prefix' : /Suffix/.test(kind) ? 'suffix' : undefined;
  return {
    type,
    generation,
    name: m && m.groups.name ? m.groups.name : undefined,
    tier: m && m.groups.tier ? +m.groups.tier : undefined,
  };
}

function stripType(line) {
  for (const [suffix, type] of TYPE_SUFFIXES) {
    if (line.endsWith(suffix)) return { line: line.slice(0, -suffix.length), type };
  }
  return { line, type: null };
}

// Returns { mods: [{ info, stats }], unknown: [{ text, type }], advanced }
function parseMods(item, data = statData()) {
  const text = String(item.raw || '').replace(/\r/g, '');
  const sections = text.split(SEP).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean)).filter((s) => s.length);
  const category = itemCategory(item);
  const out = { mods: [], unknown: [], advanced: false };

  // Mods live after the "Item Level:" section. Sections before it are header, properties,
  // requirements and sockets; they never hold mods.
  const ilvlIdx = sections.findIndex((s) => s.some((l) => /^Item Level: \d+/.test(l)));
  const start = ilvlIdx >= 0 ? ilvlIdx + 1 : 1;

  for (const section of sections.slice(start)) {
    if (section.some(isModInfoLine)) {
      out.advanced = true;
      for (const group of groupByMod(section)) {
        const info = parseModInfoLine(group.modLine);
        const lines = group.statLines.map((l) => {
          const s = stripType(l);
          if (s.type && s.type !== 'explicit' && info.type === 'explicit') info.type = s.type;
          return s.line;
        });
        parseStats(lines, info, category, data, out);
      }
      continue;
    }
    // Plain Ctrl+C: split the section into runs of lines with the same type suffix.
    let run = null;
    for (const raw of section) {
      const { line, type } = stripType(raw);
      const t = type || 'explicit';
      if (!run || run.type !== t) {
        if (run) parseStats(run.lines, { type: run.type }, category, data, out, true);
        run = { type: t, lines: [] };
      }
      run.lines.push(line);
    }
    if (run) parseStats(run.lines, { type: run.type }, category, data, out, true);
  }
  return out;
}

function* groupByMod(lines) {
  let last;
  for (const line of lines) {
    if (isModInfoLine(line)) {
      if (last) yield last;
      last = { modLine: line, statLines: [] };
    } else if (last) {
      last.statLines.push(line);
    }
  }
  if (last) yield last;
}

// Each stat in plain mode becomes its own mod (we cannot tell which lines share a mod).
function parseStats(lines, info, category, data, out, plain = false) {
  const mod = { info: { ...info }, stats: [] };
  let parsedCount = 0;
  const it = linesToStatStrings(lines);
  let step = it.next();
  while (!step.done) {
    const parsed = tryParseTranslation(step.value, info.type, category, data);
    if (parsed) {
      parsedCount++;
      if (plain) out.mods.push({ info: { ...info }, stats: [parsed] });
      else mod.stats.push(parsed);
      step = it.next(true);
    } else {
      step = it.next(false);
    }
  }
  if (!plain) out.mods.push(mod);
  // In plain mode, sections like flavour text, "Corrupted" or influence lines parse to nothing;
  // only report leftovers from runs that had at least one recognised stat.
  if (!plain || parsedCount) out.unknown.push(...step.value.map((t) => ({ text: t, type: info.type })));
}

// ---- ported from APT stat-translations.ts ---------------------------------------------------

const PAREN_LEFT = /^\s*(?:\(|（)/;
const PAREN_RIGHT = /(?:\)|）)\s*$/;

function* linesToStatStrings(lines) {
  const notParsed = [];
  let reminder = false;
  outer:
  for (let start = 0; start < lines.length; start += 1) {
    if (PAREN_LEFT.test(lines[start])) reminder = true;
    if (reminder && PAREN_RIGHT.test(lines[start])) { reminder = false; continue; }
    if (reminder) continue;
    for (let end = start; end < lines.length; end += 1) {
      let str = lines.slice(start, end + 1).join('\n');
      const unscalable = str.endsWith(UNSCALABLE);
      if (unscalable) str = str.slice(0, -UNSCALABLE.length);
      const isParsed = yield { string: str, unscalable, source: lines[start] };
      if (isParsed) { start += end - start; continue outer; }
    }
    notParsed.push(lines[start]);
  }
  return notParsed.filter((l) => l.length);
}

const PLACEHOLDER_MAP = [
  [[]],
  [[0], []],
  [[0, 1], [0], [1], []],
  [[0, 1, 2], [1, 2], [0, 2], [0, 1], [2], [1], [0]],
  [[0, 1, 2, 3], [1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2], [2, 3], [1, 3], [1, 2], [0, 3], [0, 2], [0, 1]],
];

function* statPlaceholders(stat) {
  const matches = [];
  const withPlaceholders = stat
    .replace(/\(\)/gm, '')
    .replace(/(?<value>(?<!\d|\))[+-]?\d+(?:\.\d+)?)(?:\((?<min>.[^)-]*)(?:-(?<max>[^)]+))?\))?/gm, (_, roll, min, max) => {
      if (min != null && max == null) max = min;
      const captured = {
        roll: Number(roll),
        rollStr: roll,
        decimal: roll.includes('.') || (min && min.includes('.')) || (max && max.includes('.')) || false,
        bounds: { min: Number(min), max: Number(max) },
      };
      matches.push(captured);
      if (Number.isNaN(captured.bounds.min) || Number.isNaN(captured.bounds.max)) {
        captured.bounds = undefined;
        return min != null ? `#(${min}-${max})` : '#';
      }
      return '#';
    });

  if (matches.length < PLACEHOLDER_MAP.length) {
    for (const replacements of PLACEHOLDER_MAP[matches.length]) {
      let idx = -1;
      const replaced = withPlaceholders.replace(/#/gm, () => {
        idx += 1;
        return replacements.includes(idx) ? matches[idx].rollStr : '#';
      });
      yield {
        stat: replaced,
        values: matches.filter((_, i) => !replacements.includes(i)).map((v) => ({ roll: v.roll, bounds: v.bounds && { ...v.bounds }, decimal: v.decimal })),
      };
    }
  }
  yield { stat, values: [] };
}

function tryParseTranslation(statStr, modType, category, data) {
  for (const combo of statPlaceholders(statStr.string)) {
    const found = findAndResolve(combo.stat, modType, category, combo.values.length === 1 ? combo.values[0].roll : undefined, data);
    // Some crafted mods (e.g. chaos resistance) have no "crafted" trade id. Keep them anyway:
    // they still count toward pseudo totals, and the filter layer marks them as not searchable.
    if (!found || (!(modType in found.stat.trade.ids) && modType !== 'crafted')) continue;

    let legacy = false;
    if (found.matcher.negate) {
      for (const v of combo.values) {
        v.roll *= -1;
        if (v.bounds) { v.bounds.min *= -1; v.bounds.max *= -1; }
      }
    }
    for (const v of combo.values) {
      if (!v.bounds) continue;
      if (v.bounds.min > v.bounds.max) v.bounds = { min: v.bounds.max, max: v.bounds.min };
      if (v.roll > v.bounds.max) { v.bounds.max = v.roll; legacy = true; }
      if (v.roll < v.bounds.min) { v.bounds.min = v.roll; legacy = true; }
    }
    if (!combo.values.length && found.matcher.value) {
      combo.values = [{ roll: found.matcher.value, decimal: false, bounds: { min: found.matcher.value, max: found.matcher.value } }];
    }
    return {
      stat: found.stat,
      translation: found.matcher,
      source: statStr.source,
      // Display text without advanced-copy ranges: "+52(50-59) to maximum Life" -> "+52 to maximum Life"
      text: statStr.string.replace(/(\d)\([^)]*\)/g, '$1').replace(/\n/g, ' / '),
      roll: combo.values.length
        ? {
          unscalable: statStr.unscalable,
          legacy,
          dp: !!found.stat.dp || combo.values.some((v) => v.decimal),
          value: avg(combo.values.map((v) => v.roll)),
          min: avg(combo.values.map((v) => (v.bounds ? v.bounds.min : v.roll))),
          max: avg(combo.values.map((v) => (v.bounds ? v.bounds.max : v.roll))),
          ranged: combo.values.every((v) => !!v.bounds),
        }
        : undefined,
    };
  }
  return undefined;
}

function avg(values) {
  return values.length === 2 ? (values[0] + values[1]) / 2 : values[0];
}

function findAndResolve(matchStr, modType, category, roll, data) {
  const entry = data.byMatchStr(matchStr);
  if (!entry) return undefined;
  const stat = entry.stats ? resolveGroup(entry, matchStr, modType, category, roll) : entry;
  if (!stat) return undefined;
  const matcher = stat.matchers.find((m) => m.string === matchStr || m.advanced === matchStr);
  return matcher ? { stat, matcher } : undefined;
}

function resolveGroup(group, matchStr, modType, category, roll) {
  const { resolve, stats } = group;
  if (resolve.strat === 'select') {
    let idx = resolve.test.findIndex((t) => t !== null && testCategory(category, t));
    if (idx === -1) idx = resolve.test.indexOf(null);
    return idx !== -1 ? stats[idx] : undefined;
  }
  const onTrade = stats.filter((s) => modType in s.trade.ids);
  if (onTrade.length === 1) return onTrade[0];
  const hasMatcher = (s) => s.matchers.some((m) => m.string === matchStr || m.advanced === matchStr);

  if (resolve.strat === 'trivial-merge') {
    const withStr = matchStr.length ? onTrade.filter(hasMatcher) : onTrade;
    if (!withStr.length) return undefined;
    const merged = withStr[0];
    for (const s of withStr) if (s !== merged) mergeTradeIds(merged, s);
    return merged;
  }
  if (resolve.strat === 'percent-merge') {
    const pct = stats[resolve.kind.indexOf('percent')];
    const matcher = pct.matchers.find((m) => m.string === matchStr || m.advanced === matchStr);
    if (matcher && matcher.value === 100) {
      const other = stats[resolve.kind.indexOf('value')];
      const flag = other.matchers.length === 1 && !other.matchers[0].string.includes('#');
      mergeTradeIds(pct, other, flag ? '{empty_if_100}' : '{div_by_100}');
      return pct;
    }
    return stats.find(hasMatcher);
  }
  if (resolve.strat === 'flag-merge') {
    if (roll === undefined) return undefined;
    const val = stats[resolve.kind.indexOf('value')];
    const flag = stats[resolve.kind.indexOf('flag')];
    if (roll === flag.matchers[0].value) mergeTradeIds(val, flag, '{empty}');
    return val;
  }
  return undefined;
}

function mergeTradeIds(dest, source, prefix) {
  for (const type in source.trade.ids) {
    let id = source.trade.ids[type][0];
    if (prefix) id = prefix + id;
    if (dest.trade.ids[type]) {
      if (!dest.trade.ids[type].includes(id)) dest.trade.ids[type].push(id);
    } else {
      dest.trade.ids[type] = [id];
    }
  }
}

function testCategory(actual, expected) {
  if (!actual) return false;
  if (expected === 'WEAPON') return WEAPON.has(actual);
  if (expected === 'ARMOUR') return ARMOUR.has(actual);
  if (expected === 'HEIST_EQUIPMENT') return false;
  return expected === actual;
}

module.exports = { parseMods, itemCategory, parseModInfoLine, linesToStatStrings };
