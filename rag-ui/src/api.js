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
  uploadDocument: (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total))
    });
  },

  listDocuments:    () => api.get('/documents'),
  getIngestStatus:  (jobId) => api.get(`/documents/ingest-status/${jobId}`),
  deleteDocument:   (id) => api.delete(`/documents/${id}`),
  getDocumentStats: () => api.get('/documents/stats'),

  // ── Admin ────────────────────────────────────────────────────────
  getInfo:        () => api.get('/info'),
  getDiagnostics: () => api.get('/diagnostics'),
  getModels:      () => api.get('/models'),
  switchModel:    (modelId) => api.post('/models/switch', { modelId }),
  clearCache:     () => api.delete('/cache'),
  resetVectorStore: () => api.post('/vector-store/reset'),

  // Settings
  getSettings:    () => api.get('/settings'),
  updateSettings: (data) => api.put('/settings', data),
  testApiKey:     () => api.post('/settings/test-key'),
  debugQuery:     (q) => api.get(`/query/debug?q=${encodeURIComponent(q)}`),
  health:         () => axios.get(`${BASE_URL.replace('/api', '')}/health`).then(r => r.data),
};

export default ragApi;
