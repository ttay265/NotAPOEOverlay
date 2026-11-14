'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Opacity settings popover, shared by both panels (renderer/settings.js).
contextBridge.exposeInMainWorld('overlaySettings', {
  onChange: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  hover: (on) => ipcRenderer.send('settings:hover', on),
});

contextBridge.exposeInMainWorld('overlay', {
  onItem: (cb) => ipcRenderer.on('item', (_e, data) => cb(data)),
  onTrade: (cb) => ipcRenderer.on('trade', (_e, data) => cb(data)),
  hide: () => ipcRenderer.send('hide'),
  openTrade: (url) => ipcRenderer.send('open-trade', url),
  hover: (on) => ipcRenderer.send('hover', on),
  resize: (width, height) => ipcRenderer.send('resize', { width, height }),
  wantFocus: () => ipcRenderer.send('want-focus'),
  releaseFocus: () => ipcRenderer.send('release-focus'),
  tradeSearch: (key, selections, itemOpts) => ipcRenderer.send('trade-search', { key, selections, itemOpts }),
  tradeMore: (key) => ipcRenderer.send('trade-more', { key }),
});
