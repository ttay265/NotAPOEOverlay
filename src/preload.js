'use strict';
const { contextBridge, ipcRenderer } = require('electron');

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
