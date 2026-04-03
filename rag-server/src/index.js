require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const { loginLimiter, queryLimiter, statusLimiter, uploadLimiter } = require('./middleware/rateLimiter');
const { logger }   = require('./utils/logger');
const routes       = require('./routes');
const { spec, swaggerUi } = require('./swagger');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ─────────────────────────────────────────────────
// Relax CSP for Swagger UI (needs inline scripts/styles)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"]
    }
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Session-Token']
}));

app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ── Swagger UI — available at /docs ───────────────────────────────────
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'Mnemosyne RAG API',
  customCss: `
    .swagger-ui .topbar { background: #080c14; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    body { background: #04050a; }
    .swagger-ui { color: #eef0f8; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    defaultModelsExpandDepth: -1
  }
}));

// ── API routes ────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Public health check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  const llm = require('./services/llmService');
  const cfg = require('./services/configService');
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    service:   'Mnemosyne RAG Server',
    ollama:    llm.embeddingReady ? 'ready' : 'initializing',
    keySet:    cfg.hasApiKey()
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`Mnemosyne RAG Server running on port ${PORT}`);
  logger.info(`Swagger UI available at http://localhost:${PORT}/docs`);

  // Load persisted config first
  const cfg = require('./services/configService');
  cfg.load();

  // Init LLM (Ollama for embed + verify OpenRouter if key exists)
  try {
    const llm = require('./services/llmService');
    await llm.init();
  } catch (err) {
    logger.error('LLM init error:', err.message);
  }

  // Init ChromaDB
  try {
    const vs = require('./services/vectorStore');
    await vs.init();
  } catch (err) {
    logger.error('Vector store init error:', err.message);
  }

  // Init models service (seed defaults if empty)
  try {
    const ms = require('./services/modelsService');
    await ms.initialize();
  } catch (err) {
    logger.error('Models service init error:', err.message);
  }
});

module.exports = app;
