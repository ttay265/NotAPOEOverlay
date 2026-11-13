'use strict';
// Follows your position on the campaign route from the zones you enter, and builds what the
// leveling panel shows: current zone, what to do here, how to reach the next zone, and the
// passive point quests for this act.
//
// Matching rules (Exile-Leveling's route uses the game's area ids, which are unique per act):
//  - Entering a normal zone jumps forward to the next route step that arrives there.
//  - Entering a town only advances when the town is the very next stop on the route, so popping
//    back to sell or to hand in early never skips ahead.
//  - Zones not on the route (hideout, labyrinth, optional areas) leave the position alone.
// Prev/next buttons in the panel fix any mismatch by hand.

const { loadRoute, renderFragments, AREAS, areaName } = require('./route');
const { passiveQuests, totalPoints } = require('./passives');
const { ZONE_TIPS } = require('./zonetips');

class LevelingTracker {
  constructor(options = {}, state = {}) {
    this.options = options;
    this.steps = options.steps || loadRoute(options);
    this.quests = passiveQuests(options);
    // Route step where each passive quest is handed in, for "missed it?" warnings.
    this.handIn = {};
    for (const q of this.quests) {
      const s = this.steps.find((st) => st.quests.includes(q.id) && /Hand in/i.test(textOf(st.frags)));
      if (s) this.handIn[q.id] = s.i;
    }
    this.pos = clamp(Number(state.pos) || 0, 0, this.steps.length - 1);
    this.done = { ...(state.done || {}) };
    this.zone = state.zone || null; // { id, name, areaLevel }
    this.character = state.character || null; // { name, className, level }
  }

  state() {
    return { pos: this.pos, done: this.done, zone: this.zone, character: this.character };
  }

  // Returns true if the route position moved.
  enterArea(areaId, areaLevel) {
    const known = AREAS[areaId];
    this.zone = { id: areaId, name: known ? known.name : areaId, areaLevel: areaLevel || (known && known.level) || null };
    this.awaitingName = true;
    if (!known) return false;
    if (known.town) {
      const next = this.nextArrival(this.pos);
      if (next && next.arrive === areaId) { this.pos = next.i; return true; }
      return false;
    }
    const hit = this.steps.find((s) => s.i > this.pos && s.arrive === areaId);
    if (hit) { this.pos = hit.i; return true; }
    return false;
  }

  // "You have entered X." follows each "Generating ... area" line. It names zones our data lacks
  // (hideouts, maps); if it ever comes alone, the zone is resolved from the name.
  entered(name) {
    if (this.awaitingName) {
      this.awaitingName = false;
      if (this.zone && !AREAS[this.zone.id]) this.zone.name = name;
      return false;
    }
    return this.enterAreaByName(name);
  }

  // Fallback when only "You have entered X." is seen (no area id): resolve the name near the route.
  enterAreaByName(name) {
    const ids = Object.keys(AREAS).filter((id) => AREAS[id].name === name);
    if (!ids.length) { this.zone = { id: null, name, areaLevel: null }; return false; }
    const ahead = this.steps.find((s) => s.i > this.pos && ids.includes(s.arrive));
    const act = this.currentAct();
    const id = ahead ? ahead.arrive : ids.find((x) => AREAS[x].act === act) || ids[0];
    return this.enterArea(id);
  }

  setLevel(character, className, level) {
    this.character = { name: character, className, level };
  }

  step(delta) {
    // Jump to the previous / next arrival point (a zone change), not single lines.
    if (delta > 0) {
      const n = this.nextArrival(this.pos);
      this.pos = n ? n.i : this.steps.length - 1;
    } else {
      let i = this.pos - 1;
      while (i > 0 && !this.steps[i].arrive) i--;
      this.pos = Math.max(0, i);
    }
  }

  toggleDone(id) {
    if (this.done[id]) delete this.done[id]; else this.done[id] = true;
  }

  reset() {
    this.pos = 0;
    this.done = {};
  }

  nextArrival(from) {
    for (let i = from + 1; i < this.steps.length; i++) if (this.steps[i].arrive) return this.steps[i];
    return null;
  }

  currentAct() {
    return (this.steps[this.pos] && this.steps[this.pos].act) || 1;
  }

  view() {
    const act = this.currentAct();
    const here = this.steps[this.pos];
    const next = this.nextArrival(this.pos);
    const end = next ? next.i : this.steps.length;
    const zoneId = (this.zone && this.zone.id) || (here && here.at);
    const lvl = this.character && this.character.level;

    // Things to do before leaving for the next zone.
    const todo = [];
    for (let i = this.pos + 1; i < end; i++) todo.push(this.renderStep(this.steps[i]));

    const routeZone = here && here.at;
    const offRoute = !!(this.zone && this.zone.id && routeZone && this.zone.id !== routeZone);

    const quests = this.quests.map((q) => ({
      id: q.id, act: q.act, name: q.name, points: q.points, todo: q.todo, npc: q.npc, respec: q.respec || 0,
      done: !!this.done[q.id],
      here: !this.done[q.id] && !!zoneId && q.zones.includes(zoneId),
      missed: !this.done[q.id] && this.handIn[q.id] != null && this.pos > this.handIn[q.id],
    }));
    const got = quests.filter((q) => q.done).reduce((n, q) => n + q.points, 0);

    return {
      act,
      zone: this.zone,
      routeZone: routeZone ? { id: routeZone, name: areaName(routeZone) } : null,
      offRoute,
      zoneTip: (zoneId && ZONE_TIPS[zoneId]) || null,
      character: this.character,
      arrivedVia: here ? this.renderStep(here) : null,
      todo,
      next: next ? { ...this.renderStep(next), area: areaName(next.arrive), areaLevel: AREAS[next.arrive] && AREAS[next.arrive].level } : null,
      underLevel: next && next.recommendedLevel && lvl && lvl < next.recommendedLevel ? next.recommendedLevel : null,
      passives: {
        act: quests.filter((q) => q.act === act),
        here: quests.filter((q) => q.here),
        missed: quests.filter((q) => q.missed && q.act <= act),
        got,
        total: totalPoints(this.options),
      },
      progress: { pos: this.pos, count: this.steps.length },
    };
  }

  renderStep(s) {
    const ctx = { areaId: s.at };
    const subs = s.subs.map((f) => renderFragments(f, ctx));
    return {
      i: s.i,
      tokens: renderFragments(s.frags, ctx),
      subs,
      recommendedLevel: s.recommendedLevel || null,
      passive: s.quests.some((id) => this.quests.some((q) => q.id === id)),
    };
  }
}

const textOf = (frags) => frags.map((f) => (f.t === 'text' ? f.v : '')).join('');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

module.exports = { LevelingTracker };
