const express = require('express');
const router  = express.Router();

const queryController    = require('./controllers/queryController');
const documentController = require('./controllers/documentController');
const authController     = require('./controllers/authController');
const uploadMiddleware   = require('./middleware/upload');
const { requireApiKey, requireSession } = require('./middleware/auth');
const settingsController = require('./controllers/settingsController');
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

// ── Step-by-step pipeline test — pinpoints exactly where queries fail ──
router.get('/query/test', eitherAuth, async (req, res) => {
  const llm = require('./services/llmService');
  const vs  = require('./services/vectorStore');
  const testQuery = req.query.q || 'test';
  const report = { query: testQuery, steps: {} };

  // Step 1: Ollama reachable?
  try {
    const list = await llm.ollama.list();
    const names = list.models.map(m => m.name);
    report.steps.ollama = {
      ok: true,
      models: names,
      embedModelLoaded: names.some(n => n.includes('nomic-embed-text'))
    };
  } catch (err) {
    report.steps.ollama = { ok: false, error: err.message || String(err) };
  }

  // Step 2: Embedding works?
  if (report.steps.ollama?.ok && report.steps.ollama?.embedModelLoaded) {
    try {
      const emb = await llm.embed(testQuery);
      report.steps.embedding = { ok: true, dimensions: emb.length };
    } catch (err) {
      report.steps.embedding = { ok: false, error: err.message || String(err) };
    }
  } else {
    report.steps.embedding = { ok: false, error: 'Skipped — Ollama not ready' };
  }

  // Step 3: ChromaDB / vector search works?
  try {
    const stats = await vs.stats();
    report.steps.chromadb = { ok: true, totalChunks: stats.totalChunks, collection: stats.collection };
    if (report.steps.embedding?.ok) {
      const emb = await llm.embed(testQuery);
      const chunks = await vs.query(emb, 3);
      report.steps.vector_search = {
        ok: true,
        chunksReturned: chunks.length,
        topScore: chunks[0]?.relevanceScore?.toFixed(4) ?? 'n/a',
        threshold: parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.15')
      };
    }
  } catch (err) {
    report.steps.chromadb = { ok: false, error: err.message || String(err) };
  }

  // Step 4: OpenRouter reachable?
  try {
    const ping = await llm.openrouter.chat.completions.create({
      model: llm.currentModel,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 5
    });
    const reply = ping.choices?.[0]?.message?.content;
    report.steps.openrouter = {
      ok: true,
      model: llm.currentModel,
      apiKeySet: !!process.env.OPENROUTER_API_KEY,
      testReply: reply
    };
  } catch (err) {
    const msg = err.message || String(err);
    report.steps.openrouter = {
      ok: false,
      model: llm.currentModel,
      apiKeySet: !!process.env.OPENROUTER_API_KEY,
      error: msg
    };
  }

  // Summary
  const allOk = Object.values(report.steps).every(s => s.ok);
  const failedStep = Object.entries(report.steps).find(([,s]) => !s.ok);
  report.summary = allOk
    ? 'All steps passing — queries should work'
    : `Failing at step: ${failedStep?.[0]} — ${failedStep?.[1]?.error}`;

  res.status(allOk ? 200 : 207).json(report);
});

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

// ── Settings (Session only) ───────────────────────────────────────────
router.get('/settings',          requireSession, settingsController.get);
router.put('/settings',          requireSession, settingsController.update);
router.post('/settings/test-key',requireSession, settingsController.testKey);

// ── Live model switching (Session only) ───────────────────────────────
router.get('/models', requireSession, async (req, res) => {
  const llm = require('./services/llmService');

  // Known free models — always returned even if OpenRouter API is unreachable
  const KNOWN_FREE = [
    { id: 'stepfun/step-3.5-flash:free',             name: 'Step-3.5 Flash' },
    { id: 'microsoft/phi-3-mini-128k-instruct:free',  name: 'Phi-3 Mini' },
    { id: 'meta-llama/llama-3.1-8b-instruct:free',    name: 'Llama 3.1 8B' },
    { id: 'mistralai/mistral-7b-instruct:free',       name: 'Mistral 7B' },
    { id: 'google/gemma-2-9b-it:free',                name: 'Gemma 2 9B' },
    { id: 'qwen/qwen-2-7b-instruct:free',             name: 'Qwen 2 7B' },
    { id: 'nousresearch/hermes-3-llama-3.1-8b:free',  name: 'Hermes 3' },
  ];

  let liveModels = [];
  try {
    const list = await llm.openrouter.models.list();
    liveModels = (list.data || []).filter(m => m.id.endsWith(':free'));
  } catch (_) {
    // OpenRouter list unavailable — fall back to known list
  }

  // Merge: prefer live data, fall back to known list
  const merged = KNOWN_FREE.map(km => {
    const live = liveModels.find(lm => lm.id === km.id);
    return {
      id:            km.id,
      name:          live?.name || km.name,
      contextLength: live?.context_length || null,
      active:        km.id === llm.currentModel
    };
  });

  res.json({ current: llm.currentModel, models: merged });
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

  // Test OpenRouter — do a lightweight chat ping instead of models.list()
  // models.list() can 401 on some valid keys; a minimal chat call is more reliable
  try {
    const ping = await llm.openrouter.chat.completions.create({
      model:      llm.currentModel,
      messages:   [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    });
    result.openrouter = {
      status:         'ok',
      model:          llm.currentModel,
      apiKeySet:      !!process.env.OPENROUTER_API_KEY,
      availableModels: '—'   // skip full list to keep diagnostics fast
    };
  } catch (err) {
    const msg = err.message || String(err);
    // 429 = rate limit but key IS valid
    const keyOk = msg.includes('429') || msg.includes('rate');
    result.openrouter = {
      status:    keyOk ? 'ok' : 'error',
      model:     llm.currentModel,
      apiKeySet: !!process.env.OPENROUTER_API_KEY,
      error:     keyOk ? 'Rate limited (key is valid)' : msg
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
