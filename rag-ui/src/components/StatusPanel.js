import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ragApi } from '../api';
import './StatusPanel.css';

export default function StatusPanel({ info, serverOnline, onRefresh }) {
  const [clearing,     setClearing]     = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [diagLoading,  setDiagLoading]  = useState(false);
  const [diagnostics,  setDiagnostics]  = useState(null);
  const [usage,        setUsage]        = useState(null);
  const [healthcheck,  setHealthcheck]  = useState(null);
  const [hcLoading,    setHcLoading]    = useState(false);
  const [resettingUsage, setResettingUsage] = useState(false);
  const [debugQ,       setDebugQ]       = useState('');
  const [debugResult,  setDebugResult]  = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setDiagLoading(true);
    try {
      const [d, u] = await Promise.all([
        ragApi.getDiagnostics(),
        ragApi.getUsage()
      ]);
      setDiagnostics(d);
      setUsage(u);
    } catch (err) {
      toast.error('Failed to load status: ' + err.message);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function runHealthcheck() {
    setHcLoading(true);
    setHealthcheck(null);
    try {
      const r = await ragApi.healthcheck();
      setHealthcheck(r);
    } catch (err) {
      toast.error('Healthcheck failed: ' + err.message);
    } finally {
      setHcLoading(false);
    }
  }

  async function clearCache() {
    setClearing(true);
    try { const r = await ragApi.clearCache(); toast.success(r.message || 'Cache cleared'); onRefresh?.(); }
    catch (err) { toast.error('Failed: ' + err.message); }
    finally { setClearing(false); }
  }

  async function resetVectorStore() {
    if (!window.confirm('Delete ALL indexed chunks? You will need to re-upload documents.')) return;
    setResetting(true);
    try { await ragApi.resetVectorStore(); toast.success('Vector store reset'); onRefresh?.(); }
    catch (err) { toast.error('Reset failed: ' + err.message); }
    finally { setResetting(false); }
  }

  async function resetUsage() {
    setResettingUsage(true);
    try { await ragApi.resetUsage(); toast.success('Usage stats reset'); await loadAll(); }
    catch (err) { toast.error('Reset failed: ' + err.message); }
    finally { setResettingUsage(false); }
  }

  async function runDebug(e) {
    e.preventDefault();
    if (!debugQ.trim()) return;
    setDebugLoading(true); setDebugResult(null);
    try { const r = await ragApi.debugQuery(debugQ.trim()); setDebugResult(r); }
    catch (err) { toast.error('Debug failed: ' + err.message); }
    finally { setDebugLoading(false); }
  }

  const q      = info?.queue?.queryQueue;
  const vs     = info?.vectorStore;
  const cache  = info?.cache;
  const or     = diagnostics?.openrouter;
  const ollama = diagnostics?.ollama;
  const tu     = usage?.tokenUsage;
  const model  = usage?.currentModel || info?.models?.llm || '—';
  const embedModel = usage?.embeddingModel || 'nomic-embed-text';

  // Cost estimate: ~$0.0005 per 1K tokens (rough average for free models)
  const estimatedCost = tu ? ((tu.totalTokens / 1000) * 0.0005).toFixed(4) : '0.0000';

  return (
    <div className="status-panel">
      <div className="sp-header">
        <div className="panel-title">System Status</div>
        <div className="sp-header-actions">
          <button className="btn btn-ghost btn-xs" onClick={runHealthcheck} disabled={hcLoading}>
            {hcLoading ? <span className="spinner-xs" /> : '🩺'} Healthcheck
          </button>
          <button className="btn btn-ghost btn-xs" onClick={loadAll} disabled={diagLoading}>
            {diagLoading ? <span className="spinner-xs" /> : '↻'} Refresh
          </button>
        </div>
      </div>

      {/* ── Healthcheck result (shown only after running) ── */}
      {healthcheck && (
        <div className={`hc-banner ${healthcheck.status === 'healthy' ? 'hc-ok' : 'hc-warn'}`}>
          <div className="hc-banner-title">
            <span>{healthcheck.status === 'healthy' ? '✓' : '⚠'}</span>
            System {healthcheck.status === 'healthy' ? 'Healthy' : 'Degraded'}
            <span className="hc-ts">{new Date(healthcheck.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="hc-checks">
            {Object.entries(healthcheck.checks || {}).map(([name, check]) => (
              <div key={name} className={`hc-check ${check.ok ? 'hc-check-ok' : 'hc-check-fail'}`}>
                <span className="hc-check-dot">{check.ok ? '●' : '○'}</span>
                <span className="hc-check-name">{name}</span>
                {!check.ok && <span className="hc-check-err">{check.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Service health cards ── */}
      <div className="status-grid">
        <StatusCard title="Server"       status={serverOnline ? 'online' : 'offline'} icon="⚙" detail={serverOnline ? 'Healthy' : 'Unreachable'} />
        <StatusCard title="OpenRouter"   status={diagLoading ? 'loading' : or?.status === 'ok' ? 'online' : 'offline'} icon="🌐"
          detail={diagLoading ? 'Checking…' : or?.status === 'ok' ? 'Connected' : or?.error ?? 'Not connected'} />
        <StatusCard title="Embeddings"   status={diagLoading ? 'loading' : ollama?.status === 'ok' ? 'online' : 'offline'} icon="🧠"
          detail={diagLoading ? 'Checking…' : ollama?.embedModelReady ? 'nomic-embed-text ✓' : 'Model not loaded'} />
        <StatusCard title="Vector Store" status={vs && !vs.error ? 'online' : 'offline'} icon="🗄" detail={`${vs?.totalChunks ?? 0} chunks indexed`} />
        <StatusCard title="Cache"        status={cache ? 'online' : 'unknown'} icon="⚡" detail={cache ? `${cache.entries} entries · ${cache.ttl}s TTL` : 'Unavailable'} />
        <StatusCard title="Queue"        status={q ? 'online' : 'unknown'} icon="⏱" detail={q ? `${q.waiting}w · ${q.active}a · ${q.completed}✓` : 'Unavailable'} />
      </div>

      {/* ── Active Model Card ── */}
      <div className="sp-section model-info-section">
        <div className="sp-section-header">
          <div className="sp-section-title">
            <span className="sp-section-icon">🤖</span>
            Active Language Model
          </div>
          {tu && (
            <button className="btn btn-ghost btn-xs" onClick={resetUsage} disabled={resettingUsage}>
              {resettingUsage ? <span className="spinner-xs" /> : '↺'} Reset Stats
            </button>
          )}
        </div>

        <div className="model-info-grid">
          {/* Model identity */}
          <div className="mi-card mi-card-main">
            <div className="mi-label">LLM</div>
            <div className="mi-model-name">{model}</div>
            {model.includes(':free') && <span className="mi-free-badge">FREE TIER</span>}
            <div className="mi-sub">via OpenRouter · {or?.status === 'ok' ? '🟢 Connected' : '🔴 Disconnected'}</div>
            <div className="mi-divider" />
            <div className="mi-label">Embedding</div>
            <div className="mi-embed-name">{embedModel}</div>
            <div className="mi-sub">Local · Ollama · {ollama?.embedModelReady ? '🟢 Ready' : '🔴 Not loaded'}</div>
          </div>

          {/* Token consumption */}
          <div className="mi-card">
            <div className="mi-label">Session Token Usage</div>
            <div className="mi-stat-row">
              <div className="mi-stat">
                <div className="mi-stat-val">{(tu?.totalTokens ?? 0).toLocaleString()}</div>
                <div className="mi-stat-label">Total Tokens</div>
              </div>
              <div className="mi-stat">
                <div className="mi-stat-val">{(tu?.totalPromptTokens ?? 0).toLocaleString()}</div>
                <div className="mi-stat-label">Prompt</div>
              </div>
              <div className="mi-stat">
                <div className="mi-stat-val">{(tu?.totalCompletionTokens ?? 0).toLocaleString()}</div>
                <div className="mi-stat-label">Completion</div>
              </div>
            </div>
            <div className="mi-divider" />
            <div className="mi-stat-row">
              <div className="mi-stat">
                <div className="mi-stat-val">{tu?.queryCount ?? 0}</div>
                <div className="mi-stat-label">Queries</div>
              </div>
              <div className="mi-stat">
                <div className="mi-stat-val accent-warn">${estimatedCost}</div>
                <div className="mi-stat-label">Est. Cost</div>
              </div>
              <div className="mi-stat">
                <div className="mi-stat-val">
                  {tu?.queryCount ? Math.round(tu.totalTokens / tu.queryCount) : 0}
                </div>
                <div className="mi-stat-label">Avg / Query</div>
              </div>
            </div>
            {tu?.sessionStart && (
              <div className="mi-since">Since {new Date(tu.sessionStart).toLocaleString()}</div>
            )}
          </div>

          {/* Per-model breakdown */}
          {tu?.byModel && Object.keys(tu.byModel).length > 0 && (
            <div className="mi-card mi-card-full">
              <div className="mi-label">Usage by Model</div>
              <div className="mi-model-table">
                <div className="mi-model-table-head">
                  <span>Model</span><span>Queries</span><span>Tokens</span><span>Prompt</span><span>Completion</span>
                </div>
                {Object.entries(tu.byModel).map(([mid, stats]) => (
                  <div key={mid} className="mi-model-row">
                    <span className="mi-model-id">{mid.split('/').pop()}</span>
                    <span>{stats.queries}</span>
                    <span>{stats.total.toLocaleString()}</span>
                    <span>{stats.prompt.toLocaleString()}</span>
                    <span>{stats.completion.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Embedding model info ── */}
      <div className="sp-section">
        <div className="sp-section-title">
          <span className="sp-section-icon">🧠</span>
          Embedding Model
          <span className="sp-local-tag">LOCAL · OLLAMA</span>
        </div>
        <div className="embed-info">
          <div className="embed-row">
            <span className="embed-label">Model</span>
            <span className="embed-value">nomic-embed-text</span>
            <span className={`embed-status ${ollama?.embedModelReady ? 'es-ok' : 'es-err'}`}>
              {ollama?.embedModelReady ? '● Ready' : '● Not loaded'}
            </span>
          </div>
          <div className="embed-row">
            <span className="embed-label">Host</span>
            <span className="embed-value">{diagnostics?.ollama?.host || 'ollama:11434'}</span>
          </div>
          {ollama?.models?.length > 0 && (
            <div className="embed-row">
              <span className="embed-label">Loaded</span>
              <span className="embed-value">{ollama.models.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Queue metrics ── */}
      {q && (
        <div className="sp-section">
          <div className="sp-section-title"><span className="sp-section-icon">⏱</span>Queue Metrics</div>
          <div className="metrics-row">
            <Metric label="Waiting"   value={q.waiting}   color="warn" />
            <Metric label="Active"    value={q.active}    color="accent2" />
            <Metric label="Completed" value={q.completed} color="success" />
            <Metric label="Failed"    value={q.failed}    color="danger" />
          </div>
        </div>
      )}

      {/* ── Similarity debug ── */}
      <div className="sp-section">
        <div className="sp-section-title"><span className="sp-section-icon">🔍</span>Similarity Debug</div>
        <div className="debug-desc">
          Test any query to see raw similarity scores. Scores below <code>{info?.minRelevanceScore ?? '0.15'}</code> are filtered out.
        </div>
        <form className="debug-form" onSubmit={runDebug}>
          <input className="debug-input" value={debugQ} onChange={e => setDebugQ(e.target.value)} placeholder="Enter a test query…" />
          <button className="btn btn-primary btn-xs" type="submit" disabled={debugLoading || !debugQ.trim()}>
            {debugLoading ? <span className="spinner-xs" /> : 'Run'}
          </button>
        </form>
        {debugResult && (
          <div className="debug-result">
            <div className="debug-meta">
              <span>{debugResult.totalChunksReturned} chunks · threshold {debugResult.currentThreshold}</span>
              {debugResult.recommendation && <span className="debug-rec-inline">💡 {debugResult.recommendation}</span>}
            </div>
            <div className="debug-chunks">
              {debugResult.chunks?.map((c, i) => (
                <div key={i} className={`debug-chunk ${c.relevanceScore >= (debugResult.currentThreshold ?? 0.15) ? 'dc-pass' : 'dc-fail'}`}>
                  <div className="dc-header">
                    <span className="dc-file">📄 {c.filename}</span>
                    <span className="dc-chunk">chunk {c.chunkIndex}</span>
                    <span className="dc-score">{c.relevanceScore.toFixed(4)} {c.relevanceScore >= (debugResult.currentThreshold ?? 0.15) ? '✓' : '✗'}</span>
                  </div>
                  <div className="dc-preview">{c.preview}</div>
                </div>
              ))}
              {!debugResult.chunks?.length && <div className="debug-empty">No chunks found. Upload documents first.</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Data management ── */}
      <div className="sp-section">
        <div className="sp-section-title"><span className="sp-section-icon">🗂</span>Data Management</div>
        <div className="mgmt-grid">
          <div className="mgmt-card">
            <div className="mgmt-card-title">Query Cache</div>
            <div className="mgmt-card-detail">{cache?.entries ?? 0} cached results · {cache?.backend ?? '—'} · TTL {cache?.ttl ?? '—'}s</div>
            <button className="btn btn-ghost btn-xs" onClick={clearCache} disabled={clearing}>{clearing ? 'Clearing…' : '🗑 Clear Cache'}</button>
          </div>
          <div className="mgmt-card">
            <div className="mgmt-card-title">Vector Store</div>
            <div className="mgmt-card-detail">{vs?.totalChunks ?? 0} chunks · {vs?.collection ?? 'sofia_rag_knowledge'}</div>
            <button className="btn btn-danger btn-xs" onClick={resetVectorStore} disabled={resetting}>{resetting ? 'Resetting…' : '⚠ Reset Collection'}</button>
          </div>
        </div>
      </div>

      {/* ── API Documentation ── */}
      <div className="sp-section sp-section-docs">
        <div className="sp-section-header">
          <div className="sp-section-title"><span className="sp-section-icon">📡</span>API Documentation</div>
          <a href="http://localhost:3001/docs" target="_blank" rel="noreferrer" className="btn btn-primary btn-xs">
            Open Swagger UI ↗
          </a>
        </div>
        <div className="auth-note">
          All endpoints require auth except <code>/health</code> and <code>POST /api/auth/login</code>.<br />
          <code>X-API-Key: &lt;RAG_API_KEY&gt;</code> for bots &nbsp;·&nbsp; <code>X-Session-Token: &lt;token&gt;</code> for UI
        </div>
        <div className="api-table">
          {[
            ['POST',   '/api/auth/login',              'Login — get session token'],
            ['POST',   '/api/query',                   'Sync RAG query (API Key or Session)'],
            ['GET',    '/api/query/debug?q=…',         'Raw similarity scores — no LLM'],
            ['GET',    '/api/query/test',              'Step-by-step pipeline test'],
            ['POST',   '/api/documents/upload',        'Upload document to knowledge base'],
            ['GET',    '/api/documents',               'List indexed documents'],
            ['DELETE', '/api/documents/:id',           'Remove a document'],
            ['GET',    '/api/models',                  'List available models'],
            ['POST',   '/api/models/switch',           'Switch LLM live (no restart)'],
            ['GET',    '/api/usage',                   'Token usage & model stats'],
            ['DELETE', '/api/usage',                   'Reset token usage stats'],
            ['GET',    '/api/healthcheck',             'Full system healthcheck'],
            ['GET',    '/api/settings',                'Get current configuration'],
            ['PUT',    '/api/settings',                'Update settings (key, model, tuning)'],
            ['POST',   '/api/settings/test-key',       'Test OpenRouter API key'],
            ['GET',    '/api/diagnostics',             'Deep connectivity check'],
            ['DELETE', '/api/cache',                   'Clear query cache'],
            ['POST',   '/api/vector-store/reset',      'Wipe vector store collection'],
            ['GET',    '/health',                      'Public health check (no auth)'],
          ].map(([method, path, desc]) => (
            <div key={path + method} className="api-row">
              <span className={`method method-${method.toLowerCase()}`}>{method}</span>
              <code className="api-path">{path}</code>
              <span className="api-desc">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusCard({ title, status, detail, icon }) {
  return (
    <div className={`sc sc-${status}`}>
      <div className="sc-header">
        <span className="sc-icon">{icon}</span>
        <span className="sc-title">{title}</span>
        <span className={`sc-pill pill-${status}`}>{status === 'loading' ? '…' : status}</span>
      </div>
      <div className="sc-detail">{detail}</div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div className="metric-box">
      <div className={`metric-value metric-${color}`}>{value ?? 0}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
