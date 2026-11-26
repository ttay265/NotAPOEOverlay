'use strict';
// Trade search for comparable Mercenary Warrants, and the value hints shown on the panel.
//
// How the trade site (Covens league) indexes warrants: every merc skill and every support gem is a
// stat in the "mercenary" group (ids like mercenary.skill_11054, mercenary.support_45284).
//  - an "and" group needs each listed skill somewhere on the warrant
//  - a "not" group rejects warrants with any listed skill
// Support gems are icons in the hire window, so OCR cannot name them; the search matches skills
// and the panel shows how many supports each skill has. Refine supports on the trade site.

// selected: { required: [skill ids], excludeTravel: bool }
function buildMercQuery(merc, catalog, { required, excludeTravel, status = 'available' } = {}) {
  const req = required || defaultRequired(merc);
  const noTravel = excludeTravel ?? !merc.skills.some((s) => s.travel);
  const stats = [];
  if (req.length) stats.push({ type: 'and', filters: [...new Set(req)].map((id) => ({ id })) });
  if (noTravel && catalog.travelIds.length) stats.push({ type: 'not', filters: catalog.travelIds.map((id) => ({ id })) });
  return {
    query: {
      status: { option: status },
      stats,
      filters: { trade_filters: { filters: { sale_type: { option: 'priced' } } } },
    },
    sort: { price: 'asc' },
  };
}

// By default compare on every skill except travel skills (those are handled by excludeTravel).
function defaultRequired(merc) {
  return merc.skills.filter((s) => !s.travel).map((s) => s.id);
}

function tradeSearchUrl(league, body) {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(body))}`;
}

// Plain hints on what usually moves the price, so the number has context.
function valueHints(merc) {
  const hints = [];
  const travel = merc.skills.filter((s) => s.travel);
  if (merc.skills.length) {
    hints.push(travel.length
      ? { good: false, text: `Has travel skill: ${travel.map((s) => s.name).join(', ')}` }
      : { good: true, text: 'No travel skill (usually worth more)' });
  }
  if (merc.infamous) hints.push({ good: true, text: 'Infamous merc (rarer)' });
  if (merc.level != null) hints.push({ good: merc.level >= 83, text: `Level ${merc.level}` });
  const linked = merc.skills.filter((s) => (s.supports || 0) >= 5);
  if (linked.length) hints.push({ good: true, text: `Fully linked: ${linked.map((s) => s.name).join(', ')}` });
  const trarthus = merc.skills.filter((s) => /Trarthus|Trarthan/.test(s.name));
  if (trarthus.length) hints.push({ good: true, text: `Trarthus skill: ${trarthus.map((s) => s.name).join(', ')}` });
  return hints;
}

module.exports = { buildMercQuery, defaultRequired, tradeSearchUrl, valueHints };
