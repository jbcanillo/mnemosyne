import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { HeartPulse, Globe, Database, Zap, Clock, FolderOpen, Search, RefreshCw, Trash2, Download, Upload, Shield, FileText, Activity, Terminal } from 'lucide-react';
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
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backups,      setBackups]      = useState([]);
  const [backupProgress, setBackupProgress] = useState(null);
  const [restoring,    setRestoring]    = useState(false);
  const [logs,         setLogs]         = useState([]);
  const [logsLoading,  setLogsLoading]  = useState(false);
  const [logsError,    setLogsError]    = useState(null);

  const loadAll = useCallback(async () => {
    setDiagLoading(true);
    try {
      const [d, u] = await Promise.all([
        ragApi.getDiagnostics(),
        ragApi.getUsage()
      ]);
      setDiagnostics(d);
      setUsage(u);
      // Auto-load backups
      try {
        const r = await ragApi.listBackups();
        setBackups(r.backups || []);
      } catch (_) { /* backups optional */ }
    } catch (err) {
      toast.error('Failed to load status: ' + err.message);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); loadLogs(); }, [loadAll]);

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

  async function loadBackups() {
    setBackupsLoading(true);
    try {
      const r = await ragApi.listBackups();
      setBackups(r.backups || []);
    } catch (err) {
      toast.error('Failed to load backups: ' + err.message);
    } finally {
      setBackupsLoading(false);
    }
  }

  async function createBackup() {
    if (!window.confirm('Create a backup of knowledge base and config?')) return;
    setBackupProgress('Starting...');
    try {
      const r = await ragApi.createBackup();
      toast.success(`Backup created: ${r.filename} (${r.size} MB)`);
      await loadBackups();
      setBackupProgress(null);
    } catch (err) {
      toast.error('Backup failed: ' + err.message);
      setBackupProgress(null);
    }
  }

  async function restoreBackup(filename) {
    if (!window.confirm(`Restore from ${filename}? This will replace your current knowledge base!`)) return;
    setRestoring(true);
    try {
      await ragApi.restoreBackup(filename);
      toast.success('Restore complete! System restarting...');
      setTimeout(() => window.location.reload(), 3000);
    } catch (err) {
      toast.error('Restore failed: ' + err.message);
      setRestoring(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const r = await ragApi.getLogs(200);
      if (r && r.logs && Array.isArray(r.logs)) {
        setLogs(r.logs);
      } else {
        setLogs([]);
      }
    } catch (err) {
      setLogsError(err.message);
    } finally {
      setLogsLoading(false);
    }
  }

  const q      = info?.queue?.queryQueue;
  const vs     = info?.vectorStore;
  const cache  = info?.cache;
  const or     = diagnostics?.openrouter;
  const ollama = diagnostics?.ollama;
  const tu     = usage?.tokenUsage;
  const model  = usage?.currentModel || info?.models?.llm || '—';

  // Cost estimate: ~$0.0005 per 1K tokens (rough average for free models)
  const estimatedCost = tu ? ((tu.totalTokens / 1000) * 0.0005).toFixed(4) : '0.0000';

  return (
    <div className="status-panel">
      <div className="sp-header">
        <div className="sp-header-actions">
          <button className="btn btn-ghost btn-xs" onClick={runHealthcheck} disabled={hcLoading}>
            {hcLoading ? <span className="spinner-xs" /> : <HeartPulse size={12} />} Healthcheck
          </button>
          <button className="btn btn-ghost btn-xs">
            <a href="http://localhost:3001/docs" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer">
              <FolderOpen size={12} /> API Docs
            </a>
          </button>
          <button className="btn btn-ghost btn-xs" onClick={loadAll} disabled={diagLoading}>
            {diagLoading ? <span className="spinner-xs" /> : <RefreshCw size={12} />} Refresh
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
        <StatusCard title="Server"       status={serverOnline ? 'online' : 'offline'} icon={<Activity size={15} />} detail={serverOnline ? 'Healthy' : 'Unreachable'} />
        <StatusCard title="OpenRouter"   status={diagLoading ? 'loading' : or?.status === 'ok' ? 'online' : 'offline'} icon={<Globe size={15} />}
          detail={diagLoading ? 'Checking…' : or?.status === 'ok' ? 'Connected' : or?.error ?? 'Not connected'} />
        <StatusCard title="Vector Store" status={vs && !vs.error ? 'online' : 'offline'} icon={<Database size={15} />} detail={`${vs?.totalChunks ?? 0} chunks indexed`} />
        <StatusCard title="Cache"        status={cache ? 'online' : 'unknown'} icon={<Zap size={15} />} detail={cache ? `${cache.entries} entries · ${cache.ttl}s TTL` : 'Unavailable'} />
        <StatusCard title="Queue"        status={q ? 'online' : 'unknown'} icon={<Clock size={15} />} detail={q ? `${q.waiting}w · ${q.active}a · ${q.completed} done` : 'Unavailable'} />
      </div>

      {/* ── Active Model Card ── */}
      <div className="sp-section model-info-section">
        <div className="sp-section-header">
          <div className="sp-section-title">
            <span className="sp-section-icon"><HeartPulse size={14} /></span>
            Active Language Model
          </div>
          {tu && (
            <button className="btn btn-ghost btn-xs" onClick={resetUsage} disabled={resettingUsage}>
              {resettingUsage ? <span className="spinner-xs" /> : <RefreshCw size={12} />} Reset Stats
            </button>
          )}
        </div>

        <div className="model-info-grid">
          {/* Model identity */}
          <div className="mi-card mi-card-main">
            <div className="mi-label">LLM</div>
            <div className="mi-model-name">{model}</div>
            <div className="mi-sub">via OpenRouter · {or?.status === 'ok' ? 'Connected' : 'Disconnected'}</div>
            <div className="mi-divider" />
            <div className="mi-label">Embedding</div>
            <div className="mi-embed-name">nomic-embed-text</div>
            <div className="mi-sub">Local · Ollama · {ollama?.status === 'ok' ? 'Connected' : 'Disconnected'}</div>
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

      {/* ── Queue metrics ── */}
      {q && (
        <div className="sp-section">
          <div className="sp-section-title"><span className="sp-section-icon"><Clock size={14} /></span>Queue Metrics</div>
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
        <div className="sp-section-title"><span className="sp-section-icon"><Search size={14} /></span>Similarity Debug</div>
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
                    <span className="dc-file"><FileText size={12} /> {c.filename}</span>
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

      {/* ── Live Log Viewer ── */}
      <div className="sp-section">
        <div className="sp-section-header">
          <div className="sp-section-title"><span className="sp-section-icon"><Terminal size={14} /></span>Live Log Viewer</div>
          <button className="btn btn-ghost btn-xs" onClick={loadLogs} disabled={logsLoading}>
            {logsLoading ? <span className="spinner-xs" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>
        <div className="log-viewer">
          {logsLoading ? (
            <div className="log-empty">Loading logs…</div>
          ) : logsError ? (
            <div className="log-error">Error loading logs: {logsError}</div>
          ) : logs.length === 0 ? (
            <div className="log-empty">No logs available. View server logs with: <code>docker logs mnemosyne-rag-server</code></div>
          ) : (
            <div className="log-entries">
              {logs.map((log, i) => (
                <div key={i} className={`log-entry log-${log.level || 'info'}`}>
                  <span className="log-time">{log.timestamp || ''}</span>
                  <span className="log-level">{(log.level || 'info').toUpperCase()}</span>
                  <span className="log-message">{log.message || log}</span>
                </div>
              ))}
            </div>
          )}
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
