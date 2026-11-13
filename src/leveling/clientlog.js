'use strict';
// Reads Path of Exile's own log file (logs/Client.txt) to learn which zone you are in and your
// character level. This is the same read-only source Lailloken UI, Exile-Leveling's companion
// tools and the trade-whisper helpers use. Nothing here reads game memory or sends input.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Lines we care about (English client):
//   2024/07/27 14:51:52 123456 cff945b9 [DEBUG Client 1234] Generating level 2 area "1_1_2" with seed 12345
//   2024/07/27 14:51:53 123457 cff945b9 [INFO Client 1234] : You have entered The Coast.
//   2024/07/27 14:58:10 123458 cff945b9 [INFO Client 1234] : Tuan (Witch) is now level 6
// System messages start with "] : ". Chat lines start with "] #", "] @", "] $" or a name, so a
// player cannot fake these by typing in chat.
const RE_GENERATING = /\] Generating level (\d+) area "([^"]+)"/;
const RE_ENTERED = /\] : You have entered (.+?)\.\s*$/;
const RE_LEVEL = /\] : ([^\s:()]+) \(([A-Za-z]+)\) is now level (\d+)\s*$/;

function parseLine(line) {
  let m = RE_GENERATING.exec(line);
  if (m) return { type: 'area', areaLevel: Number(m[1]), areaId: m[2] };
  m = RE_ENTERED.exec(line);
  if (m) return { type: 'entered', name: m[1] };
  m = RE_LEVEL.exec(line);
  if (m) return { type: 'level', character: m[1], className: m[2], level: Number(m[3]) };
  return null;
}

// Usual install folders. config.json "leveling.clientLog" overrides these.
function defaultLogPaths() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    path.join(pf86, 'Grinding Gear Games', 'Path of Exile', 'logs', 'Client.txt'),
    path.join(pf, 'Grinding Gear Games', 'Path of Exile', 'logs', 'Client.txt'),
    path.join(pf86, 'Steam', 'steamapps', 'common', 'Path of Exile', 'logs', 'Client.txt'),
    path.join(pf, 'Epic Games', 'PathOfExile', 'logs', 'Client.txt'),
    'C:\\Games\\Path of Exile\\logs\\Client.txt',
    'D:\\Games\\Path of Exile\\logs\\Client.txt',
    'D:\\SteamLibrary\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
  ];
}

function findLogPath(configured) {
  if (configured) return fs.existsSync(configured) ? configured : null;
  return defaultLogPaths().find((p) => fs.existsSync(p)) || null;
}

// Tails Client.txt. On start it reads only the last `backfillBytes` (the file grows to gigabytes
// over time) so the current zone and level are known right away, then polls for new bytes.
// Emits 'event' with parsed lines ({ type, ..., backfill: true|false }).
class ClientLogWatcher extends EventEmitter {
  constructor(file, { pollMs = 500, backfillBytes = 512 * 1024 } = {}) {
    super();
    this.file = file;
    this.pollMs = pollMs;
    this.backfillBytes = backfillBytes;
    this.offset = 0;
    this.partial = '';
    this.timer = null;
  }

  start() {
    const size = fs.statSync(this.file).size;
    const from = Math.max(0, size - this.backfillBytes);
    this.offset = from;
    this._read(size, true, from > 0);
    this.timer = setInterval(() => this.poll(), this.pollMs);
    return this;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    let size;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.offset) { this.offset = 0; this.partial = ''; } // log was cleared
    if (size > this.offset) this._read(size, false, false);
  }

  _read(size, backfill, skipFirstLine) {
    const len = size - this.offset;
    if (len <= 0) return;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(this.file, 'r');
    try { fs.readSync(fd, buf, 0, len, this.offset); } finally { fs.closeSync(fd); }
    this.offset = size;
    const text = this.partial + buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    this.partial = lines.pop(); // keep an unfinished last line for the next read
    if (skipFirstLine) lines.shift(); // we started mid-line
    for (const line of lines) {
      const ev = parseLine(line);
      if (ev) this.emit('event', { ...ev, backfill });
    }
  }
}

module.exports = { parseLine, ClientLogWatcher, findLogPath, defaultLogPaths };
