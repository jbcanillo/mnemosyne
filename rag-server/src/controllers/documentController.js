const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');
const documentParser = require('../services/documentParser');
const vectorStore    = require('../services/vectorStore');
const llmService     = require('../services/llmService');
const queueService   = require('../services/queueService');
const { logger }     = require('../utils/logger');

// ── Ingest job processor ─────────────────────────────────────────────
queueService.processIngests(async (job) => {
  const { filePath, filename, fileType, documentId } = job.data;

  try {
    logger.info(`[Ingest] START: ${filename} (${documentId})`);
    await job.progress(5);

    // Guard: make sure LLM service is ready before attempting embed
    if (!llmService.ready) {
      logger.warn('[Ingest] LLM not ready — waiting up to 60s...');
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        if (llmService.ready) break;
      }
      if (!llmService.ready) {
        throw new Error('Ollama is not reachable. Make sure Ollama is running and models are pulled.');
      }
    }

    // 1. Parse file → raw text
    logger.info(`[Ingest] Parsing ${fileType} file...`);
    const rawText = await documentParser.parse(filePath, fileType);
    await job.progress(20);

    if (!rawText || rawText.trim().length < 10) {
      throw new Error(`Could not extract text from "${filename}". File may be empty, scanned image, or password-protected.`);
    }
    logger.info(`[Ingest] Extracted ${rawText.length} characters`);

    // 2. Chunk text
    const metadata = { filename, fileType, documentId, uploadedAt: new Date().toISOString() };
    const chunks = documentParser.chunkText(rawText, documentId, metadata);
    await job.progress(35);

    if (chunks.length === 0) {
      throw new Error('Document produced no chunks after parsing. File may have too little text content.');
    }
    logger.info(`[Ingest] Created ${chunks.length} chunks`);

    // 3. Embed chunks in batches of 10 to avoid memory spikes
    logger.info('[Ingest] Embedding chunks...');
    const BATCH = 10;
    const allEmbeddings = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH).map(c => c.text);
      const embeddings = await llmService.embedBatch(batch);
      allEmbeddings.push(...embeddings);
      const pct = 35 + Math.round(((i + BATCH) / chunks.length) * 45);
      await job.progress(Math.min(pct, 80));
      logger.info(`[Ingest] Embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length} chunks`);
    }

    // 4. Store in ChromaDB
    logger.info('[Ingest] Storing in vector database...');
    const vectorChunks = chunks.map((c, i) => ({ ...c, embedding: allEmbeddings[i] }));
    await vectorStore.addChunks(vectorChunks);
    await job.progress(95);

    // 5. Cleanup temp file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await job.progress(100);

    logger.info(`[Ingest] COMPLETE: ${filename} → ${chunks.length} chunks indexed`);
    return { documentId, filename, chunks: chunks.length, status: 'complete' };

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logger.error(`[Ingest] FAILED: ${filename} — ${err.message}`);
    throw err; // Re-throw so Bull marks job as failed with reason
  }
});

// ── Controllers ──────────────────────────────────────────────────────

exports.upload = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { filename, path: filePath } = req.file;
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const supportedTypes = ['pdf', 'xlsx', 'xls', 'csv', 'md', 'markdown', 'txt', 'docx'];

  if (!supportedTypes.includes(ext)) {
    fs.unlinkSync(filePath);
    return res.status(400).json({
      error: `Unsupported file type: .${ext}`,
      supported: supportedTypes
    });
  }

  const documentId = uuidv4();

  try {
    const job = await queueService.addIngest({ filePath, filename, fileType: ext, documentId });
    logger.info(`[Upload] Queued: ${filename} → job ${job.id}`);

    res.status(202).json({
      documentId,
      jobId: String(job.id),
      filename,
      fileType: ext,
      status: 'processing',
      message: 'Document queued for ingestion.'
    });
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logger.error('Upload queue error:', err);
    res.status(500).json({ error: 'Failed to queue document', message: err.message });
  }
};

/**
 * GET /api/documents/ingest-status/:jobId
 * Lets the UI poll the exact ingest job status
 */
exports.ingestStatus = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await queueService.ingestQueue.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const state = await job.getState();
    res.json({
      jobId,
      state,                         // waiting | active | completed | failed
      progress: job.progress(),
      result: job.returnvalue || null,
      error: job.failedReason || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not get job status', message: err.message });
  }
};

exports.list = async (req, res) => {
  try {
    const docs = await vectorStore.listDocuments();
    res.json({ documents: docs, total: docs.length });
  } catch (err) {
    logger.error('List documents error:', err);
    res.status(500).json({ error: 'Failed to list documents' });
  }
};

exports.remove = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Document ID required' });
  try {
    await vectorStore.deleteByDocumentId(id);
    res.json({ message: `Document ${id} removed from knowledge base.` });
  } catch (err) {
    logger.error('Delete document error:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
};

exports.stats = async (req, res) => {
  try {
    const stats = await vectorStore.stats();
    const docs  = await vectorStore.listDocuments();
    res.json({ ...stats, totalDocuments: docs.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
