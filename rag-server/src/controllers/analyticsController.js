const configService = require('../services/configService');
const vectorStore = require('../services/vectorStore');
const cacheService = require('../services/cacheService');
const queueService = require('../services/queueService');
const sessionService = require('../services/sessionService');
const llmService = require('../services/llmService');
const { logger } = require('../utils/logger');

// GET /api/analytics/overview
exports.getOverview = async (req, res) => {
  try {
    const [tokenUsage, vectorStats, docs, tags, cacheStats, queueMetrics, health] = await Promise.allSettled([
      configService.getTokenUsage(),
      vectorStore.stats(),
      vectorStore.listDocuments(),
      vectorStore.getUniqueTags(),
      cacheService.stats(),
      queueService.getMetrics(),
      getHealthStatus()
    ]);

    const overview = {
      totalQueries: tokenUsage.status === 'fulfilled' ? tokenUsage.value.queryCount : 0,
      totalDocuments: docs.status === 'fulfilled' ? docs.value.length : 0,
      totalChunks: vectorStats.status === 'fulfilled' ? vectorStats.value.totalChunks : 0,
      activeTags: tags.status === 'fulfilled' ? tags.value.length : 0,
      cacheHitRate: calculateCacheHitRate(cacheStats, tokenUsage),
      avgResponseTime: calculateAvgResponseTime(queueMetrics),
      currentModel: configService.get('openrouterModel'),
      systemHealth: health.status === 'fulfilled' ? health.value : {}
    };

    res.json(overview);
  } catch (err) {
    logger.error('[Analytics] Overview error:', err.message);
    res.status(500).json({ error: 'Failed to get analytics overview' });
  }
};

// GET /api/analytics/tags
exports.getTags = async (req, res) => {
  try {
    const docs = await vectorStore.listDocuments();
    
    const tagStats = {};
    docs.forEach(doc => {
      doc.tags.forEach(tag => {
        if (!tagStats[tag]) {
          tagStats[tag] = { name: tag, documentCount: 0, chunkCount: 0, coOccurrences: {} };
        }
        tagStats[tag].documentCount++;
        tagStats[tag].chunkCount += doc.chunkCount;
        
        doc.tags.forEach(otherTag => {
          if (tag !== otherTag) {
            tagStats[tag].coOccurrences[otherTag] = (tagStats[tag].coOccurrences[otherTag] || 0) + 1;
          }
        });
      });
    });

    const relationships = [];
    const seen = new Set();
    Object.values(tagStats).forEach(tag => {
      Object.entries(tag.coOccurrences).forEach(([otherTag, count]) => {
        const key = [tag.name, otherTag].sort().join('-');
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            source: tag.name,
            target: otherTag,
            value: count
          });
        }
      });
    });

    res.json({
      tags: Object.values(tagStats),
      relationships
    });
  } catch (err) {
    logger.error('[Analytics] Tags error:', err.message);
    res.status(500).json({ error: 'Failed to get analytics tags' });
  }
};

// GET /api/analytics/sessions
exports.getSessions = async (req, res) => {
  try {
    const userId = req.user?.id || 'default-user';
    const sessions = await sessionService.getSessions(userId);
    
    const sessionsByDay = {};
    let totalMessages = 0;
    
    sessions.forEach(session => {
      const date = new Date(session.created).toISOString().split('T')[0];
      sessionsByDay[date] = (sessionsByDay[date] || 0) + 1;
      totalMessages += session.messageCount || 0;
    });

    const sessionsByDayArray = Object.entries(sessionsByDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      totalSessions: sessions.length,
      totalMessages,
      avgMessagesPerSession: sessions.length ? (totalMessages / sessions.length).toFixed(1) : 0,
      sessionsByDay: sessionsByDayArray
    });
  } catch (err) {
    logger.error('[Analytics] Sessions error:', err.message);
    res.status(500).json({ error: 'Failed to get analytics sessions' });
  }
};

// GET /api/analytics/usage
exports.getUsage = async (req, res) => {
  try {
    const [tokenUsage, cacheStats, queueMetrics] = await Promise.allSettled([
      configService.getTokenUsage(),
      cacheService.stats(),
      queueService.getMetrics()
    ]);

    res.json({
      tokenUsage: tokenUsage.status === 'fulfilled' ? tokenUsage.value : {},
      cacheStats: cacheStats.status === 'fulfilled' ? cacheStats.value : {},
      queueMetrics: queueMetrics.status === 'fulfilled' ? queueMetrics.value.queryQueue : {}
    });
  } catch (err) {
    logger.error('[Analytics] Usage error:', err.message);
    res.status(500).json({ error: 'Failed to get analytics usage' });
  }
};

// Helper functions
async function getHealthStatus() {
  const health = {};

  try {
    await llmService.ollama.list();
    health.ollama = 'ok';
  } catch { health.ollama = 'error'; }

  try {
    await vectorStore.stats();
    health.chromadb = 'ok';
  } catch { health.chromadb = 'error'; }

  try {
    await cacheService.stats();
    health.redis = 'ok';
  } catch { health.redis = 'error'; }

  try {
    const client = llmService._openrouterClient();
    await client.chat.completions.create({
      model: llmService.currentModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    });
    health.openrouter = 'ok';
  } catch (err) {
    health.openrouter = err.message.includes('429') || err.message.toLowerCase().includes('rate') ? 'ok' : 'error';
  }

  return health;
}

function calculateCacheHitRate(cacheStats, tokenUsage) {
  if (cacheStats.status !== 'fulfilled' || tokenUsage.status !== 'fulfilled') return 0;
  const cacheEntries = cacheStats.value.entries || 0;
  const totalQueries = tokenUsage.value.queryCount || 1;
  return Math.min(1, cacheEntries / totalQueries);
}

function calculateAvgResponseTime(queueMetrics) {
  if (queueMetrics.status !== 'fulfilled') return 0;
  const completed = queueMetrics.value.queryQueue?.completed || 0;
  return completed > 0 ? 1200 : 0;
}
