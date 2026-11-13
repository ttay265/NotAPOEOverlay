'use strict';
// Builds the panel with DOM nodes and textContent only, so route or log text can never inject HTML.

const body = document.getElementById('body');
const title = document.getElementById('title');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function tokens(list) {
  const span = el('span');
  for (const t of list) span.appendChild(el('span', t.k === 'text' ? null : `k-${t.k}`, t.v));
  return span;
}

function stepItem(step) {
  const li = el('li', `step${step.passive ? ' passive' : ''}`);
  li.appendChild(tokens(step.tokens));
  for (const s of step.subs) {
    const sub = el('span', 'sub');
    sub.appendChild(tokens(s));
    li.appendChild(sub);
  }
  return li;
}

function questRow(q) {
  const row = el('div', `q${q.done ? ' done' : ''}`);
  row.appendChild(el('span', 'box', q.done ? '✓' : ''));
  const txt = el('span');
  txt.appendChild(el('span', 'name', q.name));
  txt.appendChild(el('span', 'pts', ` +${q.points}${q.respec ? ` · ${q.respec} respec` : ''}`));
  txt.appendChild(el('span', 'what', `${q.todo} Reward from ${q.npc}.`));
  row.appendChild(txt);
  row.title = 'Click to tick when you have the point';
  row.onclick = () => window.leveling.toggle(q.id);
  return row;
}

let resetArmed = false;

function render(v) {
  title.textContent = `Leveling · Act ${v.act}`;
  body.replaceChildren();

  if (v.log && v.log.error) body.appendChild(el('div', 'err', v.log.error));

  // Current zone
  const zoneName = (v.zone && v.zone.name) || (v.routeZone && v.routeZone.name) || 'Unknown zone';
  body.appendChild(el('div', 'zone', zoneName));
  const bits = [];
  if (v.zone && v.zone.areaLevel) bits.push(`Area level ${v.zone.areaLevel}`);
  if (v.character) bits.push(`${v.character.name} level ${v.character.level}`);
  if (bits.length) body.appendChild(el('div', 'meta', bits.join(' · ')));
  if (v.offRoute && v.routeZone) body.appendChild(el('div', 'warn', `Off the route. Guide is at: ${v.routeZone.name}`));
  if (v.zoneTip) body.appendChild(el('div', 'tip', v.zoneTip));

  // Passive point available in this zone
  for (const q of v.passives.here) {
    const box = el('div', 'here');
    box.appendChild(el('b', null, `★ Passive point here: ${q.name} (+${q.points})`));
    box.appendChild(el('div', 'meta', q.todo));
    body.appendChild(box);
  }

  // What to do before moving on
  if (v.todo.length) {
    body.appendChild(el('h4', null, 'Do here'));
    const ul = el('ul');
    v.todo.forEach((s) => ul.appendChild(stepItem(s)));
    body.appendChild(ul);
  }

  // Next zone and how to find it
  body.appendChild(el('h4', null, 'Next zone'));
  if (v.next) {
    const box = el('div', 'next');
    box.appendChild(el('div', 'zone', v.next.area));
    const ul = el('ul');
    ul.appendChild(stepItem(v.next));
    box.appendChild(ul);
    if (v.next.areaLevel) box.appendChild(el('div', 'meta', `Area level ${v.next.areaLevel}`));
    body.appendChild(box);
    if (v.underLevel) body.appendChild(el('div', 'warn', `Recommended level ${v.underLevel} for what comes next.`));
  } else {
    body.appendChild(el('div', 'meta', 'Campaign done. Welcome to maps.'));
  }

  // Passive points
  body.appendChild(el('h4', null, `Passive points · Act ${v.act} · ${v.passives.got}/${v.passives.total} ticked`));
  if (v.passives.act.length) v.passives.act.forEach((q) => body.appendChild(questRow(q)));
  else body.appendChild(el('div', 'meta', 'No passive point quests in this act.'));

  // Earlier acts: quests the route has passed but you have not ticked.
  const earlier = v.passives.missed.filter((q) => q.act !== v.act);
  if (earlier.length) {
    body.appendChild(el('h4', null, 'Earlier acts: did you get these? (/passives in chat)'));
    earlier.forEach((q) => body.appendChild(questRow(q)));
  }

  const foot = el('div', 'foot');
  foot.appendChild(el('span', null, `Step ${v.progress.pos + 1}/${v.progress.count} · route: Exile-Leveling`));
  const reset = el('button', 'btn', resetArmed ? 'Click again to reset' : 'New run');
  reset.onclick = () => {
    if (resetArmed) { resetArmed = false; window.leveling.reset(); return; }
    resetArmed = true; reset.textContent = 'Click again to reset';
    setTimeout(() => { resetArmed = false; reset.textContent = 'New run'; }, 3000);
  };
  foot.appendChild(reset);
  body.appendChild(foot);
}

window.leveling.onUpdate(render);
document.getElementById('prev').onclick = () => window.leveling.step(-1);
document.getElementById('next').onclick = () => window.leveling.step(1);
document.getElementById('hide').onclick = () => window.leveling.hide();
