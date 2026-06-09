import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ragApi } from '../api';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);
  const [version, setVersion] = useState('v1.0.0');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError('');

    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    ragApi.version().then(data => {
      setVersion(data.version || 'v1.0.0');
    }).catch(() => {});
  }, []);

  // Show loading state if loading
  if (loading) {
    return (
      <div className="login-page">
        <div className="login-bg" aria-hidden="true">
          <div className="bg-grid" />
          <div className="bg-orb bg-orb-1" />
          <div className="bg-orb bg-orb-2" />
          <div className="bg-orb bg-orb-3" />
        </div>
        <div className="login-loading-container">
          <div className="login-loading-logo">
            <img src="/logo.png" alt="Loading" className="login-loading-img" />
          </div>
          <div className="login-loading-text">Signing in...</div>
          <div className="login-progress-bar">
            <div className="login-progress-fill" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="bg-grid" />
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>

      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo">
            <img src="/logo.png" alt="App Logo" className="logo-img" />
          </div>
          <div className="login-title">Mnemosyne</div>
          <div className="login-subtitle">RAG Knowledge Base Agent</div>
          
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="field-group">
            <label className="field-label" htmlFor="username">Username</label>
            <input
              id="username"
              className="field-input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoFocus
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                id="password"
                className="field-input"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-pass"
                onClick={() => setShowPass(v => !v)}
                tabIndex={-1}
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <span className="error-icon"><AlertTriangle size={14} /></span> {error}
            </div>
          )}

          <button
            className="login-btn"
            type="submit"
            disabled={loading || !username.trim() || !password}
          >
            Sign In →
          </button>
        </form>

       <div className="login-footer">
          <span>© {new Date().getFullYear()} Mnemosyne <span className="version-info">{version}</span></span>
          <span><br /></span>
          <span>Open-Source Self-Hosted AI Knowledge Base with RAG + OCR</span>
          <span><br /></span>
          <span>Powered by <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>OpenRouter</a> and <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Ollama</a></span>
        </div>
      </div>
    </div>
  );
}
