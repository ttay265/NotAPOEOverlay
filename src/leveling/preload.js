'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Opacity settings popover, shared by both panels (renderer/settings.js).
contextBridge.exposeInMainWorld('overlaySettings', {
  onChange: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  hover: (on) => ipcRenderer.send('settings:hover', on),
});

contextBridge.exposeInMainWorld('leveling', {
  onUpdate: (cb) => ipcRenderer.on('leveling', (_e, data) => cb(data)),
  step: (d) => ipcRenderer.send('leveling:step', d),
  toggle: (id) => ipcRenderer.send('leveling:toggle', id),
  reset: () => ipcRenderer.send('leveling:reset'),
  collapse: (collapsed, headerHeight) => ipcRenderer.send('leveling:collapse', { collapsed, headerHeight }),
});
