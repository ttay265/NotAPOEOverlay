'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leveling', {
  onUpdate: (cb) => ipcRenderer.on('leveling', (_e, data) => cb(data)),
  step: (d) => ipcRenderer.send('leveling:step', d),
  toggle: (id) => ipcRenderer.send('leveling:toggle', id),
  reset: () => ipcRenderer.send('leveling:reset'),
  hide: () => ipcRenderer.send('leveling:hide'),
});
