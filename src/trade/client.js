'use strict';
// Official trade API client with rate limiting, a request queue and a short cache.
//
// Rules this client enforces so the account/IP never gets blocked:
//  - Every request waits for the client-side limits (see ratelimit.js), synced from the
//    server's X-Rate-Limit-* headers after every response.
//  - Requests go one at a time per endpoint, in order (a queue, not a burst).
//  - If the wait would be longer than `maxWaitMs`, we refuse and tell the player how long to wait.
//  - HTTP 429 or a "restricted" state stops all requests to that endpoint until Retry-After passes.
//  - A request that became stale while queued (the player already copied another item) is dropped
//    before it is sent.
//  - Identical searches within `cacheTtlMs` (5 minutes, like APT) are answered from cache.

const crypto = require('crypto');
const { LimitSet } = require('./ratelimit');

const BASE = 'https://www.pathofexile.com';

class RateLimitError extends Error {
  constructor(waitMs, why) {
    const s = Math.max(1, Math.ceil(waitMs / 1000));
    super(`${why || 'Trade API rate limit'}: try again in ${s}s`);
    this.name = 'RateLimitError';
    this.retryInSec = s;
  }
}
class StaleError extends Error {
  constructor() { super('superseded by a newer search'); this.name = 'StaleError'; }
}

class TradeClient {
  constructor({
    fetchImpl = globalThis.fetch, baseUrl = BASE, now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    cacheTtlMs = 5 * 60 * 1000, maxWaitMs = 10000, latencySec = 2, headers = {},
  } = {}) {
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.now = now;
    this.sleep = sleep;
    this.cacheTtlMs = cacheTtlMs;
    this.maxWaitMs = maxWaitMs;
    this.headers = headers;
    this.limits = { search: new LimitSet(undefined, { latencySec }), fetch: new LimitSet(undefined, { latencySec }) };
    this.queues = { search: Promise.resolve(), fetch: Promise.resolve() };
    this.cache = new Map(); // key -> { at, value }
  }

  // body: from query.buildQuery. Returns { id, result: [ids], total }.
  async search(league, body, opts = {}) {
    const key = 'search:' + hash([league, body]);
    const hit = this.cached(key);
    if (hit) return { ...hit, cached: true };
    const json = await this.enqueue('search', opts, () => this.fetch(`${this.baseUrl}/api/trade/search/${encodeURIComponent(league)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.headers },
      body: JSON.stringify(body),
    }));
    const value = { id: json.id, result: json.result || [], total: json.total || 0 };
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  // Fetch listing details for up to 10 result ids.
  async fetchListings(queryId, ids, opts = {}) {
    if (!ids.length) return [];
    const list = ids.slice(0, 10);
    const key = 'fetch:' + list.join(',');
    const hit = this.cached(key);
    if (hit) return hit;
    const json = await this.enqueue('fetch', opts, () => this.fetch(`${this.baseUrl}/api/trade/fetch/${list.join(',')}?query=${encodeURIComponent(queryId)}`, {
      headers: { Accept: 'application/json', ...this.headers },
    }));
    const value = (json.result || []).filter(Boolean).map(toListing);
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  cached(key) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > this.cacheTtlMs) { this.cache.delete(key); return null; }
    return hit.value;
  }

  // Serialises requests per endpoint so they never burst.
  enqueue(kind, opts, send) {
    const run = this.queues[kind].then(() => this.send(kind, opts, send));
    this.queues[kind] = run.catch(() => {});
    return run;
  }

  async send(kind, { isStale, onWait } = {}, send) {
    const limits = this.limits[kind];
    const est = limits.estimateMs(1, this.now());
    if (est > this.maxWaitMs) throw new RateLimitError(est);
    for (let wait = limits.waitMs(this.now()); wait > 0; wait = limits.waitMs(this.now())) {
      if (wait > this.maxWaitMs) throw new RateLimitError(wait);
      if (onWait) onWait(Math.ceil(wait / 1000));
      await this.sleep(wait);
      if (isStale && isStale()) throw new StaleError();
    }
    if (isStale && isStale()) throw new StaleError();

    limits.take(this.now());
    let res;
    try {
      res = await send();
    } catch (err) {
      throw new Error(`Could not reach pathofexile.com (${err.message || err})`);
    }
    limits.adjust(res.headers, this.now());

    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after')) || 60;
      limits.block(this.now() + ra * 1000);
      throw new RateLimitError(ra * 1000, 'Trade API says too many requests');
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(res.status === 403
        ? 'Trade site refused the request (HTTP 403). Open pathofexile.com/trade once in a browser, then try again.'
        : `Trade API HTTP ${res.status}`);
    }
    if (json && json.error) throw new Error(`Trade API: ${json.error.message || 'error ' + json.error.code}`);
    if (!res.ok) throw new Error(`Trade API HTTP ${res.status}`);
    return json;
  }

  status() {
    const now = this.now();
    return {
      searchWaitSec: Math.ceil(this.limits.search.waitMs(now) / 1000),
      fetchWaitSec: Math.ceil(this.limits.fetch.waitMs(now) / 1000),
    };
  }
}

function hash(v) {
  return crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');
}

function toListing(r) {
  const l = r.listing || {};
  const price = l.price || {};
  const account = l.account || {};
  return {
    id: r.id,
    amount: price.amount ?? null,
    currency: price.currency ?? null,
    priceType: price.type ?? null,
    indexed: l.indexed || null,
    account: account.name || null,
    character: account.lastCharacterName || null,
    online: account.online ? (account.online.status === 'afk' ? 'afk' : 'online') : (l.fee != null ? 'online' : 'offline'),
    instantBuyout: l.fee != null,
    ilvl: r.item ? r.item.ilvl : null,
    corrupted: !!(r.item && r.item.corrupted),
  };
}

module.exports = { TradeClient, RateLimitError, StaleError, toListing };
