import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ragApi } from '../api';
import './StatusPanel.css';

const KNOWN_FREE_MODELS = [
  { id: 'stepfun/step-3.5-flash:free',             name: 'Step-3.5 Flash',     note: 'Fast · Free',        tag: 'stepfun' },
  { id: 'microsoft/phi-3-mini-128k-instruct:free',  name: 'Phi-3 Mini',         note: '128k context',       tag: 'microsoft' },
  { id: 'meta-llama/llama-3.1-8b-instruct:free',    name: 'Llama 3.1 8B',       note: 'Most capable free',  tag: 'meta' },
  { id: 'mistralai/mistral-7b-instruct:free',       name: 'Mistral 7B',         note: 'Fast & balanced',    tag: 'mistralai' },
  { id: 'google/gemma-2-9b-it:free',                name: 'Gemma 2 9B',         note: 'Google',             tag: 'google' },
  { id: 'qwen/qwen-2-7b-instruct:free',             name: 'Qwen 2 7B',          note: 'Multilingual',       tag: 'qwen' },
  { id: 'nousresearch/hermes-3-llama-3.1-8b:free',  name: 'Hermes 3',           note: 'Strong reasoning',   tag: 'nous' },
];

export default function StatusPanel({ info, serverOnline, onRefresh }) {
  const [clearing,    setClearing]    = useState(false);
  const [resetting,   setResetting]   = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [models,      setModels]      = useState(null);
  const [switching,   setSwitching]   = useState(null); // modelId being switched to
  const [debugQ,      setDebugQ]      = useState('');
  const [debugResult, setDebugResult] = useState(null);
  const [debugLoading,setDebugLoading]= useState(false);

  const loadAll = useCallback(async () => {
    setDiagLoading(true);
    try {
      const [d, m] = await Promise.all([
        ragApi.getDiagnostics(),
        ragApi.getModels()
      ]);
      setDiagnostics(d);
      setModels(m);
    } catch (err) {
      toast.error('Failed to load status: ' + err.message);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  async function handleSwitch(modelId) {
    if (modelId === models?.current) return;
    setSwitching(modelId);
    try {
      await ragApi.switchModel(modelId);
      toast.success(`Switched to ${modelId.split('/').pop()}`);
      setModels(m => ({ ...m, current: modelId }));
      // Refresh diagnostics to reflect new active model
      const d = await ragApi.getDiagnostics();
      setDiagnostics(d);
    } catch (err) {
      toast.error('Switch failed: ' + err.message);
    } finally {
      setSwitching(null);
    }
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
  const current = models?.current || info?.models?.llm || '';

  // Merge known models with live OpenRouter list
  const liveModels = models?.models || [];
  const mergedModels = KNOWN_FREE_MODELS.map(km => ({
    ...km,
    ...(liveModels.find(lm => lm.id === km.id) || {}),
    available: liveModels.length === 0 || liveModels.some(lm => lm.id === km.id)
  }));

  return (
    <div className="status-panel">
      <div className="sp-header">
        <div className="panel-title">System Status</div>
        <button className="btn btn-ghost btn-xs" onClick={loadAll} disabled={diagLoading}>
          {diagLoading ? <span className="spinner-xs" /> : '↻'} Refresh
        </button>
      </div>

      {/* ── Service health row ── */}
      <div className="status-grid">
        <StatusCard title="Server"       status={serverOnline ? 'online' : 'offline'} icon="⚙" detail={serverOnline ? 'Healthy' : 'Unreachable'} />
        <StatusCard title="OpenRouter"   status={diagLoading ? 'loading' : or?.status === 'ok' ? 'online' : 'offline'} icon="🌐" detail={diagLoading ? 'Checking…' : or?.status === 'ok' ? `${or.availableModels ?? '?'} models available` : or?.error ?? 'Not connected'} />
        <StatusCard title="Embeddings"   status={diagLoading ? 'loading' : ollama?.status === 'ok' ? 'online' : 'offline'} icon="🧠" detail={diagLoading ? 'Checking…' : ollama?.status === 'ok' ? `nomic-embed-text ${ollama.embedModelReady ? '✓' : '✗'}` : ollama?.error ?? 'Not connected'} />
        <StatusCard title="Vector Store" status={vs && !vs.error ? 'online' : 'offline'} icon="🗄" detail={`${vs?.totalChunks ?? 0} chunks indexed`} />
        <StatusCard title="Cache"        status={cache ? 'online' : 'unknown'} icon="⚡" detail={cache ? `${cache.entries} entries · ${cache.ttl}s TTL` : 'Unavailable'} />
        <StatusCard title="Queue"        status={q ? 'online' : 'unknown'} icon="⏱" detail={q ? `${q.waiting}w · ${q.active}a · ${q.completed}✓` : 'Unavailable'} />
      </div>

      {/* ── Live LLM Switcher ── */}
      <div className="sp-section">
        <div className="sp-section-header">
          <div className="sp-section-title">
            <span className="sp-section-icon">🤖</span>
            Language Model
            <span className="sp-live-badge">LIVE SWITCH</span>
          </div>
          <div className="sp-current-model">
            <span className="sp-current-label">Active:</span>
            <span className="sp-current-name">{current || '—'}</span>
            {current.includes(':free') && <span className="sp-free-tag">FREE</span>}
          </div>
        </div>

        <div className="model-switcher">
          {mergedModels.map(m => {
            const isActive   = m.id === current;
            const isSwitching = switching === m.id;
            return (
              <button
                key={m.id}
                className={`model-card ${isActive ? 'model-card-active' : ''} ${!m.available ? 'model-card-unavailable' : ''}`}
                onClick={() => handleSwitch(m.id)}
                disabled={isActive || isSwitching || !!switching}
                title={m.id}
              >
                <div className="mc-top">
                  <span className="mc-name">{m.name}</span>
                  {isActive && <span className="mc-active-dot" />}
                  {isSwitching && <span className="mc-spinner" />}
                </div>
                <div className="mc-note">{m.note}</div>
                <div className="mc-id">{m.id.split('/').pop()}</div>
                {isActive && <div className="mc-glow" />}
              </button>
            );
          })}
        </div>

        <div className="model-change-note">
          Click any card to switch the active model instantly — no restart required.
          Changes persist until the server restarts. To make permanent, update <code>OPENROUTER_MODEL</code> in <code>.env</code>.
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
          {ollama?.status === 'ok' && (ollama?.models || []).length > 0 && (
            <div className="embed-row">
              <span className="embed-label">Loaded</span>
              <span className="embed-value">{(ollama.models || []).join(', ')}</span>
            </div>
          )}
          {ollama?.status !== 'ok' && (
            <div className="embed-warn">
              Ollama unreachable. Ensure the container is running:<br />
              <code>docker logs mnemosyne-ollama</code>
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

      {/* ── Query debug ── */}
      <div className="sp-section">
        <div className="sp-section-title"><span className="sp-section-icon">🔍</span>Similarity Debug</div>
        <div className="debug-desc">
          Test any query to see raw similarity scores. If all scores are below <code>{info?.minRelevanceScore ?? '0.15'}</code>, no results are returned.
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

      {/* ── API reference ── */}
      <div className="sp-section">
        <div className="sp-section-title"><span className="sp-section-icon">📡</span>REST API</div>
        <div className="auth-note">
          All endpoints require auth except <code>/health</code> and <code>POST /api/auth/login</code>.<br />
          <code>X-API-Key: &lt;RAG_API_KEY&gt;</code> for bots · <code>X-Session-Token: &lt;token&gt;</code> for UI
        </div>
        <div className="api-table">
          {[
            ['POST',   '/api/auth/login',             'Get session token'],
            ['POST',   '/api/query',                  'Sync RAG query'],
            ['GET',    '/api/query/debug?q=…',        'Raw similarity scores'],
            ['GET',    '/api/models',                 'List available models'],
            ['POST',   '/api/models/switch',          'Switch LLM live'],
            ['POST',   '/api/documents/upload',       'Upload document'],
            ['GET',    '/api/documents',              'List documents'],
            ['GET',    '/api/diagnostics',            'Full health check'],
            ['POST',   '/api/vector-store/reset',     'Wipe collection'],
            ['DELETE', '/api/cache',                  'Clear query cache'],
          ].map(([method, path, desc]) => (
            <div key={path+method} className="api-row">
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
