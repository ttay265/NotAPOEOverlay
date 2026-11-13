'use strict';
// Loads the act-by-act campaign route and turns it into steps the overlay can follow.
//
// The route files in data/leveling/routes are Exile-Leveling's base route (MIT licence, see
// data/leveling/LICENSE-exile-leveling), the route speedrunners keep current. Format, one step per line:
//   ➞ {enter|1_1_4_0} #The Flooded Depths      a step; {kind|args} are fragments, "#..." is a comment
//       #sub Go right of the bridge             a tip for the step above (layout / navigation hint)
//   #section Act 1                              starts an act
//   #ifdef LEAGUE_START ... #endif              optional blocks, switched by route options
// Area ids (1_1_4_0) are the game's internal ids, the same ones Client.txt logs when you change zone.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'leveling');
const AREAS = require(path.join(DATA_DIR, 'areas.json'));
const QUESTS = require(path.join(DATA_DIR, 'quests.json'));

const ARROWS = { 0: '↑', 45: '↗', 90: '→', 135: '↘', 180: '↓', 225: '↙', 270: '←', 315: '↖' };

// Route options -> #ifdef flags. Bandit choice follows the game: kill all three for a passive point,
// or help one (the route kills the other two).
function flagsFor({ leagueStart = true, bandit = 'kill_all', library = false } = {}) {
  const flags = new Set();
  if (leagueStart) flags.add('LEAGUE_START');
  if (library) flags.add('LIBRARY');
  const b = String(bandit).toLowerCase();
  if (b === 'alira') flags.add('BANDIT_ALIRA');
  else if (b === 'kraityn') flags.add('BANDIT_KRAITYN');
  else if (b === 'oak') flags.add('BANDIT_OAK');
  else flags.add('BANDIT_KILL');
  return flags;
}

// "Find and kill {kill|Hillock}, take {quest_text|Chest}" -> [{t:'text'},{t:'kill'},...]
function parseFragments(text) {
  const out = [];
  const re = /\{([a-z_]+)(?:\|([^}]*))?\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    out.push({ t: m[1], args: m[2] != null ? m[2].split('|') : [] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

function stripComment(line) {
  // "#" starts a comment unless it is a directive at line start. Quest names never contain "#".
  const i = line.indexOf('#');
  return i === -1 ? line : line.slice(0, i);
}

function parseRoute(sources, options = {}) {
  const flags = flagsFor(options);
  const steps = [];
  let act = 0;
  for (const src of sources) {
    const stack = []; // active state of nested #ifdef blocks
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const active = stack.every(Boolean);
      let m;
      if ((m = /^#ifdef\s+(\w+)/.exec(line))) { stack.push(flags.has(m[1])); continue; }
      if ((m = /^#ifndef\s+(\w+)/.exec(line))) { stack.push(!flags.has(m[1])); continue; }
      if (/^#endif/.test(line)) { stack.pop(); continue; }
      if (!active) continue;
      if ((m = /^#section\s+Act\s+(\d+)/i.exec(line))) { act = Number(m[1]); continue; }
      if ((m = /^#sub\s+(.*)$/.exec(line))) {
        if (steps.length) steps[steps.length - 1].subs.push(parseFragments(m[1].trim()));
        continue;
      }
      if (line.startsWith('#')) continue;
      const frags = parseFragments(stripComment(line).trim());
      const step = { i: steps.length, act, frags, subs: [], arrive: null, quests: [] };
      for (const f of frags) {
        if ((f.t === 'enter' || f.t === 'waypoint') && f.args[0]) step.arrive = f.args[0];
        if (f.t === 'quest' && f.args[0]) step.quests.push(f.args[0]);
      }
      steps.push(step);
    }
  }
  // Where the player stands for each step: the last area arrived at, at or before it.
  let at = null;
  for (const s of steps) {
    if (s.arrive) at = s.arrive;
    s.at = at;
    const rec = s.subs.flat().map((f) => (f.t === 'text' ? f.v : '')).join(' ').match(/Recommended Level:\s*(\d+)/i);
    if (rec) s.recommendedLevel = Number(rec[1]);
  }
  return steps;
}

function loadRoute(options = {}) {
  const dir = path.join(DATA_DIR, 'routes');
  const sources = [];
  for (let n = 1; n <= 10; n++) sources.push(fs.readFileSync(path.join(dir, `act-${n}.txt`), 'utf8'));
  return parseRoute(sources, options);
}

// Fragments -> display tokens {k: style, v: text}. The renderer only ever sets textContent.
function renderFragments(frags, ctx = {}) {
  const out = [];
  for (const f of frags) {
    const a = f.args || [];
    switch (f.t) {
      case 'text': out.push({ k: 'text', v: f.v.replace(/➞/g, '→') }); break;
      case 'enter': out.push({ k: 'area', v: areaName(a[0]) }); break;
      case 'area': out.push({ k: 'area', v: areaName(a[0]) }); break;
      case 'waypoint':
        if (a[0]) out.push({ k: 'wp', v: 'Waypoint' }, { k: 'text', v: ' to ' }, { k: 'area', v: areaName(a[0]) });
        else out.push({ k: 'wp', v: 'waypoint' });
        break;
      case 'waypoint_get': out.push({ k: 'wp', v: 'the waypoint' }); break;
      case 'logout': out.push({ k: 'logout', v: 'Log out to character select (back to town)' }); break;
      case 'portal': out.push({ k: 'wp', v: a[0] === 'set' ? 'a portal' : 'your portal' }); break;
      case 'quest': out.push({ k: 'quest', v: (QUESTS[a[0]] && QUESTS[a[0]].name) || a[0] }); break;
      case 'quest_text': out.push({ k: 'item', v: a[0] }); break;
      case 'kill': out.push({ k: 'kill', v: a[0] }); break;
      case 'arena': out.push({ k: 'area', v: a[0] }); break;
      case 'generic': out.push({ k: 'generic', v: a[0] }); break;
      case 'trial': out.push({ k: 'trial', v: 'the Trial of Ascendancy' }); break;
      case 'ascend': out.push({ k: 'trial', v: `the ${cap(a[0] || 'normal')} Labyrinth` }); break;
      case 'crafting': {
        const where = a[0] || ctx.areaId;
        const recipes = where && AREAS[where] ? AREAS[where].recipes : [];
        out.push({ k: 'generic', v: recipes && recipes.length ? `crafting recipe (${recipes.join(', ')})` : 'the crafting recipe' });
        break;
      }
      case 'dir': out.push({ k: 'dir', v: ARROWS[Number(a[0]) % 360] || `${a[0]}°` }); break;
      default: out.push({ k: 'text', v: a.join(' ') || f.t });
    }
  }
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const areaName = (id) => (AREAS[id] ? AREAS[id].name : id);

module.exports = { parseRoute, loadRoute, parseFragments, renderFragments, flagsFor, AREAS, QUESTS, areaName };
