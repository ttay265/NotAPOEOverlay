// Trimmed responses in poe.ninja's currencyoverview / itemoverview shape.
module.exports = {
  Currency: { lines: [
    { currencyTypeName: 'Divine Orb', chaosEquivalent: 150, receive: { listing_count: 900 } },
    { currencyTypeName: 'Chaos Orb', chaosEquivalent: 1 },
  ] },
  Fragment: { lines: [] },
  UniqueArmour: { lines: [
    { name: "Kaom's Heart", baseType: 'Glorious Plate', chaosValue: 30, listingCount: 120 },
    { name: "Kaom's Heart", baseType: 'Glorious Plate', chaosValue: 600, links: 6, listingCount: 3 },
  ] },
  SkillGem: { lines: [
    { name: 'Arc', gemLevel: 20, gemQuality: 20, corrupted: false, chaosValue: 5, listingCount: 50 },
    { name: 'Arc', gemLevel: 21, gemQuality: 20, corrupted: true, chaosValue: 40, listingCount: 20 },
    { name: 'Arc', gemLevel: 20, gemQuality: 20, corrupted: true, chaosValue: 3, listingCount: 30 },
  ] },
  DivinationCard: { lines: [{ name: 'The Doctor', baseType: 'The Doctor', chaosValue: 900, listingCount: 40 }] },
  Map: { lines: [{ name: 'Strand Map', baseType: 'Strand Map', mapTier: 16, chaosValue: 2, listingCount: 200 }] },
};
