import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ragApi } from '../api';
import './SettingsPanel.css';

const FREE_MODELS = [
  'stepfun/step-3.5-flash:free',
  'microsoft/phi-3-mini-128k-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-2-9b-it:free',
  'qwen/qwen-2-7b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-8b:free',
];

export default function SettingsPanel({ onRefresh }) {
  const [settings,  setSettings]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [testing,   setTesting]   = useState(false);
  const [testResult,setTestResult]= useState(null);
  const [showKey,   setShowKey]   = useState(false);

  // Form state
  const [apiKey,   setApiKey]   = useState('');
  const [model,    setModel]    = useState('');
  const [minScore, setMinScore] = useState('');
  const [topK,     setTopK]     = useState('');
  const [cacheTtl, setCacheTtl] = useState('');
  const [chunkSize,setChunkSize]= useState('');
  const [chunkOvlp,setChunkOvlp]= useState('');

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await ragApi.getSettings();
      setSettings(s);
      // Don't pre-fill the key — user must type it fresh to change it
      setModel(s.openrouterModel    || '');
      setMinScore(String(s.minRelevanceScore ?? '0.15'));
      setTopK(String(s.topK         ?? '5'));
      setCacheTtl(String(s.cacheTtl ?? '3600'));
      setChunkSize(String(s.chunkSize ?? '500'));
      setChunkOvlp(String(s.chunkOverlap ?? '50'));
    } catch (err) {
      toast.error('Failed to load settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveApiKey(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      const r = await ragApi.updateSettings({ openrouterApiKey: apiKey.trim() });
      setSettings(r.settings);
      setApiKey('');
      toast.success('API key saved');
      onRefresh?.();
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function testKey() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await ragApi.testApiKey();
      setTestResult(r);
      if (r.ok) toast.success(`Key works! Model replied: "${r.reply}"`);
      else      toast.error('Key test failed: ' + r.error);
    } catch (err) {
      toast.error('Test error: ' + err.message);
    } finally {
      setTesting(false);
    }
  }

  async function saveModelSettings(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await ragApi.updateSettings({
        openrouterModel:   model,
        minRelevanceScore: parseFloat(minScore),
        topK:              parseInt(topK),
        cacheTtl:          parseInt(cacheTtl),
        chunkSize:         parseInt(chunkSize),
        chunkOverlap:      parseInt(chunkOvlp),
      });
      setSettings(r.settings);
      toast.success('Settings saved');
      onRefresh?.();
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="settings-loading">
      <span className="spinner-lg" /> Loading settings…
    </div>
  );

  const keyIsSet = settings?.openrouterApiKey && settings.openrouterApiKey !== '';

  return (
    <div className="settings-panel">
      <div className="panel-title">⚙ Configuration</div>

      {/* ── OpenRouter API Key ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon">🔑</span>
            OpenRouter API Key
          </div>
          <div className={`key-status ${keyIsSet ? 'key-ok' : 'key-missing'}`}>
            {keyIsSet
              ? <><span className="key-dot" /> Configured <span className="key-masked">{settings.openrouterApiKey}</span></>
              : <><span className="key-dot" /> Not set</>
            }
          </div>
        </div>

        <p className="sp-desc">
          Get a free key at <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="sp-link">openrouter.ai</a> → Keys → Create Key.
          No credit card required for free-tier models.
        </p>

        <form className="key-form" onSubmit={saveApiKey}>
          <div className="key-input-wrap">
            <input
              className="sp-input"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={keyIsSet ? 'Enter new key to replace current…' : 'sk-or-v1-…'}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="key-toggle" onClick={() => setShowKey(v => !v)}>
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          <div className="key-actions">
            <button className="btn btn-primary" type="submit" disabled={saving || !apiKey.trim()}>
              {saving ? <span className="spinner-xs" /> : '💾'} Save Key
            </button>
            {keyIsSet && (
              <button className="btn btn-ghost" type="button" onClick={testKey} disabled={testing}>
                {testing ? <span className="spinner-xs" /> : '⚡'} Test Connection
              </button>
            )}
          </div>
        </form>

        {testResult && (
          <div className={`test-result ${testResult.ok ? 'test-ok' : 'test-fail'}`}>
            {testResult.ok
              ? <><span className="tr-icon">✓</span> Connected to <strong>{testResult.model}</strong> — model replied: <em>"{testResult.reply}"</em> ({testResult.tokens} tokens used)</>
              : <><span className="tr-icon">✗</span> {testResult.error}</>
            }
          </div>
        )}
      </div>

      {/* ── Model & RAG tuning ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon">🤖</span>
            Model & RAG Settings
          </div>
        </div>

        <form className="settings-form" onSubmit={saveModelSettings}>
          {/* Active model */}
          <div className="form-group">
            <label className="form-label">Active LLM Model</label>
            <select className="sp-select" value={model} onChange={e => setModel(e.target.value)}>
              {FREE_MODELS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
              {!FREE_MODELS.includes(model) && model && (
                <option value={model}>{model} (custom)</option>
              )}
            </select>
            <div className="form-hint">All listed models are free-tier on OpenRouter.</div>
          </div>

          {/* Custom model input */}
          <div className="form-group">
            <label className="form-label">Custom Model ID <span className="form-optional">(optional — overrides dropdown)</span></label>
            <input
              className="sp-input"
              type="text"
              value={FREE_MODELS.includes(model) ? '' : model}
              onChange={e => setModel(e.target.value || FREE_MODELS[0])}
              placeholder="e.g. anthropic/claude-3-haiku"
            />
          </div>

          <div className="form-divider" />

          {/* RAG tuning */}
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Min Relevance Score</label>
              <input className="sp-input" type="number" step="0.01" min="0" max="1" value={minScore} onChange={e => setMinScore(e.target.value)} />
              <div className="form-hint">0–1. Lower = more results. Default: 0.15</div>
            </div>
            <div className="form-group">
              <label className="form-label">Top-K Chunks</label>
              <input className="sp-input" type="number" min="1" max="20" value={topK} onChange={e => setTopK(e.target.value)} />
              <div className="form-hint">Chunks retrieved per query. Default: 5</div>
            </div>
            <div className="form-group">
              <label className="form-label">Cache TTL (seconds)</label>
              <input className="sp-input" type="number" min="0" value={cacheTtl} onChange={e => setCacheTtl(e.target.value)} />
              <div className="form-hint">How long query results are cached. Default: 3600</div>
            </div>
            <div className="form-group">
              <label className="form-label">Chunk Size (words)</label>
              <input className="sp-input" type="number" min="50" max="2000" value={chunkSize} onChange={e => setChunkSize(e.target.value)} />
              <div className="form-hint">Words per document chunk. Default: 500</div>
            </div>
            <div className="form-group">
              <label className="form-label">Chunk Overlap (words)</label>
              <input className="sp-input" type="number" min="0" max="500" value={chunkOvlp} onChange={e => setChunkOvlp(e.target.value)} />
              <div className="form-hint">Overlap between adjacent chunks. Default: 50</div>
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner-xs" /> : '💾'} Save Settings
          </button>
        </form>
      </div>

      {/* ── API Docs link ── */}
      <div className="sp-card sp-card-docs">
        <div className="sp-card-title">
          <span className="sp-card-icon">📡</span>
          API Documentation
        </div>
        <p className="sp-desc">
          Interactive Swagger UI for testing all API endpoints directly from your browser.
        </p>
        <a
          href="http://localhost:3001/docs"
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost docs-link"
        >
          Open Swagger UI →
        </a>
        <div className="form-hint" style={{ marginTop: 8 }}>
          Opens at <code>http://localhost:3001/docs</code> — use your session token or API key to authenticate.
        </div>
      </div>
    </div>
  );
}
