import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { User, LogOut, MessageSquare, BookOpen, Activity, Settings } from 'lucide-react';
import LoginScreen from './components/LoginScreen';
import QueryPanel from './components/QueryPanel';
import DocumentsPanel from './components/DocumentsPanel';
import StatusPanel from './components/StatusPanel';
import SettingsPanel from './components/SettingsPanel';
import { ragApi } from './api';
import './App.css';

const TABS = [
  { id: 'query',     label: 'Query',         icon: <MessageSquare size={14} /> },
  { id: 'documents', label: 'Knowledge Base', icon: <BookOpen size={14} /> },
  { id: 'status',    label: 'System Status',  icon: <Activity size={14} /> },
  { id: 'settings',  label: 'Settings',       icon: <Settings size={14} /> },
];

function AuthenticatedApp() {
  const { username, expiresAt, logout } = useAuth();
  const [activeTab,    setActiveTab]    = useState('query');
  const [serverOnline, setServerOnline] = useState(null);
  const [info,         setInfo]         = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isQueryLoading, setIsQueryLoading] = useState(false);

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
      {/* ── Animated background ── */}
      <div className="app-bg" aria-hidden="true">
        <div className="bg-grid" />
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>

      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <button className="tab-toggle-mobile" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <span className="tab-toggle-icon">{mobileMenuOpen ? '✕' : '☰'}</span>
          </button>
          <div className="logo">
            <span className="logo-name">Mnemosyne</span>
            <span className="logo-sub">RAG Knowledge Base</span>
          </div>
        </div>
        <div className="header-right">
          <div className="session-info">
            <span className="session-user"><User size={14} /> {username}</span>
            {sessionExpirySummary() && (
              <span className="session-expiry">{sessionExpirySummary()}</span>
            )}
            <button className="logout-btn" onClick={logout} title="Sign out">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile sidebar overlay ── */}
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* ── Tabs / Mobile sidebar ── */}
      <nav className={`tabs ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="tabs-logo-area">
          <img src="/logo.svg" alt="Mnemosyne" className="tabs-logo-img" />
        </div>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(t.id); setMobileMenuOpen(false); }}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
            {t.id === 'query' && isQueryLoading && (
              <span className="tab-processing-dot" title="Processing query..." />
            )}
            {t.id === 'query' && chatHistory.length > 0 && activeTab !== 'query' && !isQueryLoading && (
              <span className="tab-unread" />
            )}
          </button>
        ))}
      </nav>

      {/* ── Content — all panels always mounted, hidden via CSS to preserve state ── */}
      <main className="main">
        <div style={{ display: activeTab === 'query'     ? 'contents' : 'none' }}>
          <QueryPanel history={chatHistory} setHistory={setChatHistory} onLoadingChange={setIsQueryLoading} />
        </div>
        <div style={{ display: activeTab === 'documents' ? 'contents' : 'none' }}>
          <DocumentsPanel onRefresh={checkHealth} />
        </div>
        <div style={{ display: activeTab === 'status'    ? 'contents' : 'none' }}>
          <StatusPanel info={info} serverOnline={serverOnline} onRefresh={checkHealth} />
        </div>
        <div style={{ display: activeTab === 'settings'  ? 'contents' : 'none' }}>
          <SettingsPanel onRefresh={checkHealth} />
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="app-footer">
        <div className="footer-content">
          <span>© {new Date().getFullYear()} Mnemosyne RAG Knowledge Base</span>
          <span className="footer-sep">·</span>
          <span>Self-hosted Retrieval-Augmented Generation</span>
        </div>
      </footer>
    </div>
  );
}

function AppInner() {
  const { isAuthenticated, checking, justLoggedIn } = useAuth();
  if (checking) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }
  if (justLoggedIn) {
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
