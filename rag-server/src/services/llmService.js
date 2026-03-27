const { Ollama } = require('ollama');
const OpenAI     = require('openai');
const { logger } = require('../utils/logger');

// ── Embedding config (env only — not runtime-changeable) ──────────────
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ── OpenRouter base ────────────────────────────────────────────────────
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Safely extract a readable message from any error shape
function errMsg(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.error?.message) return err.error.message;
  if (err.cause?.message) return err.cause.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// Lazy-load configService to avoid circular deps at module init time
function cfg() {
  return require('./configService');
}

class LLMService {
  constructor() {
    this.ollama          = new Ollama({ host: OLLAMA_HOST });
    this.embeddingReady  = false;
    this.generationReady = false;
    logger.info(`[LLM] Embedding → Ollama ${OLLAMA_HOST} / ${EMBED_MODEL}`);
  }

  // ── Build a fresh OpenRouter client using the current saved API key ──
  _openrouterClient() {
    const apiKey = cfg().get('openrouterApiKey');
    if (!apiKey) throw new Error('OpenRouter API key is not configured. Set it in Settings.');
    return new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE,
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL   || 'http://localhost:3000',
        'X-Title':      process.env.APP_TITLE || 'Mnemosyne RAG'
      }
    });
  }

  get currentModel() {
    return cfg().get('openrouterModel');
  }

  // ── Init ──────────────────────────────────────────────────────────────
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
          logger.info('[Embed] Pull complete');
        }

        this.embeddingReady = true;
        logger.info('[Embed] Ready ✓');
        return;
      } catch (err) {
        logger.warn(`[Embed] Not ready (${i}/${MAX}): ${errMsg(err)}`);
        if (i < MAX) await new Promise(r => setTimeout(r, 5000));
      }
    }
    logger.error('[Embed] Failed. Check: docker logs mnemosyne-ollama');
  }

  async _initGeneration() {
    const apiKey = cfg().get('openrouterApiKey');
    if (!apiKey) {
      logger.warn('[LLM] No OpenRouter API key configured — set it in the Settings tab');
      // Mark ready so the server starts; queries will fail gracefully with a clear message
      this.generationReady = true;
      return;
    }
    try {
      logger.info('[LLM] Verifying OpenRouter API key…');
      const client = this._openrouterClient();
      await client.chat.completions.create({
        model: this.currentModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      });
      this.generationReady = true;
      logger.info(`[LLM] OpenRouter ready ✓  model: ${this.currentModel}`);
    } catch (err) {
      const msg = errMsg(err);
      // 429 = rate limit → key works fine
      if (msg.includes('429') || msg.toLowerCase().includes('rate')) {
        logger.warn('[LLM] OpenRouter rate limited on ping — marking ready anyway');
        this.generationReady = true;
      } else {
        logger.error(`[LLM] OpenRouter key verification failed: ${msg}`);
        // Still mark ready — let queries fail with a useful message
        this.generationReady = true;
      }
    }
  }

  // ── Re-initialise generation after key/model update in settings ──────
  async reinitGeneration() {
    this.generationReady = false;
    await this._initGeneration();
    return this.generationReady;
  }

  // ── Embedding ─────────────────────────────────────────────────────────
  async embed(text) {
    if (!this.embeddingReady) {
      throw new Error('Ollama not ready. Check: docker logs mnemosyne-ollama');
    }
    try {
      const response = await this.ollama.embeddings({ model: EMBED_MODEL, prompt: text });
      if (!response?.embedding?.length) {
        throw new Error('Ollama returned empty embedding — model may not be loaded yet');
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

  // ── Generation ────────────────────────────────────────────────────────
  async generateResponse(query, context) {
    const apiKey = cfg().get('openrouterApiKey');
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Go to the Settings tab to add your key.');
    }

    const model       = this.currentModel;
    const client      = this._openrouterClient();
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
      const completion = await client.chat.completions.create({
        model,
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   }
        ],
        temperature: 0.1,
        max_tokens:  512
      });

      const answer = completion.choices?.[0]?.message?.content;
      if (!answer) throw new Error('OpenRouter returned an empty response');

      // Track token usage in configService
      if (completion.usage) {
        cfg().trackTokens(completion.usage, model);
      }
      logger.debug(`[LLM] Tokens: ${completion.usage?.total_tokens ?? '?'} · model: ${model}`);
      return answer;

    } catch (err) {
      const msg = errMsg(err);
      logger.error(`[LLM] generateResponse() failed: ${msg}`);

      if (msg.includes('401') || msg.toLowerCase().includes('user not found') || msg.toLowerCase().includes('unauthorized')) {
        throw new Error('OpenRouter API key is invalid or expired. Update it in Settings → API Configuration.');
      }
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        throw new Error('OpenRouter rate limit reached. Wait a moment and retry.');
      }
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        throw new Error(`Model "${model}" not found on OpenRouter. Switch to a different model in Settings.`);
      }
      throw new Error(`LLM generation failed: ${msg}`);
    }
  }

  // ── Live model switching ───────────────────────────────────────────────
  async switchModel(modelId) {
    if (!modelId || typeof modelId !== 'string' || !modelId.trim()) {
      throw new Error('Invalid model ID');
    }
    const previous = this.currentModel;
    cfg().update({ openrouterModel: modelId.trim() });
    logger.info(`[LLM] Model switched: ${previous} → ${modelId}`);
    return { previous, current: modelId };
  }

  get ready() {
    return this.embeddingReady && this.generationReady;
  }
}

module.exports = new LLMService();
