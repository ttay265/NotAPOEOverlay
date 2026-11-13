# Design notes

## 1. What existing overlays use

| Tool | Stack | Ideas worth reusing |
|---|---|---|
| Awakened PoE Trade (and its PoE 2 fork Exiled Exchange 2) | Electron, TypeScript, Vue. `electron-overlay-window` to track the game window, `uiohook-napi` for global hotkeys | Parse the Ctrl+C item text, price check against poe.ninja and the official trade API, respect trade API rate-limit headers. Sends one Ctrl+C per hotkey press. |
| Sidekick | C# / .NET with a web UI | Same clipboard-parse approach; good item-mod data handling. |
| Exilence CE (Exilence Next) | Electron + React, later .NET | Reads stash tabs through the account API to value a whole stash with poe.ninja prices. |
| Lailloken UI | AutoHotkey | Many QoL panels; reads `Client.txt` and the screen, no memory reading. |
| POE-TradeMacro | AutoHotkey | The original clipboard price checker. Retired, but shows the same pattern. |
| MercuryTrade, Poe Trades Companion | Java / AutoHotkey | Tail `Client.txt` for trade whispers and give one-click invite / trade / thank buttons. |

The pattern every accepted tool shares: get data from the clipboard, `Client.txt`, the public
APIs, or the screen, and keep the player in charge of every game action. None read game memory.

## 2. Stack chosen for the prototype

**Electron + plain JavaScript (Node 20+).** It is what Awakened PoE Trade uses, so its solutions
transfer directly. It has a cross-platform transparent always-on-top window and a mature UI layer
for the later stash-layout and trade screens, and it needs no native build tools to start.

The prototype deliberately has no native modules yet. It watches the clipboard instead of hooking
keys, so it installs with a plain `npm install`. Next steps that need native modules:

- `electron-overlay-window`: pin the overlay to the game window and hide it when the game loses focus.
- `uiohook-napi`: one hotkey that sends Ctrl+C and opens the panel in one press, as Awakened PoE Trade does.

TypeScript and a UI framework can come in once there is more than one panel.

## 3. Game rules that shape the design

Grinding Gear Games' rules for third-party tools, as applied by the community tools above:

- **One server action per key press.** A macro may do exactly one game action per key the player presses. Ctrl+C on a hovered item, or sending one chat command such as `/invite name`, is fine. One key that ctrl-clicks 40 items is not.
- **No automation while the player is not actively playing.** Nothing may act in the game on its own: no auto-buying, auto-accepting trades, auto-listing, or auto-sorting.
- **No reading or changing game memory or network traffic.** Reading `Client.txt`, the clipboard, the screen, and the public APIs is the accepted route.
- **Trade API**: respect the rate-limit headers; aggressive polling gets the IP blocked.

## 4. Where the project goals conflict, and the compliant version

| Goal | Conflict | Compliant design |
|---|---|---|
| Automated trading while the player idles | Accepting, inviting, or trading while away is game automation and risks a ban. | The overlay works **for** the player while idle but never acts: it watches `Client.txt` for buy whispers, checks the offered price against poe.ninja, queues them, and sends a desktop or phone notification. When the player is back, each request is one key: invite, then trade, then thank. The overlay highlights the stash tab and cell named in the whisper so the player can grab the item fast. |
| Auto-arrange and deposit between inventory and stash | Moving many items with one key breaks the one-action rule. | The overlay reads the inventory and stash (account API, or screen reading) and draws a highlight on each item to ctrl-click and where it will go. The player clicks; the overlay keeps up. |
| Controller-friendly play | Mapping a controller button to one key or one click is fine; a button that runs a chain of actions is not. | Map each controller button to one existing game key or one overlay action (open price check, next highlighted item). Check first how far the PC client's own controller support already goes. |
| Smart stash layouts | None, read-only. | Read stash tabs, suggest which tab type and affinity each item group should use, and show a printable plan. |
| Find items to buy or sell | None, read-only. | Build official trade site searches (already in the prototype) and list price gaps from poe.ninja. Whispering a seller stays a player click. |

## 5. Roadmap

1. **Now:** clipboard price check and campaign leveling helper (this prototype).
2. Pin to the game window, single-hotkey price check (`electron-overlay-window`, `uiohook-napi`).
3. Trade helper: `Client.txt` watcher, whisper queue with price sanity check, one-key invite / trade / thank, stash cell highlight, notifications while idle.
4. Rare item pricing through the official trade API (mod parsing, rate-limit handling).
5. Stash reader through the official OAuth API (needs an app registration with GGG) for stash valuation and layout suggestions.
6. Controller mapping layer.

## 6. Leveling helper

What existing leveling tools do, and what this one reuses:

| Tool | How it knows where you are | What we took |
|---|---|---|
| Exile-Leveling (web app, MIT) | You tick steps by hand | Its base route: steps, tips, direction arrows and area ids for all 10 acts, vendored in `data/leveling/` |
| Lailloken UI leveling tracker | Tails `Client.txt` | Zone detection from the log, compact always-on-top panel |
| PoE-Leveling-Guide / LevelingGuide (AutoHotkey) | Tails `Client.txt` | Zone layout notes next to the current zone |
| Maxroll campaign guide, passive quest lists | n/a | Layout notes and the 24-point passive quest list |

How it works: `Client.txt` logs `Generating level N area "<id>"` on every zone change, with the game's
internal area id, which is unique per act (The Coast is `1_1_2` in Act 1 and `2_6_2` in Act 6). The
route uses the same ids, so the tracker moves forward to the next step that arrives in that area.
Towns only count when the town is the very next stop, so a trip to sell never skips ahead. Zones not on
the route (hideout, labyrinth, optional areas) leave the guide where it is.

Limits: the log does not record quest completion, so passive quests are ticked by the player and the
panel only nudges for ones the route has passed. Layout notes describe the usual tile layout, not the
current instance; showing the real exit would need screen reading, which can come later.

## 7. Known gaps in this prototype

- Not run against live poe.ninja yet: the build environment could not reach poe.ninja, so pricing was tested with saved sample responses in poe.ninja's format. If poe.ninja changes its API paths, edit `baseUrl` in `src/pricing.js`.
- Magic items: the base type is not separated from affixes, so they are not priced.
- Unique variants (for example different versions of the same unique) take the first match.
- Not tested on Windows yet; built and screenshot-tested on Linux with Electron 33.
- Leveling helper: tested with a sample Client.txt in the documented line format, not yet against a live game log.
