'use strict';
// Small diagnostics log in the app's user data folder (overlay.log), also echoed to the terminal.
// Used to tell why a Ctrl+C did not show the price panel. Never logs full item text.
const fs = require('fs');

let file = null;
function initLog(path) {
  file = path;
  try { if (fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, ''); } catch { /* new file */ }
}
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
  if (file) { try { fs.appendFileSync(file, line + '\n'); } catch { /* not fatal */ } }
}
module.exports = { initLog, log };
