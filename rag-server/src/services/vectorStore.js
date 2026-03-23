const { ChromaClient } = require('chromadb');
const { logger } = require('../utils/logger');

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'sofia_rag_knowledge';

class VectorStore {
  constructor() {
    this.client = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://chromadb:8000'
    });
    this.collection = null;
  }

  async init() {
    try {
      // Always use cosine distance — required for nomic-embed-text
      // If collection already exists with wrong metric, delete and recreate
      this.collection = await this.client.getOrCreateCollection({
        name: COLLECTION_NAME,
        metadata: {
          description: 'Mnemosyne RAG Knowledge Base',
          'hnsw:space': 'cosine'   // correct key format for ChromaDB
        }
      });
      const count = await this.collection.count();
      logger.info(`Vector store ready: collection="${COLLECTION_NAME}", chunks=${count}`);
    } catch (err) {
      logger.error('VectorStore init failed:', err.message);
      throw err;
    }
  }

  async ensureInit() {
    if (!this.collection) await this.init();
  }

  async addChunks(chunks) {
    await this.ensureInit();
    await this.collection.add({
      ids:       chunks.map(c => c.id),
      embeddings:chunks.map(c => c.embedding),
      documents: chunks.map(c => c.text),
      metadatas: chunks.map(c => c.metadata)
    });
    logger.info(`[VectorStore] Added ${chunks.length} chunks`);
  }

  /**
   * Query for similar chunks.
   *
   * ChromaDB with cosine space returns distances in [0, 2]:
   *   0   = identical
   *   1   = orthogonal (unrelated)
   *   2   = opposite
   *
   * We convert to a similarity score in [0, 1]:
   *   similarity = 1 - (distance / 2)
   *
   * Typical good matches score 0.55–0.85 with nomic-embed-text.
   */
  async query(queryEmbedding, nResults = 5) {
    await this.ensureInit();

    const count = await this.collection.count();
    if (count === 0) {
      logger.warn('[VectorStore] Collection is empty — no chunks to search');
      return [];
    }

    // Can't request more results than exist
    const safeN = Math.min(nResults, count);

    const results = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: safeN,
      include: ['documents', 'metadatas', 'distances']
    });

    if (!results.documents?.[0]?.length) return [];

    const mapped = results.documents[0].map((doc, i) => {
      const distance = results.distances[0][i];
      // Correct cosine conversion: distance is in [0,2], similarity in [0,1]
      const relevanceScore = Math.max(0, 1 - (distance / 2));
      return {
        text: doc,
        metadata: results.metadatas[0][i],
        distance,
        relevanceScore
      };
    });

    // Log scores so we can tune MIN_RELEVANCE_SCORE
    const scoreList = mapped.map(c =>
      `${c.metadata?.filename ?? '?'} chunk${c.metadata?.chunkIndex ?? '?'}: ` +
      `dist=${c.distance?.toFixed(4)} score=${c.relevanceScore?.toFixed(4)}`
    ).join(' | ');
    logger.info(`[VectorStore] Query scores → ${scoreList}`);

    return mapped;
  }

  async deleteByDocumentId(documentId) {
    await this.ensureInit();
    await this.collection.delete({ where: { documentId } });
    logger.info(`[VectorStore] Deleted chunks for documentId=${documentId}`);
  }

  /**
   * Wipe and recreate the collection.
   * Use this if the collection was created with wrong distance metric.
   */
  async reset() {
    try {
      await this.client.deleteCollection({ name: COLLECTION_NAME });
      logger.info(`[VectorStore] Collection "${COLLECTION_NAME}" deleted`);
    } catch (_) { /* didn't exist */ }
    this.collection = null;
    await this.init();
    logger.info('[VectorStore] Collection recreated with cosine metric');
  }

  async stats() {
    await this.ensureInit();
    const count = await this.collection.count();
    return { totalChunks: count, collection: COLLECTION_NAME };
  }

  async listDocuments() {
    await this.ensureInit();
    const count = await this.collection.count();
    if (count === 0) return [];

    const results = await this.collection.get({
      include: ['metadatas'],
      limit: 10000
    });

    const docs = {};
    for (const meta of results.metadatas) {
      if (!meta?.documentId) continue;
      if (!docs[meta.documentId]) {
        docs[meta.documentId] = {
          id: meta.documentId,
          filename: meta.filename,
          fileType: meta.fileType,
          uploadedAt: meta.uploadedAt,
          chunkCount: 0
        };
      }
      docs[meta.documentId].chunkCount++;
    }
    return Object.values(docs);
  }
}

module.exports = new VectorStore();
