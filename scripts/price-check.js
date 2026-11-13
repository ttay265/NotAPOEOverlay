'use strict';
// Command-line check without Electron: paste an item copied from PoE into a file, then
//   npm run price -- path\to\item.txt
// or pipe it in. Uses the league in config.json.
const fs = require('fs');
const path = require('path');
const { parseItem } = require('../src/parser');
const { PriceService } = require('../src/pricing');

const { league } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const text = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
const item = parseItem(text);
if (!item) { console.error('Not a PoE item (expected text starting with "Item Class:")'); process.exit(1); }
const { raw, ...shown } = item;
console.log(shown);
new PriceService({ league }).price(item)
  .then((p) => console.log(p || 'No poe.ninja price found'))
  .catch((e) => { console.error('Lookup failed:', e.message); process.exit(2); });
