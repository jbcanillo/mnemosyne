const fs     = require('fs');
const path   = require('path');
const { logger } = require('../utils/logger');

// Config is persisted to a volume-mounted file so it survives container restarts
const CONFIG_DIR  = process.env.CONFIG_DIR || '/data/config';
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

// Default values — used when no config file exists yet
const DEFAULTS = {
  openrouterApiKey:  '',
  openrouterModel:   process.env.OPENROUTER_MODEL || 'stepfun/step-3.5-flash:free',
  minRelevanceScore: parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.15'),
  topK:              parseInt(process.env.TOP_K || '5'),
  chunkSize:         parseInt(process.env.CHUNK_SIZE || '500'),
  chunkOverlap:      parseInt(process.env.CHUNK_OVERLAP || '50'),
  cacheTtl:          parseInt(process.env.CACHE_TTL || '3600'),
};

// In-memory token usage tracking (resets on server restart)
// Persisted snapshot saved to disk periodically
const tokenUsage = {
  totalPromptTokens:     0,
  totalCompletionTokens: 0,
  totalTokens:           0,
  queryCount:            0,
  sessionStart:          new Date().toISOString(),
  lastQuery:             null,
  byModel:               {}   // { modelId: { prompt, completion, total, queries } }
};

class ConfigService {
  constructor() {
    this._config = null;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
    } catch (err) {
      logger.warn(`[Config] Could not create config dir ${CONFIG_DIR}: ${err.message}`);
    }
  }

  // Load config from disk (cached in memory)
  load() {
    if (this._config) return this._config;
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        this._config = { ...DEFAULTS, ...JSON.parse(raw) };
        logger.info('[Config] Loaded from disk');
      } else {
        this._config = { ...DEFAULTS };
        // Seed from env if key was provided the old way
        if (process.env.OPENROUTER_API_KEY) {
          this._config.openrouterApiKey = process.env.OPENROUTER_API_KEY;
          logger.info('[Config] Seeded OpenRouter key from environment variable');
          this.save(); // persist it so future boots don't need the env var
        }
      }
    } catch (err) {
      logger.error(`[Config] Failed to load: ${err.message}`);
      this._config = { ...DEFAULTS };
    }
    return this._config;
  }

  // Persist config to disk
  save() {
    try {
      this._ensureDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._config, null, 2), 'utf8');
      logger.info('[Config] Saved to disk');
    } catch (err) {
      logger.error(`[Config] Failed to save: ${err.message}`);
      throw new Error(`Could not persist config: ${err.message}`);
    }
  }

  get(key) {
    return this.load()[key];
  }

  // Update one or more settings and persist
  update(updates) {
    const cfg = this.load();

    // Validate known keys
    const allowed = Object.keys(DEFAULTS);
    for (const key of Object.keys(updates)) {
      if (!allowed.includes(key)) {
        throw new Error(`Unknown setting: "${key}". Allowed: ${allowed.join(', ')}`);
      }
    }

    this._config = { ...cfg, ...updates };
    this.save();

    logger.info(`[Config] Updated: ${Object.keys(updates).join(', ')}`);
    return this._config;
  }

  // Return config safe to send to the client — mask the API key
  getPublic() {
    const cfg = this.load();
    return {
      ...cfg,
      openrouterApiKey: cfg.openrouterApiKey
        ? `sk-or-...${cfg.openrouterApiKey.slice(-6)}`  // show last 6 chars only
        : ''
    };
  }

  // Check if the OpenRouter key is configured
  hasApiKey() {
    return !!this.load().openrouterApiKey;
  }

  // ── Token usage tracking ─────────────────────────────────────────────
  trackTokens(usage, model) {
    if (!usage) return;
    const p = usage.prompt_tokens     || 0;
    const c = usage.completion_tokens || 0;
    const t = usage.total_tokens      || (p + c);

    tokenUsage.totalPromptTokens     += p;
    tokenUsage.totalCompletionTokens += c;
    tokenUsage.totalTokens           += t;
    tokenUsage.queryCount            += 1;
    tokenUsage.lastQuery              = new Date().toISOString();

    if (model) {
      if (!tokenUsage.byModel[model]) {
        tokenUsage.byModel[model] = { prompt: 0, completion: 0, total: 0, queries: 0 };
      }
      tokenUsage.byModel[model].prompt     += p;
      tokenUsage.byModel[model].completion += c;
      tokenUsage.byModel[model].total      += t;
      tokenUsage.byModel[model].queries    += 1;
    }
  }

  getTokenUsage() {
    return { ...tokenUsage };
  }

  resetTokenUsage() {
    tokenUsage.totalPromptTokens     = 0;
    tokenUsage.totalCompletionTokens = 0;
    tokenUsage.totalTokens           = 0;
    tokenUsage.queryCount            = 0;
    tokenUsage.sessionStart          = new Date().toISOString();
    tokenUsage.lastQuery             = null;
    tokenUsage.byModel               = {};
    logger.info('[Config] Token usage stats reset');
  }
}

module.exports = new ConfigService();
