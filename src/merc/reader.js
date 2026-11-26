'use strict';
// OCR of the merc hire window. Uses tesseract.js (WebAssembly, no native build) with the English
// model shipped in node_modules, so nothing is downloaded at run time.
//
// Why OCR: the hire window is not an item, so Ctrl+C gives no text for it, and reading game memory
// is not allowed. A screenshot of our own screen is the same thing a player sees (DESIGN.md §3).

const path = require('path');
const { layout, binarize, encodeBmp, countSupports } = require('./screen');
const { mercFromOcr, headerInfo } = require('./parse');

const THRESHOLDS = [150, 120, 95]; // brighter cut first; lower ones if nothing is found (monitor gamma, HDR)

class MercReader {
  constructor({ catalog, layoutOptions = {}, createWorker } = {}) {
    this.catalog = catalog;
    this.layoutOptions = layoutOptions;
    this.createWorker = createWorker || defaultWorker;
    this.worker = null;
  }

  async ocr(buf) {
    if (!this.worker) this.worker = this.createWorker();
    const w = await this.worker;
    const { data } = await w.recognize(buf, {}, { text: true, blocks: true });
    return data;
  }

  // img: { width, height, data } with 4 bytes per pixel (RGBA or BGRA).
  async read(img) {
    const lay = layout(img.width, img.height, this.layoutOptions);
    // Header and skill column are read separately; each tries a second threshold if the first
    // pass finds nothing (monitor gamma, HDR, compression all shift the text brightness).
    let header = '';
    let headerScore = -1;
    for (const threshold of THRESHOLDS) {
      const text = (await this.ocr(encodeBmp(binarize(img, lay.header, { threshold })))).text || '';
      const score = headerScoreOf(text, this.catalog);
      if (score > headerScore) { header = text; headerScore = score; }
      if (score >= 2) break;
    }
    let merc = null;
    for (const threshold of THRESHOLDS) {
      const col = await this.ocr(encodeBmp(binarize(img, lay.skills, { threshold })));
      const lines = ocrLines(col).map((l) => ({ text: l.text, y: lay.skills.y + (l.bbox.y0 + l.bbox.y1) / 4 })); // /2 centre, /2 upscale
      const m = mercFromOcr({ header, lines }, this.catalog);
      if (!merc || m.skills.length > merc.skills.length) merc = m;
      if (m.skills.length) break;
    }
    this.lastHeader = header;
    for (const s of merc.skills) s.supports = countSupports(img, lay, s.y);
    return merc;
  }

  async close() {
    if (this.worker) { const w = await this.worker; await w.terminate(); this.worker = null; }
  }
}

// 1 point each for a recognised archetype and a level.
function headerScoreOf(text, catalog) {
  const h = headerInfo(text, catalog);
  return (h.archetype ? 1 : 0) + (h.level != null ? 1 : 0);
}

function ocrLines(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  if (!out.length && data.text) { // no layout info: spread lines evenly (positions unknown)
    data.text.split('\n').filter((t) => t.trim()).forEach((text) => out.push({ text, bbox: { y0: 0, y1: 0 } }));
  }
  return out;
}

async function defaultWorker() {
  const { createWorker, PSM } = require('tesseract.js');
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const w = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  return w;
}

module.exports = { MercReader, ocrLines };
