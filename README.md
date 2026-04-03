# Mnemosyne — RAG Knowledge Base

A self-hosted, containerized Retrieval-Augmented Generation (RAG) system with full authentication, live LLM switching, and a Viber chatbot integration. Answers questions grounded exclusively in your own uploaded documents.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                   Docker Network (mnemosyne-rag-network)          │
│                                                                   │
│  ┌──────────────┐     ┌───────────────┐     ┌─────────────────┐ │
│  │  React UI    │────▶│  RAG Server   │────▶│ OpenRouter API  │ │
│  │  :3000       │     │  :3001        │     │ (LLM cloud)     │ │
│  │  Login gate  │     │  API Key +    │     └─────────────────┘ │
│  └──────────────┘     │  Session auth │     ┌─────────────────┐ │
│                        └──────┬────────┘────▶│ Ollama :11434   │ │
│                               │              │ (embeddings)    │ │
│                       ┌───────┴──────┐       └─────────────────┘ │
│                       │              │                            │
│                ┌──────▼──┐    ┌──────▼──┐                       │
│                │ChromaDB │    │  Redis  │                        │
│                │(vectors)│    │(cache+q)│                        │
│                └─────────┘    └─────────┘                        │
└──────────────────────────────────────────────────────────────────┘
         ▲
         │  HTTP  ·  X-API-Key header
         │
┌────────┴──────────┐
│  Chatbot.php      │ ◀─── Viber Webhook
│  (CI PHP App)     │
└───────────────────┘
```

### Component Stack

| Component | Technology | Role |
|-----------|-----------|------|
| **LLM** | OpenRouter (cloud) | Response generation — free tier, no GPU needed |
| **Embeddings** | Ollama + nomic-embed-text | Local semantic indexing — ~270 MB, no API cost |
| **Vector DB** | ChromaDB | Chunk storage and cosine similarity search |
| **Cache / Queue** | Redis + Bull | Query caching, async job queue |
| **API Server** | Node.js + Express | REST API, auth, rate limiting |
| **Admin UI** | React | Document management, query testing, live model switching |
| **Chatbot** | PHP / CodeIgniter | Viber-facing bot |

---

## Authentication

| Client | Method | Header |
|--------|--------|--------|
| Viber bot (`Chatbot.php`) | API Key | `X-API-Key: <RAG_API_KEY>` |
| React Admin UI | Session Token | `X-Session-Token: <token>` (auto-injected after login) |

### API Key — server-to-server
- Static secret, minimum 32 characters
- Set via `RAG_API_KEY` in `rag-server/.env`
- Also set in CI PHP as a constant or environment variable
- Grants access to `/api/query` and `/api/query/status/:jobId`

### Session Token — React UI
- Login via `POST /api/auth/login` → receive a 64-char hex token
- Valid for `SESSION_TTL_HOURS` (default 8 h), stored in `sessionStorage`
- Token verified automatically on every page load
- 5 failed login attempts → IP locked out for 15 minutes

### Public endpoints (no auth required)
- `GET /health`
- `POST /api/auth/login`

---

## Quick Start

### Prerequisites
- Docker Engine 24+ and Docker Compose v2+
- 6 GB RAM minimum
- A free [OpenRouter](https://openrouter.ai) API key

### 1 — Configure secrets

```bash
cp rag-server/.env.example rag-server/.env
```

Open `rag-server/.env` and fill in:

```env
# Generate: openssl rand -hex 32
RAG_API_KEY=your_64_char_hex_key

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_password

# Free at https://openrouter.ai → Keys → Create Key
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
```

### 2 — Start the stack

```bash
docker compose up -d

# First boot: Ollama pulls nomic-embed-text (~270 MB)
docker logs mnemosyne-ollama-init -f
```

### 3 — Open the Admin UI

**http://localhost:3000** → login with your `ADMIN_USERNAME` / `ADMIN_PASSWORD`

### 4 — Upload documents

Go to the **Knowledge Base** tab and upload PDFs, Excel files, Markdown, DOCX, CSV, or plain text. Each document is parsed, chunked, embedded, and indexed automatically. A live progress bar shows the exact stage.

### 5 — Configure the Viber bot

Add to `application/config/constants.php`:

```php
define('RAG_SERVER_URL', 'http://localhost:3001');
define('RAG_API_KEY',    'your_64_char_hex_key');  // same key as .env
```

Verify the connection at:
```
GET http://your-ci-host/chatbot/rag_status
```

Expected:
```json
{ "rag_server": "online", "api_key_valid": true, "api_key_set": true }
```

---

## Live LLM Switching

You can switch the active language model **at runtime without restarting** any container.

### Via the Admin UI
Go to **System Status** → **Language Model** section → click any model card. The active model switches instantly with a loading spinner. The change persists until the container restarts.

### Via API

```bash
# List available free models
curl http://localhost:3001/api/models \
  -H "X-Session-Token: your_token"

# Switch to a different model
curl -X POST http://localhost:3001/api/models/switch \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: your_token" \
  -d '{"modelId": "meta-llama/llama-3.1-8b-instruct:free"}'
```

### Available free models (OpenRouter)

| Model ID | Notes |
|----------|-------|
| `stepfun/step-3.5-flash:free` | **Default** — fast, free |
| `microsoft/phi-3-mini-128k-instruct:free` | 128k context window |
| `meta-llama/llama-3.1-8b-instruct:free` | Most capable free model |
| `mistralai/mistral-7b-instruct:free` | Fast and balanced |
| `google/gemma-2-9b-it:free` | Google, strong reasoning |
| `qwen/qwen-2-7b-instruct:free` | Multilingual |

To make a switch permanent, update `OPENROUTER_MODEL` in `rag-server/.env` and restart the `mnemosyne-rag-server` container.

---

## REST API Reference

All endpoints require auth except `/health` and `POST /api/auth/login`.

### Auth

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
# → { "token": "abc123...", "expiresAt": "..." }

# Verify
curl http://localhost:3001/api/auth/verify \
  -H "X-Session-Token: abc123..."
```

### Query

```bash
# Sync query — API Key (Viber bot)
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{"query": "What information is in the knowledge base?"}'

# Async query — enqueue and poll
curl -X POST http://localhost:3001/api/query \
  -H "X-Session-Token: your_token" \
  -H "Content-Type: application/json" \
  -d '{"query": "Summarise the uploaded documents", "async": true}'
# → { "jobId": "42" }

curl http://localhost:3001/api/query/status/42 \
  -H "X-Session-Token: your_token"

# Debug — see raw similarity scores for a query
curl "http://localhost:3001/api/query/debug?q=your+question" \
  -H "X-Session-Token: your_token"
```

### Documents

```bash
# Upload
curl -X POST http://localhost:3001/api/documents/upload \
  -H "X-Session-Token: your_token" \
  -F "file=@/path/to/document.pdf"

# List
curl http://localhost:3001/api/documents \
  -H "X-Session-Token: your_token"

# Check ingest job progress
curl http://localhost:3001/api/documents/ingest-status/<jobId> \
  -H "X-Session-Token: your_token"

# Delete
curl -X DELETE http://localhost:3001/api/documents/<id> \
  -H "X-Session-Token: your_token"
```

### Models

```bash
# List available models
curl http://localhost:3001/api/models \
  -H "X-Session-Token: your_token"

# Switch active model live
curl -X POST http://localhost:3001/api/models/switch \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: your_token" \
  -d '{"modelId":"meta-llama/llama-3.1-8b-instruct:free"}'
```

### Admin

```bash
# Full diagnostics (OpenRouter, Ollama, ChromaDB, Redis)
curl http://localhost:3001/api/diagnostics \
  -H "X-Session-Token: your_token"

# Clear query cache
curl -X DELETE http://localhost:3001/api/cache \
  -H "X-Session-Token: your_token"

# Reset vector store (wipes all chunks — re-upload required)
curl -X POST http://localhost:3001/api/vector-store/reset \
  -H "X-Session-Token: your_token"
```

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_API_KEY` | — | **Required.** Min 32 chars. `openssl rand -hex 32` |
| `ADMIN_USERNAME` | `admin` | UI login username |
| `ADMIN_PASSWORD` | — | **Required.** Min 8 chars |
| `SESSION_TTL_HOURS` | `8` | UI session lifetime (hours) |
| `OPENROUTER_API_KEY` | — | **Required.** Free at openrouter.ai |
| `OPENROUTER_MODEL` | `stepfun/step-3.5-flash:free` | Default LLM (switchable live) |
| `OLLAMA_HOST` | `http://ollama:11434` | Ollama endpoint (embeddings) |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `TOP_K` | `5` | Chunks retrieved per query |
| `MIN_RELEVANCE_SCORE` | `0.15` | Cosine similarity threshold (0–1) |
| `CHUNK_SIZE` | `500` | Words per document chunk |
| `CHUNK_OVERLAP` | `50` | Overlap between adjacent chunks |
| `CACHE_TTL` | `3600` | Query cache TTL in seconds |
| `CORS_ORIGIN` | `*` | Restrict in production |
| `APP_URL` | `http://localhost:3000` | Application start URL |

---

## Smart Rate Limiting

Mnemosyne implements **intelligent, endpoint-specific rate limiting** to prevent bottlenecks during high-traffic operations while protecting the server from abuse.

### Rate Limit Tiers

| Endpoint Type | Limit | Window | Purpose |
|---------------|-------|--------|---------|
| **Login** | 10 attempts | 15 minutes | Brute force protection |
| **Query operations** | 150 req/min* | 1 minute | Document queries + job status polls |
| **Status & Health** | 300 req/min* | 1 minute | Live metric polling (1–5 sec intervals) |
| **Document upload** | 10 uploads | 1 minute | Document ingestion |
| **Unauthenticated** | 50% lower | — | API key/session exempt |

*Authenticated users (with `X-Session-Token` or `X-API-Key` header) receive higher limits.

### How It Works

**Login Brute Force Protection**
- 10 failed attempts per 15 minutes per IP address
- Returns `429 Too Many Requests` after 10 failures

**High-Throughput Query Operations**
- Supports **150 requests/minute** (~2.5 req/sec) for authenticated users
- Handles:
  - Multiple simultaneous document uploads with 3-second polling intervals
  - Rapid query submissions with async job polling
  - Both sync and async query modes

**Live Status Polling**
- Status checks and health polls have **highest limit (300 req/min)**
- Enables:
  - Queue metrics polling every 1 second
  - Service health checks every 5 seconds
  - Real-time component status updates

**Intelligent Backoff**
- When a client hits a rate limit, polling automatically backs off with **exponential backoff**:
  - First retry: 1.5x the normal interval
  - Second retry: 2.25x the normal interval
  - Third retry: 3.375x the normal interval
  - Prevents retry storms and distributes load

### Configuration

Set authenticated user limit in `rag-server/.env`:

```env
# Default: 120 (allows 2 req/sec for auth users)
# Increase for high-concurrency deployments
# Example: 240 = 4 req/sec, 60 = 1 req/sec
RATE_LIMIT_MAX=120
```

### Example: Multiple Document Uploads

Without smart rate limiting, the following scenario would fail:

```bash
# Upload 5 documents in rapid succession
for i in {1..5}; do
  curl -X POST http://localhost:3001/api/documents/upload \
    -H "X-Session-Token: $token" \
    -F "file=@document_$i.pdf" &
done
wait

# Each upload polls for status every 3 seconds
# 5 docs × polling every 3s = 5 status requests total
# ✓ Succeeds — within 10 uploads/min limit
# ✓ Polling not throttled — within 300 req/min limit
```

### Monitoring Rate Limits

When a rate limit is exceeded, the server responds with:

```json
{
  "error": "Too many requests. Please try again in a moment.",
  "retryAfter": 60
}
```

The UI automatically shows a toast notification with the error message. Status checks and other operations will gracefully retry with exponential backoff.

---

## Troubleshooting

**Document uploads succeed but queries return "no information"**
Run the debug endpoint to see actual similarity scores:
```bash
curl "http://localhost:3001/api/query/debug?q=your+question" -H "X-Session-Token: your_token"
```
If all scores are below `MIN_RELEVANCE_SCORE`, lower the threshold in `.env`. If no chunks are returned at all, reset the vector store collection and re-upload documents — the collection may have been created with the wrong distance metric.

**Document shows "Processing…" then disappears**
Check server logs:
```bash
docker logs mnemosyne-rag-server --tail 80
```
Most common cause is Ollama not responding. Verify:
```bash
docker logs mnemosyne-ollama --tail 30
```

**OpenRouter returns 429**
Free tier has rate limits. Wait 30–60 seconds and retry, or switch to a less busy free model via the System Status tab.

**Container name conflicts on startup**
If you previously ran the stack with old `avabas-*` container names, remove them first:
```bash
docker rm -f avabas-ollama avabas-chromadb avabas-redis avabas-rag-server avabas-rag-ui 2>/dev/null
docker compose up -d
```

---

## Docker Container Reference

| Container | Image | Purpose |
|-----------|-------|---------|
| `mnemosyne-ollama` | `ollama/ollama:0.3.12` | Embedding model runtime |
| `mnemosyne-ollama-init` | `curlimages/curl` | Pulls models on first boot, then exits |
| `mnemosyne-chromadb` | `chromadb/chroma:latest` | Vector database |
| `mnemosyne-redis` | `redis:7-alpine` | Cache and job queue |
| `mnemosyne-rag-server` | Built from `rag-server/` | REST API |
| `mnemosyne-rag-ui` | Built from `rag-ui/` | React Admin UI |
