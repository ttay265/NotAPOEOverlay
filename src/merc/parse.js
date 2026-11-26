'use strict';
// Turn OCR text (hire window) or copied text (Ctrl+C on a warrant) into a merc description:
// { archetype, attribute, level, infamous, skills: [{ id, name, travel, supports }] }

const { matchSkill, matchArchetype } = require('./catalog');

// header: the OCR text of the header strip. lines: [{ text, y }] from the skill column.
function mercFromOcr({ header = '', lines = [] }, catalog) {
  const merc = headerInfo(header, catalog);
  const seen = new Set();
  for (const line of lines) {
    const hit = matchSkill(line.text, catalog);
    if (!hit || seen.has(hit.skill.id)) continue;
    seen.add(hit.skill.id);
    merc.skills.push({ id: hit.skill.id, name: hit.skill.name, travel: hit.skill.travel, y: line.y, supports: null });
  }
  return merc;
}

function headerInfo(text, catalog) {
  const arch = matchArchetype(text, catalog);
  // OCR often reads "Lvl" as "LvI" or "Lv1".
  const lvl = /L\s*v\s*[lI1|]?\s*(\d{1,3})/i.exec(text) || /Level:?\s*(\d{1,3})/i.exec(text);
  const attr = /(Str|Dex|Int)\s*[/|\[\]lI1]?\s*(Str|Dex|Int)?/i.exec(text.replace(/Lvl.*?\d+/i, ''));
  const level = lvl ? Number(lvl[1]) : null;
  return {
    archetype: arch ? arch.archetype.name : null,
    attribute: arch ? arch.archetype.attribute : (attr ? [attr[1], attr[2]].filter(Boolean).map(cap).join(' / ') : null),
    level: level && level <= 100 ? level : null,
    infamous: /infamous/i.test(text),
    skills: [],
  };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

// Ctrl+C text of a Mercenary Warrant (format not confirmed yet): any line that names a merc skill
// is a skill; a support line right under a skill (by name match) counts as one of its supports.
function mercFromText(text, catalog) {
  if (!/mercenar|warrant/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const merc = headerInfo(lines.slice(0, 6).join('  '), catalog);
  const supportByName = new Map(catalog.supports.map((s) => [s.name.replace(/\s*\(Tier \d\)$/, '').toLowerCase(), s]));
  let current = null;
  for (const line of lines) {
    const sup = supportByName.get(line.replace(/\s*support$/i, '').replace(/\s*\(Tier \d\)$/, '').toLowerCase());
    if (sup && current) { current.supports = (current.supports || 0) + 1; current.supportIds.push(sup.id); continue; }
    const hit = matchSkill(line, catalog, 0.95);
    if (hit && hit.skill.key.length >= line.replace(/[^A-Za-z]/g, '').length - 2) {
      current = { id: hit.skill.id, name: hit.skill.name, travel: hit.skill.travel, supports: 0, supportIds: [] };
      merc.skills.push(current);
    }
  }
  return merc.skills.length ? merc : null;
}

module.exports = { mercFromOcr, mercFromText, headerInfo };
