'use strict';
// Reading the merc hire window from a screenshot. Pure functions on a raw RGBA/BGRA bitmap so
// they can be unit-tested without Electron.
//
// The hire window is a fixed-layout panel centred on the screen. PoE scales its UI with the
// screen height, so every position below is a fraction of the height, measured from the
// horizontal centre (measured on a 2560x1600 screenshot; 16:9 and 16:10 behave the same).
// layout.offsetX / offsetY / scale in config.json can nudge it if a setup differs.

// Header strip: "Blade Ambusher | Lvl 83 | Dex / Int".
const HEADER = { x: -0.18, y: 0.1025, w: 0.43, h: 0.0255 };
// Column with the skill names (up to 7 rows).
const SKILLS = { x: -0.208, y: 0.552, w: 0.204, h: 0.28 };
// Support gem slots to the right of each skill name.
const SLOTS = { x: 0.0144, step: 0.04032, count: 5, half: 0.011 };

function layout(width, height, { offsetX = 0, offsetY = 0, scale = 1 } = {}) {
  const u = height * scale;
  const cx = width / 2 + offsetX * height;
  const top = offsetY * height;
  const rect = (r) => clampRect({ x: Math.round(cx + r.x * u), y: Math.round(top + r.y * u), w: Math.round(r.w * u), h: Math.round(r.h * u) }, width, height);
  return {
    header: rect(HEADER),
    skills: rect(SKILLS),
    // Centre of support slot j on a row whose text is centred at screen y.
    slot: (y, j) => ({ x: Math.round(cx + (SLOTS.x + j * SLOTS.step) * u), y: Math.round(y), r: Math.max(2, Math.round(SLOTS.half * u)) }),
    slotCount: SLOTS.count,
  };
}

function clampRect(r, W, H) {
  const x = Math.max(0, Math.min(r.x, W - 1));
  const y = Math.max(0, Math.min(r.y, H - 1));
  return { x, y, w: Math.max(1, Math.min(r.w, W - x)), h: Math.max(1, Math.min(r.h, H - y)) };
}

// Crop, upscale and threshold into dark text on white, which Tesseract reads far better than
// the game's light text on a textured background. Channel order does not matter (max of 3).
function binarize(img, rect, { scale = 2, threshold = 150 } = {}) {
  const { width: W, data } = img;
  const w = rect.w * scale; const h = rect.h * scale;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = rect.y + Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const i = (sy * W + rect.x + Math.floor(x / scale)) * 4;
      gray[y * w + x] = Math.max(data[i], data[i + 1], data[i + 2]) > threshold ? 0 : 255;
    }
  }
  return { width: w, height: h, gray };
}

// 24-bit BMP, which Tesseract (Leptonica) reads directly. Avoids a PNG encoder dependency.
function encodeBmp({ width, height, gray }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize; // bottom-up
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      buf[row + x * 3] = v; buf[row + x * 3 + 1] = v; buf[row + x * 3 + 2] = v;
    }
  }
  return buf;
}

// How many support gems sit next to the skill row at screen y. Empty slots are near-black
// (brightness ~20), socketed gems are bright (brightness 80-150).
function countSupports(img, lay, y, { minBrightness = 60 } = {}) {
  let n = 0;
  for (let j = 0; j < lay.slotCount; j++) {
    const { x, y: yc, r } = lay.slot(y, j);
    if (meanBrightness(img, x - r, yc - r, 2 * r, 2 * r) >= minBrightness) n++;
    else break; // gems fill left to right
  }
  return n;
}

function meanBrightness(img, x0, y0, w, h) {
  const { width: W, height: H, data } = img;
  let sum = 0; let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 4;
      sum += Math.max(data[i], data[i + 1], data[i + 2]); n++;
    }
  }
  return n ? sum / n : 0;
}

module.exports = { layout, binarize, encodeBmp, countSupports, meanBrightness };
