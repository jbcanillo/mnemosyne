const express = require('express');
const router  = express.Router();

const queryController    = require('./controllers/queryController');
const documentController = require('./controllers/documentController');
const authController     = require('./controllers/authController');
const analyticsController = require('./controllers/analyticsController');
const uploadMiddleware   = require('./middleware/upload');
const { requireApiKey, requireSession, eitherAuth } = require('./middleware/auth');
const settingsController = require('./controllers/settingsController');
const { loginLimiter, queryLimiter, statusLimiter, uploadLimiter } = require('./middleware/rateLimiter');
const modelsService      = require('./services/modelsService');
const { logger }         = require('./utils/logger');

// ── Auth ─────────────────────────────────────────────────────────────
router.post('/auth/login',  loginLimiter, authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/verify',  ...authController.verify);

// ── Query (API Key OR Session) ────────────────────────────────────────
// queryLimiter allows 150+ requests/min for authenticated users, less for others
router.post('/query',              eitherAuth, queryLimiter, queryController.query);
router.get('/query/status/:jobId', eitherAuth, statusLimiter, queryController.getJobStatus);
router.get('/query/debug',         eitherAuth, statusLimiter, queryController.debug);

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
    const client = llm._openrouterClient();
    const ping = await client.chat.completions.create({
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
router.post('/documents/upload',             eitherAuth, uploadLimiter, uploadMiddleware.single('file'), documentController.upload);
router.get('/documents',                     eitherAuth, documentController.list);
router.get('/documents/stats',               eitherAuth, documentController.stats);
router.get('/documents/tags',                eitherAuth, documentController.getTags);
router.get('/documents/ingest-status/:jobId',eitherAuth, statusLimiter, documentController.ingestStatus);
router.get('/documents/:id/download',        eitherAuth, documentController.download);
router.delete('/documents/:id',              eitherAuth, documentController.remove);
router.put('/documents/:id/tags',            eitherAuth, documentController.updateTags);

// ── Admin (Session only) ──────────────────────────────────────────────
router.delete('/cache',            eitherAuth, queryController.clearCache);
router.post('/vector-store/reset', eitherAuth, async (req, res) => {
  try {
    const vs = require('./services/vectorStore');
    await vs.reset();
    res.json({ message: 'Vector store collection reset. Re-upload all documents.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/info',     eitherAuth, statusLimiter, queryController.info);

// ── API Keys (Session only) ───────────────────────────────────────────
const apiKeyService = require('./services/apiKeyService');
router.get('/api-keys', eitherAuth, async (req, res) => {
  try {
    const keys = await apiKeyService.getAllKeys();
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api-keys', eitherAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const key = await apiKeyService.createKey(name.trim());
    res.status(201).json({ key });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api-keys/:id', eitherAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const deletedKey = await apiKeyService.deleteKey(id);
    res.json({ message: 'API key deleted', key: deletedKey });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/api-keys/:id/toggle', eitherAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const key = await apiKeyService.toggleKey(id);
    res.json({ message: `API key ${key.active ? 'activated' : 'deactivated'}`, key });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Token usage & model info (Session only) ──────────────────────────
router.get('/usage', eitherAuth, (req, res) => {
  const cfg = require('./services/configService');
  const llm = require('./services/llmService');
  res.json({
    currentModel:  llm.currentModel,
    embeddingModel:'nomic-embed-text',
    engine:        llm.getEngine(),
    tokenUsage:    cfg.getTokenUsage()
  });
});

router.delete('/usage', eitherAuth, (req, res) => {
  const cfg = require('./services/configService');
  cfg.resetTokenUsage();
  res.json({ message: 'Token usage stats reset.' });
});

// ── Healthcheck (public — no authentication required) ──────────────────
router.get('/healthcheck', statusLimiter, async (req, res) => {
  const llm = require('./services/llmService');
  const vs  = require('./services/vectorStore');
  const cfg = require('./services/configService');
  const checks = {};

  // Ollama
  try {
    const list = await llm.ollama.list();
    checks.ollama = { ok: true, models: list.models.map(m => m.name) };
  } catch (err) {
    checks.ollama = { ok: false, error: err.message };
  }

  // ChromaDB
  try {
    const stats = await vs.stats();
    checks.chromadb = { ok: true, chunks: stats.totalChunks };
  } catch (err) {
    checks.chromadb = { ok: false, error: err.message };
  }

  // OpenRouter (fast ping)
  try {
    const client = llm._openrouterClient();
    const r = await client.chat.completions.create({
      model: llm.currentModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    });
    checks.openrouter = { ok: true, model: llm.currentModel, latencyMs: null };
  } catch (err) {
    const msg = err.message || '';
    checks.openrouter = {
      ok: msg.includes('429'),   // 429 = rate limited but key is valid
      model: llm.currentModel,
      error: msg
    };
  }

  // Redis
  try {
    const cache = require('./services/cacheService');
    const s = await cache.stats();
    checks.redis = { ok: true, backend: s.backend, entries: s.entries };
  } catch (err) {
    checks.redis = { ok: false, error: err.message };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  const apiKeyService = require('./services/apiKeyService');
  res.status(allOk ? 200 : 207).json({
    status:    allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    keySet:    apiKeyService.hasKeys(),
    checks
  });
});

// ── Settings (Session only) ───────────────────────────────────────────
router.get('/settings',          eitherAuth, settingsController.get);
router.put('/settings',          eitherAuth, settingsController.update);
router.post('/settings/test-key',eitherAuth, settingsController.testKey);
router.post('/models/:modelId/test', eitherAuth, async (req, res) => {
  const { modelId } = req.params;
  const OpenAI = require('openai');
  const cfg = require('./services/configService');
  const apiKey = cfg.get('openrouterApiKey');
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'No API key configured.' });
  }
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL   || 'http://localhost:3000',
        'X-Title':      process.env.APP_TITLE || 'Mnemosyne RAG'
      }
    });
    const completion = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 5
    });
    const reply = completion.choices?.[0]?.message?.content?.trim();
    res.json({
      ok: true,
      model: modelId,
      reply,
      tokens: completion.usage?.total_tokens ?? 0
    });
  } catch (err) {
    const msg = err.message || String(err);
    res.status(200).json({
      ok: false,
      model: modelId,
      error: msg.includes('401') || msg.includes('User not found')
        ? 'Invalid API key or model not accessible.'
        : msg.includes('429')
          ? 'Rate limited — model may be rate-limited but key is valid.'
          : msg
    });
  }
});

// ── Local LLM Model Management ─────────────────────────────────────────
router.post('/local-model/check', eitherAuth, async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name required' });
  const llm = require('./services/llmService');
  try {
    const list = await llm.ollama.list();
    const exists = list.models.some(m => m.name.includes(model));
    res.json({ exists, models: list.models.map(m => m.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/local-model/pull', eitherAuth, async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name required' });
  const llm = require('./services/llmService');
  try {
    await llm.ollama.pull({ model });
    res.json({ message: `Model ${model} pulled successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ollama/models', eitherAuth, async (req, res) => {
  const llm = require('./services/llmService');
  try {
    const list = await llm.ollama.list();
    res.json({ models: list.models.map(m => ({ name: m.name, size: m.size, modified_at: m.modified_at })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ollama/models/:model', eitherAuth, async (req, res) => {
  const { model } = req.params;
  const llm = require('./services/llmService');
  try {
    await llm.ollama.delete({ model: decodeURIComponent(model) });
    res.json({ message: `Model "${model}" deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Live model switching (Session only) ───────────────────────────────
router.get('/models', eitherAuth, async (req, res) => {
  const llm = require('./services/llmService');

  try {
    // Get configured models from modelsService (Redis-backed)
    const configuredModels = await modelsService.getAllModels();
    const currentModel = llm.currentModel;

    // Enrich with active flag
    const enriched = configuredModels.map(m => ({
      ...m,
      active: m.id === currentModel
    }));

    res.json({ current: currentModel, models: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models/switch', eitherAuth, async (req, res) => {
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

// ── Model CRUD (Session only) ─────────────────────────────────────────
router.post('/models', eitherAuth, async (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Both id and name are required' });
  try {
    const model = await modelsService.addModel(id, name);
    res.status(201).json({ message: 'Model added', model });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/models/:modelId', eitherAuth, async (req, res) => {
  const { modelId } = req.params;
  try {
    await modelsService.deleteModel(modelId);
    res.json({ message: `Model ${modelId} deleted` });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/models/reset', eitherAuth, async (req, res) => {
  try {
    await modelsService.reset();
    const models = await modelsService.getAllModels();
    res.json({ message: 'All models cleared', models: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Backup & Restore (Session only) ───────────────────────────────────
router.post('/backup/create', eitherAuth, async (req, res) => {
  try {
    const backup = require('./services/backupService');
    const result = await backup.createBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backup/list', eitherAuth, async (req, res) => {
  try {
    const backup = require('./services/backupService');
    const backups = await backup.listBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backup/restore', eitherAuth, async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });
  try {
    const backup = require('./services/backupService');
    const result = await backup.restoreBackup(filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/backup/:filename', eitherAuth, async (req, res) => {
  const { filename } = req.params;
  if (!filename) return res.status(400).json({ error: 'filename required' });
  try {
    const backup = require('./services/backupService');
    const result = await backup.deleteBackup(filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions / Conversations (Session only) ───────────────────────────
router.post('/sessions', eitherAuth, async (req, res) => {
  const { title } = req.body;
  const userId = req.user?.id || 'default-user';
  try {
    logger.info(`[API] POST /sessions - User: ${userId}, Title: "${title}"`);
    const sessions = require('./services/sessionService');
    const session = await sessions.createSession(userId, title);
    logger.info(`[API] Session created: ${session.id}`);
    res.status(201).json(session);
  } catch (err) {
    logger.error(`[API] POST /sessions failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions', eitherAuth, async (req, res) => {
  const userId = req.user?.id || 'default-user';
  try {
    logger.info(`[API] GET /sessions - User: ${userId}`);
    const sessions = require('./services/sessionService');
    const list = await sessions.getSessions(userId);
    logger.info(`[API] Retrieved ${list.length} sessions for user ${userId}`);
    res.json({ sessions: list });
  } catch (err) {
    logger.error(`[API] GET /sessions failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:sessionId', eitherAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { limit = 50, offset = 0 } = req.query;
  try {
    logger.info(`[API] GET /sessions/${sessionId} - User: ${req.user?.id || 'default-user'}, Limit: ${limit}, Offset: ${offset}`);
    const sessions = require('./services/sessionService');
    const session = await sessions.getSession(sessionId);
    if (!session) {
      logger.warn(`[API] Session not found: ${sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const messages = await sessions.getMessages(sessionId, offset, offset + limit - 1);
    logger.info(`[API] Retrieved ${messages.length} messages from session ${sessionId}`);
    res.json({ ...session, messages });
  } catch (err) {
    logger.error(`[API] GET /sessions/${sessionId} failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:sessionId/messages', eitherAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { type, text, sources, fromCache, relevantChunks, jobId } = req.body;
  if (!type || !text) return res.status(400).json({ error: 'type and text required' });
  try {
    const textPreview = text.substring(0, 100) + (text.length > 100 ? '...' : '');
    logger.info(`[API] POST /sessions/${sessionId}/messages - Type: ${type}, User: ${req.user?.id || 'default-user'}, Text: "${textPreview}"`);
    const sessions = require('./services/sessionService');
    const msg = await sessions.addMessage(sessionId, { type, text, sources, fromCache, relevantChunks, jobId });
    logger.info(`[API] Message added to session ${sessionId}`);
    res.status(201).json(msg);
  } catch (err) {
    logger.error(`[API] POST /sessions/${sessionId}/messages failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.put('/sessions/:sessionId', eitherAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { title, tags } = req.body;
  try {
    logger.info(`[API] PUT /sessions/${sessionId} - User: ${req.user?.id || 'default-user'}, Title: "${title || 'unchanged'}", Tags: [${tags?.join(', ') || 'none'}]`);
    const sessions = require('./services/sessionService');
    if (title) {
      await sessions.updateSessionTitle(sessionId, title);
    }
    if (tags) {
      await sessions.updateSessionTags(sessionId, tags);
    }
    logger.info(`[API] Session ${sessionId} updated successfully`);
    res.json({ message: 'Session updated' });
  } catch (err) {
    logger.error(`[API] PUT /sessions/${sessionId} failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sessions/:sessionId', eitherAuth, async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user?.id || 'default-user';
  try {
    logger.info(`[API] DELETE /sessions/${sessionId} - User: ${userId}`);
    const sessions = require('./services/sessionService');
    await sessions.deleteSession(userId, sessionId);
    logger.info(`[API] Session ${sessionId} deleted by user ${userId}`);
    res.json({ message: 'Session deleted' });
  } catch (err) {
    logger.error(`[API] DELETE /sessions/${sessionId} failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:sessionId/clear', eitherAuth, async (req, res) => {
  const { sessionId } = req.params;
  try {
    logger.info(`[API] POST /sessions/${sessionId}/clear - User: ${req.user?.id || 'default-user'}`);
    const sessions = require('./services/sessionService');
    await sessions.clearSession(sessionId);
    logger.info(`[API] Session ${sessionId} cleared`);
    res.json({ message: 'Session cleared' });
  } catch (err) {
    logger.error(`[API] POST /sessions/${sessionId}/clear failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ── Diagnostics — connectivity check ──────────────────
router.get('/diagnostics', eitherAuth, async (req, res) => {
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
    const client = llm._openrouterClient();
    const ping = await client.chat.completions.create({
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

// ── Logs (Session only) — read recent server logs ────────────────────
router.get('/logs', eitherAuth, async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { logger } = require('./utils/logger');
  const lines = parseInt(req.query.lines) || 200;

  try {
    const logFile = path.join('/var/log/rag', 'combined.log');
    if (!fs.existsSync(logFile)) {
      // Fallback: try error.log
      const errorFile = path.join('/var/log/rag', 'error.log');
      if (!fs.existsSync(errorFile)) {
        return res.json({ logs: [], message: 'No log files found. Logs are written to stdout — use docker logs.' });
      }
      const raw = fs.readFileSync(errorFile, 'utf8');
      const parsed = raw.trim().split('\n').slice(-lines).map(line => {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]: (.*)$/);
        if (match) {
          return { timestamp: match[1], level: match[2].toLowerCase(), message: match[3] };
        }
        return { timestamp: '', level: 'info', message: line };
      });
      return res.json({ logs: parsed.reverse() });
    }

    const raw = fs.readFileSync(logFile, 'utf8');
    const parsed = raw.trim().split('\n').slice(-lines).map(line => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]: (.*)$/);
      if (match) {
        return { timestamp: match[1], level: match[2].toLowerCase(), message: match[3] };
      }
      return { timestamp: '', level: 'info', message: line };
    });
    res.json({ logs: parsed.reverse() });
  } catch (err) {
    logger.error('[Logs] Failed to read logs:', err.message);
    res.json({ logs: [], error: err.message });
  }
});

// ── Analytics (Session only) ─────────────────────────────────────────
router.get('/analytics/overview', requireSession, analyticsController.getOverview);
router.get('/analytics/tags', requireSession, analyticsController.getTags);
router.get('/analytics/sessions', requireSession, analyticsController.getSessions);
router.get('/analytics/usage', requireSession, analyticsController.getUsage);
