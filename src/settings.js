'use strict';
// Overlay look settings changed from the in-panel popover. Saved in the app's user data folder
// (not config.json, so git pulls never conflict). config.json "overlay.opacity" is the starting value.

const fs = require('fs');
const { clampOpacity, clampPanelOpacity } = require('./layout');

function normalize(s = {}, base = {}) {
  return {
    bgOpacity: clampOpacity(s.bgOpacity ?? base.bgOpacity),
    panelOpacity: clampPanelOpacity(s.panelOpacity ?? base.panelOpacity),
  };
}

class OverlaySettings {
  constructor(file, overlayConfig = {}) {
    this.file = file;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    this.values = normalize(saved, { bgOpacity: overlayConfig.opacity, panelOpacity: overlayConfig.panelOpacity });
    this.timer = null;
  }

  get() { return { ...this.values }; }

  // Returns the new values. Unknown keys are ignored.
  set(patch = {}) {
    this.values = normalize({ ...this.values, ...pick(patch) }, this.values);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
    return this.get();
  }

  flush() {
    clearTimeout(this.timer);
    try { fs.writeFileSync(this.file, JSON.stringify(this.values)); } catch { /* not fatal */ }
  }
}

function pick(p) {
  const out = {};
  if (p && p.bgOpacity != null) out.bgOpacity = p.bgOpacity;
  if (p && p.panelOpacity != null) out.panelOpacity = p.panelOpacity;
  return out;
}

module.exports = { OverlaySettings, normalize };
