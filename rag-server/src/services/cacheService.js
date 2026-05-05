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
   * Generate cache key from query
   */
  generateKey(query, options = {}) {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    const hash = crypto.createHash('sha256')
      .update(normalized + JSON.stringify(options))
      .digest('hex')
      .substring(0, 16);
    return `rag:query:${hash}`;
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
      if (this.useRedis) {
        await this.redis.setex(key, ttl, JSON.stringify(value));
      } else {
        this.memCache.set(key, value, ttl);
      }
    } catch (err) {
      logger.warn('Cache set error:', err.message);
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
        const keys = await this.redis.keys('rag:query:*');
        if (keys.length) await this.redis.del(...keys);
        logger.info(`Flushed ${keys.length} Redis cache entries`);
        return keys.length;
      } else {
        const count = this.memCache.keys().length;
        this.memCache.flushAll();
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
      const keys = await this.redis.keys('rag:query:*').catch(() => []);
      return { backend: 'redis', entries: keys.length, ttl: this.currentTtl };
    }
    return { backend: 'memory', entries: this.memCache.keys().length, ttl: this.currentTtl };
  }
}

module.exports = new CacheService();
