'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLine, ClientLogWatcher } = require('../src/leveling/clientlog');
const { parseRoute, loadRoute, parseFragments, renderFragments, AREAS } = require('../src/leveling/route');
const { LevelingTracker } = require('../src/leveling/tracker');
const { passiveQuests, totalPoints } = require('../src/leveling/passives');
const { ZONE_TIPS } = require('../src/leveling/zonetips');

test('parses Client.txt zone, entered and level lines', () => {
  assert.deepStrictEqual(parseLine('2026/11/13 10:01:00 1 cff945b9 [DEBUG Client 42] Generating level 2 area "1_1_2" with seed 9'),
    { type: 'area', areaLevel: 2, areaId: '1_1_2' });
  assert.deepStrictEqual(parseLine('2026/11/13 10:01:01 1 cff945b9 [INFO Client 42] : You have entered The Coast.'),
    { type: 'entered', name: 'The Coast' });
  assert.deepStrictEqual(parseLine('2026/11/13 10:01:01 1 cff945b9 [INFO Client 42] : Tuan (Witch) is now level 5'),
    { type: 'level', character: 'Tuan', className: 'Witch', level: 5 });
});

test('chat lines cannot fake system messages', () => {
  assert.strictEqual(parseLine('2026/11/13 10:01:30 1 cff945b9 [INFO Client 42] #Troll: Fake (Witch) is now level 99'), null);
  assert.strictEqual(parseLine('2026/11/13 10:01:31 1 cff945b9 [INFO Client 42] @From Troll: : You have entered The Fake Zone.'), null);
});

test('route loads all ten acts and every area id is known', () => {
  const steps = loadRoute();
  assert.ok(steps.length > 400);
  assert.deepStrictEqual([...new Set(steps.map((s) => s.act))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const unknown = steps.filter((s) => s.arrive && !AREAS[s.arrive] && !/Labyrinth/.test(s.arrive)).map((s) => s.arrive);
  assert.deepStrictEqual(unknown, []);
});

test('route options switch #ifdef blocks', () => {
  const src = '#section Act 1\nA\n#ifdef LEAGUE_START\n    B\n#endif\n#ifndef BANDIT_KILL\n    C\n#endif\nD\n    #sub tip {dir|90}';
  const texts = (o) => parseRoute([src], o).map((s) => s.frags[0].v);
  assert.deepStrictEqual(texts({ leagueStart: true }), ['A', 'B', 'D']);
  assert.deepStrictEqual(texts({ leagueStart: false, bandit: 'alira' }), ['A', 'C', 'D']);
  const last = parseRoute([src])[2];
  assert.deepStrictEqual(renderFragments(last.subs[0]).map((t) => t.v), ['tip ', '→']);
});

test('fragments render to plain tokens', () => {
  const t = renderFragments(parseFragments('Kill {kill|Hillock} ➞ {enter|1_1_town} #comment'.replace(/#.*/, '')));
  assert.deepStrictEqual(t.map((x) => [x.k, x.v]), [['text', 'Kill '], ['kill', 'Hillock'], ['text', ' → '], ['area', "Lioneye's Watch"], ['text', ' ']]);
});

test('tracker follows an Act 1 log and does not skip ahead on town visits', () => {
  const t = new LevelingTracker();
  const log = fs.readFileSync(path.join(__dirname, 'fixtures', 'client-act1.txt'), 'utf8').split(/\r?\n/);
  const seen = [];
  for (const line of log) {
    const ev = parseLine(line);
    if (!ev) continue;
    if (ev.type === 'area') { t.enterArea(ev.areaId, ev.areaLevel); seen.push(t.view()); }
    if (ev.type === 'entered') t.entered(ev.name);
    if (ev.type === 'level') t.setLevel(ev.character, ev.className, ev.level);
  }
  // A town trip from the Submerged Passage (step 6) keeps the guide on the Submerged Passage.
  assert.strictEqual(seen[5].zone.name, "Lioneye's Watch");
  assert.strictEqual(seen[5].routeZone.name, 'The Submerged Passage');
  assert.ok(seen[5].offRoute);
  // Flooded Depths shows the passive point.
  assert.strictEqual(seen[7].zone.name, 'The Flooded Depths');
  assert.deepStrictEqual(seen[7].passives.here.map((q) => q.id), ['a1q7']);
  // Hideout: off route, keeps the Ledge as the guide position, uses the logged name.
  assert.strictEqual(seen[10].zone.name, 'Zone10');
  assert.strictEqual(seen[10].routeZone.name, 'The Ledge');
  // Town after the Lower Prison is on the route: hand in the Dweller there.
  const town = seen[13];
  assert.ok(!town.offRoute);
  assert.ok(town.todo.some((s) => s.passive && s.tokens.some((x) => x.v === 'The Dweller of the Deep')));
  const end = seen[seen.length - 1];
  assert.strictEqual(end.zone.name, 'The Lower Prison');
  assert.strictEqual(end.next.area, 'The Upper Prison');
  assert.strictEqual(end.character.level, 5);
});

test('starting mid-campaign jumps straight to the current zone', () => {
  const t = new LevelingTracker();
  t.enterArea('2_8_8', 57);
  const v = t.view();
  assert.strictEqual(v.act, 8);
  assert.strictEqual(v.zone.name, 'The Quay');
  assert.ok(v.passives.here.some((q) => q.id === 'a8q6'));
  // Earlier passives are listed as "did you get these?" until ticked.
  assert.ok(v.passives.missed.some((q) => q.id === 'a1q7'));
  t.toggleDone('a1q7');
  assert.ok(!t.view().passives.missed.some((q) => q.id === 'a1q7'));
});

test('prev / next move one zone at a time', () => {
  const t = new LevelingTracker();
  t.step(1); t.step(1);
  assert.strictEqual(t.view().routeZone.name, 'The Coast');
  t.step(-1);
  assert.strictEqual(t.view().routeZone.name, "Lioneye's Watch");
});

test('passive quest list adds up to 24 (23 when helping a bandit)', () => {
  assert.strictEqual(totalPoints({}), 24);
  assert.strictEqual(totalPoints({ bandit: 'alira' }), 23);
  for (const q of passiveQuests()) for (const z of q.zones) assert.ok(AREAS[z], `${q.id} zone ${z}`);
  for (const id of Object.keys(ZONE_TIPS)) assert.ok(AREAS[id], `tip zone ${id}`);
  // Every passive quest is handed in somewhere on the default route.
  const t = new LevelingTracker();
  assert.deepStrictEqual(passiveQuests().filter((q) => t.handIn[q.id] == null).map((q) => q.id), []);
});

test('watcher backfills the tail of the log, then picks up new lines', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poelog-'));
  const file = path.join(dir, 'Client.txt');
  fs.writeFileSync(file, 'junk line\r\n2026/11/13 10:01:00 1 x [DEBUG Client 1] Generating level 2 area "1_1_2" with seed 1\r\n');
  const events = [];
  const w = new ClientLogWatcher(file, { pollMs: 20 });
  w.on('event', (e) => events.push(e));
  w.start();
  fs.appendFileSync(file, '2026/11/13 10:02:00 1 x [DEBUG Client 1] Generating level 4 area "1_1_3"');
  await new Promise((r) => setTimeout(r, 60));
  fs.appendFileSync(file, ' with seed 2\r\n');
  await new Promise((r) => setTimeout(r, 60));
  w.stop();
  assert.deepStrictEqual(events.map((e) => [e.areaId, e.backfill]), [['1_1_2', true], ['1_1_3', false]]);
});
