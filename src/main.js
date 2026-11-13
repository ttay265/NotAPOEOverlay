'use strict';
// Electron main process.
// Flow: you hover an item in PoE and press Ctrl+C yourself (the game copies the item text).
// We watch the clipboard, parse the item, look up poe.ninja, and show a small
// click-through-free, non-focusable panel near the mouse. No input is ever sent to the game.

const { app, BrowserWindow, clipboard, screen, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseItem } = require('./parser');
const { PriceService, tradeSearchUrl } = require('./pricing');
const { setupLeveling } = require('./leveling/window');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const config = Object.assign(
  { league: 'Standard', hideAfterMs: 10000, pollMs: 250, toggleHotkey: 'Ctrl+Shift+Space' },
  JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
);
const prices = new PriceService({ league: config.league });

let win;
let lastClip = '';
let hideTimer;

function createWindow() {
  win = new BrowserWindow({
    width: 340, height: 220, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // 'screen-saver' level keeps us above a borderless-windowed game.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function showNearCursor() {
  const p = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(p).workArea;
  const [w, h] = win.getSize();
  const x = Math.min(p.x + 24, area.x + area.width - w);
  const y = Math.min(Math.max(p.y - h / 2, area.y), area.y + area.height - h);
  win.setPosition(Math.round(x), Math.round(y));
  win.showInactive(); // never take focus from the game
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => win.hide(), config.hideAfterMs);
}

async function onClipboard(text) {
  const item = parseItem(text);
  if (!item) return;
  const tradeUrl = tradeSearchUrl(item, config.league);
  win.webContents.send('item', { item: strip(item), status: 'loading', tradeUrl, league: config.league });
  showNearCursor();
  try {
    const price = await prices.price(item);
    win.webContents.send('item', { item: strip(item), status: price ? 'ok' : 'unpriced', price, tradeUrl, league: config.league });
  } catch (err) {
    win.webContents.send('item', { item: strip(item), status: 'error', error: String(err.message || err), tradeUrl, league: config.league });
  }
}

function strip(item) {
  const { raw, ...rest } = item;
  return rest;
}

app.whenReady().then(() => {
  createWindow();
  if (config.leveling && config.leveling.enabled !== false) setupLeveling(config.leveling);
  lastClip = clipboard.readText();
  setInterval(() => {
    const t = clipboard.readText();
    if (t !== lastClip) {
      lastClip = t;
      onClipboard(t);
    }
  }, config.pollMs);

  globalShortcut.register(config.toggleHotkey, () => (win.isVisible() ? win.hide() : showNearCursor()));
  ipcMain.on('hide', () => win.hide());
  ipcMain.on('open-trade', (_e, url) => {
    if (typeof url === 'string' && url.startsWith('https://www.pathofexile.com/trade/')) shell.openExternal(url);
  });
  ipcMain.on('hover', (_e, on) => { clearTimeout(hideTimer); if (!on) hideTimer = setTimeout(() => win.hide(), config.hideAfterMs); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
