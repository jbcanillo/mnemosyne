const { Ollama } = require('ollama');
const OpenAI     = require('openai');
const { logger } = require('../utils/logger');

// ── Embedding: Ollama (local, nomic-embed-text) ───────────────────────
const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://ollama:11434';
const EMBED_MODEL  = process.env.EMBED_MODEL  || 'nomic-embed-text';

// ── Generation: OpenRouter (cloud, free tier) ─────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL   = process.env.OPENROUTER_MODEL || 'stepfun/step-3.5-flash:free';
let   OPENROUTER_MODEL_CURRENT = OPENROUTER_MODEL; // mutable — changed by switchModel()
const OPENROUTER_BASE    = 'https://openrouter.ai/api/v1';

// Safely extract a readable error message from any shape
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
    // Ollama client — used ONLY for embeddings
    this.ollama = new Ollama({ host: OLLAMA_HOST });

    // OpenRouter client — uses OpenAI-compatible SDK
    if (!OPENROUTER_API_KEY) {
      logger.warn('[LLM] OPENROUTER_API_KEY is not set — generation will fail until configured');
    }
    this.openrouter = new OpenAI({
      apiKey:  OPENROUTER_API_KEY || 'not-set',
      baseURL: OPENROUTER_BASE,
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL    || 'http://localhost:3000',
        'X-Title':      process.env.APP_TITLE  || 'Mnemosyne RAG'
      }
    });

    this.embeddingReady = false;
    this.generationReady = !!OPENROUTER_API_KEY;

    logger.info(`[LLM] Embedding  → Ollama ${OLLAMA_HOST} / ${EMBED_MODEL}`);
    logger.info(`[LLM] Generation → OpenRouter / ${OPENROUTER_MODEL_CURRENT}`);
  }

  // ── Initialisation ────────────────────────────────────────────────

  async init() {
    await Promise.all([
      this._initEmbedding(),
      this._initGeneration()
    ]);
  }

  async _initEmbedding() {
    const MAX = 12;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        logger.info(`[Embed] Connecting to Ollama (attempt ${attempt}/${MAX})...`);
        const list = await this.ollama.list();
        const names = list.models.map(m => m.name);
        logger.info(`[Embed] Ollama connected. Models: ${names.join(', ') || '(none)'}`);

        if (!names.some(n => n.includes('nomic-embed-text'))) {
          logger.warn(`[Embed] Model "${EMBED_MODEL}" not found — pulling now...`);
          await this.ollama.pull({ model: EMBED_MODEL });
          logger.info(`[Embed] Pull complete: ${EMBED_MODEL}`);
        }

        this.embeddingReady = true;
        logger.info(`[Embed] Ready ✓`);
        return;
      } catch (err) {
        logger.warn(`[Embed] Not ready (${attempt}/${MAX}): ${errMsg(err)}`);
        if (attempt < MAX) await new Promise(r => setTimeout(r, 5000));
      }
    }
    logger.error('[Embed] Could not connect to Ollama after all attempts.');
    logger.error('[Embed] Check the ollama container: docker logs mnemosyne-ollama');
  }

  async _initGeneration() {
    if (!OPENROUTER_API_KEY) {
      logger.error('[LLM] OPENROUTER_API_KEY missing — set it in rag-server/.env');
      return;
    }
    try {
      // Light validation — list models to confirm key works
      logger.info('[LLM] Verifying OpenRouter API key...');
      await this.openrouter.models.list();
      this.generationReady = true;
      logger.info(`[LLM] OpenRouter ready ✓  model: ${OPENROUTER_MODEL}`);
    } catch (err) {
      logger.error(`[LLM] OpenRouter verification failed: ${errMsg(err)}`);
      logger.error('[LLM] Check OPENROUTER_API_KEY in rag-server/.env');
    }
  }

  // ── Embedding (Ollama) ────────────────────────────────────────────

  async embed(text) {
    if (!this.embeddingReady) {
      throw new Error(`Ollama embedding not ready. Check docker logs mnemosyne-ollama.`);
    }
    try {
      const response = await this.ollama.embeddings({ model: EMBED_MODEL, prompt: text });
      if (!response?.embedding?.length) {
        throw new Error('Ollama returned an empty embedding.');
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
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  // ── Generation (OpenRouter) ───────────────────────────────────────

  async generateResponse(query, context) {
    if (!this.generationReady) {
      throw new Error('OpenRouter not ready. Check OPENROUTER_API_KEY in .env.');
    }

    const contextText = context
      .map((c, i) => `[Source ${i + 1}: ${c.metadata?.filename || 'Document'}]\n${c.text}`)
      .join('\n\n---\n\n');

    const systemPrompt =
`You are Mnemosyne, an AI assistant for a RAG knowledge base system.
Answer questions STRICTLY based on the provided context documents.

RULES:
1. Only use information from the context. Never invent or assume facts.
2. If the answer is not in the context, say exactly: "I don't have information about that in the knowledge base."
3. Be concise and direct. For Viber: plain text only, no markdown, under 200 words.
4. Cite which document a fact comes from when relevant.`;

    const userPrompt =
`Context documents:
${contextText}

---

Question: ${query}

Answer based ONLY on the context above:`;

    try {
      const completion = await this.openrouter.chat.completions.create({
        model:    OPENROUTER_MODEL_CURRENT,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   }
        ],
        temperature: 0.1,    // low = less hallucination
        max_tokens:  512
      });

      const answer = completion.choices?.[0]?.message?.content;
      if (!answer) throw new Error('OpenRouter returned an empty response.');

      logger.debug(`[LLM] Tokens used: ${completion.usage?.total_tokens ?? 'unknown'}`);
      return answer;

    } catch (err) {
      const msg = errMsg(err);
      logger.error(`[LLM] generateResponse() failed: ${msg}`);

      // Surface rate-limit errors clearly
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        throw new Error('OpenRouter rate limit reached on free tier. Wait a moment and try again.');
      }
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        throw new Error('OpenRouter API key is invalid. Check OPENROUTER_API_KEY in .env.');
      }
      throw new Error(`LLM generation failed: ${msg}`);
    }
  }

  // ── Status helper (used by /api/diagnostics) ──────────────────────
  get ready() {
    return this.embeddingReady && this.generationReady;
  }
}

module.exports = new LLMService();
