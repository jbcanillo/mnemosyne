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
   *
   * @param {number[]} queryEmbedding - The query embedding vector
   * @param {number} nResults - Number of results to return
   * @param {string[]} tags - Optional tags to filter by (AND logic)
   */
  async query(queryEmbedding, nResults = 5, tags = null) {
    await this.ensureInit();

    const count = await this.collection.count();
    if (count === 0) {
      logger.warn('[VectorStore] Collection is empty — no chunks to search');
      return [];
    }

    // Can't request more results than exist
    const safeN = Math.min(nResults, count);

    const queryParams = {
      queryEmbeddings: [queryEmbedding],
      nResults: safeN,
      include: ['documents', 'metadatas', 'distances']
    };

    const results = await this.collection.query(queryParams);

    if (!results.documents?.[0]?.length) return [];

    let mapped = results.documents[0].map((doc, i) => {
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

    // Filter by tags after retrieval (AND logic — chunk's document must have ALL tags)
    if (tags && tags.length > 0) {
      mapped = mapped.filter(chunk => {
        const chunkTags = chunk.metadata?.tags || '';
        const tagList = chunkTags.split(',').map(t => t.trim().toLowerCase());
        return tags.every(tag => tagList.includes(tag.toLowerCase()));
      });
      logger.info(`[VectorStore] Tag filter: ${tags.join(', ')} → ${mapped.length} chunks remaining`);
    }

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

  async listDocuments(tagsFilter = null) {
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
          tags: meta.tags ? meta.tags.split(',').filter(t => t.trim()) : [],
          chunkCount: 0
        };
      }
      docs[meta.documentId].chunkCount++;
    }

    let docList = Object.values(docs);

    // Filter by tags if provided (AND logic — document must have ALL tags)
    if (tagsFilter && tagsFilter.length > 0) {
      docList = docList.filter(doc =>
        tagsFilter.every(tag => doc.tags.includes(tag))
      );
    }

    return docList;
  }

  /**
   * Get all unique tags across all documents.
   * @returns {string[]} Array of unique tag strings
   */
  async getUniqueTags() {
    await this.ensureInit();
    const count = await this.collection.count();
    if (count === 0) return [];

    const results = await this.collection.get({
      include: ['metadatas'],
      limit: 10000
    });

    const tagSet = new Set();
    for (const meta of results.metadatas) {
      if (meta?.tags) {
        meta.tags.split(',').forEach(t => {
          const trimmed = t.trim();
          if (trimmed) tagSet.add(trimmed);
        });
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * Update tags for all chunks of a document.
   * @param {string} documentId
   * @param {string[]} tags
   */
  async updateTags(documentId, tags) {
    await this.ensureInit();
    const tagsString = tags.join(',');

    // Get all chunks for this document
    const results = await this.collection.get({
      where: { documentId },
      include: ['metadatas']
    });

    if (!results.ids || results.ids.length === 0) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Update metadata for each chunk
    const newMetadatas = results.metadatas.map(meta => ({
      ...meta,
      tags: tagsString
    }));

    await this.collection.update({
      ids: results.ids,
      metadatas: newMetadatas
    });

    logger.info(`[VectorStore] Updated tags for document ${documentId}: ${tagsString}`);
  }
}

module.exports = new VectorStore();
