'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlaySettings', {
  onChange: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  hover: (on) => ipcRenderer.send('settings:hover', on),
});

contextBridge.exposeInMainWorld('mercApi', {
  onUpdate: (cb) => ipcRenderer.on('merc', (_e, data) => cb(data)),
  search: (required, excludeTravel) => ipcRenderer.send('merc:search', { required, excludeTravel }),
  more: () => ipcRenderer.send('merc:more'),
  hide: () => ipcRenderer.send('merc:hide'),
  open: (url) => ipcRenderer.send('merc:open', url),
  resize: (h) => ipcRenderer.send('merc:resize', h),
});
