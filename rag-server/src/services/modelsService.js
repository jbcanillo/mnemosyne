const cacheService = require('./cacheService');
const { logger } = require('../utils/logger');

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

  throw new Error('Redis is not available. Models require Redis for persistence. Check that Redis container is running.');
}

/**
 * Default models — empty, user adds everything from scratch
 */
const DEFAULT_MODELS = [];

const MODELS_CONFIG_KEY = 'config:models';

/**
 * Initialize models list if empty — called on startup
 */
async function initialize() {
  try {
    const client = await getRedis();
    const exists = await client.exists(MODELS_CONFIG_KEY);
    if (!exists) {
      logger.info('[ModelsService] No models configured — start with empty list');
      await client.set(MODELS_CONFIG_KEY, JSON.stringify([]));
    }
  } catch (err) {
    logger.warn('[ModelsService] Init failed:', err.message);
  }
}

/**
 * Get all available models
 */
async function getAllModels() {
  try {
    const client = await getRedis();
    const raw = await client.get(MODELS_CONFIG_KEY);
    if (!raw) {
      await initialize();
      return DEFAULT_MODELS;
    }
    return JSON.parse(raw);
  } catch (err) {
    logger.error('[ModelsService] Failed to get models:', err.message);
    return DEFAULT_MODELS;
  }
}

/**
 * Get single model by ID
 */
async function getModelById(modelId) {
  const models = await getAllModels();
  return models.find(m => m.id === modelId);
}

/**
 * Add a new model
 * @param {string} id - Model ID from OpenRouter (e.g., 'openai/gpt-4:free')
 * @param {string} name - Display name
 */
async function addModel(id, name) {
  if (!id || !name) throw new Error('Both id and name are required');
  
  const models = await getAllModels();
  
  // Check if already exists
  if (models.some(m => m.id === id)) {
    throw new Error(`Model ${id} already exists`);
  }
  
  const newModel = { id, name };
  models.push(newModel);
  
  try {
    const client = await getRedis();
    await client.set(MODELS_CONFIG_KEY, JSON.stringify(models));
    logger.info(`[ModelsService] Added model: ${id}`);
    return newModel;
  } catch (err) {
    logger.error('[ModelsService] Failed to add model:', err.message);
    throw err;
  }
}

/**
 * Update a model
 * @param {string} modelId - Model ID to update
 * @param {object} updates - { name?, id? }
 */
async function updateModel(modelId, updates) {
  const models = await getAllModels();
  const idx = models.findIndex(m => m.id === modelId);
  
  if (idx === -1) throw new Error(`Model ${modelId} not found`);
  
  // If renaming the ID, check for duplicates
  if (updates.id && updates.id !== modelId) {
    if (models.some(m => m.id === updates.id)) {
      throw new Error(`Model ${updates.id} already exists`);
    }
  }
  
  models[idx] = { ...models[idx], ...updates };
  
  try {
    const client = await getRedis();
    await client.set(MODELS_CONFIG_KEY, JSON.stringify(models));
    logger.info(`[ModelsService] Updated model: ${modelId}`);
    return models[idx];
  } catch (err) {
    logger.error('[ModelsService] Failed to update model:', err.message);
    throw err;
  }
}

/**
 * Delete a model
 */
async function deleteModel(modelId) {
  const models = await getAllModels();
  const filtered = models.filter(m => m.id !== modelId);
  
  if (filtered.length === models.length) {
    throw new Error(`Model ${modelId} not found`);
  }
  
  try {
    const client = await getRedis();
    await client.set(MODELS_CONFIG_KEY, JSON.stringify(filtered));
    logger.info(`[ModelsService] Deleted model: ${modelId}`);
  } catch (err) {
    logger.error('[ModelsService] Failed to delete model:', err.message);
    throw err;
  }
}

/**
 * Reset to defaults
 */
async function reset() {
  try {
    const client = await getRedis();
    await client.set(MODELS_CONFIG_KEY, JSON.stringify([]));
    logger.info('[ModelsService] Cleared all models');
  } catch (err) {
    logger.error('[ModelsService] Failed to reset:', err.message);
    throw err;
  }
}

/**
 * Get free models only (filtered by name containing 'free')
 */
async function getFreeModels() {
  const models = await getAllModels();
  return models.filter(m => m.id.includes(':free'));
}

module.exports = {
  initialize,
  getAllModels,
  getModelById,
  addModel,
  updateModel,
  deleteModel,
  reset,
  getFreeModels,
};
