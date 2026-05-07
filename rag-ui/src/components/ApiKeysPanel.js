import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Key, Shield, Plus, Trash2, Eye, EyeOff, Copy, Check, RotateCw } from 'lucide-react';
import { ragApi } from '../api';

export default function ApiKeysPanel() {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    loadApiKeys();
  }, []);

  async function loadApiKeys() {
    setLoading(true);
    try {
      const r = await ragApi.getApiKeys();
      setApiKeys(r.keys || []);
    } catch (err) {
      toast.error('Failed to load API keys: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }
    setCreatingKey(true);
    try {
      const r = await ragApi.createApiKey(newKeyName.trim());
      if (!r || !r.key) {
        console.error('Invalid response from createApiKey:', r);
        toast.error('Invalid response from server');
        return;
      }
      setNewlyCreatedKey(r.key);
      setNewKeyName('');
      await loadApiKeys();
      toast.success('API key created successfully');
    } catch (err) {
      console.error('Error creating API key:', err);
      toast.error('Failed to create API key: ' + (err?.message || String(err)));
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleDeleteApiKey(id) {
    if (!window.confirm('Delete this API key? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await ragApi.deleteApiKey(id);
      await loadApiKeys();
      toast.success('API key deleted');
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleApiKey(id) {
    setTogglingId(id);
    try {
      await ragApi.toggleApiKey(id);
      await loadApiKeys();
    } catch (err) {
      toast.error('Failed to toggle key: ' + err.message);
    } finally {
      setTogglingId(null);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    toast.success('API key copied to clipboard');
  }

  return (
    <div className="settings-panel">
      {/* ── Header ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Shield size={16} /></span>
            API Key Management
          </div>
        </div>
        <div className="sp-card-body">
          <p className="sp-desc">
            Create API keys to access the RAG API service. Use these keys in the <code>X-API-Key</code> header when making requests to <code>/api/query</code>.
          </p>

          {/* Create new API key */}
          <div className="add-model-form">
            <input
              className="sp-input"
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder="Enter a name for the new API key (e.g., 'Viber Bot', 'Mobile App')"
              style={{ flex: 1 }}
              onKeyPress={e => e.key === 'Enter' && handleCreateApiKey()}
            />
            <button
              className="btn btn-primary"
              onClick={handleCreateApiKey}
              disabled={creatingKey || !newKeyName.trim()}
            >
              {creatingKey ? <span className="spinner-xs" /> : <Plus size={14} />} Create Key
            </button>
          </div>

          {/* Show newly created key (one-time display) */}
          {newlyCreatedKey && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(61,255,160,0.1)',
              border: '1px solid rgba(61,255,160,0.3)',
              borderRadius: 'var(--radius)',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '8px' }}>
                ⚠️ Copy this key now! It won't be shown again:
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: 'var(--bg3)',
                borderRadius: '6px',
                fontFamily: 'var(--mono)',
                fontSize: '12px',
                color: 'var(--accent)'
              }}>
                <code style={{ flex: 1, wordBreak: 'break-all' }}>
                  {typeof newlyCreatedKey === 'object' ? newlyCreatedKey.key : newlyCreatedKey}
                </code>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyToClipboard(typeof newlyCreatedKey === 'object' ? newlyCreatedKey.key : newlyCreatedKey)}
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>
                Use this key in your API requests: <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: '3px' }}>X-API-Key: {typeof newlyCreatedKey === 'object' ? newlyCreatedKey.key : newlyCreatedKey}</code>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: '8px' }}
                onClick={() => setNewlyCreatedKey(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── API Keys List ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon"><Key size={16} /></span>
            Existing API Keys ({apiKeys.length})
          </div>
          <button className="btn btn-ghost btn-xs" onClick={loadApiKeys}>
            <RotateCw size={12} /> Refresh
          </button>
        </div>
        <div className="sp-card-body" style={{ padding: '0' }}>
          {loading ? (
            <div className="settings-loading">
              <span className="spinner-lg" /> Loading API keys…
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="models-empty">No API keys created yet. Create one above.</div>
          ) : (
            <div className="models-list" style={{ padding: '8px' }}>
              {apiKeys.map(key => (
                <div key={key.id} className="model-item" style={{
                  opacity: key.active ? 1 : 0.6,
                  transition: 'all 0.2s'
                }}>
                  <div className="model-info" style={{ flex: 1 }}>
                    <div className="model-name">
                      {key.name}
                    </div>
                    <div className="model-id">
                      <code style={{ 
                        fontFamily: 'var(--mono)', 
                        fontSize: '11px', 
                        color: 'var(--text3)',
                        background: 'var(--bg4)',
                        padding: '1px 6px',
                        borderRadius: '3px'
                      }}>
                        {key.keyPreview || `${key.key?.substring(0, 8)}...`}
                      </code>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px' }}>
                      Created: {new Date(key.created).toLocaleString()}
                      {key.lastUsed && ` • Last used: ${new Date(key.lastUsed).toLocaleString()}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleToggleApiKey(key.id)}
                      disabled={togglingId === key.id}
                      title={key.active ? 'Deactivate key' : 'Activate key'}
                      style={{ 
                        color: key.active ? 'var(--warn)' : 'var(--success)',
                        border: `1px solid ${key.active ? 'rgba(255,180,84,0.3)' : 'rgba(61,255,160,0.3)'}`
                      }}
                    >
                      {togglingId === key.id ? <span className="spinner-xs" /> : (key.active ? <EyeOff size={12} /> : <Eye size={12} />)}
                      {key.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteApiKey(key.id)}
                      disabled={deletingId === key.id}
                    >
                      {deletingId === key.id ? <span className="spinner-xs" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
