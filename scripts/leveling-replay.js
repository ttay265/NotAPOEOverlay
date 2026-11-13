'use strict';
// Replays a Client.txt through the leveling helper and prints what the panel would show at each
// zone change. Usage: npm run leveling -- "C:\path\to\Client.txt" [--last 20]
const fs = require('fs');
const { parseLine } = require('../src/leveling/clientlog');
const { LevelingTracker } = require('../src/leveling/tracker');

const file = process.argv[2];
if (!file) { console.error('Usage: npm run leveling -- <Client.txt> [--last N]'); process.exit(1); }
const lastIdx = process.argv.indexOf('--last');
const last = lastIdx > 0 ? Number(process.argv[lastIdx + 1]) : Infinity;

const config = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'config.json'), 'utf8'));
const t = new LevelingTracker(config.leveling || {});
const text = (toks) => toks.map((x) => x.v).join('');
const out = [];
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const ev = parseLine(line);
  if (!ev) continue;
  if (ev.type === 'level') { t.setLevel(ev.character, ev.className, ev.level); continue; }
  if (ev.type === 'entered') { t.entered(ev.name); continue; }
  if (ev.type !== 'area') continue;
  t.enterArea(ev.areaId, ev.areaLevel);
  const v = t.view();
  const lines = [`== ${v.zone.name} (area ${v.zone.areaLevel})  act ${v.act}  step ${v.progress.pos + 1}/${v.progress.count}${v.offRoute ? `  [off route, guide at ${v.routeZone.name}]` : ''}`];
  if (v.zoneTip) lines.push(`   layout: ${v.zoneTip}`);
  for (const q of v.passives.here) lines.push(`   ★ passive here: ${q.name}`);
  for (const s of v.todo) { lines.push(`   - ${text(s.tokens)}`); for (const sub of s.subs) lines.push(`       ${text(sub)}`); }
  if (v.next) { lines.push(`   next: ${v.next.area} :: ${text(v.next.tokens)}`); for (const sub of v.next.subs) lines.push(`       ${text(sub)}`); }
  out.push(lines.join('\n'));
}
console.log(out.slice(-last).join('\n'));
