const crypto = require('crypto');
const cacheService = require('./cacheService');
const { logger } = require('../utils/logger');

const API_KEYS_CONFIG_KEY = 'config:api_keys';

/**
 * Get the Redis client from cacheService — waits up to 5s for connection
 */
async function getRedis() {
  // If already connected, return immediately
  if (cacheService.useRedis && cacheService.redis) {
    return cacheService.redis;
  }

  // Wait up to 5 seconds for Redis to connect
  for (let i = 0; i < 10; i++) {
    if (cacheService.useRedis && cacheService.redis) {
      return cacheService.redis;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error('Redis is not available. API keys require Redis for persistence. Check that Redis container is running.');
}

class ApiKeyService {
  constructor() {
    this._keys = new Map(); // In-memory cache
  }

  /**
   * Initialize API keys — called on startup
   * Migrates the single RAG_API_KEY from env to Redis if it exists
   */
  async initialize() {
    try {
      const client = await getRedis();

      // Check if API keys already exist in Redis
      const exists = await client.exists(API_KEYS_CONFIG_KEY);
      if (!exists && process.env.RAG_API_KEY) {
        // Migrate the single API key from environment
        const key = {
          id: crypto.randomUUID(),
          key: process.env.RAG_API_KEY,
          name: 'Default API Key',
          created: new Date().toISOString(),
          lastUsed: null,
          active: true
        };
        await this.addKey(key.key, key.name);
        logger.info('[ApiKeyService] Migrated existing RAG_API_KEY from environment to Redis');
      } else if (!exists) {
        logger.info('[ApiKeyService] No API keys configured — starting with empty list');
      }

      // Load keys into memory cache
      await this._loadKeys();
      logger.info(`[ApiKeyService] Loaded ${this._keys.size} API keys`);
    } catch (err) {
      logger.error('[ApiKeyService] Initialization failed:', err.message);
      throw err;
    }
  }

  /**
   * Load API keys from Redis into memory
   */
  async _loadKeys() {
    try {
      const client = await getRedis();
      const data = await client.get(API_KEYS_CONFIG_KEY);
      if (data) {
        const keys = JSON.parse(data);
        this._keys.clear();
        keys.forEach(key => {
          this._keys.set(key.id, key);
        });
      }
    } catch (err) {
      logger.error('[ApiKeyService] Failed to load keys:', err.message);
      throw err;
    }
  }

  /**
   * Save API keys to Redis
   */
  async _saveKeys() {
    try {
      const client = await getRedis();
      const keys = Array.from(this._keys.values());
      await client.set(API_KEYS_CONFIG_KEY, JSON.stringify(keys));
      logger.debug(`[ApiKeyService] Saved ${keys.length} API keys to Redis`);
    } catch (err) {
      logger.error('[ApiKeyService] Failed to save keys:', err.message);
      throw err;
    }
  }

  /**
   * Generate a new API key
   */
  generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Add a new API key
   */
  async addKey(key, name = 'Unnamed Key') {
    if (!key || key.length < 32) {
      throw new Error('API key must be at least 32 characters long');
    }

    const keyObj = {
      id: crypto.randomUUID(),
      key: key,
      name: name,
      created: new Date().toISOString(),
      lastUsed: null,
      active: true
    };

    this._keys.set(keyObj.id, keyObj);
    await this._saveKeys();
    logger.info(`[ApiKeyService] Added new API key: ${name}`);
    return keyObj;
  }

  /**
   * Create and add a new randomly generated API key
   */
  async createKey(name = 'New API Key') {
    const key = this.generateKey();
    return await this.addKey(key, name);
  }

  /**
   * Get all API keys (without the actual key values for security)
   */
  async getAllKeys() {
    const keys = Array.from(this._keys.values()).map(k => ({
      id: k.id,
      name: k.name,
      created: k.created,
      lastUsed: k.lastUsed,
      active: k.active,
      keyPreview: k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4)
    }));
    return keys;
  }

  /**
   * Get a specific API key by ID (full details, only for internal use)
   */
  getKeyById(id) {
    return this._keys.get(id);
  }

  /**
   * Validate an API key and return the key object if valid
   */
  validateKey(providedKey) {
    for (const [id, keyObj] of this._keys) {
      if (keyObj.active && this._timingSafeCompare(providedKey, keyObj.key)) {
        // Update last used timestamp
        keyObj.lastUsed = new Date().toISOString();
        this._saveKeys().catch(err => logger.error('[ApiKeyService] Failed to update lastUsed:', err.message));
        return keyObj;
      }
    }
    return null;
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  _timingSafeCompare(a, b) {
    try {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) {
        // Still do a dummy compare to avoid timing leak on length
        crypto.timingSafeEqual(bufA, bufA);
        return false;
      }
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Delete an API key by ID
   */
  async deleteKey(id) {
    const keyObj = this._keys.get(id);
    if (!keyObj) {
      throw new Error('API key not found');
    }

    this._keys.delete(id);
    await this._saveKeys();
    logger.info(`[ApiKeyService] Deleted API key: ${keyObj.name}`);
    return keyObj;
  }

  /**
   * Toggle active status of an API key
   */
  async toggleKey(id) {
    const keyObj = this._keys.get(id);
    if (!keyObj) {
      throw new Error('API key not found');
    }

    keyObj.active = !keyObj.active;
    await this._saveKeys();
    logger.info(`[ApiKeyService] ${keyObj.active ? 'Activated' : 'Deactivated'} API key: ${keyObj.name}`);
    return keyObj;
  }

  /**
   * Check if any API keys are configured
   */
  hasKeys() {
    return Array.from(this._keys.values()).some(k => k.active);
  }

  /**
   * Get the total number of active keys
   */
  getActiveKeyCount() {
    return Array.from(this._keys.values()).filter(k => k.active).length;
  }
}

module.exports = new ApiKeyService();