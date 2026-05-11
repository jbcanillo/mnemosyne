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
// Relax CSP for Swagger UI (needs inline scripts/styles, web workers)
// Disable COOP/COEP/HSTS for non-localhost access (avoids "untrustworthy origin" errors)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,  // Disable COOP - causes issues on IP-based access
  crossOriginEmbedderPolicy: false, // Disable COEP - not needed for Swagger UI
  hsts: false, // Disable HSTS - prevents browser from forcing HTTPS upgrade
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'", 'http:', 'https:'],
      fontSrc:     ["'self'", 'data:'],
      frameSrc:    ["'self'"],
      workerSrc:   ["'self'", "blob:"] // Allow web workers for Swagger UI
    }
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Session-Token'],
  credentials: true
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
  customJs: `
    window.onload = function() {
      // Auto-apply API key if stored in localStorage
      const apiKey = localStorage.getItem('swagger_api_key');
      if (apiKey) {
        ui.authActions.authorize({
          ApiKeyAuth: { name: 'X-API-Key', schema: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, value: apiKey }
        });
      }

      // Listen for authorization changes and store API key
      ui.authActions.preAuthorizeApiKey('ApiKeyAuth', function(auth) {
        if (auth && auth.value) {
          localStorage.setItem('swagger_api_key', auth.value);
        }
      });
    };
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    defaultModelsExpandDepth: -1,
    requestInterceptor: (req) => {
      // Ensure API key is sent if authorized
      if (req.headers && req.headers['X-API-Key']) {
        console.log('Swagger sending X-API-Key:', req.headers['X-API-Key'].substring(0, 8) + '...');
      }
      return req;
    },
    responseInterceptor: (res) => {
      // Log responses for debugging
      if (res.status === 401 || res.status === 403) {
        console.log('Auth failed:', res.status, res.statusText);
      }
      return res;
    }
  }
}));

// ── API routes ────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Public health check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  const llm = require('./services/llmService');
  const apiKeyService = require('./services/apiKeyService');
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    service:   'Mnemosyne RAG Server',
    ollama:    llm.embeddingReady ? 'ready' : 'initializing',
    keySet:    apiKeyService.hasKeys()
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

  // Init API key service (migrate legacy key if needed)
  try {
    const aks = require('./services/apiKeyService');
    await aks.initialize();
  } catch (err) {
    logger.error('API key service init error:', err.message);
  }
});

module.exports = app;
