'use strict';
// The leveling panel: its own small always-on-top window docked to a screen corner, separate
// from the price-check panel. It never takes focus from the game and never sends input to it.

const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { ClientLogWatcher, findLogPath } = require('./clientlog');
const { LevelingTracker } = require('./tracker');
const { dockPosition } = require('../layout');

const DEFAULTS = {
  enabled: true,
  clientLog: '', // empty = look in the usual install folders
  leagueStart: true, // include league-start extras (flasks, trials, early gems)
  bandit: 'kill_all', // kill_all | alira | kraityn | oak
  library: false, // include the Act 3 Library side trip
  corner: 'top-left', // top-left | top-right | bottom-left | bottom-right
  width: 340,
  height: 460,
  toggleHotkey: 'Ctrl+Shift+L',
};

// look: { bgOpacity, panelOpacity } from the shared overlay settings (src/settings.js).
function setupLeveling(userConfig = {}, look = { bgOpacity: 0.35, panelOpacity: 1 }) {
  const cfg = { ...DEFAULTS, ...userConfig };
  if (!cfg.enabled) return null;

  const statePath = path.join(app.getPath('userData'), 'leveling-state.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* first run */ }
  const tracker = new LevelingTracker(cfg, saved);

  const win = new BrowserWindow({
    width: cfg.width, height: cfg.height, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setOpacity(look.panelOpacity);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'leveling.html'), { query: { bg: String(look.bgOpacity), panel: String(look.panelOpacity) } });

  const dock = () => {
    const { x, y } = dockPosition(screen.getPrimaryDisplay().workArea, win.getSize(), cfg.corner);
    win.setPosition(x, y);
  };

  let logStatus = { file: null, error: null };
  const push = () => { if (!win.isDestroyed()) win.webContents.send('leveling', { ...tracker.view(), log: logStatus }); };
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(statePath, JSON.stringify(tracker.state())); } catch { /* not fatal */ }
    }, 300);
  };
  const changed = () => { push(); save(); };

  // Client.txt: during the start-up backfill only the latest zone and level matter.
  const file = findLogPath(cfg.clientLog);
  if (!file) {
    logStatus = { file: null, error: cfg.clientLog ? `Client.txt not found at ${cfg.clientLog}` : 'Client.txt not found. Set "leveling.clientLog" in config.json.' };
  } else {
    logStatus = { file, error: null };
    let lastArea = null; let lastLevel = null; let lastName = null; let backfilling = true;
    const watcher = new ClientLogWatcher(file);
    watcher.on('event', (ev) => {
      if (ev.backfill && backfilling) {
        if (ev.type === 'area') { lastArea = ev; lastName = null; }
        if (ev.type === 'entered') lastName = ev.name;
        if (ev.type === 'level') lastLevel = ev;
        return;
      }
      if (ev.type === 'area') tracker.enterArea(ev.areaId, ev.areaLevel);
      else if (ev.type === 'entered') tracker.entered(ev.name);
      else if (ev.type === 'level') tracker.setLevel(ev.character, ev.className, ev.level);
      changed();
    });
    try {
      watcher.start();
      backfilling = false;
      if (lastLevel) tracker.setLevel(lastLevel.character, lastLevel.className, lastLevel.level);
      if (lastArea) tracker.enterArea(lastArea.areaId, lastArea.areaLevel);
      if (lastName) tracker.entered(lastName);
      save();
      app.on('will-quit', () => watcher.stop());
    } catch (err) {
      logStatus = { file, error: `Cannot read Client.txt: ${err.message}` };
    }
  }

  win.webContents.on('did-finish-load', () => { dock(); win.showInactive(); push(); });
  ipcMain.on('leveling:step', (_e, d) => { tracker.step(d > 0 ? 1 : -1); changed(); });
  ipcMain.on('leveling:toggle', (_e, id) => { if (typeof id === 'string') { tracker.toggleDone(id); changed(); } });
  ipcMain.on('leveling:reset', () => { tracker.reset(); changed(); });
  // "–" collapses the panel to its header bar (the window shrinks too, so it stops covering the
  // game); "+" opens it again. Ctrl+Shift+L still hides/shows it completely.
  let collapsedHeight = 0; // 0 = expanded
  const fitHeight = (h) => {
    win.setSize(cfg.width, h);
    dock();
  };
  ipcMain.on('leveling:collapse', (_e, { collapsed, headerHeight } = {}) => {
    collapsedHeight = collapsed ? Math.max(30, Math.min(cfg.height, Math.ceil(Number(headerHeight) || 44))) : 0;
    fitHeight(collapsedHeight || cfg.height);
  });
  // The opacity popover needs the full height while the panel is collapsed.
  ipcMain.on('settings:hover', (e, open) => {
    if (e.sender === win.webContents && collapsedHeight) fitHeight(open ? cfg.height : collapsedHeight);
  });
  if (cfg.toggleHotkey) {
    globalShortcut.register(cfg.toggleHotkey, () => (win.isVisible() ? win.hide() : (dock(), win.showInactive())));
  }
  return { win, tracker };
}

module.exports = { setupLeveling, DEFAULTS };
