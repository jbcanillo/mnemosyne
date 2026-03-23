const { Ollama } = require('ollama');
const OpenAI     = require('openai');
const { logger } = require('../utils/logger');

// ── Embedding: Ollama (local) ─────────────────────────────────────────
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ── Generation: OpenRouter (cloud) ───────────────────────────────────
const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL    = process.env.OPENROUTER_MODEL || 'stepfun/step-3.5-flash:free';
const OPENROUTER_BASE     = 'https://openrouter.ai/api/v1';

// Mutable — changed live by switchModel()
let ACTIVE_MODEL = OPENROUTER_MODEL;

// Safely extract a readable message from any error shape
function errMsg(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.error?.message) return err.error.message;
  if (err.cause?.message) return err.cause.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

class LLMService {
  constructor() {
    this.ollama = new Ollama({ host: OLLAMA_HOST });

    if (!OPENROUTER_API_KEY) {
      logger.warn('[LLM] OPENROUTER_API_KEY not set — generation will fail');
    }

    this.openrouter = new OpenAI({
      apiKey:  OPENROUTER_API_KEY || 'not-set',
      baseURL: OPENROUTER_BASE,
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL   || 'http://localhost:3000',
        'X-Title':      process.env.APP_TITLE || 'Mnemosyne RAG'
      }
    });

    this.embeddingReady  = false;
    this.generationReady = false;

    logger.info(`[LLM] Embedding  → Ollama ${OLLAMA_HOST} / ${EMBED_MODEL}`);
    logger.info(`[LLM] Generation → OpenRouter / ${ACTIVE_MODEL}`);
  }

  // ── Init ─────────────────────────────────────────────────────────

  async init() {
    await Promise.all([
      this._initEmbedding(),
      this._initGeneration()
    ]);
  }

  async _initEmbedding() {
    const MAX = 12;
    for (let i = 1; i <= MAX; i++) {
      try {
        logger.info(`[Embed] Connecting to Ollama (attempt ${i}/${MAX})…`);
        const list  = await this.ollama.list();
        const names = list.models.map(m => m.name);
        logger.info(`[Embed] Connected. Models: ${names.join(', ') || '(none)'}`);

        if (!names.some(n => n.includes('nomic-embed-text'))) {
          logger.warn(`[Embed] ${EMBED_MODEL} not found — pulling…`);
          await this.ollama.pull({ model: EMBED_MODEL });
          logger.info(`[Embed] Pull complete`);
        }

        this.embeddingReady = true;
        logger.info('[Embed] Ready ✓');
        return;
      } catch (err) {
        logger.warn(`[Embed] Not ready (${i}/${MAX}): ${errMsg(err)}`);
        if (i < MAX) await new Promise(r => setTimeout(r, 5000));
      }
    }
    logger.error('[Embed] Failed to connect to Ollama. Check: docker logs mnemosyne-ollama');
  }

  async _initGeneration() {
    if (!OPENROUTER_API_KEY) {
      logger.error('[LLM] OPENROUTER_API_KEY missing — set it in rag-server/.env');
      return;
    }
    try {
      logger.info('[LLM] Verifying OpenRouter API key…');
      // Use a simple models.list() call — if it throws, key is bad
      await this.openrouter.models.list();
      this.generationReady = true;
      logger.info(`[LLM] OpenRouter ready ✓  model: ${ACTIVE_MODEL}`);
    } catch (err) {
      const msg = errMsg(err);
      // Some OpenRouter keys work for chat but models.list() returns 401
      // Don't block generation — mark ready and let the first real call confirm
      if (msg.includes('401') || msg.includes('403')) {
        logger.warn(`[LLM] models.list() auth error (${msg}) — marking ready anyway, key will be validated on first query`);
        this.generationReady = true;
      } else {
        logger.error(`[LLM] OpenRouter verification failed: ${msg}`);
        logger.error('[LLM] Check OPENROUTER_API_KEY in rag-server/.env');
        // Still mark ready — let queries fail with clear messages rather than blocking all queries
        this.generationReady = true;
      }
    }
  }

  // ── Embedding ────────────────────────────────────────────────────

  async embed(text) {
    if (!this.embeddingReady) {
      throw new Error('Ollama not ready. Check: docker logs mnemosyne-ollama');
    }
    try {
      const response = await this.ollama.embeddings({ model: EMBED_MODEL, prompt: text });
      if (!response?.embedding?.length) {
        throw new Error('Ollama returned empty embedding — model may not be loaded');
      }
      return response.embedding;
    } catch (err) {
      const msg = errMsg(err);
      logger.error(`[Embed] embed() failed: ${msg}`);
      throw new Error(`Embedding failed: ${msg}`);
    }
  }

  async embedBatch(texts) {
    const results = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }

  // ── Generation ───────────────────────────────────────────────────

  async generateResponse(query, context) {
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not configured. Set it in rag-server/.env');
    }

    const contextText = context
      .map((c, i) => `[Source ${i + 1}: ${c.metadata?.filename || 'Document'}]\n${c.text}`)
      .join('\n\n---\n\n');

    const systemPrompt =
`You are Mnemosyne, an AI assistant for a RAG knowledge base system.
Answer questions STRICTLY based on the provided context documents.

RULES:
1. Only use information from the context. Never invent or assume facts.
2. If the answer is not in the context, say: "I don't have information about that in the knowledge base."
3. Be concise and direct. For Viber: plain text only, no markdown, under 200 words.
4. Cite the source document when referencing specific facts.`;

    const userPrompt =
`Context documents:
${contextText}

---

Question: ${query}

Answer based ONLY on the context above:`;

    try {
      const completion = await this.openrouter.chat.completions.create({
        model:       ACTIVE_MODEL,
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   }
        ],
        temperature: 0.1,
        max_tokens:  512
      });

      const answer = completion.choices?.[0]?.message?.content;
      if (!answer) throw new Error('OpenRouter returned an empty response');

      logger.debug(`[LLM] Tokens: ${completion.usage?.total_tokens ?? '?'} · model: ${ACTIVE_MODEL}`);
      return answer;

    } catch (err) {
      const msg = errMsg(err);
      logger.error(`[LLM] generateResponse() failed: ${msg}`);

      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        throw new Error('OpenRouter rate limit reached. Wait a moment and retry.');
      }
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        throw new Error('Invalid OpenRouter API key. Check OPENROUTER_API_KEY in .env.');
      }
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        throw new Error(`Model "${ACTIVE_MODEL}" not found on OpenRouter. Switch to a different model.`);
      }
      throw new Error(`LLM generation failed: ${msg}`);
    }
  }

  // ── Live model switching ─────────────────────────────────────────

  /**
   * Switch the active LLM at runtime — no restart needed.
   * @param {string} modelId  e.g. 'meta-llama/llama-3.1-8b-instruct:free'
   */
  async switchModel(modelId) {
    if (!modelId || typeof modelId !== 'string' || !modelId.trim()) {
      throw new Error('Invalid model ID');
    }
    const previous = ACTIVE_MODEL;
    ACTIVE_MODEL   = modelId.trim();
    logger.info(`[LLM] Model switched: ${previous} → ${ACTIVE_MODEL}`);
    return { previous, current: ACTIVE_MODEL };
  }

  get currentModel() {
    return ACTIVE_MODEL;
  }

  // ── Status ───────────────────────────────────────────────────────

  get ready() {
    return this.embeddingReady && this.generationReady;
  }
}

module.exports = new LLMService();
