import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Key, Bot, Package, Plus, Trash2, RotateCcw, Eye, EyeOff, Save, Network, FolderOpen, Download, Upload, Shield, Database } from 'lucide-react';
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

  // LLM Engine and local model state
  const [llmEngine,  setLlmEngine]  = useState('');
  const [localModel, setLocalModel] = useState('');
  // FIX: added 'checking' status so Check and Download don't share 'downloading'
  const [localModelStatus, setLocalModelStatus] = useState('unknown'); // 'available' | 'checking' | 'downloading' | 'not_found' | 'unknown'

  // Form state
  const [apiKey,   setApiKey]   = useState('');
  const [model,    setModel]    = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [minScore, setMinScore] = useState('');
  const [topK,     setTopK]     = useState('');
  const [cacheTtl, setCacheTtl] = useState('');
  const [chunkSize,setChunkSize]= useState('');
  const [chunkOvlp,setChunkOvlp]= useState('');

  useEffect(() => {
    loadSettings();
    loadModels();
    loadBackups();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await ragApi.getSettings();
      setSettings(s);
      setLlmEngine(s.llmEngine || '');
      setLocalModel(s.localLlmModel || 'llama3.2');
      setSystemPrompt(s.systemPrompt || `You are Mnemosyne, an AI assistant for a RAG knowledge base system.
Answer questions STRICTLY based on the provided context documents.

RULES:
1. Only use information from the context. Never invent or assume facts.
2. If the answer is not in the context, say: "I don't have information about that in the knowledge base."
3. Be concise and direct. For External Chat Apps: plain text only, no markdown, under 1500 words.`);
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
      const active = (r.models || []).find(m => m.active);
      if (active) {
        setActiveModel(active);
        setModel(active.id);
      }
    } catch (err) {
      console.warn('Failed to load models:', err.message);
    }
  }

  async function saveApiKey() {
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

  // FIX: uses 'checking' status instead of 'downloading' during check
  async function checkLocalModel() {
    setLocalModelStatus('checking');
    try {
      const r = await ragApi.checkLocalModel({ model: localModel });
      if (r.exists) {
        setLocalModelStatus('available');
        toast.success(`Model "${localModel}" is available`);
      } else {
        setLocalModelStatus('not_found');
      }
    } catch (err) {
      setLocalModelStatus('unknown');
      toast.error('Check failed: ' + err.message);
    }
  }

  async function pullLocalModel() {
    setLocalModelStatus('downloading');
    try {
      await ragApi.pullLocalModel({ model: localModel });
      setLocalModelStatus('available');
      toast.success(`Model "${localModel}" downloaded successfully`);
    } catch (err) {
      setLocalModelStatus('not_found');
      toast.error('Download failed: ' + err.message);
    }
  }

  async function saveModelSettings() {
    setSaving(true);
    try {
      const r = await ragApi.updateSettings({
        llmEngine:         llmEngine || undefined,
        systemPrompt:      systemPrompt || undefined,
        openrouterModel:   model,
        localLlmModel:     localModel,
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

  // ── Model management ─────────────────────────────────────────────────
  async function handleAddModel() {
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

  // ── Data management ──────────────────────────────────────────────────
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
    try {
      const r = await ragApi.clearCache();
      toast.success(r.message || 'Cache cleared');
      onRefresh?.();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setClearing(false);
    }
  }

  async function resetVectorStore() {
    if (!window.confirm('Delete ALL indexed chunks? You will need to re-upload documents.')) return;
    setResetting(true);
    try {
      await ragApi.resetVectorStore();
      toast.success('Vector store reset');
      onRefresh?.();
    } catch (err) {
      toast.error('Reset failed: ' + err.message);
    } finally {
      setResetting(false);
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

  async function deleteBackup(filename) {
    if (!window.confirm(`Delete backup "${filename}"? This cannot be undone.`)) return;
    try {
      await ragApi.deleteBackup(filename);
      toast.success('Backup deleted');
      await loadBackups();
    } catch (err) {
      toast.error('Failed to delete backup: ' + err.message);
    }
  }

  if (loading) return (
    <div className="settings-loading">
      <span className="spinner-lg" /> Loading settings…
    </div>
  );

  const showLocalSection = llmEngine === 'local' || (!llmEngine && !settings?.openrouterApiKey);
  const showOpenRouterSection = llmEngine === 'openrouter' || (llmEngine === '' && !!settings?.openrouterApiKey);

  return (
    <div className="settings-panel">

      {/* ── Model & LLM Settings ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Bot size={16} /></span>
            Model & LLM Settings
          </div>
        </div>

        <div className="sp-card-body">
          {/* FIX: replaced <form onSubmit> with <div> + onClick on Save button */}
          <div className="settings-form">

            {/* LLM Engine selector */}
            <div className="form-group">
              <label className="form-label">LLM Engine</label>
              <select
                className="sp-select"
                value={llmEngine}
                onChange={e => setLlmEngine(e.target.value)}
              >
                <option value="">Auto (OpenRouter if key set, else Local)</option>
                <option value="openrouter">OpenRouter (cloud)</option>
                <option value="local">Local Ollama</option>
              </select>
              <div className="form-hint">
                {showLocalSection
                  ? 'Using local Ollama models — no API key needed'
                  : 'Uses OpenRouter cloud API — requires API key'}
              </div>
            </div>

            {/* OpenRouter section */}
            {showOpenRouterSection && (
              <>
                {/* OpenRouter API Key */}
                <div className="form-group">
                  <label className="form-label">OpenRouter API Key</label>
                  <div className="key-input-wrap">
                    <input
                      className="sp-input"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={settings?.openrouterApiKey ? 'Enter new key to replace current…' : 'sk-or-v1-…'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="key-toggle" onClick={() => setShowKey(v => !v)}>
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {apiKey.trim() && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={saveApiKey}
                      disabled={saving}
                      style={{ marginTop: '8px' }}
                    >
                      {saving ? <span className="spinner-xs" /> : <Key size={14} />} Save API Key
                    </button>
                  )}
                  <div className="form-hint">
                    Get a free key at <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="sp-link">openrouter.ai</a> → Keys → Create Key.
                    No credit card required for free-tier models.
                  </div>
                </div>

                {/* Test Key button */}
                {settings?.openrouterApiKey && (
                  <div className="form-group">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={testKey}
                      disabled={testing}
                    >
                      {testing ? <span className="spinner-xs" /> : <Network size={14} />} Test Connection
                    </button>
                    {testResult && (
                      <div className={`test-result ${testResult.ok ? 'test-ok' : 'test-fail'}`} style={{ marginTop: '8px' }}>
                        {testResult.ok
                          ? `✓ Connected — model replied: "${testResult.reply}"`
                          : `✗ ${testResult.error}`}
                      </div>
                    )}
                  </div>
                )}

                {/* Active model selector */}
                <div className="form-group">
                  <label className="form-label">Active OpenRouter Model</label>
                  <select className="sp-select" value={model} onChange={e => setModel(e.target.value)}>
                    <option value="">-- Select a model --</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.active ? '★ ' : ''}{m.name} ({m.id})
                      </option>
                    ))}
                  </select>
                  <div className="form-hint">Select from configured OpenRouter models. Add new ones below.</div>
                </div>
              </>
            )}

            {/* Local Ollama section */}
            {showLocalSection && (
              <>
                <div className="form-group">
                  <label className="form-label">Local Ollama Model</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <input
                        className="sp-input"
                        type="text"
                        value={localModel}
                        onChange={e => { setLocalModel(e.target.value); setLocalModelStatus('unknown'); }}
                        placeholder="e.g., llama3.2, mistral, qwen2.5"
                      />
                    </div>
                    {/* FIX: disabled during 'checking' OR 'downloading', label reflects correct state */}
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={checkLocalModel}
                      disabled={localModelStatus === 'checking' || localModelStatus === 'downloading' || !localModel.trim()}
                    >
                      {localModelStatus === 'checking' ? <><span className="spinner-xs" /> Checking…</> : 'Check'}
                    </button>
                  </div>
                  <div className="form-hint">
                    Model name available in your Ollama instance. Default: llama3.2.
                  </div>
                </div>

                {localModelStatus === 'not_found' && (
                  <div className="form-group">
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-danger)' }}>Model not found in Ollama</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={pullLocalModel}
                        disabled={!localModel.trim()}
                      >
                        <Download size={14} /> Download Model
                      </button>
                    </div>
                    <div className="form-hint">
                      The model will be pulled (~GB size) and stored in the Ollama container.
                    </div>
                  </div>
                )}

                {localModelStatus === 'downloading' && (
                  <div className="form-group">
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="spinner-xs" />
                      <span style={{ color: 'var(--color-warning)' }}>Downloading model, please wait…</span>
                    </div>
                  </div>
                )}

                {localModelStatus === 'available' && (
                  <div className="form-group">
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-success)' }}>✓ Model available</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* System Prompt */}
            <div className="form-group">
              <label className="form-label">System Prompt</label>
              <textarea
                className="sp-input"
                rows="6"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Enter system prompt for AI behavior..."
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
              <div className="form-hint">
                Defines the AI's behavior and rules. Changes apply to new queries. Default includes strict RAG behavior (no hallucination).
              </div>
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

            {/* FIX: onClick instead of type="submit" */}
            <button
              className="btn btn-primary"
              onClick={saveModelSettings}
              disabled={saving}
              style={{ width: 'auto', alignSelf: 'flex-start' }}
            >
              {saving ? <span className="spinner-xs" /> : <Save size={14} />} Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* ── Manage OpenRouter Models ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Package size={16} /></span>
            Manage OpenRouter Models
          </div>
          <button className="btn btn-ghost btn-xs" onClick={handleResetModels} disabled={resettingModels} title="Clear all models">
            {resettingModels ? <span className="spinner-xs" /> : <RotateCcw size={14} />} Clear All
          </button>
        </div>

        <div className="sp-card-body">
          <p className="sp-desc">
            Add or remove OpenRouter models to choose from (e.g., openai/gpt-4o-mini:free). Use the model ID from{' '}
            <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="sp-link">openrouter.ai/models</a>.
          </p>

          {/* FIX: replaced <form onSubmit> with <div> + onClick on Add button */}
          <div className="add-model-form">
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
            <button
              className="btn btn-primary"
              onClick={handleAddModel}
              disabled={addingModel || !newModelId.trim() || !newModelName.trim()}
            >
              {addingModel ? <span className="spinner-xs" /> : <Plus size={14} />} Add Model
            </button>
          </div>

          {/* Models list */}
          <div className="models-list">
            {models.length === 0 ? (
              <div className="models-empty">No OpenRouter models configured.</div>
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
      </div>

      {/* ── Data Management ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><FolderOpen size={16} /></span>
            Data Management
          </div>
        </div>

        <div className="sp-card-body">
          <div className="mgmt-grid">
            <div className="mgmt-card">
              <div className="mgmt-card-title"><Database size={14} /> Query Cache</div>
              <div className="mgmt-card-detail">Removes all cached query results</div>
              <button className="btn btn-danger btn-xs" onClick={clearCache} disabled={clearing}>
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
                <button className="btn btn-primary" onClick={createBackup} disabled={!!backupProgress || restoring}>
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
                      <div className="backup-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => restoreBackup(b.filename)} disabled={restoring}>
                          {restoring ? 'Restoring…' : <><Upload size={12} /> Restore</>}
                        </button>
                        <button className="btn btn-danger btn-xs backup-delete" onClick={() => deleteBackup(b.filename)} title="Delete backup">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}