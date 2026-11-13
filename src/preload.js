'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onItem: (cb) => ipcRenderer.on('item', (_e, data) => cb(data)),
  hide: () => ipcRenderer.send('hide'),
  openTrade: (url) => ipcRenderer.send('open-trade', url),
  hover: (on) => ipcRenderer.send('hover', on),
});
