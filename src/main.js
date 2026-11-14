'use strict';
// Electron main process.
// Flow: you hover an item in PoE and press Ctrl+C yourself (the game copies the item text).
// We watch the clipboard, parse the item, look up poe.ninja, and show a small
// click-through-free, non-focusable panel near the mouse. No input is ever sent to the game.

const { app, BrowserWindow, clipboard, screen, globalShortcut, ipcMain, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseItem } = require('./parser');
const { PriceService, tradeSearchUrl } = require('./pricing');
const { setupLeveling } = require('./leveling/window');
const { TradePriceCheck } = require('./trade/pricecheck');
const { TradeClient, StaleError } = require('./trade/client');
const { CORNERS, dockPosition, priceOffsetX } = require('./layout');
const { OverlaySettings } = require('./settings');
const { initLog, log } = require('./log');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const config = Object.assign(
  { league: 'Standard', hideAfterMs: 10000, pollMs: 250, toggleHotkey: 'Ctrl+Shift+Space' },
  JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
);
const prices = new PriceService({ league: config.league });
const tradeCfg = Object.assign(
  { enabled: true, autoSearch: true, status: 'available', rangePercent: 10, maxWaitSec: 10, debounceMs: 350 },
  config.trade || {}
);
// Electron's net.fetch uses Chromium's network stack and the app session (cookies),
// which is what the trade site's Cloudflare front expects (same approach as Awakened PoE Trade).
const trade = new TradePriceCheck({
  league: config.league,
  prices,
  status: tradeCfg.status,
  rangePercent: tradeCfg.rangePercent,
  client: new TradeClient({ fetchImpl: (url, init) => net.fetch(url, init), maxWaitMs: tradeCfg.maxWaitSec * 1000 }),
});
const WIDTH = { basic: 340, trade: 440 };
// overlay.position: a screen corner (default top-left) or "cursor" (old behaviour: next to the mouse).
const overlayCfg = Object.assign({ opacity: 0.6, position: 'top-left' }, config.overlay || {});
let settings; // OverlaySettings, created once Electron knows the user data folder
const PRICE_POS = overlayCfg.position === 'cursor' || CORNERS.includes(overlayCfg.position) ? overlayCfg.position : 'top-left';

let win;
let lastClip = '';
let hideTimer;
let autoSearchTimer;
let busy = false; // a trade request is running: keep the panel open

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH.basic, height: 220, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // 'screen-saver' level keeps us above a borderless-windowed game.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  const s = settings.get();
  win.setOpacity(s.panelOpacity);
  win.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2) log('price panel error:', msg, `${src}:${line}`); });
  win.webContents.on('render-process-gone', (_e, d) => log('price panel crashed:', d.reason));
  win.webContents.on('preload-error', (_e, _p, err) => log('price panel preload error:', String(err)));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { bg: String(s.bgOpacity), panel: String(s.panelOpacity) } });
}

function showPanel() {
  const [w, h] = win.getSize();
  if (PRICE_POS === 'cursor') {
    const p = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(p).workArea;
    const x = Math.min(p.x + 24, area.x + area.width - w);
    const y = Math.min(Math.max(p.y - h / 2, area.y), area.y + area.height - h);
    win.setPosition(Math.round(x), Math.round(y));
  } else {
    const area = screen.getPrimaryDisplay().workArea;
    const { x, y } = dockPosition(area, [w, h], PRICE_POS, { offsetX: priceOffsetX(PRICE_POS, config.leveling) });
    win.setPosition(x, y);
  }
  win.showInactive(); // never take focus from the game
  log('panel shown at', win.getBounds());
  armHide();
}

function armHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!busy) hidePanel(); else armHide(); }, config.hideAfterMs);
}

function hidePanel() {
  clearTimeout(hideTimer);
  win.hide();
  win.setFocusable(false); // hand focus back to the game
}

// Keep the panel inside the screen when its content grows (mod list, results).
function resizePanel(width, height) {
  const [x, y] = win.getPosition();
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  const h = Math.min(Math.max(120, Math.ceil(height)), area.height);
  const w = width;
  win.setBounds({
    x: Math.min(x, area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h),
    width: w,
    height: h,
  });
}

async function onClipboard(text) {
  const item = parseItem(text);
  const first = String(text || '').replace(/\r/g, '').trim().split('\n')[0].slice(0, 60);
  log('clipboard changed:', { chars: (text || '').length, firstLine: first, item: item ? `${item.rarity} ${item.baseType}` : null });
  if (!item) return;
  clearTimeout(autoSearchTimer);
  trade.cancel();
  const tradeUrl = tradeSearchUrl(item, config.league);
  const prep = tradeCfg.enabled && TradePriceCheck.supports(item) ? trade.prepare(item) : null;
  const base = { item: strip(item), tradeUrl, league: config.league, trade: prep };
  win.setSize(prep ? WIDTH.trade : WIDTH.basic, win.getSize()[1]);
  const ninjaPriced = !(item.rarity === 'Rare' || item.rarity === 'Magic');
  win.webContents.send('item', { ...base, status: ninjaPriced ? 'loading' : 'unpriced' });
  showPanel();

  // The Ctrl+C the player pressed is the one action that triggers one search (debounced, so
  // copying several items quickly only searches the last one).
  if (prep && tradeCfg.autoSearch && prep.canAutoSearch && item.rarity !== 'Unique') {
    autoSearchTimer = setTimeout(() => {
      const selections = prep.filters.map((f) => ({ id: f.id, enabled: f.enabled, min: f.min, max: f.max }));
      runTrade(prep.key, () => trade.search(prep.key, selections, null, { onWait: waitNotice(prep.key), auto: true }));
    }, tradeCfg.debounceMs);
  }

  // poe.ninja still prices uniques, gems, currency etc. Rares have no ninja price.
  if (!ninjaPriced) return;
  try {
    const price = await prices.price(item);
    win.webContents.send('item', { ...base, status: price ? 'ok' : 'unpriced', price });
  } catch (err) {
    win.webContents.send('item', { ...base, status: 'error', error: String(err.message || err) });
  }
}

function waitNotice(key) {
  return (sec) => win.webContents.send('trade', { key, state: 'waiting', waitSec: sec });
}

async function runTrade(key, fn) {
  busy = true;
  win.webContents.send('trade', { key, state: 'searching' });
  try {
    const result = await fn();
    win.webContents.send('trade', { key, state: 'ok', result });
  } catch (err) {
    if (!(err instanceof StaleError)) {
      win.webContents.send('trade', { key, state: 'error', error: String(err.message || err), retryInSec: err.retryInSec || null });
    }
  } finally {
    busy = false;
    armHide();
  }
}

function strip(item) {
  const { raw, ...rest } = item;
  return rest;
}

app.whenReady().then(() => {
  initLog(path.join(app.getPath('userData'), 'overlay.log'));
  log('overlay started', { version: app.getVersion(), league: config.league, position: PRICE_POS, primary: screen.getPrimaryDisplay().workArea });
  settings = new OverlaySettings(path.join(app.getPath('userData'), 'overlay-settings.json'), overlayCfg);
  createWindow();
  if (config.leveling && config.leveling.enabled !== false) setupLeveling(config.leveling, settings.get());

  // Opacity popover (either panel): apply live to every overlay window and save.
  ipcMain.on('settings:set', (_e, patch) => {
    const s = settings.set(patch);
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      w.setOpacity(s.panelOpacity);
      w.webContents.send('settings', s);
    }
  });
  // Keep the price panel open while its popover is open.
  ipcMain.on('settings:hover', (e, on) => {
    if (e.sender !== win.webContents) return;
    clearTimeout(hideTimer);
    if (!on) armHide();
  });
  app.on('will-quit', () => settings.flush());
  lastClip = clipboard.readText();
  setInterval(() => {
    const t = clipboard.readText();
    if (t !== lastClip) {
      lastClip = t;
      onClipboard(t).catch((err) => log('price check failed:', String((err && err.stack) || err)));
    }
  }, config.pollMs);

  log('log file:', path.join(app.getPath('userData'), 'overlay.log'));
  const toggled = globalShortcut.register(config.toggleHotkey, () => (win.isVisible() ? hidePanel() : showPanel()));
  if (!toggled) log('could not register hotkey (another app may own it):', config.toggleHotkey);
  ipcMain.on('hide', () => hidePanel());
  ipcMain.on('open-trade', (_e, url) => {
    if (typeof url === 'string' && url.startsWith('https://www.pathofexile.com/trade/')) shell.openExternal(url);
  });
  ipcMain.on('hover', (_e, on) => { clearTimeout(hideTimer); if (!on) armHide(); });
  ipcMain.on('resize', (_e, { width, height } = {}) => {
    if (Number.isFinite(height)) resizePanel(width === WIDTH.trade ? WIDTH.trade : WIDTH.basic, height);
  });
  // Typing a min/max needs keyboard focus. Only take it when the player clicks into a field.
  ipcMain.on('want-focus', () => { win.setFocusable(true); win.focus(); });
  ipcMain.on('release-focus', () => { win.setFocusable(false); });
  ipcMain.on('trade-search', (_e, { key, selections, itemOpts } = {}) => {
    if (busy || !Array.isArray(selections)) return; // button press while a search runs: ignore
    clearTimeout(autoSearchTimer);
    runTrade(key, () => trade.search(key, selections, itemOpts, { onWait: waitNotice(key) }));
  });
  ipcMain.on('trade-more', (_e, { key } = {}) => {
    if (busy) return;
    runTrade(key, () => trade.more(key, { onWait: waitNotice(key) }));
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
