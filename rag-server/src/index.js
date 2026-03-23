require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const { createRateLimiter } = require('./middleware/rateLimiter');
const { logger } = require('./utils/logger');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ─────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── CORS ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Session-Token']
}));

app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ── Global rate limiter ───────────────────────────────────────────────
app.use('/api/', createRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60'),
  message: { error: 'Too many requests.', retryAfter: 60 }
}));

// ── Routes ───────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check — reports Ollama/ChromaDB readiness ─────────────────
app.get('/health', (req, res) => {
  const llm = require('./services/llmService');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Mnemosyne RAG Server',
    ollama: llm.ready ? 'ready' : 'initializing'
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start server then initialise LLM in background ───────────────────
// Server starts immediately so Docker health checks pass.
// LLM init runs async — uploads made before it's ready are queued
// and will be processed once Ollama is reachable.
app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`RAG Server running on port ${PORT}`);
  logger.info('Authentication: API Key + Session Token enabled');

  // Init LLM service (connects to Ollama, verifies models exist)
  try {
    const llmService = require('./services/llmService');
    await llmService.init();
    logger.info('LLM service ready — document ingestion enabled');
  } catch (err) {
    logger.error('LLM service failed to initialise:', err.message);
    logger.error('Check that Ollama is running and models are pulled:');
    logger.error('  ollama pull nomic-embed-text');
    logger.error('  ollama pull phi3:mini');
  }

  // Init ChromaDB connection
  try {
    const vectorStore = require('./services/vectorStore');
    await vectorStore.init();
    logger.info('Vector store ready');
  } catch (err) {
    logger.error('ChromaDB failed to initialise:', err.message);
  }
});

module.exports = app;
