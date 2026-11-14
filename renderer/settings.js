'use strict';
// Gear button + popover with two opacity sliders, shared by the price and leveling panels.
// Changes apply live to both panels and are saved by the main process.
(function () {
  const root = document.documentElement;
  const q = new URLSearchParams(location.search);
  let s = { bgOpacity: Number(q.get('bg')), panelOpacity: Number(q.get('panel')) };
  const apply = () => { if (Number.isFinite(s.bgOpacity)) root.style.setProperty('--bg-alpha', String(s.bgOpacity)); };
  apply();

  const gear = document.createElement('button');
  gear.className = 'gear'; gear.title = 'Opacity settings'; gear.textContent = '⚙';
  const pop = document.createElement('div');
  pop.className = 'pop'; pop.hidden = true;
  pop.innerHTML = `
    <label>Background <span id="bg-v"></span></label>
    <input type="range" id="bg" min="0" max="100" step="5">
    <label>Whole panel (text too) <span id="panel-v"></span></label>
    <input type="range" id="panel" min="20" max="100" step="5">
    <div class="note">Applies to both panels. Saved automatically.</div>`;
  document.addEventListener('DOMContentLoaded', () => document.body.append(gear, pop));
  const bg = pop.querySelector('#bg');
  const panel = pop.querySelector('#panel');
  const show = () => {
    bg.value = Math.round(s.bgOpacity * 100); pop.querySelector('#bg-v').textContent = `${bg.value}%`;
    panel.value = Math.round(s.panelOpacity * 100); pop.querySelector('#panel-v').textContent = `${panel.value}%`;
  };
  show();

  // The price panel is sized to its content; make room for the popover while it is open.
  const fit = (open) => {
    if (!window.overlay || !window.overlay.resize) return;
    const content = document.getElementById('card').getBoundingClientRect().height + 8;
    window.overlay.resize(window.innerWidth >= 440 ? 440 : 340, open ? Math.max(content, pop.offsetHeight + 34) : content);
  };
  const toggle = (open) => {
    pop.hidden = !open; gear.classList.toggle('on', open);
    window.overlaySettings.hover(open); fit(open);
  };
  gear.onclick = (e) => { e.stopPropagation(); toggle(pop.hidden); };
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== gear) toggle(false); });
  bg.oninput = () => { s.bgOpacity = bg.value / 100; apply(); show(); window.overlaySettings.set({ bgOpacity: s.bgOpacity }); };
  panel.oninput = () => { s.panelOpacity = panel.value / 100; show(); window.overlaySettings.set({ panelOpacity: s.panelOpacity }); };
  window.overlaySettings.onChange((next) => { s = { ...s, ...next }; apply(); show(); });
})();
