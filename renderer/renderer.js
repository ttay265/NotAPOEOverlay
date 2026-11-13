'use strict';
const card = document.getElementById('card');
let tradeUrl = null;

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

window.overlay.onItem(({ item, status, price, error, tradeUrl: url, league }) => {
  tradeUrl = url;
  const rarityClass = (item.rarity || '').split(' ')[0];
  const bits = [item.itemClass];
  if (item.gemLevel) bits.push(`Lv ${item.gemLevel} / ${item.quality}%`);
  if (item.mapTier) bits.push(`T${item.mapTier}`);
  if (item.links >= 5) bits.push(`${item.links}L`);
  if (item.stackSize > 1) bits.push(`x${item.stackSize}`);
  if (item.corrupted) bits.push('Corrupted');

  let body = '';
  if (status === 'loading') body = '<div class="price sub">Checking poe.ninja…</div>';
  else if (status === 'error') body = `<div class="err">Price lookup failed: ${esc(error)}</div>`;
  else if (status === 'unpriced') body = `<div class="sub" style="margin-top:8px">No poe.ninja price for this item${item.rarity === 'Rare' ? ' (rares need a trade search)' : ''}.</div>`;
  else {
    const div = price.divine != null && price.divine >= 0.5 ? ` <span class="sub">(${fmt(price.divine)} div)</span>` : '';
    body = `<div class="price">${fmt(price.chaos)} c${div}</div>`;
    if (item.stackSize > 1) body += `<div class="sub">Stack: ${fmt(price.total)} c${price.totalDivine >= 0.5 ? ` / ${fmt(price.totalDivine)} div` : ''}</div>`;
    body += `<div class="meta">Matched ${esc(price.matchedName)} · ${esc(league)}</div>`;
    if (price.confidence === 'low') body += `<div class="low">Few listings (${price.listings ?? 0}), price may be off</div>`;
  }

  card.innerHTML = `
    <div class="name ${esc(rarityClass)}">${item.rarity === 'Unique' || item.rarity === 'Rare' ? esc(item.name) + `<div class="meta">${esc(item.baseType)}</div>` : esc(item.baseType)}</div>
    <div class="meta">${bits.map(esc).join(' · ')}</div>
    ${body}
    <div class="row"><button id="trade">Search trade site</button><button id="close">Close</button></div>`;
  document.getElementById('trade').onclick = () => tradeUrl && window.overlay.openTrade(tradeUrl);
  document.getElementById('close').onclick = () => window.overlay.hide();
});

card.addEventListener('mouseenter', () => window.overlay.hover(true));
card.addEventListener('mouseleave', () => window.overlay.hover(false));
