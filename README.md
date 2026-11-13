# NotAPOEOverlay: Path of Exile 1 overlay prototype (Windows, English client)

Two panels: a campaign **leveling helper** (below) and a small price-check overlay.

## Price check

The price-check overlay: Hover an item in game and press **Ctrl+C** (the game's own copy key).
The overlay reads the copied item text, looks up its price on poe.ninja, and shows a small panel
next to your mouse. It never sends keys or clicks to the game.

### Rare items: pick mods and search the official trade site

Rare, magic and unique gear gets a mod list, the same idea as Awakened PoE Trade:

- Each mod has a checkbox and editable **min / max** boxes. Scroll the mouse wheel over a box to
  change it (Shift = steps of 10), or click into it to type. **Enter** searches, **Esc** closes.
- Pseudo totals (**P**) add up resistances, life (including Strength), attributes and so on across
  all mods and the implicit, like the trade site's "pseudo" stats. Total elemental resistance,
  total life and chaos resistance start ticked; everything else is your choice.
- Defaults start 10% below your roll (`trade.rangePercent`). Copy with **Ctrl+Alt+C** to also get
  roll ranges and tiers in the list.
- Options under the list: same base type, item level, links, online only.
- On copy, one search runs with the default ticks (when any are ticked). After that, a search only
  runs when you press **Search**. Results show the median and cheapest of the 10 cheapest listings
  (converted to chaos with poe.ninja rates), each listing's price, item level, age and seller
  status. **Load 10 more** fetches the next page. **Open trade site** opens the same search in your browser.

How it avoids getting you blocked by the trade API:

- It reads the `X-Rate-Limit-*` headers on every response and keeps its own count of each limit,
  so it never sends a request that would go over one. Until it has seen the headers it allows only
  one request per 5 seconds.
- Requests wait in a queue, one at a time. If the wait would be over 10 seconds (`trade.maxWaitSec`),
  it shows "try again in N s" instead of queueing.
- On HTTP 429 it stops all requests until the `Retry-After` time has passed.
- Copying several items quickly only searches the last one (350 ms debounce), and a queued search
  for an item you have moved on from is dropped before it is sent.
- The same search within 5 minutes comes from cache, and the Search button ignores presses while a
  search is running and more than one per second.

## Run it on Windows

1. Install Node.js 20 or newer from https://nodejs.org.
2. In this folder, open a terminal and run `npm install`.
3. Open `config.json` and set `league` to the league you play, spelled as poe.ninja spells it
   (for example `"Standard"`, `"Hardcore"`, or the current challenge league name).
4. In Path of Exile, set **Options > Graphics > Display Mode** to **Windowed Fullscreen**.
   Overlays cannot draw over exclusive fullscreen.
5. Run `npm start`, then in game hover an item and press Ctrl+C (Ctrl+Alt+C also works).

The panel hides after 10 seconds, or when you click Close. **Ctrl+Shift+Space** shows or hides it.
"Search trade site" opens the official trade site in your browser, pre-filled with the item.

## Leveling helper

A panel in the top-right corner that follows your campaign run. It reads the game's own log file
(`logs/Client.txt` in the Path of Exile folder) to see which zone you just entered and your
character level. It never reads game memory and never presses keys for you.

For the zone you are in, it shows:

- **Layout note**: how this zone is usually laid out (where the waypoint and exits tend to be).
- **★ Passive point here**: when a quest that gives a passive skill point is in this zone.
- **Do here**: the steps of the route for this zone, with direction arrows and tips.
- **Next zone**: where the main quest goes next and how to find the exit. A warning shows when
  you are below the recommended level for what comes next.
- **Passive points**: every passive point quest in the current act, with what to do and who
  gives the reward. Click a quest to tick it. Quests from earlier acts that the route has passed
  but you have not ticked are listed under "did you get these?". Type `/passives` in game chat to
  check what the game says you have (24 in total when you kill all three bandits).

**‹ ›** move the guide one zone back or forward if it ever gets out of step, **–** hides the panel,
**Ctrl+Shift+L** shows or hides it, and **New run** (click twice) starts over for a new character.
Going to town, your hideout or an optional zone never moves the guide forward on its own.
Progress is saved between sessions.

### Settings (`config.json`, `leveling` section)

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Set to `false` to turn the panel off. |
| `clientLog` | `""` | Full path to `Client.txt`. Empty looks in the usual Standalone, Steam and Epic folders. Use `\\` in paths, e.g. `"D:\\Games\\Path of Exile\\logs\\Client.txt"`. |
| `leagueStart` | `true` | Include league-start extras: trials, flask and gem pickups. |
| `bandit` | `"kill_all"` | `kill_all` (one extra passive point), or `alira`, `kraityn`, `oak` to help one. |
| `library` | `false` | Include the Act 3 Library side trip. |
| `corner` | `"top-right"` | Where the panel docks: `top-left`, `top-right`, `bottom-left`, `bottom-right`. |
| `toggleHotkey` | `"Ctrl+Shift+L"` | Show or hide the panel. |

### Try it without the game

`npm run leveling -- "C:\path\to\Client.txt" --last 10` replays a log and prints what the panel
would have shown at each zone change. `test/fixtures/client-act1.txt` is a short sample.

### Where the guide comes from

The route, step tips and area ids are [Exile-Leveling](https://github.com/HeartofPhos/exile-leveling)'s
base route (MIT licence, copy in `data/leveling/LICENSE-exile-leveling`), the route speedrunners keep
current. Zone layout notes and the passive quest list are written for this project from the Maxroll
campaign guide and community act-by-act notes. To use your own route, edit the files in
`data/leveling/routes/` (Exile-Leveling's route editor writes the same format).

## Check prices without the overlay

Copy an item in game, paste it into a text file, then run:

```
npm run price -- item.txt
```

This is the quickest way to see whether poe.ninja lookups work for your league.

## What it prices

| Item | How it is matched |
|---|---|
| Currency, fragments, essences, fossils, scarabs, oils, omens… | by name, times stack size |
| Divination cards | by name, times stack size |
| Unique items | by name and base, using the 5-link or 6-link price when linked |
| Skill gems | by name and corruption, closest level then quality |
| Maps | by base and tier |
| Rare, magic and unique gear | official trade API with the mods you tick (see above) |

Prices with fewer than 5 listings on poe.ninja are flagged as unreliable.

## Tests

`npm test` runs the parser and pricing tests against saved sample data.

## Files

- `src/parser.js` reads the clipboard item text.
- `src/pricing.js` fetches and caches poe.ninja data (30 minutes) and matches items.
- `src/main.js` is the Electron overlay: clipboard watch, window, hotkey.
- `src/trade/` is the trade API price check: `mods.js` (mod text to trade stat ids), `filters.js`
  (pseudo totals and default min/max), `query.js` (search body), `ratelimit.js` and `client.js`
  (rate limits, queue, cache), `pricecheck.js` (ties it together).
- `data/trade/stats.ndjson` is the stat translation table from Awakened PoE Trade (MIT, see
  `data/trade/LICENSE-awakened-poe-trade`). Copy a newer one from APT after a big patch.
- `renderer/` is the panel UI.
- `src/leveling/` is the leveling helper: `clientlog.js` (Client.txt reader), `route.js` (route parser),
  `tracker.js` (follows your position), `passives.js`, `zonetips.js`, `window.js` (panel window).
- `renderer/leveling.*` is the leveling panel UI. `data/leveling/` holds the route and area data.
- `docs/DESIGN.md` covers the survey of existing overlays, the stack choice, the game's rules on automation, and the plan for the stash and trading features.
