const express = require('express');
const router  = express.Router();

const queryController    = require('./controllers/queryController');
const documentController = require('./controllers/documentController');
const authController     = require('./controllers/authController');
const uploadMiddleware   = require('./middleware/upload');
const { requireApiKey, requireSession } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimiter');

// ── Auth ─────────────────────────────────────────────────────────────
const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});
router.post('/auth/login',  loginRateLimit, authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/verify',  ...authController.verify);

// ── Query (API Key OR Session) ────────────────────────────────────────
const queryRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.QUERY_RATE_LIMIT || '20'),
  message: { error: 'Query rate limit exceeded.' }
});
router.post('/query',              eitherAuth, queryRateLimit, queryController.query);
router.get('/query/status/:jobId', eitherAuth, queryController.getJobStatus);
router.get('/query/debug',         eitherAuth, queryController.debug);

// ── Documents (Session only) ─────────────────────────────────────────
router.post('/documents/upload',             requireSession, uploadMiddleware.single('file'), documentController.upload);
router.get('/documents',                     requireSession, documentController.list);
router.get('/documents/stats',               requireSession, documentController.stats);
router.get('/documents/ingest-status/:jobId',requireSession, documentController.ingestStatus);
router.delete('/documents/:id',              requireSession, documentController.remove);

// ── Admin (Session only) ──────────────────────────────────────────────
router.delete('/cache',            requireSession, queryController.clearCache);
router.post('/vector-store/reset', requireSession, async (req, res) => {
  try {
    const vs = require('./services/vectorStore');
    await vs.reset();
    res.json({ message: 'Vector store collection reset. Re-upload all documents.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/info',     requireSession, queryController.info);

// ── Live model switching (Session only) ───────────────────────────────
router.get('/models', requireSession, async (req, res) => {
  const llm = require('./services/llmService');
  try {
    const list = await llm.openrouter.models.list();
    // Return all free models + the current active model
    const freeModels = (list.data || [])
      .filter(m => m.id.endsWith(':free'))
      .map(m => ({
        id:          m.id,
        name:        m.name || m.id,
        contextLength: m.context_length,
        active:      m.id === llm.currentModel
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    res.json({ current: llm.currentModel, models: freeModels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models/switch', requireSession, async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });
  const llm = require('./services/llmService');
  try {
    const result = await llm.switchModel(modelId);
    res.json({ message: `Switched to ${modelId}`, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

function eitherAuth(req, res, next) {
  const hasApiKey =
    req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').toLowerCase().startsWith('bearer ');
  return hasApiKey ? requireApiKey(req, res, next) : requireSession(req, res, next);
}

// ── Diagnostics (Session only) — connectivity check ──────────────────
router.get('/diagnostics', requireSession, async (req, res) => {
  const llm    = require('./services/llmService');
  const vs     = require('./services/vectorStore');
  const result = { ollama: {}, chromadb: {}, redis: {} };

  // Test Ollama (embeddings)
  try {
    const list = await llm.ollama.list();
    result.ollama = {
      status: 'ok',
      host: process.env.OLLAMA_HOST,
      models: list.models.map(m => m.name),
      embedModelReady: list.models.some(m => m.name.includes('nomic-embed-text'))
    };
  } catch (err) {
    result.ollama = { status: 'error', host: process.env.OLLAMA_HOST, error: err.message || String(err) };
  }

  // Test OpenRouter (LLM generation)
  try {
    const models = await llm.openrouter.models.list();
    result.openrouter = {
      status: 'ok',
      model: process.env.OPENROUTER_MODEL,
      apiKeySet: !!process.env.OPENROUTER_API_KEY,
      availableModels: models.data?.length ?? 0
    };
  } catch (err) {
    result.openrouter = {
      status: 'error',
      model: process.env.OPENROUTER_MODEL,
      apiKeySet: !!process.env.OPENROUTER_API_KEY,
      error: err.message || String(err)
    };
  }

  // Test ChromaDB
  try {
    const stats = await vs.stats();
    result.chromadb = { status: 'ok', ...stats };
  } catch (err) {
    result.chromadb = { status: 'error', error: err.message || String(err) };
  }

  // Test Redis via cache
  try {
    const cache = require('./services/cacheService');
    const s = await cache.stats();
    result.redis = { status: 'ok', ...s };
  } catch (err) {
    result.redis = { status: 'error', error: err.message || String(err) };
  }

  const allOk = ['ollama','chromadb','redis','openrouter'].every(k => result[k]?.status === 'ok');
  res.status(allOk ? 200 : 207).json({ allOk, ...result });
});
