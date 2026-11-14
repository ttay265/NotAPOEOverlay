'use strict';
// Client-side mirror of the official trade API rate limits.
//
// The server describes its limits in response headers:
//   X-Rate-Limit-Rules: Account,Ip
//   X-Rate-Limit-Ip:        8:10:60,15:60:300,60:300:1800     (max hits : window s : penalty s)
//   X-Rate-Limit-Ip-State:  1:10:0,1:60:0,1:300:0             (hits used : window s : restricted for s)
//   Retry-After: 60                                            (on HTTP 429)
// We keep one RateLimiter per (max, window) rule, sync our hit count with the server's state,
// and never send a request that would go over any rule.
//
// Ported to timestamps (so it is testable with a fake clock) from Awakened PoE Trade's
// renderer/src/web/price-check/trade/RateLimiter.ts and common.ts
// (MIT, (c) 2020 Alexander Drozdov, https://github.com/SnosMe/awakened-poe-trade).

class RateLimiter {
  constructor(max, windowSec) {
    this.max = max;
    this.window = windowSec;
    this.releases = []; // ms timestamps when each used hit frees up, ascending
  }

  prune(now) {
    while (this.releases.length && this.releases[0] <= now) this.releases.shift();
  }

  available(now) {
    this.prune(now);
    return Math.max(this.max - this.releases.length, 0);
  }

  take(now) {
    this.releases.push(now + this.window * 1000);
    this.releases.sort((a, b) => a - b);
  }

  // ms until one hit frees up (0 if one is free now)
  waitMs(now) {
    return this.available(now) > 0 ? 0 : this.releases[0] - now;
  }

  isEqual(other) {
    return this.max === other.max && this.window === other.window;
  }
}

class LimitSet {
  constructor(limiters = [new RateLimiter(1, 5)], { latencySec = 2 } = {}) {
    // Before the first response we don't know the real limits; start very conservative.
    this.limiters = limiters;
    this.latencySec = latencySec; // padding so client/server clocks and latency never desync us
    this.restrictedUntil = 0;
  }

  waitMs(now) {
    const blocked = Math.max(0, this.restrictedUntil - now);
    return Math.max(blocked, ...this.limiters.map((l) => l.waitMs(now)));
  }

  take(now) {
    for (const l of this.limiters) l.take(now);
  }

  // How long until `count` more requests could all be sent (simulation, from APT estimateTime).
  estimateMs(count, now) {
    const sim = this.limiters.map((l) => {
      l.prune(now);
      return { max: l.max, window: l.window, stack: l.releases.map((t) => t - now) };
    });
    let total = Math.max(0, this.restrictedUntil - now);
    for (const s of sim) s.stack = s.stack.filter((t) => t > total);
    while (count--) {
      while (sim.some((s) => s.stack.length >= s.max)) {
        const wait = sim.reduce((ms, s) => (s.stack.length >= s.max ? Math.max(s.stack[0] - total, ms) : ms), 0);
        total += wait;
        for (const s of sim) s.stack = s.stack.filter((t) => t > total);
      }
      for (const s of sim) s.stack.push(total + s.window * 1000);
    }
    return total;
  }

  // Sync with the server's view. `headers` needs a get(name) method (fetch Headers).
  adjust(headers, now) {
    const rulesHeader = headers.get('x-rate-limit-rules');
    if (!rulesHeader) return;
    const rules = rulesHeader.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
    const server = [];
    for (const rule of rules) {
      const limits = (headers.get(`x-rate-limit-${rule}`) || '').split(',').filter(Boolean);
      const states = (headers.get(`x-rate-limit-${rule}-state`) || '').split(',').filter(Boolean);
      limits.forEach((lim, i) => {
        const [max, window] = lim.split(':').map(Number);
        const [used, , restricted] = (states[i] || '0:0:0').split(':').map(Number);
        if (!max || !window) return;
        server.push({ max, window: window + this.latencySec, used: used || 0 });
        if (restricted > 0) this.restrictedUntil = Math.max(this.restrictedUntil, now + restricted * 1000);
      });
    }
    if (!server.length) return;

    // Drop rules the server no longer reports.
    this.limiters = this.limiters.filter((l) => server.some((s) => l.isEqual(s)));
    for (const s of server) {
      let l = this.limiters.find((x) => x.isEqual(s));
      if (!l) {
        l = new RateLimiter(s.max, s.window);
        this.limiters.push(l);
      }
      // Server counted more hits than we did (other tools, browser tabs): burn the difference.
      const delta = s.used - (l.max - l.available(now));
      for (let i = 0; i < Math.min(delta, l.available(now)); i++) l.take(now);
    }
  }

  block(untilMs) {
    this.restrictedUntil = Math.max(this.restrictedUntil, untilMs);
  }

  toJSON() {
    return this.limiters.map((l) => `${l.max - l.available(Date.now())}/${l.max} per ${l.window}s`);
  }
}

module.exports = { RateLimiter, LimitSet };
