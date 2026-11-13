'use strict';
// Price-check panel: poe.ninja price for most items, plus a mod picker and trade API search
// for rares, magic items and uniques.
const card = document.getElementById('card');
const WIDTH = { basic: 340, trade: 440 };

let data = null; // last 'item' event
let tradeKey = null;
let sel = new Map(); // filter id -> { enabled, min, max }
let itemOpts = null;
let tradeState = { state: 'idle' };
let loadingMore = false;

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (sel) => card.querySelector(sel);

window.overlay.onItem((d) => {
  const sameItem = d.trade && d.trade.key === tradeKey;
  data = d;
  if (sameItem) { renderNinja(); fit(); return; }
  tradeKey = d.trade ? d.trade.key : null;
  sel = new Map(d.trade ? d.trade.filters.map((f) => [f.id, { enabled: f.enabled, min: f.min, max: f.max }]) : []);
  itemOpts = d.trade ? { ...d.trade.itemOpts } : null;
  tradeState = { state: 'idle' };
  renderItem();
});

window.overlay.onTrade((t) => {
  if (t.key !== tradeKey) return;
  if (t.state === 'ok' && loadingMore && tradeState.result) {
    // "Load more": append the new page to what is already shown.
    t.result.listings = tradeState.result.listings.concat(t.result.listings);
  }
  if (t.state === 'ok' || t.state === 'error') loadingMore = false;
  tradeState = { ...t, result: t.result || tradeState.result };
  renderTrade();
});

function renderItem() {
  const { item } = data;
  const rarityClass = (item.rarity || '').split(' ')[0];
  const bits = [item.itemClass];
  if (item.itemLevel) bits.push(`iLvl ${item.itemLevel}`);
  if (item.gemLevel) bits.push(`Lv ${item.gemLevel} / ${item.quality}%`);
  if (item.mapTier) bits.push(`T${item.mapTier}`);
  if (item.links >= 5) bits.push(`${item.links}L`);
  if (item.stackSize > 1) bits.push(`x${item.stackSize}`);
  if (item.corrupted) bits.push('Corrupted');

  const named = item.rarity === 'Unique' || item.rarity === 'Rare';
  let html = `
    <div class="name ${esc(rarityClass)}">${named ? esc(item.name) + `<div class="meta">${esc(item.baseType)}</div>` : esc(item.baseType)}</div>
    <div class="meta">${bits.map(esc).join(' · ')}</div>
    <div id="ninja"></div>`;

  if (data.trade) html += tradeHtml(data.trade, item);
  html += `<div class="row">${data.trade ? '<button id="search" class="primary">Search</button>' : ''}<button id="trade">Open trade site</button><button id="close">Close</button></div>`;
  if (data.trade) html += '<div class="status" id="status"></div><div id="results"></div>';
  card.innerHTML = html;

  $('#trade').onclick = () => {
    const url = (tradeState.result && tradeState.result.tradeUrl) || data.tradeUrl;
    if (url) window.overlay.openTrade(url);
  };
  $('#close').onclick = () => window.overlay.hide();
  if (data.trade) wireTrade();
  renderNinja();
  renderTrade();
}

function tradeHtml(trade, item) {
  const rows = trade.filters.map((f) => {
    const s = sel.get(f.id);
    const na = !f.tradeable;
    const tag = { pseudo: 'P', implicit: 'I', explicit: 'E', crafted: 'C', fractured: 'F', enchant: 'N' }[f.tag] || '?';
    const range = f.bounds ? ` (${fmtRoll(f.bounds.min)}–${fmtRoll(f.bounds.max)})` : '';
    const title = na ? 'This mod cannot be searched on the trade site' : f.tag === 'pseudo' ? 'Total from all mods on the item' : f.text + range;
    return `<label class="mod ${s.enabled ? '' : 'off'} ${na ? 'na' : ''}" data-id="${f.id}" title="${esc(title)}">
      <input type="checkbox" ${s.enabled ? 'checked' : ''} ${na ? 'disabled' : ''}>
      <span class="tag ${esc(f.tag)}">${tag}</span>
      <span class="text">${esc(f.text)}${f.tier ? `<span class="tier">T${f.tier}</span>` : ''}</span>
      ${f.option || f.value == null ? '<span></span><span></span>' : `
      <input class="num" data-k="min" data-v="${f.value}" placeholder="min" value="${s.min ?? ''}" ${na ? 'disabled' : ''}>
      <input class="num" data-k="max" data-v="${f.value}" placeholder="max" value="${s.max ?? ''}" ${na ? 'disabled' : ''}>`}
    </label>`;
  }).join('');

  const o = itemOpts;
  const opts = [];
  if (item.rarity !== 'Unique') opts.push(`<label><input type="checkbox" data-o="baseType" ${o.baseType ? 'checked' : ''}>Same base</label>`);
  if (item.itemLevel) opts.push(`<label><input type="checkbox" data-o="itemLevel" ${o.itemLevel ? 'checked' : ''}>iLvl ≥ <input class="num" data-o="itemLevelMin" value="${o.itemLevelMin ?? ''}"></label>`);
  if (item.links >= 5) opts.push(`<label><input type="checkbox" data-o="links" ${o.links ? 'checked' : ''}>Links ≥ <input class="num" data-o="linksMin" value="${o.linksMin ?? ''}"></label>`);
  if (item.corrupted) opts.push(`<label><input type="checkbox" data-o="corrupted" ${o.corrupted ? 'checked' : ''}>Corrupted only</label>`);
  opts.push(`<label><input type="checkbox" data-o="onlineOnly" ${o.onlineOnly ? 'checked' : ''}>Online only</label>`);

  const hints = [];
  if (!trade.advanced) hints.push('Tip: Ctrl+Alt+C copies roll ranges and tiers.');
  if (trade.unknown.length) hints.push(`Not recognised: ${trade.unknown.map(esc).join('; ')}`);

  return `
    <div class="section"><span>Mods to search</span><span>min · max</span></div>
    <div class="mods">${rows || '<div class="meta">No searchable mods found.</div>'}</div>
    <div class="opts">${opts.join('')}</div>
    ${hints.map((h) => `<div class="hint">${h}</div>`).join('')}`;
}

function fmtRoll(v) {
  return Number.isInteger(v) ? v : +v.toFixed(2);
}

function wireTrade() {
  card.querySelectorAll('.mod').forEach((row) => {
    const id = +row.dataset.id;
    const box = row.querySelector('input[type=checkbox]');
    box.onchange = () => { sel.get(id).enabled = box.checked; row.classList.toggle('off', !box.checked); };
    row.querySelectorAll('input.num').forEach((inp) => {
      // Clicking a number field must not toggle the row's checkbox.
      inp.onclick = (e) => e.preventDefault();
      inp.oninput = () => { sel.get(id)[inp.dataset.k] = inp.value.trim() === '' ? null : inp.value.trim(); };
      wireNumber(inp, () => {
        const s = sel.get(id);
        s[inp.dataset.k] = inp.value === '' ? null : inp.value;
        if (!s.enabled) { s.enabled = true; box.checked = true; row.classList.remove('off'); }
      });
    });
  });
  card.querySelectorAll('[data-o]').forEach((inp) => {
    const k = inp.dataset.o;
    if (inp.type === 'checkbox') inp.onchange = () => { itemOpts[k] = inp.checked; };
    else {
      inp.onclick = (e) => e.preventDefault();
      inp.oninput = () => { itemOpts[k] = inp.value.trim() === '' ? null : +inp.value; };
      wireNumber(inp, () => { itemOpts[k] = inp.value === '' ? null : +inp.value; });
    }
  });
  $('#search').onclick = search;
}

// Mouse wheel changes a number without needing keyboard focus (Shift = steps of 10).
// Clicking into the field takes keyboard focus so you can type; Enter searches, Esc closes.
function wireNumber(inp, onChange) {
  inp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const cur = Number(inp.value === '' ? inp.dataset.v || 0 : inp.value);
    if (!Number.isFinite(cur)) return;
    inp.value = String(+(cur + (e.deltaY < 0 ? step : -step)).toFixed(2));
    onChange();
  }, { passive: false });
  inp.addEventListener('mousedown', () => window.overlay.wantFocus());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.hide();
  else if (e.key === 'Enter' && tradeKey) search();
});

function search() {
  if (!tradeKey || tradeState.state === 'searching' || tradeState.state === 'waiting') return;
  const selections = [...sel].map(([id, s]) => ({ id, enabled: s.enabled, min: s.min, max: s.max }));
  tradeState = { state: 'searching', result: tradeState.result };
  renderTrade();
  window.overlay.tradeSearch(tradeKey, selections, itemOpts);
}

function renderNinja() {
  const el = $('#ninja');
  if (!el || !data) return;
  const { item, status, price, error, league } = data;
  let body = '';
  if (status === 'loading') body = '<div class="price sub">Checking poe.ninja…</div>';
  else if (status === 'error') body = `<div class="err">Price lookup failed: ${esc(error)}</div>`;
  else if (status === 'unpriced') body = data.trade ? '' : `<div class="sub" style="margin-top:8px">No poe.ninja price for this item.</div>`;
  else if (price) {
    const div = price.divine != null && price.divine >= 0.5 ? ` <span class="sub">(${fmt(price.divine)} div)</span>` : '';
    body = `<div class="price">${fmt(price.chaos)} c${div}</div>`;
    if (item.stackSize > 1) body += `<div class="sub">Stack: ${fmt(price.total)} c${price.totalDivine >= 0.5 ? ` / ${fmt(price.totalDivine)} div` : ''}</div>`;
    body += `<div class="meta">poe.ninja: ${esc(price.matchedName)} · ${esc(league)}</div>`;
    if (price.confidence === 'low') body += `<div class="low">Few listings (${price.listings ?? 0}), price may be off</div>`;
  }
  el.innerHTML = body;
}

function renderTrade() {
  const statusEl = $('#status');
  const resultsEl = $('#results');
  if (!statusEl) { fit(); return; }
  const t = tradeState;
  const btn = $('#search');
  const running = t.state === 'searching' || t.state === 'waiting';
  if (btn) btn.disabled = running;

  if (t.state === 'searching') statusEl.innerHTML = '<span class="spinner"></span>Searching trade…';
  else if (t.state === 'waiting') statusEl.innerHTML = `<span class="spinner"></span>Waiting ${t.waitSec}s for the trade rate limit…`;
  else if (t.state === 'error') statusEl.innerHTML = `<span class="err">${esc(t.error)}</span>`;
  else if (t.state === 'idle') statusEl.innerHTML = '<span class="meta">Tick the mods that matter, then Search (or press Enter).</span>';
  else statusEl.innerHTML = '';

  const r = t.result;
  if (!r) { resultsEl.innerHTML = ''; fit(); return; }
  let html = '';
  if (r.summary) {
    const d = r.summary.divine;
    const asDiv = (c) => (d && c >= d * 0.5 ? ` <span class="sub">(${fmt(c / d)} div)</span>` : '');
    html += `<div class="summary">~${fmt(r.summary.median)} c${asDiv(r.summary.median)}</div>
      <div class="meta">median of ${r.summary.count} cheapest · lowest ${fmt(r.summary.cheapest)} c · ${r.total.toLocaleString()} listed${r.cached ? ' · cached' : ''}</div>`;
  } else {
    html += `<div class="meta" style="margin-top:6px">${r.total ? `${r.total.toLocaleString()} listed, none priced in chaos/divine` : 'No listings match. Untick a mod or lower a min.'}</div>`;
  }
  html += '<div class="listings">' + r.listings.map((l) => `
    <div class="listing" title="${esc(l.account || '')}">
      <span class="dot ${esc(l.online)}"></span>
      <span>${l.amount != null ? `${esc(fmtRoll(l.amount))} ${esc(l.currency)}` : '<span class="meta">no price</span>'}${l.instantBuyout ? ' <span class="meta">· instant</span>' : ''}</span>
      <span class="ilvl">${l.ilvl ? 'i' + esc(l.ilvl) : ''}</span>
      <span class="age">${esc(age(l.indexed))}</span>
    </div>`).join('') + '</div>';
  if (r.canLoadMore) html += `<div class="row"><button id="more" ${running ? 'disabled' : ''}>Load 10 more</button></div>`;
  resultsEl.innerHTML = html;
  const more = $('#more');
  if (more) more.onclick = () => {
    if (running) return;
    loadingMore = true;
    tradeState = { state: 'searching', result: tradeState.result };
    renderTrade();
    window.overlay.tradeMore(tradeKey);
  };
  fit();
}

function age(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function fit() {
  requestAnimationFrame(() => window.overlay.resize(tradeKey ? WIDTH.trade : WIDTH.basic, card.offsetHeight + 8));
}

card.addEventListener('mouseenter', () => window.overlay.hover(true));
card.addEventListener('mouseleave', () => { window.overlay.hover(false); });
window.addEventListener('blur', () => window.overlay.releaseFocus());
