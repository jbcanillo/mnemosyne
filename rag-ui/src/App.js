import React, { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { User, LogOut, MessageSquare, BookOpen, Activity, Settings, Sun, Moon, BarChart3 } from 'lucide-react';
import LoginScreen from './components/LoginScreen';
import QueryPanel from './components/QueryPanel';
import DocumentsPanel from './components/DocumentsPanel';
import AnalyticsPanel from './components/AnalyticsPanel';
import StatusPanel from './components/StatusPanel';
import SettingsPanel from './components/SettingsPanel';
import { ragApi } from './api';
import './App.css';

const TABS = [
  { id: 'query',     label: 'Query',         icon: <MessageSquare size={14} /> },
  { id: 'documents', label: 'Knowledge Base', icon: <BookOpen size={14} /> },
  { id: 'analytics', label: 'Analytics',     icon: <BarChart3 size={14} /> },
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
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  // ── Persistent chat history — lives here so tab switches don't reset it ──
  const [chatHistory, setChatHistory] = useState([]);
  const [chatViewed, setChatViewed] = useState(true); // Track if user has viewed latest messages

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

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Toggle theme
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Track scroll position to show "scroll to top" button
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      // Show button when user is near bottom (within 300px) or scrolled down
      setShowScrollTop(scrollTop > 300 || scrollTop > docHeight - 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top smoothly
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // Mark chat as viewed when user navigates to query tab
  useEffect(() => {
    if (activeTab === 'query') {
      setChatViewed(true);
    }
  }, [activeTab]);

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
          <button className="theme-toggle-btn" onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <div className="session-info">
            <span className="session-user"><User size={14} /> {username}</span>
            {sessionExpirySummary() && (
              <span className="session-expiry">{sessionExpirySummary()}</span>
            )}
            <button className="logout-btn" onClick={logout} title="Sign out">
              <LogOut size={14} />
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
            {t.id === 'query' && !chatViewed && activeTab !== 'query' && (
              <span className="tab-unread" />
            )}
          </button>
        ))}
      </nav>

      {/* ── Content — all panels always mounted, hidden via CSS to preserve state ── */}
      <main className="main">
        <div style={{ display: activeTab === 'query'     ? 'contents' : 'none' }}>
          <QueryPanel history={chatHistory} setHistory={setChatHistory} onLoadingChange={setIsQueryLoading} onNewMessage={() => setChatViewed(false)} />
        </div>
        <div style={{ display: activeTab === 'documents' ? 'contents' : 'none' }}>
          <DocumentsPanel onRefresh={checkHealth} />
        </div>
        <div style={{ display: activeTab === 'analytics' ? 'contents' : 'none' }}>
          <AnalyticsPanel />
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
          <span>Self-hosted Retrieval-Augmented Generation + OCR</span>
          <span className="footer-sep">·</span>
          <span>Powered by <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">OpenRouter</a></span>
        </div>
      </footer>

      {/* ── Scroll to Top Button ── */}
      {showScrollTop && (
        <button 
          className="scroll-to-top-btn" 
          onClick={scrollToTop} 
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <span>↑</span>
        </button>
      )}
    </div>
  );
}

function AppInner() {
  const { isAuthenticated, checking, justLoggedIn } = useAuth();
  
  // Show logo + progress bar during auth check or after login
  const showLoadingState = checking || justLoggedIn;
  
  if (showLoadingState) {
    return (
      <div className="app-loading">
        <div className="login-loading-container">
          <div className="login-loading-logo">
            <img src="/logo.svg" alt="Mnemosyne" className="login-loading-img" />
          </div>
          <div className="login-progress-bar">
            <div className="login-progress-fill" />
          </div>
          <div className="login-loading-text">Loading...</div>
        </div>
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
