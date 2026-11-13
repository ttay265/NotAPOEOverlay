'use strict';
// Parses the text Path of Exile 1 puts on the clipboard when you hover an item
// and press Ctrl+C (or Ctrl+Alt+C for the advanced description).
// English client only.

const SEP = '--------';

function parseItem(text) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\r/g, '').trim();
  if (!clean.startsWith('Item Class:')) return null;

  const sections = clean
    .split(SEP)
    .map((s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('{')))
    .filter((s) => s.length);

  const header = sections[0];
  const item = {
    itemClass: valueOf(header, 'Item Class'),
    rarity: valueOf(header, 'Rarity'),
    name: null,
    baseType: null,
    stackSize: 1,
    itemLevel: null,
    gemLevel: null,
    quality: 0,
    mapTier: null,
    links: 0,
    sockets: null,
    corrupted: false,
    mirrored: false,
    unidentified: false,
    raw: clean,
  };
  if (!item.itemClass || !item.rarity) return null;

  const names = header.filter((l) => !l.startsWith('Item Class:') && !l.startsWith('Rarity:'));
  if (names.length >= 2) {
    item.name = names[0];
    item.baseType = names[1];
  } else {
    item.name = names[0] || null;
    item.baseType = names[0] || null;
  }

  for (const line of sections.slice(1).flat()) {
    let m;
    if ((m = line.match(/^Stack Size: ([\d,.\s]+)\/[\d,.\s]+/))) item.stackSize = toInt(m[1]);
    else if ((m = line.match(/^Item Level: (\d+)/))) item.itemLevel = +m[1];
    else if ((m = line.match(/^Level: (\d+)/)) && item.rarity === 'Gem' && item.gemLevel === null) item.gemLevel = +m[1]; // first Level: line; later one is the requirement
    else if ((m = line.match(/^Quality(?: \([^)]+\))?: \+(\d+)%/))) item.quality = +m[1];
    else if ((m = line.match(/^Map Tier: (\d+)/))) item.mapTier = +m[1];
    else if ((m = line.match(/^Sockets: (.+)$/))) {
      item.sockets = m[1].trim();
      item.links = maxLinks(item.sockets);
    } else if (line === 'Corrupted') item.corrupted = true;
    else if (line === 'Mirrored') item.mirrored = true;
    else if (line === 'Unidentified') item.unidentified = true;
  }

  // Magic items put prefix/suffix around the base name; we can't reliably strip them
  // without base-type data, so keep the full name as both fields for now.
  return item;
}

function valueOf(lines, key) {
  const line = lines.find((l) => l.startsWith(key + ':'));
  return line ? line.slice(key.length + 1).trim() : null;
}

function toInt(s) {
  return parseInt(String(s).replace(/[\s,.]/g, ''), 10) || 1;
}

// "R-R-R G-B-B" -> 3. Space separates groups, dash links sockets in a group.
function maxLinks(sockets) {
  return Math.max(0, ...sockets.split(/\s+/).filter(Boolean).map((g) => g.split('-').length));
}

module.exports = { parseItem, maxLinks };
