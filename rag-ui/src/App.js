import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './components/LoginScreen';
import QueryPanel from './components/QueryPanel';
import DocumentsPanel from './components/DocumentsPanel';
import StatusPanel from './components/StatusPanel';
import { ragApi } from './api';
import './App.css';

const TABS = [
  { id: 'query',     label: 'Query',         icon: '⚡' },
  { id: 'documents', label: 'Knowledge Base', icon: '📚' },
  { id: 'status',    label: 'System Status',  icon: '🛰' },
];

function AuthenticatedApp() {
  const { username, expiresAt, logout } = useAuth();
  const [activeTab,    setActiveTab]    = useState('query');
  const [serverOnline, setServerOnline] = useState(null);
  const [info,         setInfo]         = useState(null);

  // ── Persistent chat history — lives here so tab switches don't reset it ──
  const [chatHistory, setChatHistory] = useState([]);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    const onUnauthorized = () => logout();
    window.addEventListener('rag:unauthorized', onUnauthorized);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rag:unauthorized', onUnauthorized);
    };
  }, [logout]);

  async function checkHealth() {
    try {
      await ragApi.health();
      setServerOnline(true);
      const data = await ragApi.getInfo();
      setInfo(data);
    } catch {
      setServerOnline(false);
    }
  }

  function sessionExpirySummary() {
    if (!expiresAt) return null;
    const mins = Math.round((new Date(expiresAt) - Date.now()) / 60000);
    if (mins < 30) return `Session expires in ${mins}m`;
    return null;
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-name">Mnemosyne</span>
            <span className="logo-sub">RAG Knowledge Base</span>
          </div>
        </div>
        <div className="header-right">
          <div className="session-info">
            <span className="session-user">👤 {username}</span>
            {sessionExpirySummary() && (
              <span className="session-expiry">{sessionExpirySummary()}</span>
            )}
            <button className="logout-btn" onClick={logout} title="Sign out">
              Sign out
            </button>
          </div>
          <div className={`status-dot ${serverOnline === null ? 'unknown' : serverOnline ? 'online' : 'offline'}`}>
            <span className="dot-pulse" />
            <span>{serverOnline === null ? '…' : serverOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {/* ── Stats bar — generic labels, no brand or backend names ── */}
      {info && (
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-value">{info.vectorStore?.totalChunks ?? '—'}</span>
            <span className="stat-label">Chunks Indexed</span>
          </div>
          <div className="stat-sep" />
          <div className="stat-item">
            <span className="stat-value">{info.cache?.entries ?? '—'}</span>
            <span className="stat-label">Cached Queries</span>
          </div>
          <div className="stat-sep" />
          <div className="stat-item">
            <span className="stat-value">{info.queue?.queryQueue?.active ?? '—'}</span>
            <span className="stat-label">Active Jobs</span>
          </div>
          <div className="stat-sep" />
          <div className="stat-item">
            <span className="stat-value">{chatHistory.length}</span>
            <span className="stat-label">Messages</span>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
            {/* Show unread dot on Query tab when chat has messages and tab is not active */}
            {t.id === 'query' && chatHistory.length > 0 && activeTab !== 'query' && (
              <span className="tab-unread" />
            )}
          </button>
        ))}
      </nav>

      {/* ── Content — all panels always mounted, hidden via CSS to preserve state ── */}
      <main className="main">
        <div style={{ display: activeTab === 'query'     ? 'contents' : 'none' }}>
          <QueryPanel history={chatHistory} setHistory={setChatHistory} />
        </div>
        <div style={{ display: activeTab === 'documents' ? 'contents' : 'none' }}>
          <DocumentsPanel onRefresh={checkHealth} />
        </div>
        <div style={{ display: activeTab === 'status'    ? 'contents' : 'none' }}>
          <StatusPanel info={info} serverOnline={serverOnline} onRefresh={checkHealth} />
        </div>
      </main>
    </div>
  );
}

function AppInner() {
  const { isAuthenticated, checking } = useAuth();
  if (checking) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }
  return isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg3)',
            color: 'var(--text)',
            border: '1px solid var(--border2)',
            fontFamily: 'var(--sans)',
            fontSize: '13px'
          }
        }}
      />
      <AppInner />
    </AuthProvider>
  );
}
