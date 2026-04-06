const Redis = require('ioredis');
const { v4: uuid } = require('uuid');
const { logger } = require('../utils/logger');

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

class SessionService {
  constructor() {
    this.redis = null;
    this.init();
  }

  init() {
    try {
      this.redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 2
      });

      this.redis.on('connect', () => {
        logger.info('SessionService: Connected to Redis');
      });

      this.redis.on('error', (err) => {
        logger.warn('SessionService: Redis error:', err.message);
      });

      this.redis.connect().catch(err => {
        logger.warn('SessionService: Failed to connect to Redis:', err.message);
      });
    } catch (err) {
      logger.error('SessionService: Init failed:', err.message);
    }
  }

  /**
   * Create a new conversation session
   */
  async createSession(userId, title = 'New Conversation') {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const sessionId = uuid();
      const session = {
        id: sessionId,
        userId,
        title: title || 'New Conversation',
        created: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        tags: [],
        messages: [],
        messageCount: 0
      };

      // Store session metadata
      await this.redis.setex(
        `session:${sessionId}`,
        SESSION_TTL,
        JSON.stringify(session)
      );

      // Add to user's session list
      await this.redis.lpush(`sessions:${userId}`, sessionId);
      await this.redis.expire(`sessions:${userId}`, SESSION_TTL);

      logger.info(`[Session] Created: ${sessionId} for user ${userId}`);
      return session;
    } catch (err) {
      logger.error('[Session] Create failed:', err.message);
      throw err;
    }
  }

  /**
   * Get all sessions for a user
   */
  async getSessions(userId) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const sessionIds = await this.redis.lrange(`sessions:${userId}`, 0, -1);
      const sessions = [];

      for (const id of sessionIds) {
        const data = await this.redis.get(`session:${id}`);
        if (data) {
          sessions.push(JSON.parse(data));
        }
      }

      return sessions.sort((a, b) => new Date(b.created) - new Date(a.created));
    } catch (err) {
      logger.warn('[Session] Get list failed:', err.message);
      return [];
    }
  }

  /**
   * Get a specific session with message history
   */
  async getSession(sessionId) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const data = await this.redis.get(`session:${sessionId}`);
      if (!data) return null;

      const session = JSON.parse(data);
      
      // Get message count and recent messages for preview
      const messageCount = await this.redis.llen(`session:${sessionId}:messages`);
      session.messageCount = messageCount;

      return session;
    } catch (err) {
      logger.warn('[Session] Get failed:', err.message);
      return null;
    }
  }

  /**
   * Add a message to a session
   */
  async addMessage(sessionId, message) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const msg = {
        id: uuid(),
        type: message.type, // 'user', 'assistant', 'error'
        text: message.text,
        ts: new Date().toISOString(),
        sources: message.sources || [],
        fromCache: message.fromCache || false,
        relevantChunks: message.relevantChunks || 0,
        jobId: message.jobId || null
      };

      // Add to message list
      await this.redis.rpush(`session:${sessionId}:messages`, JSON.stringify(msg));
      await this.redis.expire(`session:${sessionId}:messages`, SESSION_TTL);

       // Update session metadata
       const session = await this.redis.get(`session:${sessionId}`);
       if (session) {
         const parsed = JSON.parse(session);
         parsed.messageCount = (parsed.messageCount || 0) + 1;
         parsed.lastMessageAt = msg.ts;
         parsed.modified = new Date().toISOString();
         await this.redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(parsed));
       }

      return msg;
    } catch (err) {
      logger.error('[Session] Add message failed:', err.message);
      throw err;
    }
  }

  /**
   * Get messages for a session (paginated)
   */
  async getMessages(sessionId, start = 0, end = -1) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const rawMessages = await this.redis.lrange(`session:${sessionId}:messages`, start, end);
      return rawMessages.map(msg => JSON.parse(msg));
    } catch (err) {
      logger.warn('[Session] Get messages failed:', err.message);
      return [];
    }
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId, title) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const data = await this.redis.get(`session:${sessionId}`);
      if (data) {
        const session = JSON.parse(data);
        session.title = title;
        session.modified = new Date().toISOString();
        await this.redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(session));
      }
      return true;
    } catch (err) {
      logger.error('[Session] Update title failed:', err.message);
      throw err;
    }
  }

  /**
   * Update session tags
   */
  async updateSessionTags(sessionId, tags = []) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      const data = await this.redis.get(`session:${sessionId}`);
      if (data) {
        const session = JSON.parse(data);
        session.tags = tags || [];
        session.modified = new Date().toISOString();
        await this.redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(session));
        logger.info(`[Session] Updated tags for session ${sessionId}: [${tags.join(', ')}]`);
      }
      return true;
    } catch (err) {
      logger.error('[Session] Update tags failed:', err.message);
      throw err;
    }
  }

  /**
   * Delete a session and its messages
   */
  async deleteSession(userId, sessionId) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      await this.redis.del(`session:${sessionId}`);
      await this.redis.del(`session:${sessionId}:messages`);
      await this.redis.lrem(`sessions:${userId}`, 1, sessionId);

      logger.info(`[Session] Deleted: ${sessionId}`);
      return true;
    } catch (err) {
      logger.error('[Session] Delete failed:', err.message);
      throw err;
    }
  }

  /**
   * Clear all messages from a session
   */
  async clearSession(sessionId) {
    try {
      if (!this.redis) throw new Error('Redis not available');

      await this.redis.del(`session:${sessionId}:messages`);
      
      const data = await this.redis.get(`session:${sessionId}`);
      if (data) {
        const session = JSON.parse(data);
        session.messageCount = 0;
        session.modified = new Date().toISOString();
        await this.redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(session));
      }

      return true;
    } catch (err) {
      logger.error('[Session] Clear failed:', err.message);
      throw err;
    }
  }
}

module.exports = new SessionService();
