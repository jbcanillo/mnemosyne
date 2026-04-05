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
        },
        Document: {
          type: 'object',
          properties: {
            id:         { type: 'string', description: 'Document UUID' },
            filename:   { type: 'string' },
            fileType:   { type: 'string', description: 'File extension without dot' },
            chunkCount: { type: 'integer' },
            uploadedAt: { type: 'string', format: 'date-time' },
            tags:       { type: 'array', items: { type: 'string' }, description: 'Tags assigned to this document' }
          }
        },
        Session: {
          type: 'object',
          properties: {
            id:           { type: 'string', description: 'Session UUID' },
            title:        { type: 'string' },
            messageCount: { type: 'integer' },
            createdAt:    { type: 'string', format: 'date-time' }
          }
        },
        Backup: {
          type: 'object',
          properties: {
            filename:  { type: 'string' },
            size:      { type: 'integer', description: 'Size in bytes' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Model: {
          type: 'object',
          properties: {
            id:     { type: 'string' },
            name:   { type: 'string' },
            active: { type: 'boolean' }
          }
        },
        Usage: {
          type: 'object',
          properties: {
            currentModel:  { type: 'string' },
            embeddingModel:{ type: 'string' },
            tokenUsage:    { type: 'object', description: 'Token usage statistics' }
          }
        },
        AnalyticsOverview: {
          type: 'object',
          properties: {
            totalQueries:    { type: 'integer' },
            totalDocuments:  { type: 'integer' },
            totalChunks:     { type: 'integer' },
            activeTags:      { type: 'integer' },
            cacheHitRate:    { type: 'number' },
            avgResponseTime: { type: 'number' },
            currentModel:    { type: 'string' },
            systemHealth:    { type: 'object' }
          }
        },
        AnalyticsTags: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'object', properties: {
              name: { type: 'string' },
              documentCount: { type: 'integer' },
              chunkCount: { type: 'integer' },
              coOccurrences: { type: 'object' }
            } } },
            relationships: { type: 'array', items: { type: 'object', properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              value: { type: 'integer' }
            } } }
          }
        },
        AnalyticsSessions: {
          type: 'object',
          properties: {
            totalSessions:       { type: 'integer' },
            totalMessages:       { type: 'integer' },
            avgMessagesPerSession: { type: 'number' },
            sessionsByDay: { type: 'array', items: { type: 'object', properties: {
              date: { type: 'string' },
              count: { type: 'integer' }
            } } }
          }
        },
        AnalyticsUsage: {
          type: 'object',
          properties: {
            tokenUsage:   { type: 'object' },
            cacheStats:   { type: 'object' },
            queueMetrics: { type: 'object' }
          }
        },
        AnalyticsOverview: {
          type: 'object',
          properties: {
            totalQueries:    { type: 'integer' },
            totalDocuments:  { type: 'integer' },
            totalChunks:     { type: 'integer' },
            activeTags:      { type: 'integer' },
            cacheHitRate:    { type: 'number' },
            avgResponseTime: { type: 'number' },
            currentModel:    { type: 'string' },
            systemHealth:    { type: 'object' }
          }
        },
        AnalyticsTags: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'object', properties: {
              name: { type: 'string' },
              documentCount: { type: 'integer' },
              chunkCount: { type: 'integer' },
              coOccurrences: { type: 'object' }
            } } },
            relationships: { type: 'array', items: { type: 'object', properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              value: { type: 'integer' }
            } } }
          }
        },
        AnalyticsSessions: {
          type: 'object',
          properties: {
            totalSessions:       { type: 'integer' },
            totalMessages:       { type: 'integer' },
            avgMessagesPerSession: { type: 'number' },
            sessionsByDay: { type: 'array', items: { type: 'object', properties: {
              date: { type: 'string' },
              count: { type: 'integer' }
            } } }
          }
        },
        AnalyticsUsage: {
          type: 'object',
          properties: {
            tokenUsage:   { type: 'object' },
            cacheStats:   { type: 'object' },
            queueMetrics: { type: 'object' }
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
      { name: 'System',    description: 'Health, diagnostics, cache, vector store' },
      { name: 'Sessions',  description: 'Conversation sessions management' },
      { name: 'Backups',   description: 'Backup and restore operations' },
      { name: 'Analytics', description: 'Analytics and metrics dashboard' }
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
              options:{ type: 'object', properties: {
                topK: { type: 'integer', default: 5 },
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter query to documents with these tags (OR logic)' }
              } }
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
            500: { description: 'Query processing failed. Please try again.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } }
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
            content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: {
              file: { type: 'string', format: 'binary', description: 'PDF, DOCX, XLSX, CSV, MD, TXT (max 50 MB)' },
              tags: { type: 'string', description: 'Comma-separated tags (e.g., "finance,hr,policy")' }
            } } } }
          },
          responses: {
            202: { description: 'Upload accepted, processing in background', content: { 'application/json': { schema: { type: 'object', properties: { documentId: { type: 'string' }, jobId: { type: 'string' }, filename: { type: 'string' }, status: { type: 'string' } } } } } },
            400: { description: 'Unsupported file type or no file' }
          }
        }
      },
      '/documents/{id}/download': {
        get: {
          tags: ['Documents'], summary: 'Download a document',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Document downloaded' }, 404: { description: 'Document not found' } }
        }
      },
      '/documents': {
        get: {
          tags: ['Documents'], summary: 'List all indexed documents',
          parameters: [
            { name: 'tags', in: 'query', required: false, schema: { type: 'string' }, description: 'Comma-separated tags to filter by (OR logic)' }
          ],
          responses: {
            200: { description: 'Document list', content: { 'application/json': { schema: { type: 'object', properties: {
              documents: { type: 'array', items: { '$ref': '#/components/schemas/Document' } },
              total: { type: 'integer' }
            } } } } }
          }
        }
      },
      '/documents/stats': {
        get: {
          tags: ['Documents'], summary: 'Get document statistics',
          responses: {
            200: { description: 'Stats', content: { 'application/json': { schema: { type: 'object', properties: {
              totalChunks: { type: 'integer' },
              collection: { type: 'string' },
              totalDocuments: { type: 'integer' }
            } } } } }
          }
        }
      },
      '/documents/tags': {
        get: {
          tags: ['Documents'], summary: 'List all unique tags across documents',
          responses: {
            200: { description: 'Tag list', content: { 'application/json': { schema: { type: 'object', properties: {
              tags: { type: 'array', items: { type: 'string' } }
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
      '/documents/{id}/tags': {
        put: {
          tags: ['Documents'], summary: 'Update tags for a document',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Document ID (UUID)' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['tags'], properties: {
              tags: { type: 'array', items: { type: 'string' }, description: 'New tags for this document' }
            } } } }
          },
          responses: {
            200: { description: 'Tags updated', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } },
            400: { description: 'Invalid request' },
            404: { description: 'Document not found' }
          }
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
      '/models': {
        post: {
          tags: ['Models'], summary: 'Add a custom LLM model',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['id', 'name'], properties: {
              id: { type: 'string', description: 'OpenRouter model ID' },
              name: { type: 'string', description: 'Display name' }
            } } } }
          },
          responses: {
            200: { description: 'Model added', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Model' } } } },
            400: { description: 'Invalid model ID' }
          }
        }
      },
      '/models/{id}': {
        delete: {
          tags: ['Models'], summary: 'Remove a custom LLM model',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Model ID' }],
          responses: { 200: { description: 'Model removed' }, 404: { description: 'Model not found' } }
        }
      },
      '/models/reset': {
        post: {
          tags: ['Models'], summary: 'Reset models to default list',
          responses: { 200: { description: 'Models reset to defaults' } }
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
      },
      '/usage': {
        get: {
          tags: ['System'], summary: 'Get token usage statistics',
          responses: {
            200: { description: 'Usage stats', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Usage' } } } }
          }
        },
        delete: {
          tags: ['System'], summary: 'Reset token usage statistics',
          responses: { 200: { description: 'Usage stats reset' } }
        }
      },
      '/logs': {
        get: {
          tags: ['System'], summary: 'Get server logs',
          parameters: [
            { name: 'lines', in: 'query', required: false, schema: { type: 'integer', default: 200 }, description: 'Number of log lines to return' }
          ],
          responses: { 200: { description: 'Server logs' } }
        }
      },

      // ── SESSIONS ──────────────────────────────────────────────────────
      '/sessions': {
        post: {
          tags: ['Sessions'], summary: 'Create a new conversation session',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
              title: { type: 'string', description: 'Session title' }
            } } } }
          },
          responses: {
            200: { description: 'Session created', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Session' } } } }
          }
        },
        get: {
          tags: ['Sessions'], summary: 'List all conversation sessions',
          responses: {
            200: { description: 'Session list', content: { 'application/json': { schema: { type: 'object', properties: {
              sessions: { type: 'array', items: { '$ref': '#/components/schemas/Session' } }
            } } } } }
          }
        }
      },
      '/sessions/{id}': {
        get: {
          tags: ['Sessions'], summary: 'Get session messages',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } }
          ],
          responses: {
            200: { description: 'Session messages', content: { 'application/json': { schema: { type: 'object', properties: {
              messages: { type: 'array', items: { type: 'object' } }
            } } } } }
          }
        },
        put: {
          tags: ['Sessions'], summary: 'Update session title',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
              title: { type: 'string' }
            } } } }
          },
          responses: { 200: { description: 'Session updated' } }
        },
        delete: {
          tags: ['Sessions'], summary: 'Delete a conversation session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Session deleted' } }
        }
      },
      '/sessions/{id}/messages': {
        post: {
          tags: ['Sessions'], summary: 'Add a message to a session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: {
              type: { type: 'string', enum: ['user', 'assistant', 'error'] },
              text: { type: 'string' },
              sources: { type: 'array', items: { type: 'object' } },
              fromCache: { type: 'boolean' },
              relevantChunks: { type: 'integer' },
              ts: { type: 'string', format: 'date-time' },
              jobId: { type: 'string' }
            } } } }
          },
          responses: { 200: { description: 'Message added' } }
        }
      },
      '/sessions/{id}/clear': {
        post: {
          tags: ['Sessions'], summary: 'Clear all messages from a session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Session cleared' } }
        }
      },

      // ── BACKUPS ───────────────────────────────────────────────────────
      '/backup/create': {
        post: {
          tags: ['Backups'], summary: 'Create a backup of ChromaDB and config',
          responses: {
            200: { description: 'Backup created', content: { 'application/json': { schema: { type: 'object', properties: {
              filename: { type: 'string' },
              size: { type: 'integer' },
              message: { type: 'string' }
            } } } } }
          }
        }
      },
      '/backup/list': {
        get: {
          tags: ['Backups'], summary: 'List all available backups',
          responses: {
            200: { description: 'Backup list', content: { 'application/json': { schema: { type: 'object', properties: {
              backups: { type: 'array', items: { '$ref': '#/components/schemas/Backup' } }
            } } } } }
          }
        }
      },
      '/backup/restore': {
        post: {
          tags: ['Backups'], summary: 'Restore from a backup',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['filename'], properties: {
              filename: { type: 'string', description: 'Backup filename to restore' }
            } } } }
          },
          responses: {
            200: { description: 'Backup restored' },
            400: { description: 'Invalid backup file' }
          }
        }
      },
      '/backup/{filename}': {
        delete: {
          tags: ['Backups'], summary: 'Delete a backup file',
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' }, description: 'Backup filename to delete' }],
          responses: {
            200: { description: 'Backup deleted' },
            404: { description: 'Backup not found' }
          }
        }
      },

      // ── ANALYTICS ─────────────────────────────────────────────────────
      '/analytics/overview': {
        get: {
          tags: ['Analytics'], summary: 'Get analytics overview with system metrics',
          responses: {
            200: { description: 'Analytics overview', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsOverview' } } } }
          }
        }
      },
      '/analytics/tags': {
        get: {
          tags: ['Analytics'], summary: 'Get tag statistics and co-occurrence relationships',
          responses: {
            200: { description: 'Tag analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsTags' } } } }
          }
        }
      },
      '/analytics/sessions': {
        get: {
          tags: ['Analytics'], summary: 'Get session analytics with daily breakdown',
          responses: {
            200: { description: 'Session analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsSessions' } } } }
          }
        }
      },
      '/analytics/usage': {
        get: {
          tags: ['Analytics'], summary: 'Get token usage, cache stats, and queue metrics',
          responses: {
            200: { description: 'Usage analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsUsage' } } } }
          }
        }
      },

      // ── ANALYTICS ─────────────────────────────────────────────────────
      '/analytics/overview': {
        get: {
          tags: ['Analytics'], summary: 'Get analytics overview with system metrics',
          responses: {
            200: { description: 'Analytics overview', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsOverview' } } } }
          }
        }
      },
      '/analytics/tags': {
        get: {
          tags: ['Analytics'], summary: 'Get tag statistics and co-occurrence relationships',
          responses: {
            200: { description: 'Tag analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsTags' } } } }
          }
        }
      },
      '/analytics/sessions': {
        get: {
          tags: ['Analytics'], summary: 'Get session analytics with daily breakdown',
          responses: {
            200: { description: 'Session analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsSessions' } } } }
          }
        }
      },
      '/analytics/usage': {
        get: {
          tags: ['Analytics'], summary: 'Get token usage, cache stats, and queue metrics',
          responses: {
            200: { description: 'Usage analytics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyticsUsage' } } } }
          }
        }
      }
    }
  },
  apis: []  // inline spec above — no separate file scanning needed
};

const spec = swaggerJsdoc(options);

module.exports = { spec, swaggerUi };
