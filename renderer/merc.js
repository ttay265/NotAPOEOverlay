'use strict';
// Merc price check panel (src/merc/window.js sends the data).
const card = document.getElementById('card');
const q = new URLSearchParams(location.search);
if (q.get('bg')) document.documentElement.style.setProperty('--bg-alpha', q.get('bg'));

let merc = null; let required = new Set(); let excludeTravel = false; let tradeUrl = null;
let status = ''; let result = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const price = (c, div) => (div && c >= div ? `${fmt(c / div)} div` : `${fmt(c)} c`);

window.mercApi.onUpdate((d) => {
  if (d.state === 'reading') { merc = null; result = null; status = 'Reading the merc window…'; }
  else if (d.state === 'notfound') { merc = null; result = null; status = 'No merc skills found on screen. Open the merc hire window (centre of the screen) and press the hotkey again.'; }
  else if (d.state === 'merc') {
    merc = d.merc; required = new Set(d.required); excludeTravel = d.excludeTravel; tradeUrl = d.tradeUrl; result = null; status = '';
    window._hints = d.hints;
  } else if (d.state === 'searching') { status = 'Searching the trade site…'; if (d.tradeUrl) tradeUrl = d.tradeUrl; }
  else if (d.state === 'waiting') status = `Waiting ${d.waitSec}s for the trade rate limit…`;
  else if (d.state === 'error') status = `<span class="err">${esc(d.error)}</span>`;
  else if (d.state === 'result') {
    if (d.append && result) d.result.listings = result.listings.concat(d.result.listings);
    result = d.result; tradeUrl = result.tradeUrl; status = '';
  }
  render();
});

function render() {
  let html = '<div class="head"><span class="title">Merc price check</span><button id="close">✕</button></div>';
  if (merc) {
    const bits = [merc.attribute, merc.level != null ? `Lvl ${merc.level}` : null, merc.infamous ? 'Infamous' : null].filter(Boolean);
    html += `<div class="name">${esc(merc.archetype || 'Unknown mercenary')}</div><div class="meta">${bits.map(esc).join(' · ')}</div>`;
    html += '<ul class="hints">' + (window._hints || []).map((h) => `<li class="${h.good ? 'good' : 'bad'}">${h.good ? '▲' : '▼'} ${esc(h.text)}</li>`).join('') + '</ul>';
    html += '<h4>Skills to match</h4>';
    html += merc.skills.map((s) => `<label class="skill ${required.has(s.id) ? '' : 'off'}" data-id="${esc(s.id)}">
      <input type="checkbox" ${required.has(s.id) ? 'checked' : ''}><span class="sn">${esc(s.name)}${s.travel ? ' <span class="travel">travel</span>' : ''}</span>
      <span class="links">${s.supports == null ? '' : `${s.supports} support${s.supports === 1 ? '' : 's'}`}</span></label>`).join('');
    html += `<label class="skill"><input type="checkbox" id="notravel" ${excludeTravel ? 'checked' : ''}><span class="sn">Only mercs without a travel skill</span></label>`;
    html += '<div class="row"><button id="search" class="primary">Search</button><button id="open">Open trade site</button></div>';
  }
  if (status) html += `<div class="status">${status}</div>`;
  if (result) {
    const s = result.summary;
    html += `<div class="sum">${result.total.toLocaleString()} listed${s ? ` · cheapest <b>${price(s.cheapest, s.divine)}</b> · median <b>${price(s.median, s.divine)}</b>` : ''}</div>`;
    html += '<table>' + result.listings.map((l) => `<tr><td class="p">${l.amount != null ? `${esc(l.amount)} ${esc(l.currency)}` : '—'}</td><td>${l.chaos != null ? esc(price(l.chaos, s && s.divine)) : ''}</td><td class="a">${esc(l.account || '')}</td></tr>`).join('') + '</table>';
    if (result.canLoadMore) html += '<div class="row"><button id="more">Load more</button></div>';
    html += '<div class="note">Matched on skills only. Support gems are icons, so refine them on the trade site.</div>';
  }
  card.innerHTML = html;
  card.querySelector('#close').onclick = () => window.mercApi.hide();
  card.querySelectorAll('label.skill[data-id]').forEach((el) => {
    el.querySelector('input').onchange = (e) => { if (e.target.checked) required.add(el.dataset.id); else required.delete(el.dataset.id); render(); };
  });
  const nt = card.querySelector('#notravel'); if (nt) nt.onchange = (e) => { excludeTravel = e.target.checked; };
  const sb = card.querySelector('#search'); if (sb) sb.onclick = () => window.mercApi.search([...required], excludeTravel);
  const ob = card.querySelector('#open'); if (ob) ob.onclick = () => tradeUrl && window.mercApi.open(tradeUrl);
  const mb = card.querySelector('#more'); if (mb) mb.onclick = () => window.mercApi.more();
  requestAnimationFrame(() => window.mercApi.resize(card.getBoundingClientRect().height + 8));
}
