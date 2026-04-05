import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
});

// ── Request interceptor ───────────────────────────────────────────────
// Automatically attach session token to every request if available
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('rag_token');
  if (token) {
    config.headers['X-Session-Token'] = token;
  }
  return config;
});

// ── Response interceptor ─────────────────────────────────────────────
// Normalise errors; redirect to login on 401
api.interceptors.response.use(
  res => res.data,
  err => {
    const status = err.response?.status;
    const msg    = err.response?.data?.error || err.response?.data?.message || err.message || 'Request failed';

    // Session expired or invalid — clear storage so App re-renders to login screen
    if (status === 401) {
      sessionStorage.removeItem('rag_token');
      sessionStorage.removeItem('rag_user');
      // Dispatch a custom event so AuthContext can react without a hard refresh
      window.dispatchEvent(new CustomEvent('rag:unauthorized'));
    }

    return Promise.reject(new Error(msg));
  }
);

export const ragApi = {
  // ── Auth ──────────────────────────────────────────────────────────
  login: (username, password) =>
    api.post('/auth/login', { username, password }),

  logout: (token) =>
    api.post('/auth/logout', {}, {
      headers: token ? { 'X-Session-Token': token } : {}
    }),

  verifySession: (token) =>
    api.get('/auth/verify', {
      headers: { 'X-Session-Token': token }
    }),

  // ── Query ─────────────────────────────────────────────────────────
  query: (query, options = {}) =>
    api.post('/query', { query, options }),

  queryAsync: (query, options = {}) =>
    api.post('/query', { query, async: true, options }),

  getJobStatus: (jobId) =>
    api.get(`/query/status/${jobId}`),

  // ── Documents ────────────────────────────────────────────────────
  uploadDocument: (file, tags = [], onProgress) => {
    const form = new FormData();
    form.append('file', file);
    if (tags.length > 0) {
      form.append('tags', tags.join(','));
    }
    return api.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total))
    });
  },

  listDocuments:    (tags = null) => {
    const params = tags && tags.length > 0 ? `?tags=${encodeURIComponent(tags.join(','))}` : '';
    return api.get(`/documents${params}`);
  },
  getTags:          () => api.get('/documents/tags'),
  updateDocumentTags: (id, tags) => api.put(`/documents/${id}/tags`, { tags }),
  getIngestStatus:  (jobId) => api.get(`/documents/ingest-status/${jobId}`),
  deleteDocument:   (id) => api.delete(`/documents/${id}`),
  getDocumentStats: () => api.get('/documents/stats'),

  // ── Admin ────────────────────────────────────────────────────────
  getInfo:        () => api.get('/info'),
  getDiagnostics: () => api.get('/diagnostics'),
  getModels:      () => api.get('/models'),
  switchModel:    (modelId) => api.post('/models/switch', { modelId }),
  addModel:       (id, name) => api.post('/models', { id, name }),
  deleteModel:    (modelId) => api.delete(`/models/${modelId}`),
  resetModels:    () => api.post('/models/reset'),
  clearCache:     () => api.delete('/cache'),
  resetVectorStore: () => api.post('/vector-store/reset'),

  // Usage & healthcheck
  getUsage:       () => api.get('/usage'),
  resetUsage:     () => api.delete('/usage'),
  healthcheck:    () => api.get('/healthcheck'),
  getLogs:        (lines = 200) => api.get(`/logs?lines=${lines}`),

  // Settings
  getSettings:    () => api.get('/settings'),
  updateSettings: (data) => api.put('/settings', data),
  testApiKey:     () => api.post('/settings/test-key'),
  debugQuery:     (q) => api.get(`/query/debug?q=${encodeURIComponent(q)}`),
  health:         () => axios.get(`${BASE_URL.replace('/api', '')}/health`).then(r => r.data),

  // ── Backup & Restore ───────────────────────────────────────────
  createBackup:   () => api.post('/backup/create'),
  listBackups:    () => api.get('/backup/list'),
  restoreBackup:  (filename) => api.post('/backup/restore', { filename }),
  deleteBackup:   (filename) => api.delete(`/backup/${encodeURIComponent(filename)}`),

  // ── Sessions / Conversations ───────────────────────────────────
  createSession:  (title) => api.post('/sessions', { title }),
  getSessions:    () => api.get('/sessions'),
  getSession:     (sessionId, limit = 50, offset = 0) => 
    api.get(`/sessions/${sessionId}?limit=${limit}&offset=${offset}`),
  addMessage:     (sessionId, message) => api.post(`/sessions/${sessionId}/messages`, message),
  updateSession:  (sessionId, data) => api.put(`/sessions/${sessionId}`, data),
  deleteSession:  (sessionId) => api.delete(`/sessions/${sessionId}`),
  clearSession:   (sessionId) => api.post(`/sessions/${sessionId}/clear`),

  // ── Analytics ────────────────────────────────────────────────────────
  getAnalyticsOverview: () => api.get('/analytics/overview'),
  getAnalyticsTags:   () => api.get('/analytics/tags'),
  getAnalyticsSessions: () => api.get('/analytics/sessions'),
  getAnalyticsUsage:  () => api.get('/analytics/usage'),
};

export default ragApi;
