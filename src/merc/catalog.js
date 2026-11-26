'use strict';
// Mercenary skill / support / archetype names and their trade API ids (data/merc/catalog.json),
// plus fuzzy matching so OCR text with a few wrong letters still finds the right skill.

const path = require('path');

let cached;
function loadCatalog() {
  if (!cached) cached = indexCatalog(require(path.join(__dirname, '..', '..', 'data', 'merc', 'catalog.json')));
  return cached;
}

// Skills a merc uses to move around. Tuan's rule of thumb: mercs without one sell for more,
// because a travel skill makes the merc jump around (and away from the player).
const TRAVEL_SKILLS = [
  'Flame Dash', 'Greater Flame Dash', 'Frostblink', 'Dash', 'Charged Dash of the Arcane', 'Leap Slam',
  'Lightning Warp', 'Bloody Warp', 'Shield Charge', 'Whirling Blades', 'Blink Arrow', 'Smoke Mine',
  'Bodyswap', 'Withering Step',
];

const norm = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, '');

function indexCatalog(raw, { travel = TRAVEL_SKILLS } = {}) {
  const travelSet = new Set(travel.map(norm));
  const skills = raw.skills.map((s) => ({ ...s, key: norm(s.name), travel: travelSet.has(norm(s.name)) }));
  const archetypes = raw.archetypes.map((a) => ({ ...a, key: norm(a.name) }));
  const byName = new Map();
  for (const s of skills) if (!byName.has(s.key)) byName.set(s.key, s);
  return {
    skills, archetypes, supports: raw.supports,
    skillByName: (name) => byName.get(norm(name)) || null,
    travelIds: skills.filter((s) => s.travel).map((s) => s.id),
  };
}

// Levenshtein distance, small strings only.
function distance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const similarity = (a, b) => (a.length || b.length ? 1 - distance(a, b) / Math.max(a.length, b.length) : 1);

// Best skill for one OCR'd line. The line may carry junk after the name ("GRACE | oo"), so the
// name is compared with the start of the line too. When both "Spectral Helix" and "Spectral Helix
// of Trarthus" fit, the longer one wins.
function matchSkill(line, catalog, minScore = 0.8) {
  const text = norm(line);
  if (text.length < 3) return null;
  const hits = [];
  for (const s of catalog.skills) {
    const score = Math.max(similarity(text, s.key), text.length > s.key.length ? similarity(text.slice(0, s.key.length), s.key) : 0);
    if (score >= minScore) hits.push({ skill: s, score });
  }
  if (!hits.length) return null;
  const top = Math.max(...hits.map((h) => h.score));
  return hits.filter((h) => h.score >= top - 0.1).sort((a, b) => b.skill.key.length - a.skill.key.length || b.score - a.score)[0];
}

// Archetype named anywhere in a line ("Blade Ambusher  Lvl 83  Dex / Int").
function matchArchetype(text, catalog, minScore = 0.8) {
  const t = norm(text);
  let best = null;
  for (const a of catalog.archetypes) {
    for (let i = 0; i + a.key.length - 2 <= t.length; i++) {
      for (const len of [a.key.length - 1, a.key.length, a.key.length + 1]) {
        const score = similarity(t.slice(i, i + len), a.key);
        if (score >= minScore && (!best || score > best.score || (score === best.score && a.key.length > best.archetype.key.length))) {
          best = { archetype: a, score };
        }
      }
    }
  }
  return best;
}

module.exports = { loadCatalog, indexCatalog, matchSkill, matchArchetype, similarity, norm, TRAVEL_SKILLS };
