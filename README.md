# SOFIA RAG Knowledge Base — AV ABAS ERP

Self-hosted, containerized RAG (Retrieval-Augmented Generation) system with full authentication, powering the AV ABAS Viber chatbot with an AI knowledge base grounded in your own documents.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Network (rag-net)                      │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐     ┌─────────────┐    │
│  │  React UI    │─────▶│  RAG Server  │────▶│   Ollama    │    │
│  │  (port 3000) │      │  (port 3001) │     │ phi3:mini + │    │
│  │  Login gate  │      │  API Key +   │     │ nomic-embed │    │
│  └──────────────┘      │  Session auth│     └─────────────┘    │
│                         └──────┬───────┘                        │
│                                │                                 │
│                        ┌───────┴──────┐                         │
│                        │              │                          │
│                  ┌─────▼───┐   ┌──────▼──┐                     │
│                  │ChromaDB │   │  Redis  │                      │
│                  │(vectors)│   │(cache+q)│                      │
│                  └─────────┘   └─────────┘                      │
└─────────────────────────────────────────────────────────────────┘
          ▲
          │  HTTP + X-API-Key header
          │
 ┌────────┴──────────┐
 │  CI PHP App       │
 │  Chatbot.php      │ ◀─── Viber Webhook
 └───────────────────┘
```

---

## Authentication Model

| Client | Method | Header |
|--------|--------|--------|
| Viber Bot (Chatbot.php) | API Key | `X-API-Key: <RAG_API_KEY>` |
| React Admin UI | Session Token | `X-Session-Token: <token>` (auto-injected after login) |

### API Key — for server-to-server
- Static secret, minimum 32 characters
- Set in `rag-server/.env` as `RAG_API_KEY`
- Set in CI PHP config as `RAG_API_KEY` constant or environment variable
- Used by `/api/query` and `/api/query/status/:jobId`

### Session Token — for React UI
- Login via `POST /api/auth/login` with `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- Returns a 64-character hex token valid for `SESSION_TTL_HOURS` (default 8h)
- Stored in `sessionStorage` (cleared when browser tab closes)
- Auto-refreshed check on every page load
- 5 failed login attempts → IP locked out for 15 minutes

### Public endpoints (no auth)
- `GET /health` — for Docker health checks
- `POST /api/auth/login` — how you get a token

---

## Quick Start

### 1. Prerequisites
- Docker Engine 24+ and Docker Compose v2+
- 8 GB RAM minimum (16 GB recommended)
- 20 GB disk (Ollama models)

### 2. Configure secrets

```bash
cp rag-server/.env.example rag-server/.env
```

Edit `rag-server/.env` and set:

```env
# Generate with: openssl rand -hex 32
RAG_API_KEY=your_64_char_hex_secret_here

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_password_here
```

### 3. Configure Chatbot.php

Add to `application/config/constants.php`:

```php
define('RAG_SERVER_URL', 'http://localhost:3001');  // host access
// OR if PHP runs inside the same Docker network:
// define('RAG_SERVER_URL', 'http://rag-server:3001');

define('RAG_API_KEY', 'your_64_char_hex_secret_here');  // same key as .env
```

### 4. Start the stack

```bash
docker compose up -d

# Watch startup (Ollama will pull models on first boot ~5-15 min)
docker compose logs -f rag-server
```

### 5. Access the Admin UI

Open **http://localhost:3000** → login with your `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 6. Upload ERP documents

Use the **Knowledge Base** tab to upload PDFs, Excel files, Markdown docs, etc.

### 7. Verify the Viber bot connection

```
GET http://localhost/chatbot/rag_status
```

Expected response:
```json
{
  "rag_server": "online",
  "api_key_valid": true,
  "api_key_set": true
}
```

---

## REST API Reference

All endpoints require auth except `/health` and `POST /api/auth/login`.

### Auth

```bash
# Login — get session token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
# → { "token": "abc123...", "expiresAt": "..." }

# Verify token
curl http://localhost:3001/api/auth/verify \
  -H "X-Session-Token: abc123..."
```

### Query (API Key — for Viber bot)

```bash
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{"query": "How do I create a purchase order?"}'
```

### Query (Session — for React UI or testing)

```bash
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: your_session_token" \
  -d '{"query": "What vessels are in the system?"}'
```

### Document Management (Session only)

```bash
# Upload
curl -X POST http://localhost:3001/api/documents/upload \
  -H "X-Session-Token: your_token" \
  -F "file=@/path/to/manual.pdf"

# List
curl http://localhost:3001/api/documents \
  -H "X-Session-Token: your_token"

# Delete
curl -X DELETE http://localhost:3001/api/documents/<id> \
  -H "X-Session-Token: your_token"
```

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_API_KEY` | — | **Required.** Min 32 chars. Use `openssl rand -hex 32` |
| `ADMIN_USERNAME` | `admin` | React UI login username |
| `ADMIN_PASSWORD` | — | **Required.** Min 8 chars |
| `SESSION_TTL_HOURS` | `8` | How long UI sessions last |
| `LLM_MODEL` | `phi3:mini` | Ollama LLM model |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `TOP_K` | `5` | Chunks retrieved per query |
| `MIN_RELEVANCE_SCORE` | `0.4` | Min similarity threshold (0–1) |
| `CHUNK_SIZE` | `500` | Words per document chunk |
| `CHUNK_OVERLAP` | `50` | Overlap between chunks |
| `CACHE_TTL` | `3600` | Query cache TTL (seconds) |
| `QUERY_RATE_LIMIT` | `20` | Max queries/min per IP |
| `CORS_ORIGIN` | `*` | Restrict to your UI domain in production |
