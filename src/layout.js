'use strict';
// Pure helpers for where the overlay windows sit and how see-through they are.
// Kept free of Electron so they can be unit tested.

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

// Background opacity of the panels (0 = invisible card, 1 = solid). Text stays fully opaque.
function clampOpacity(v, fallback = 0.6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0.1, n));
}

// Top-left x/y for a window of size [w, h] docked to `corner` of a display work area.
// offsetX / offsetY push the window away from the corner (e.g. to sit beside another panel).
function dockPosition(area, [w, h], corner = 'top-left', { margin = 8, offsetX = 0, offsetY = 0 } = {}) {
  const c = CORNERS.includes(corner) ? corner : 'top-left';
  const right = c.endsWith('right');
  const bottom = c.startsWith('bottom');
  let x = right ? area.x + area.width - w - margin - offsetX : area.x + margin + offsetX;
  let y = bottom ? area.y + area.height - h - margin - offsetY : area.y + margin + offsetY;
  // Never leave the work area.
  x = Math.max(area.x, Math.min(x, area.x + area.width - w));
  y = Math.max(area.y, Math.min(y, area.y + area.height - h));
  return { x: Math.round(x), y: Math.round(y) };
}

// Sideways offset for the price panel so it does not cover the leveling panel when both
// are docked to the same corner.
function priceOffsetX(pricePosition, leveling) {
  if (!leveling || leveling.enabled === false) return 0;
  if ((leveling.corner || 'top-left') !== pricePosition) return 0;
  return (leveling.width || 340) + 8;
}

module.exports = { CORNERS, clampOpacity, dockPosition, priceOffsetX };
