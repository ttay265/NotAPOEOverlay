'use strict';
// Every campaign quest that gives passive skill points (PoE 1, 3.x campaign).
// 22 quests + killing all three bandits = 24 points ("An End to Hunger" gives 2).
// Type /passives in game chat to see which ones you have.
//
// zones: area ids where the objective is, so the overlay can say "passive point here".
// act: the act whose route you do it in (The Way Forward is an Act 1 quest finished in Act 2).
// Sources: Exile-Leveling quest data (reward books), mobalytics.gg side-quest passive list,
// Maxroll campaign guide.

const PASSIVE_QUESTS = [
  { id: 'a1q7', act: 1, points: 1, name: 'The Dweller of the Deep', zones: ['1_1_4_0'], npc: 'Tarkleigh',
    todo: 'Kill the Dweller of the Deep in the Flooded Depths (off the Submerged Passage, right of the bridge).' },
  { id: 'a1q6', act: 1, points: 1, name: 'The Marooned Mariner', zones: ['1_1_9', '1_1_9a'], npc: 'Bestel',
    todo: 'Take the Allflame in the Ship Graveyard Cave, then kill Captain Fairgraves in the Ship Graveyard.' },
  { id: 'a1q9', act: 2, points: 1, name: 'The Way Forward', zones: ['1_2_9'], npc: 'Bestel (Act 1 town)',
    todo: 'Kill Captain Arteri in the Western Forest, open the gate with the Thaumetic Emblem, then talk to Bestel in Lioneye\'s Watch.' },
  { id: 'a2q5', act: 2, points: 1, name: 'Through Sacred Ground', zones: ['1_2_5_2'], npc: 'Yeena', respec: 2,
    todo: 'Take the Golden Hand from the altar in the Crypt Level 2.' },
  { id: 'a2q7', act: 2, points: 1, name: 'Deal with the Bandits (kill all)', zones: ['1_2_4', '1_2_9', '1_2_12'], npc: 'Eramir',
    todo: 'Kill Kraityn (Broken Bridge), Alira (Western Forest) and Oak (Wetlands). Helping one instead gives no passive.' , banditOnly: true },
  { id: 'a3q11', act: 3, points: 1, name: "Victario's Secrets", zones: ['1_3_10_1'], npc: 'Hargan', respec: 2,
    todo: 'Find all three Platinum Busts in the Sewers (under stashes, guarded by magic packs).' },
  { id: 'a3q9', act: 3, points: 1, name: "Piety's Pets", zones: ['1_3_14_2'], npc: 'Grigor',
    todo: 'Kill Piety in the Lunaris Temple Level 2.' },
  { id: 'a4q6', act: 4, points: 1, name: 'An Indomitable Spirit', zones: ['1_4_3_2'], npc: 'Tasuni', respec: 2,
    todo: "Free Deshret's Spirit in the Mines Level 2." },
  { id: 'a5q3', act: 5, points: 1, name: 'In Service to Science', zones: ['1_5_2'], npc: 'Vilenta',
    todo: 'Take the Miasmeter in the Control Blocks, then hand it in at Overseer\'s Tower.' },
  { id: 'a5q7', act: 5, points: 1, name: "Kitava's Torments", zones: ['1_5_7'], npc: 'Lani', respec: 2,
    todo: "Collect the three Kitava's Torments from the corners of the Reliquary." },
  { id: 'a6q3', act: 6, points: 1, name: 'The Father of War', zones: ['2_6_5'], npc: 'Tarkleigh',
    todo: "Kill Tukohama in Tukohama's Keep (Karui Fortress)." },
  { id: 'a6q7', act: 6, points: 1, name: 'The Cloven One', zones: ['2_6_8'], npc: 'Bestel',
    todo: 'Kill Abberath in the Valley of the Fire Drinker (Prisoner\'s Gate).' },
  { id: 'a6q6', act: 6, points: 1, name: 'The Puppet Mistress', zones: ['2_6_11'], npc: 'Tarkleigh',
    todo: 'Kill Ryslatha in the Spawning Ground (Wetlands).' },
  { id: 'a7q1', act: 7, points: 1, name: 'The Master of a Million Faces', zones: ['2_7_7'], npc: 'Eramir',
    todo: 'Kill Greust in the Forest Encampment arena of the Ashen Fields.' },
  { id: 'a7q6', act: 7, points: 1, name: "Kishara's Star", zones: ['2_7_10'], npc: 'Weylam Roth', respec: 2,
    todo: "Take Kishara's Star from the lockbox in the Causeway (near the Vaal City entrance)." },
  { id: 'a7q9', act: 7, points: 1, name: 'Queen of Despair', zones: ['2_7_9'], npc: 'Eramir',
    todo: 'Collect 7 Fireflies in the Dread Thicket, then kill Gruthkul in the Den of Despair.' },
  { id: 'a8q6', act: 8, points: 1, name: 'Love is Dead', zones: ['2_8_8'], npc: 'Clarissa', respec: 2,
    todo: 'Take the Ankh of Eternity in the Quay, then kill Tolman at the Resurrection Site.' },
  { id: 'a8q7', act: 8, points: 1, name: 'The Gemling Legion', zones: ['2_8_9'], npc: 'Maramoa',
    todo: 'Kill the Gemling Legionnaires in the Grain Gate.' },
  { id: 'a8q4', act: 8, points: 1, name: 'Reflection of Terror', zones: ['2_8_4'], npc: 'Hargan',
    todo: 'Kill Yugul in the Pools of Terror (High Gardens, reached from the Bath House).' },
  { id: 'a9q5', act: 9, points: 1, name: 'Queen of the Sands', zones: ['2_9_4'], npc: 'Irasha',
    todo: 'Kill Shakari in the Sand Pit (Oasis).' },
  { id: 'a9q2', act: 9, points: 1, name: 'The Ruler of Highgate', zones: ['2_9_8'], npc: 'Irasha',
    todo: 'Kill Garukhan at the Shrine of the Winds in the Quarry.' },
  { id: 'a10q6', act: 10, points: 1, name: "Vilenta's Vengeance", zones: ['2_10_7'], npc: 'Lani',
    todo: 'Kill Vilenta in the Control Blocks (from the Ravaged Square).' },
  { id: 'a10q3', act: 10, points: 2, name: 'An End to Hunger', zones: ['2_10_6'], npc: 'Lani',
    todo: 'Kill Kitava in the Feeding Trough, then talk to Lani in Oriath.' },
];

function passiveQuests({ bandit = 'kill_all' } = {}) {
  const killAll = !['alira', 'kraityn', 'oak'].includes(String(bandit).toLowerCase());
  return PASSIVE_QUESTS.filter((q) => killAll || !q.banditOnly);
}

const totalPoints = (opts) => passiveQuests(opts).reduce((n, q) => n + q.points, 0);

module.exports = { PASSIVE_QUESTS, passiveQuests, totalPoints };
