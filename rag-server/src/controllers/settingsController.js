const configService = require('../services/configService');
const cacheService  = require('../services/cacheService');
const { logger }    = require('../utils/logger');

/**
 * GET /api/settings
 * Returns current settings with the API key masked.
 */
exports.get = (req, res) => {
  try {
    res.json(configService.getPublic());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/settings
 * Updates one or more settings. Reinitialises LLM if key/model changed.
 *
 * Body: { openrouterApiKey?, openrouterModel?, minRelevanceScore?, topK?, ... }
 */
exports.update = async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Body must be a JSON object of settings to update.' });
  }

  try {
    const keyChanged     = 'openrouterApiKey'  in updates;
    const modelChanged   = 'openrouterModel'   in updates;
    const engineChanged  = 'llmEngine'        in updates;
    const localModelChanged = 'localLlmModel' in updates;
    const cacheTtlChanged = 'cacheTtl'         in updates;

    // Strip empty string key — treat as "clear key" intention only when explicitly blank
    if (keyChanged && updates.openrouterApiKey === '') {
      logger.warn('[Settings] OpenRouter API key cleared');
    }

    configService.update(updates);

    // Update cache TTL if changed
    if (cacheTtlChanged) {
      const newTtl = updates.cacheTtl;
      cacheService.updateTtl(newTtl);
      logger.info(`[Settings] Cache TTL updated to ${newTtl}s`);
    }

    // Re-verify LLM connection if engine-related settings changed
    if (keyChanged || modelChanged || engineChanged || localModelChanged) {
      const llm = require('../services/llmService');
      const ok  = await llm.reinitGeneration();
      logger.info(`[Settings] LLM re-init after settings change: ${ok ? 'ok' : 'failed'}`);
    }

    res.json({
      message:  'Settings saved.',
      settings: configService.getPublic()
    });
  } catch (err) {
    logger.error('[Settings] Update failed:', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/settings/test-key
 * Tests the current OpenRouter API key without changing anything.
 */
exports.testKey = async (req, res) => {
  const OpenAI = require('openai');
  const apiKey = configService.get('openrouterApiKey');
  const model  = configService.get('openrouterModel');

  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'No API key configured.' });
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL   || 'http://localhost:3000',
        'X-Title':      process.env.APP_TITLE || 'Mnemosyne RAG'
      }
    });

    const completion = await client.chat.completions.create({
      model,
      messages:   [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 5
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    res.json({
      ok:    true,
      model,
      reply,
      tokens: completion.usage?.total_tokens ?? 0
    });
  } catch (err) {
    const msg = err.message || String(err);
    res.status(200).json({
      ok:    false,
      error: msg.includes('401') || msg.includes('User not found')
        ? 'Invalid API key — check your OpenRouter dashboard.'
        : msg.includes('429')
          ? 'Rate limited — key is valid but try again in a moment.'
          : msg
    });
  }
};
