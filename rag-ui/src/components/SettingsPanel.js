import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Key, Bot, Package, Plus, Trash2, RotateCcw, Eye, EyeOff, Save, Zap, FolderOpen, Download, Upload, Shield, Database } from 'lucide-react';
import { ragApi } from '../api';
import './SettingsPanel.css';

export default function SettingsPanel({ onRefresh }) {
  const [settings,  setSettings]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [testing,   setTesting]   = useState(false);
  const [testResult,setTestResult]= useState(null);
  const [showKey,   setShowKey]   = useState(false);
  const [models,    setModels]    = useState([]);
  const [activeModel, setActiveModel] = useState(null);

  // Model management state
  const [newModelId,   setNewModelId]   = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [addingModel,  setAddingModel]  = useState(false);
  const [deletingModel, setDeletingModel] = useState(null);
  const [resettingModels, setResettingModels] = useState(false);

  // Data management state
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [backups, setBackups] = useState([]);

  // Form state
  const [apiKey,   setApiKey]   = useState('');
  const [model,    setModel]    = useState('');
  const [minScore, setMinScore] = useState('');
  const [topK,     setTopK]     = useState('');
  const [cacheTtl, setCacheTtl] = useState('');
  const [chunkSize,setChunkSize]= useState('');
  const [chunkOvlp,setChunkOvlp]= useState('');

  useEffect(() => { 
    loadSettings();
    loadModels();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await ragApi.getSettings();
      setSettings(s);
      // Don't pre-fill the key — user must type it fresh to change it
      // Note: will be overridden by loadModels() which loads the active model
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

  async function loadModels() {
    try {
      const r = await ragApi.getModels();
      setModels(r.models || []);
      // Find and track the active model (current system model)
      const active = (r.models || []).find(m => m.active);
      if (active) {
        setActiveModel(active);
        setModel(active.id);
      }
    } catch (err) {
      console.warn('Failed to load models:', err.message);
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

  // ── Model management ────────────────────────────────────────────────
  async function handleAddModel(e) {
    e.preventDefault();
    if (!newModelId.trim() || !newModelName.trim()) return;
    setAddingModel(true);
    try {
      await ragApi.addModel(newModelId.trim(), newModelName.trim());
      setNewModelId('');
      setNewModelName('');
      toast.success('Model added');
      await loadModels();
    } catch (err) {
      toast.error('Failed to add model: ' + err.message);
    } finally {
      setAddingModel(false);
    }
  }

  async function handleDeleteModel(modelId) {
    if (models.find(m => m.id === modelId)?.active) {
      toast.error('Cannot delete the currently active model. Switch to another model first.');
      return;
    }
    if (!confirm(`Delete model "${modelId}"?`)) return;
    setDeletingModel(modelId);
    try {
      await ragApi.deleteModel(modelId);
      toast.success('Model deleted');
      await loadModels();
    } catch (err) {
      toast.error('Failed to delete model: ' + err.message);
    } finally {
      setDeletingModel(null);
    }
  }

  async function handleResetModels() {
    if (!confirm('Clear all models? You will need to re-add them manually.')) return;
    setResettingModels(true);
    try {
      await ragApi.resetModels();
      toast.success('All models cleared');
      await loadModels();
    } catch (err) {
      toast.error('Failed to reset models: ' + err.message);
    } finally {
      setResettingModels(false);
    }
  }

  // ── Data management ────────────────────────────────────────────────
  useEffect(() => {
    loadBackups();
  }, []);

  async function loadBackups() {
    try {
      const r = await ragApi.listBackups();
      setBackups(r.backups || []);
    } catch (err) {
      console.warn('Failed to load backups:', err.message);
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

  if (loading) return (
    <div className="settings-loading">
      <span className="spinner-lg" /> Loading settings…
    </div>
  );

  const keyIsSet = settings?.openrouterApiKey && settings.openrouterApiKey !== '';

  return (
    <div className="settings-panel">

      {/* ── OpenRouter API Key ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Key size={16} /></span>
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
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="key-actions">
            <button className="btn btn-primary" type="submit" disabled={saving || !apiKey.trim()}>
              {saving ? <span className="spinner-xs" /> : <Save size={14} />} Save Key
            </button>
            {keyIsSet && (
              <button className="btn btn-warning" type="button" onClick={testKey} disabled={testing}>
                {testing ? <span className="spinner-xs" /> : <Zap size={14} />} Test Connection
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
            <span className="sp-card-icon"><Bot size={16} /></span>
            Model & RAG Settings
          </div>
        </div>

        <form className="settings-form" onSubmit={saveModelSettings}>
          {/* Active model selector */}
          <div className="form-group">
            <label className="form-label">Active LLM Model</label>
            <select className="sp-select" value={model} onChange={e => setModel(e.target.value)}>
              <option value="">-- Select a model --</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.active ? '★ ' : ''}{m.name} ({m.id})
                </option>
              ))}
            </select>
            <div className="form-hint">Select from configured models or add new ones below. ★ = Currently active model.</div>
          </div>

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

          <button className="btn btn-primary btn-sm" type="submit" disabled={saving} style={{ width: 'auto', alignSelf: 'flex-start' }}>
            {saving ? <span className="spinner-xs" /> : <Save size={14} />} Save Settings
          </button>
        </form>
      </div>

      {/* ── Model Management ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Package size={16} /></span>
            Manage LLM Models
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleResetModels} disabled={resettingModels} title="Clear all models">
            {resettingModels ? <span className="spinner-xs" /> : <RotateCcw size={14} />} Clear All
          </button>
        </div>

        <p className="sp-desc">
          Add or remove OpenRouter models. Use the model ID from <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="sp-link">openrouter.ai/models</a> (e.g., <code>openai/gpt-4o-mini:free</code>).
        </p>

        {/* Add model form */}
        <form className="add-model-form" onSubmit={handleAddModel}>
          <input
            className="sp-input"
            type="text"
            value={newModelId}
            onChange={e => setNewModelId(e.target.value)}
            placeholder="Model ID (e.g., anthropic/claude-3-haiku:free)"
            autoComplete="off"
            spellCheck={false}
          />
          <input
            className="sp-input"
            type="text"
            value={newModelName}
            onChange={e => setNewModelName(e.target.value)}
            placeholder="Display name (e.g., Claude 3 Haiku)"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary" type="submit" disabled={addingModel || !newModelId.trim() || !newModelName.trim()}>
            {addingModel ? <span className="spinner-xs" /> : <Plus size={14} />} Add Model
          </button>
        </form>

        {/* Models list */}
        <div className="models-list">
          {models.length === 0 ? (
            <div className="models-empty">No models configured. Reset to defaults or add one above.</div>
          ) : (
            models.map(m => (
              <div key={m.id} className={`model-item ${m.active ? 'model-active' : ''}`}>
                <div className="model-info">
                  <div className="model-name">
                    {m.active && <span className="model-active-badge">★ Active</span>}
                    {m.name}
                  </div>
                  <div className="model-id">{m.id}</div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDeleteModel(m.id)}
                  disabled={deletingModel === m.id || m.active}
                  title={m.active ? 'Cannot delete active model' : 'Delete model'}
                >
                  {deletingModel === m.id ? <span className="spinner-xs" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Data Management ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><FolderOpen size={16} /></span>
            Data Management
          </div>
        </div>

        <div className="mgmt-grid">
          <div className="mgmt-card">
            <div className="mgmt-card-title"><Database size={14} /> Query Cache</div>
            <div className="mgmt-card-detail">Removes all cached query results</div>
            <button className="btn btn-ghost btn-xs" onClick={clearCache} disabled={clearing}>
              {clearing ? 'Clearing…' : <><Trash2 size={12} /> Clear Cache</>}
            </button>
          </div>
          <div className="mgmt-card">
            <div className="mgmt-card-title"><Shield size={14} /> Vector Store</div>
            <div className="mgmt-card-detail">Reset all indexed chunks</div>
            <button className="btn btn-danger btn-xs" onClick={resetVectorStore} disabled={resetting}>
              {resetting ? 'Resetting…' : <><Shield size={12} /> Reset Collection</>}
            </button>
          </div>
          <div className="mgmt-card mgmt-card-full">
            <div className="mgmt-card-title"><Download size={14} /> Backup & Restore</div>
            <div className="mgmt-card-detail">Knowledge base backup and restore</div>
            <div className="mgmt-actions">
              <button className="btn btn-primary btn-xs" onClick={createBackup} disabled={backupProgress || restoring}>
                {backupProgress ? 'Creating...' : <><Download size={12} /> Create Backup</>}
              </button>
            </div>
            {backups.length > 0 && (
              <div className="backup-list">
                <div className="backup-list-title">Available Backups:</div>
                {backups.map((b, i) => (
                  <div key={i} className="backup-item">
                    <div className="backup-info">
                      <div className="backup-name">{b.filename}</div>
                      <div className="backup-meta">{(b.size / 1024 / 1024).toFixed(1)} MB · {new Date(b.created).toLocaleString()}</div>
                    </div>
                    <button className="btn btn-warning btn-xs" onClick={() => restoreBackup(b.filename)} disabled={restoring}>
                      {restoring ? 'Restoring…' : <><Upload size={12} /> Restore</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
