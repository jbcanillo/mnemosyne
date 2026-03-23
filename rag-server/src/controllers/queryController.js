const queueService  = require('../services/queueService');
const cacheService  = require('../services/cacheService');
const vectorStore   = require('../services/vectorStore');
const llmService    = require('../services/llmService');
const { logger }    = require('../utils/logger');

// Lower default threshold — nomic-embed-text with cosine similarity
// typically scores 0.3–0.7 for relevant content. 0.15 is a safe floor
// that excludes truly unrelated content without over-filtering.
const MIN_RELEVANCE_SCORE = parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.15');
const TOP_K = parseInt(process.env.TOP_K || '5');

// Initialize async query processor
queueService.processQueries(async (job) => {
  const { query, options = {} } = job.data;
  return await processRagQuery(query, options, job);
});

/**
 * Core RAG pipeline
 */
async function processRagQuery(query, options = {}, job = null) {
  if (job) await job.progress(10);

  // 1. Embed the query
  const queryEmbedding = await llmService.embed(query);
  if (job) await job.progress(30);

  // 2. Retrieve top-K chunks
  const topK = options.topK || TOP_K;
  const chunks = await vectorStore.query(queryEmbedding, topK);
  if (job) await job.progress(60);

  // 3. Log what we got back before filtering (key for debugging)
  if (chunks.length === 0) {
    logger.warn(`[Query] No chunks returned from vector store for: "${query.substring(0, 80)}"`);
    logger.warn('[Query] Collection may be empty or query embedding failed.');
  } else {
    const best = chunks[0];
    logger.info(
      `[Query] Top match: score=${best.relevanceScore.toFixed(4)} ` +
      `file="${best.metadata?.filename}" threshold=${MIN_RELEVANCE_SCORE}`
    );
  }

  // 4. Filter by minimum relevance
  const relevantChunks = chunks.filter(c => c.relevanceScore >= MIN_RELEVANCE_SCORE);

  if (relevantChunks.length === 0) {
    const topScore = chunks[0]?.relevanceScore?.toFixed(4) ?? 'n/a';
    logger.warn(
      `[Query] All ${chunks.length} chunks below threshold ${MIN_RELEVANCE_SCORE}. ` +
      `Best score was ${topScore}. ` +
      `Consider lowering MIN_RELEVANCE_SCORE in .env (current: ${MIN_RELEVANCE_SCORE})`
    );
    return {
      answer: "I don't have information about that in the knowledge base. Please try rephrasing your question or upload more relevant documents.",
      sources: [],
      relevantChunks: 0,
      topScoreDebug: topScore,
      fromCache: false
    };
  }

  logger.info(`[Query] Using ${relevantChunks.length} chunks (scores: ${relevantChunks.map(c => c.relevanceScore.toFixed(3)).join(', ')})`);

  // 5. Generate response via OpenRouter
  const answer = await llmService.generateResponse(query, relevantChunks);
  if (job) await job.progress(90);

  const result = {
    answer,
    sources: relevantChunks.map(c => ({
      filename:       c.metadata.filename,
      relevanceScore: Math.round(c.relevanceScore * 100) / 100,
      chunkIndex:     c.metadata.chunkIndex
    })),
    relevantChunks: relevantChunks.length,
    fromCache: false
  };

  if (job) await job.progress(100);
  return result;
}

// ─── Controllers ────────────────────────────────────────────────────

exports.query = async (req, res) => {
  const { query, async: isAsync = false, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Invalid query.' });
  }

  const trimmedQuery = query.trim().substring(0, 1000);

  try {
    const cacheKey = cacheService.generateKey(trimmedQuery, options);
    const cached   = await cacheService.get(cacheKey);
    if (cached) {
      logger.info(`[Query] Cache hit: "${trimmedQuery.substring(0, 50)}"`);
      return res.json({ ...cached, fromCache: true, query: trimmedQuery });
    }

    if (isAsync) {
      const job = await queueService.addQuery({ query: trimmedQuery, options });
      return res.status(202).json({ jobId: job.id, status: 'queued' });
    }

    const result = await processRagQuery(trimmedQuery, options);
    await cacheService.set(cacheKey, result);
    return res.json({ ...result, query: trimmedQuery });

  } catch (err) {
    logger.error('[Query] Error:', err.message);
    return res.status(500).json({ error: 'Query processing failed', message: err.message });
  }
};

/**
 * GET /api/query/debug?q=your+question
 * Returns raw chunk scores without LLM generation — use this to
 * tune MIN_RELEVANCE_SCORE and verify embeddings are working.
 */
exports.debug = async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Pass ?q=your+question' });

  try {
    const queryEmbedding = await llmService.embed(query);
    const chunks = await vectorStore.query(queryEmbedding, 10);

    res.json({
      query,
      currentThreshold: MIN_RELEVANCE_SCORE,
      totalChunksReturned: chunks.length,
      recommendation: chunks.length > 0
        ? `Set MIN_RELEVANCE_SCORE below ${chunks[0].relevanceScore.toFixed(3)} to get results`
        : 'No chunks found — check that documents are indexed',
      chunks: chunks.map(c => ({
        filename:       c.metadata?.filename,
        chunkIndex:     c.metadata?.chunkIndex,
        relevanceScore: parseFloat(c.relevanceScore.toFixed(4)),
        distance:       parseFloat(c.distance.toFixed(4)),
        preview:        c.text.substring(0, 120) + '…'
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getJobStatus = async (req, res) => {
  const { jobId } = req.params;
  try {
    const status = await queueService.getJobStatus(jobId);
    if (!status) return res.status(404).json({ error: 'Job not found' });
    if (status.state === 'completed' && status.result) {
      const cacheKey = cacheService.generateKey(status.data?.query || '', status.data?.options || {});
      await cacheService.set(cacheKey, status.result);
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get job status' });
  }
};

exports.clearCache = async (req, res) => {
  try {
    const count = await cacheService.flush();
    res.json({ message: `Cache cleared. ${count} entries removed.` });
  } catch (err) {
    res.status(500).json({ error: 'Cache clear failed' });
  }
};

exports.info = async (req, res) => {
  try {
    const [vectorStats, cacheStats, queueMetrics] = await Promise.all([
      vectorStore.stats().catch(() => ({ error: 'unavailable' })),
      cacheService.stats(),
      queueService.getMetrics().catch(() => ({ error: 'unavailable' }))
    ]);
    res.json({
      service: 'Mnemosyne RAG Server',
      version: '1.0.0',
      models: {
        embedding: process.env.EMBED_MODEL   || 'nomic-embed-text',
        llm:       process.env.OPENROUTER_MODEL || 'microsoft/phi-3-mini-128k-instruct:free',
        provider:  'OpenRouter'
      },
      minRelevanceScore: MIN_RELEVANCE_SCORE,
      vectorStore: vectorStats,
      cache: cacheStats,
      queue: queueMetrics
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get server info' });
  }
};
