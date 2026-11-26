'use strict';
// Merc price check panel. Hotkey (default Ctrl+Shift+M) while the merc hire window is open:
// take one screenshot, OCR the archetype / level / skills, count support gems, then run one trade
// search for warrants with the same skills. Nothing is sent to the game.

const { BrowserWindow, screen, globalShortcut, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');
const { loadCatalog } = require('./catalog');
const { MercReader } = require('./reader');
const { mercFromText } = require('./parse');
const { buildMercQuery, defaultRequired, tradeSearchUrl, valueHints } = require('./query');
const { summarise } = require('../trade/pricecheck');
const { StaleError } = require('../trade/client');
const { dockPosition } = require('../layout');

const DEFAULTS = {
  enabled: true,
  hotkey: 'Ctrl+Shift+M',
  corner: 'top-right',
  autoSearch: true,
  width: 380,
  height: 520,
  layout: { offsetX: 0, offsetY: 0, scale: 1 }, // nudge the OCR regions if your UI differs
};
const PAGE = 10;

// trade: the TradePriceCheck instance (shares its rate-limited client and currency rates).
function setupMerc(userConfig = {}, { league, trade, status = 'available', log = () => {}, look = { bgOpacity: 0.35, panelOpacity: 1 } }) {
  const cfg = { ...DEFAULTS, ...userConfig, layout: { ...DEFAULTS.layout, ...(userConfig.layout || {}) } };
  if (!cfg.enabled) return null;
  const catalog = loadCatalog();
  const reader = new MercReader({ catalog, layoutOptions: cfg.layout });

  const win = new BrowserWindow({
    width: cfg.width, height: cfg.height, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setOpacity(look.panelOpacity);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'merc.html'), { query: { bg: String(look.bgOpacity) } });

  let current = null; // { gen, merc, body, search, shown }
  let gen = 0;
  let busy = false;
  const send = (data) => { if (!win.isDestroyed()) win.webContents.send('merc', data); };
  const show = () => {
    const { x, y } = dockPosition(screen.getPrimaryDisplay().workArea, win.getSize(), cfg.corner);
    win.setPosition(x, y);
    win.showInactive();
  };

  async function capture() {
    const d = screen.getPrimaryDisplay();
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) throw new Error('Could not capture the screen');
    const { width, height } = src.thumbnail.getSize();
    return { width, height, data: src.thumbnail.toBitmap() };
  }

  async function checkScreen() {
    if (busy) return;
    const g = ++gen;
    current = null;
    show();
    send({ state: 'reading' });
    let merc;
    try {
      const img = await capture();
      merc = await reader.read(img);
      log('merc read', { w: img.width, h: img.height, archetype: merc.archetype, level: merc.level, skills: merc.skills.map((s) => `${s.name}:${s.supports}`) });
    } catch (err) {
      log('merc read failed:', String((err && err.stack) || err));
      send({ state: 'error', error: `Could not read the screen: ${err.message || err}` });
      return;
    }
    if (g !== gen) return;
    if (!merc.skills.length) {
      send({ state: 'notfound', merc });
      return;
    }
    present(merc, g);
  }

  function present(merc, g) {
    current = { gen: g, merc, search: null, shown: 0 };
    const required = defaultRequired(merc);
    const excludeTravel = !merc.skills.some((s) => s.travel);
    send({ state: 'merc', merc, hints: valueHints(merc), required, excludeTravel, tradeUrl: url(merc, { required, excludeTravel }) });
    if (cfg.autoSearch) runSearch({ required, excludeTravel });
  }

  const url = (merc, sel) => tradeSearchUrl(league, buildMercQuery(merc, catalog, { ...sel, status }));

  async function runSearch(sel) {
    const cur = current;
    if (!cur || busy) return;
    busy = true;
    const body = buildMercQuery(cur.merc, catalog, { ...sel, status });
    send({ state: 'searching', tradeUrl: tradeSearchUrl(league, body) });
    const isStale = () => current !== cur;
    const onWait = (sec) => send({ state: 'waiting', waitSec: sec });
    try {
      const res = await trade.client.search(league, body, { isStale, onWait });
      cur.search = res;
      const listings = await trade.client.fetchListings(res.id, res.result.slice(0, PAGE), { isStale, onWait });
      cur.shown = Math.min(PAGE, res.result.length);
      send({ state: 'result', result: await view(cur, listings, res) });
    } catch (err) {
      if (!(err instanceof StaleError)) send({ state: 'error', error: String(err.message || err) });
    } finally {
      busy = false;
    }
  }

  async function more() {
    const cur = current;
    if (!cur || !cur.search || busy) return;
    busy = true;
    try {
      const ids = cur.search.result.slice(cur.shown, cur.shown + PAGE);
      const listings = await trade.client.fetchListings(cur.search.id, ids, { isStale: () => current !== cur });
      cur.shown += ids.length;
      send({ state: 'result', result: await view(cur, listings, cur.search), append: true });
    } catch (err) {
      if (!(err instanceof StaleError)) send({ state: 'error', error: String(err.message || err) });
    } finally {
      busy = false;
    }
  }

  async function view(cur, listings, res) {
    const rates = await trade.rates().catch(() => ({ chaos: 1 }));
    const priced = listings.map((l) => ({ ...l, chaos: l.amount != null && rates[l.currency] ? l.amount * rates[l.currency] : null }));
    return {
      total: res.total,
      shown: cur.shown,
      canLoadMore: cur.shown < res.result.length,
      tradeUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(res.id)}`,
      listings: priced,
      summary: summarise(priced, rates.divine),
    };
  }

  const ok = globalShortcut.register(cfg.hotkey, () => { checkScreen().catch((e) => log('merc check failed:', String(e))); });
  if (!ok) log('could not register merc hotkey (another app may own it):', cfg.hotkey);

  ipcMain.on('merc:search', (_e, sel = {}) => {
    if (!Array.isArray(sel.required)) return;
    runSearch({ required: sel.required.filter((id) => typeof id === 'string'), excludeTravel: !!sel.excludeTravel });
  });
  ipcMain.on('merc:more', () => more());
  ipcMain.on('merc:hide', () => win.hide());
  ipcMain.on('merc:open', (_e, link) => {
    if (typeof link === 'string' && link.startsWith('https://www.pathofexile.com/trade/')) shell.openExternal(link);
  });
  ipcMain.on('merc:resize', (_e, h) => {
    if (!Number.isFinite(h)) return;
    const area = screen.getPrimaryDisplay().workArea;
    win.setSize(cfg.width, Math.min(Math.max(140, Math.ceil(h)), area.height));
    show();
  });

  return {
    win,
    // Ctrl+C on a Mercenary Warrant: returns true when the text was a warrant and we took it.
    fromClipboard(text) {
      const merc = mercFromText(text, catalog);
      if (!merc) return false;
      const g = ++gen;
      show();
      present(merc, g);
      return true;
    },
    close: () => reader.close(),
  };
}

module.exports = { setupMerc };
