'use strict';
// Stat translation data for matching item mod text to official trade API stat ids.
//
// data/trade/stats.ndjson is copied from Awakened PoE Trade (MIT, (c) 2020 Alexander Drozdov,
// https://github.com/SnosMe/awakened-poe-trade, renderer/public/data/en/stats.ndjson).
// See data/trade/LICENSE-awakened-poe-trade. Each line is either a Stat or a StatGroup:
//   Stat      { ref, better, matchers: [{ string, advanced?, negate?, value? }], trade: { ids: { explicit: [...], ... }, inverted?, option? }, dp? }
//   StatGroup { resolve: { strat, ... }, stats: Stat[] }
// To update for a new patch, copy the same file from a newer APT release.

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'trade', 'stats.ndjson');

class StatData {
  constructor(lines) {
    this.byMatcher = new Map(); // matcher string -> raw JSON line
    this.byRef = new Map(); // ref -> raw JSON line
    for (const line of lines) {
      if (!line) continue;
      const entry = JSON.parse(line);
      const stats = entry.stats || [entry];
      for (const stat of stats) {
        if (!this.byRef.has(stat.ref)) this.byRef.set(stat.ref, line);
        for (const m of stat.matchers) {
          if (!this.byMatcher.has(m.string)) this.byMatcher.set(m.string, line);
          if (m.advanced && !this.byMatcher.has(m.advanced)) this.byMatcher.set(m.advanced, line);
        }
      }
    }
  }

  static load(file = DEFAULT_FILE) {
    return new StatData(fs.readFileSync(file, 'utf8').split('\n'));
  }

  // Fresh copy each call, because resolving a group may merge trade ids into a stat.
  byMatchStr(str) {
    const line = this.byMatcher.get(str);
    return line ? JSON.parse(line) : undefined;
  }

  // Pseudo stats share refs with real ones inside groups; prefer the one that has a pseudo trade id.
  pseudoByRef(ref) {
    const line = this.byRef.get(ref);
    if (!line) return undefined;
    const entry = JSON.parse(line);
    if (!entry.stats) return entry;
    return entry.stats.find((s) => s.ref === ref && s.trade.ids.pseudo);
  }
}

let shared;
function statData() {
  if (!shared) shared = StatData.load();
  return shared;
}

module.exports = { StatData, statData };
