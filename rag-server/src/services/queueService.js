const Bull   = require('bull');
const { logger } = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Safely extract a readable message from any error type
function errMsg(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.cause?.message) return err.cause.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

class QueueService {
  constructor() {
    this.queryQueue = new Bull('rag-queries', REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    this.ingestQueue = new Bull('rag-ingest', REDIS_URL, {
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 3000 },
        removeOnComplete: 50,
        removeOnFail: 50,
        timeout: 10 * 60 * 1000   // 10 min max per ingest job
      }
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.queryQueue.on('failed', (job, err) => {
      logger.error(`Query job ${job.id} failed: ${errMsg(err)}`);
    });

    this.ingestQueue.on('failed', (job, err) => {
      // Full error details so we can always diagnose
      logger.error(`Ingest job ${job.id} failed: ${errMsg(err)}`);
      logger.error(`  File: ${job.data?.filename}`);
      if (err?.stack) logger.error(`  Stack: ${err.stack.split('\n')[1]?.trim()}`);
    });

    this.queryQueue.on('completed', (job) => {
      logger.debug(`Query job ${job.id} completed`);
    });

    this.ingestQueue.on('completed', (job) => {
      logger.info(`Ingest job ${job.id} completed: ${job.returnvalue?.filename} (${job.returnvalue?.chunks} chunks)`);
    });

    this.ingestQueue.on('error', (err) => {
      logger.error(`Ingest queue error: ${errMsg(err)}`);
    });

    this.queryQueue.on('error', (err) => {
      logger.error(`Query queue error: ${errMsg(err)}`);
    });
  }

  async addQuery(data) {
    return this.queryQueue.add(data, { priority: data.priority || 1 });
  }

  async addIngest(data) {
    return this.ingestQueue.add(data, { priority: 1 });
  }

  processQueries(processor) {
    const concurrency = parseInt(process.env.QUERY_CONCURRENCY || '3');
    this.queryQueue.process(concurrency, processor);
    logger.info(`Query processor started (concurrency=${concurrency})`);
  }

  processIngests(processor) {
    this.ingestQueue.process(2, processor);
    logger.info('Ingest processor started (concurrency=2)');
  }

  async getJobStatus(jobId) {
    const job = await this.queryQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      id: job.id,
      state,
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
      progress: job.progress(),
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedAt: job.finishedOn  ? new Date(job.finishedOn).toISOString()  : null
    };
  }

  async getMetrics() {
    const [qWaiting, qActive, qCompleted, qFailed] = await Promise.all([
      this.queryQueue.getWaitingCount(),
      this.queryQueue.getActiveCount(),
      this.queryQueue.getCompletedCount(),
      this.queryQueue.getFailedCount()
    ]);
    return { queryQueue: { waiting: qWaiting, active: qActive, completed: qCompleted, failed: qFailed } };
  }
}

module.exports = new QueueService();
