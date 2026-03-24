const swaggerJsdoc  = require('swagger-jsdoc');
const swaggerUi     = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Mnemosyne RAG API',
      version:     '1.0.0',
      description: 'REST API for the Mnemosyne RAG Knowledge Base system. All endpoints except `/health` and `POST /api/auth/login` require authentication via `X-API-Key` (server-to-server) or `X-Session-Token` (UI/browser).',
      contact:     { name: 'Mnemosyne RAG' }
    },
    servers: [{ url: '/api', description: 'RAG API' }],
    components: {
      securitySchemes: {
        ApiKeyAuth:     { type: 'apiKey', in: 'header', name: 'X-API-Key',      description: 'Static API key for server-to-server calls (e.g. Viber bot)' },
        SessionToken:   { type: 'apiKey', in: 'header', name: 'X-Session-Token',description: 'Session token obtained from POST /auth/login (React UI)' }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' }
          }
        },
        Settings: {
          type: 'object',
          properties: {
            openrouterApiKey:  { type: 'string', description: 'Masked — shows last 6 chars only' },
            openrouterModel:   { type: 'string', example: 'stepfun/step-3.5-flash:free' },
            minRelevanceScore: { type: 'number', example: 0.15 },
            topK:              { type: 'integer', example: 5 },
            chunkSize:         { type: 'integer', example: 500 },
            chunkOverlap:      { type: 'integer', example: 50 },
            cacheTtl:          { type: 'integer', example: 3600 }
          }
        }
      }
    },
    security: [{ SessionToken: [] }],
    tags: [
      { name: 'Auth',      description: 'Authentication' },
      { name: 'Query',     description: 'RAG queries' },
      { name: 'Documents', description: 'Knowledge base document management' },
      { name: 'Models',    description: 'LLM model management' },
      { name: 'Settings',  description: 'Runtime configuration (API keys, model, tuning)' },
      { name: 'System',    description: 'Health, diagnostics, cache, vector store' }
    ],
    paths: {
      // ── AUTH ──────────────────────────────────────────────────────────
      '/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Login and get a session token',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['username','password'], properties: { username: { type: 'string' }, password: { type: 'string' } } } } }
          },
          responses: {
            200: { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, expiresAt: { type: 'string' }, username: { type: 'string' } } } } } },
            401: { description: 'Invalid credentials' },
            429: { description: 'Too many attempts — IP locked out' }
          }
        }
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'], summary: 'Invalidate current session',
          responses: { 200: { description: 'Logged out' } }
        }
      },
      '/auth/verify': {
        get: {
          tags: ['Auth'], summary: 'Verify session token is still valid',
          responses: {
            200: { description: 'Valid session', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, username: { type: 'string' }, expiresAt: { type: 'string' } } } } } },
            401: { description: 'Invalid or expired session' }
          }
        }
      },

      // ── QUERY ─────────────────────────────────────────────────────────
      '/query': {
        post: {
          tags: ['Query'], summary: 'Run a RAG query against the knowledge base',
          security: [{ ApiKeyAuth: [] }, { SessionToken: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: {
              query:  { type: 'string', example: 'What documents are in the knowledge base?' },
              async:  { type: 'boolean', default: false, description: 'If true, returns a jobId to poll instead of waiting' },
              options:{ type: 'object', properties: { topK: { type: 'integer', default: 5 } } }
            } } } }
          },
          responses: {
            200: { description: 'Query result', content: { 'application/json': { schema: { type: 'object', properties: {
              answer:         { type: 'string' },
              sources:        { type: 'array', items: { type: 'object', properties: { filename: { type: 'string' }, relevanceScore: { type: 'number' }, chunkIndex: { type: 'integer' } } } },
              relevantChunks: { type: 'integer' },
              fromCache:      { type: 'boolean' },
              query:          { type: 'string' }
            } } } } },
            202: { description: 'Async job queued', content: { 'application/json': { schema: { type: 'object', properties: { jobId: { type: 'string' }, status: { type: 'string' } } } } } },
            500: { description: 'Query processing failed', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } }
          }
        }
      },
      '/query/status/{jobId}': {
        get: {
          tags: ['Query'], summary: 'Poll status of an async query job',
          security: [{ ApiKeyAuth: [] }, { SessionToken: [] }],
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Job status', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['waiting','active','completed','failed'] }, progress: { type: 'integer' }, result: { type: 'object' }, failedReason: { type: 'string' } } } } } },
            404: { description: 'Job not found' }
          }
        }
      },
      '/query/debug': {
        get: {
          tags: ['Query'], summary: 'See raw similarity scores for a query (no LLM call)',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' }, example: 'What is in the document?' }],
          responses: {
            200: { description: 'Chunk scores', content: { 'application/json': { schema: { type: 'object', properties: {
              query: { type: 'string' }, currentThreshold: { type: 'number' },
              totalChunksReturned: { type: 'integer' }, recommendation: { type: 'string' },
              chunks: { type: 'array', items: { type: 'object' } }
            } } } } }
          }
        }
      },
      '/query/test': {
        get: {
          tags: ['Query'], summary: 'Test each pipeline step individually (Ollama → embed → ChromaDB → OpenRouter)',
          parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, example: 'hello' }],
          responses: {
            200: { description: 'All steps passing' },
            207: { description: 'Some steps failing — check steps object' }
          }
        }
      },

      // ── DOCUMENTS ─────────────────────────────────────────────────────
      '/documents/upload': {
        post: {
          tags: ['Documents'], summary: 'Upload a document to the knowledge base',
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'PDF, DOCX, XLSX, CSV, MD, TXT (max 50 MB)' } } } } }
          },
          responses: {
            202: { description: 'Upload accepted, processing in background', content: { 'application/json': { schema: { type: 'object', properties: { documentId: { type: 'string' }, jobId: { type: 'string' }, filename: { type: 'string' }, status: { type: 'string' } } } } } },
            400: { description: 'Unsupported file type or no file' }
          }
        }
      },
      '/documents': {
        get: {
          tags: ['Documents'], summary: 'List all indexed documents',
          responses: {
            200: { description: 'Document list', content: { 'application/json': { schema: { type: 'object', properties: {
              documents: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, filename: { type: 'string' }, fileType: { type: 'string' }, chunkCount: { type: 'integer' }, uploadedAt: { type: 'string' } } } },
              total: { type: 'integer' }
            } } } } }
          }
        }
      },
      '/documents/ingest-status/{jobId}': {
        get: {
          tags: ['Documents'], summary: 'Poll ingest job progress',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Job state (waiting/active/completed/failed)' }, 404: { description: 'Job not found' } }
        }
      },
      '/documents/{id}': {
        delete: {
          tags: ['Documents'], summary: 'Remove a document and all its chunks',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Document ID (UUID)' }],
          responses: { 200: { description: 'Removed' }, 400: { description: 'Invalid ID' } }
        }
      },

      // ── MODELS ────────────────────────────────────────────────────────
      '/models': {
        get: {
          tags: ['Models'], summary: 'List available free OpenRouter models',
          responses: {
            200: { description: 'Model list', content: { 'application/json': { schema: { type: 'object', properties: {
              current: { type: 'string' },
              models:  { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' } } } }
            } } } } }
          }
        }
      },
      '/models/switch': {
        post: {
          tags: ['Models'], summary: 'Switch active LLM at runtime (no restart needed)',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['modelId'], properties: { modelId: { type: 'string', example: 'meta-llama/llama-3.1-8b-instruct:free' } } } } }
          },
          responses: {
            200: { description: 'Switched', content: { 'application/json': { schema: { type: 'object', properties: { previous: { type: 'string' }, current: { type: 'string' } } } } } },
            400: { description: 'Invalid model ID' }
          }
        }
      },

      // ── SETTINGS ──────────────────────────────────────────────────────
      '/settings': {
        get: {
          tags: ['Settings'], summary: 'Get current configuration (API key is masked)',
          responses: { 200: { description: 'Current settings', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Settings' } } } } }
        },
        put: {
          tags: ['Settings'], summary: 'Update one or more settings — persisted to disk',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Settings' } } }
          },
          responses: {
            200: { description: 'Settings saved', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, settings: { '$ref': '#/components/schemas/Settings' } } } } } },
            400: { description: 'Invalid setting key or value' }
          }
        }
      },
      '/settings/test-key': {
        post: {
          tags: ['Settings'], summary: 'Test the current OpenRouter API key with a live ping',
          responses: {
            200: { description: 'Test result', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, model: { type: 'string' }, reply: { type: 'string' }, error: { type: 'string' } } } } } }
          }
        }
      },

      // ── SYSTEM ────────────────────────────────────────────────────────
      '/info': {
        get: {
          tags: ['System'], summary: 'Server info and metrics',
          responses: { 200: { description: 'Info object with model, vector store, cache, queue stats' } }
        }
      },
      '/diagnostics': {
        get: {
          tags: ['System'], summary: 'Full connectivity check (Ollama, OpenRouter, ChromaDB, Redis)',
          responses: { 200: { description: 'All systems ok' }, 207: { description: 'Some systems failing' } }
        }
      },
      '/cache': {
        delete: {
          tags: ['System'], summary: 'Clear query cache',
          responses: { 200: { description: 'Cache cleared' } }
        }
      },
      '/vector-store/reset': {
        post: {
          tags: ['System'], summary: 'Wipe and recreate vector store collection',
          responses: { 200: { description: 'Collection reset — re-upload all documents' } }
        }
      }
    }
  },
  apis: []  // inline spec above — no separate file scanning needed
};

const spec = swaggerJsdoc(options);

module.exports = { spec, swaggerUi };
