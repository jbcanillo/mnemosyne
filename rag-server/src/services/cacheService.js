const Redis = require('ioredis');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const DEFAULT_CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600'); // 1 hour

class CacheService {
  constructor() {
    this.useRedis = false;
    // Initialize TTL from config (will be set after config loads)
    this.currentTtl = DEFAULT_CACHE_TTL;
    this.memCache = new NodeCache({ stdTTL: this.currentTtl, checkperiod: 120 });
    // In-memory reverse index (filename → cache keys) for the non-Redis fallback
    this.memSourceIndex = new Map();

    // Try Redis
    try {
      this.redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 2
      });

      this.redis.on('connect', () => {
        this.useRedis = true;
        logger.info('Cache: Using Redis');
      });

      this.redis.on('error', (err) => {
        if (this.useRedis) {
          logger.warn('Redis error, falling back to memory cache:', err.message);
          this.useRedis = false;
        }
      });

      this.redis.connect().catch(() => {
        logger.warn('Redis unavailable, using in-memory cache');
      });
    } catch (err) {
      logger.warn('Redis init failed, using in-memory cache');
    }

    // Sync TTL from configService after it's loaded
    try {
      const cfg = require('./configService');
      const savedTtl = cfg.get('cacheTtl');
      if (savedTtl && typeof savedTtl === 'number') {
        this.currentTtl = savedTtl;
        this.memCache.setDefaultTTL(savedTtl);
        logger.info(`[Cache] Initialized TTL from config: ${savedTtl}s`);
      }
    } catch (err) {
      logger.warn('[Cache] Could not load initial TTL from config:', err.message);
    }
  }

  // Update TTL from config (called when settings change)
  updateTtl(ttl) {
    this.currentTtl = ttl;
    // Note: existing cache entries keep their original TTL.
    // New entries will use the updated TTL.
    logger.info(`[Cache] TTL updated to ${ttl}s`);
  }

  /**
   * Generate cache key from query.
   *
   * Only options that change the answer take part in the key. Tags are
   * lowercased, de-duplicated and sorted so ["HR","Finance"] and
   * ["finance","hr"] share an entry, while an answer filtered to HR is never
   * served to someone filtering on Purchasing. sessionId is deliberately left
   * out: conversations with history bypass the cache (see queryController),
   * so the remaining entries are history-free and safe to share.
   */
  generateKey(query, options = {}) {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    const { sessionId, tags, ...rest } = options || {};
    const canonical = { ...rest };
    if (Array.isArray(tags) && tags.length) {
      canonical.tags = [...new Set(tags.map(t => String(t).trim().toLowerCase()))].sort();
    }
    const stable = JSON.stringify(canonical, Object.keys(canonical).sort());
    const hash = crypto.createHash('sha256')
      .update(normalized + stable)
      .digest('hex')
      .substring(0, 16);
    return `rag:query:${hash}`;
  }

  _sourceKey(filename) {
    return `rag:src:${String(filename).toLowerCase()}`;
  }

  /**
   * Walk keys matching a pattern with SCAN (non-blocking, unlike KEYS).
   */
  async _scan(pattern) {
    const found = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async get(key) {
    try {
      if (this.useRedis) {
        const val = await this.redis.get(key);
        if (val) {
          logger.debug(`Cache HIT (Redis): ${key}`);
          return JSON.parse(val);
        }
      } else {
        const val = this.memCache.get(key);
        if (val !== undefined) {
          logger.debug(`Cache HIT (Memory): ${key}`);
          return val;
        }
      }
      logger.debug(`Cache MISS: ${key}`);
      return null;
    } catch (err) {
      logger.warn('Cache get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttl = this.currentTtl) {
    try {
      const entry = { ...value, cachedAt: new Date().toISOString() };
      const filenames = [...new Set((value?.sources || []).map(s => s?.filename).filter(Boolean))];

      // "No information found" answers cite nothing, so a later upload could
      // never invalidate them. Don't cache them at all.
      if (filenames.length === 0) return;

      if (this.useRedis) {
        const pipe = this.redis.multi().setex(key, ttl, JSON.stringify(entry));
        for (const f of filenames) {
          const idx = this._sourceKey(f);
          pipe.sadd(idx, key);
          // Index lives at least as long as the entries it points at
          pipe.expire(idx, Math.max(ttl, 60) * 2);
        }
        await pipe.exec();
      } else {
        this.memCache.set(key, entry, ttl);
        for (const f of filenames) {
          const idx = this._sourceKey(f);
          if (!this.memSourceIndex.has(idx)) this.memSourceIndex.set(idx, new Set());
          this.memSourceIndex.get(idx).add(key);
        }
      }
    } catch (err) {
      logger.warn('Cache set error:', err.message);
    }
  }

  /**
   * Drop every cached answer that cited the given source file.
   * Call when a document is (re-)ingested or deleted.
   */
  async invalidateBySource(filename) {
    if (!filename) return 0;
    const idx = this._sourceKey(filename);
    try {
      let count = 0;
      if (this.useRedis) {
        const keys = await this.redis.smembers(idx);
        if (keys.length) count = await this.redis.del(...keys);
        await this.redis.del(idx);
      } else {
        const keys = [...(this.memSourceIndex.get(idx) || [])];
        count = this.memCache.del(keys);
        this.memSourceIndex.delete(idx);
      }
      logger.info(`[Cache] Invalidated ${count} cached answer(s) citing "${filename}"`);
      return count;
    } catch (err) {
      logger.warn('Cache invalidateBySource error:', err.message);
      return 0;
    }
  }

  async del(key) {
    try {
      if (this.useRedis) {
        await this.redis.del(key);
      } else {
        this.memCache.del(key);
      }
    } catch (err) {
      logger.warn('Cache del error:', err.message);
    }
  }

  async flush() {
    try {
      if (this.useRedis) {
        const keys = await this._scan('rag:query:*');
        const idx  = await this._scan('rag:src:*');
        if (keys.length) await this.redis.del(...keys);
        if (idx.length)  await this.redis.del(...idx);
        logger.info(`Flushed ${keys.length} Redis cache entries`);
        return keys.length;
      } else {
        const count = this.memCache.keys().length;
        this.memCache.flushAll();
        this.memSourceIndex.clear();
        logger.info(`Flushed ${count} memory cache entries`);
        return count;
      }
    } catch (err) {
      logger.warn('Cache flush error:', err.message);
      return 0;
    }
  }

  async stats() {
    if (this.useRedis) {
      const keys = await this._scan('rag:query:*').catch(() => []);
      return { backend: 'redis', entries: keys.length, ttl: this.currentTtl };
    }
    return { backend: 'memory', entries: this.memCache.keys().length, ttl: this.currentTtl };
  }
}

module.exports = new CacheService();
