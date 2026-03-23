import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ragApi } from '../api';
import './QueryPanel.css';

const EXAMPLE_QUERIES = [
  'What information is available about this topic?',
  'Summarize the key points in the knowledge base',
  'How does the process work?',
  'What are the main categories of data?',
  'Give me an overview of the uploaded documents',
];

// history and setHistory come from App.js so chat persists across tab switches
export default function QueryPanel({ history, setHistory }) {
  const [query,     setQuery]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [asyncMode, setAsyncMode] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  async function handleQuery(e) {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    const q = query.trim();
    setQuery('');
    setLoading(true);
    setHistory(h => [...h, { type: 'user', text: q, ts: new Date() }]);

    try {
      if (asyncMode) {
        const job = await ragApi.queryAsync(q);
        setHistory(h => [...h, { type: 'assistant', text: null, jobId: job.jobId, loading: true, ts: new Date() }]);
        pollJob(job.jobId);
      } else {
        const result = await ragApi.query(q);
        setHistory(h => [...h, {
          type: 'assistant', text: result.answer,
          sources: result.sources, fromCache: result.fromCache,
          relevantChunks: result.relevantChunks, ts: new Date()
        }]);
      }
    } catch (err) {
      setHistory(h => [...h, { type: 'error', text: err.message, ts: new Date() }]);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function pollJob(jobId) {
    const poll = async () => {
      try {
        const status = await ragApi.getJobStatus(jobId);
        if (status.state === 'completed') {
          setHistory(h => h.map(m => m.jobId === jobId
            ? { ...m, loading: false, text: status.result.answer, sources: status.result.sources }
            : m));
          return;
        }
        if (status.state === 'failed') {
          setHistory(h => h.map(m => m.jobId === jobId
            ? { ...m, loading: false, type: 'error', text: status.failedReason }
            : m));
          return;
        }
        setTimeout(poll, 1500);
      } catch { setTimeout(poll, 2000); }
    };
    setTimeout(poll, 500);
  }

  function clearChat() {
    setHistory([]);
    toast.success('Conversation cleared');
  }

  return (
    <div className="query-panel">
      {/* Controls */}
      <div className="query-controls">
        <div className="panel-title">⚡ Query Interface</div>
        <div className="controls-right">
          <label className="toggle-wrap">
            <span className="toggle-label">Async Queue</span>
            <input type="checkbox" checked={asyncMode} onChange={e => setAsyncMode(e.target.checked)} className="toggle-input" />
            <span className="toggle-slider" />
          </label>
          {history.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={clearChat}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="chat-area">
        {history.length === 0 ? (
          <div className="chat-welcome">
            <div className="welcome-icon">🤖</div>
            <div className="welcome-title">Ask anything about your knowledge base</div>
            <div className="welcome-subtitle">Responses are grounded exclusively in your uploaded documents.</div>
            <div className="example-queries">
              {EXAMPLE_QUERIES.map((q, i) => (
                <button key={i} className="example-btn" onClick={() => setQuery(q)}>{q}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {history.map((msg, i) => (
              <div key={i} className={`message message-${msg.type}`}>
                {msg.type === 'user' && (
                  <div className="msg-bubble user-bubble">
                    <div className="msg-avatar user-avatar">U</div>
                    <div className="msg-content">
                      <div className="msg-text">{msg.text}</div>
                      <div className="msg-meta">{fmtTime(msg.ts)}</div>
                    </div>
                  </div>
                )}
                {msg.type === 'assistant' && (
                  <div className="msg-bubble assistant-bubble">
                    <div className="msg-avatar sofia-avatar">S</div>
                    <div className="msg-content">
                      {msg.loading ? (
                        <div className="typing-indicator">
                          <span /><span /><span />
                          <span className="typing-label">
                            Thinking{msg.jobId ? ` (job ${msg.jobId.toString().slice(0, 8)})` : ''}…
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="msg-text">{msg.text}</div>
                          <div className="msg-footer">
                            {msg.sources?.length > 0 && (
                              <div className="sources-row">
                                <span className="sources-label">Sources:</span>
                                {msg.sources.map((s, j) => (
                                  <span key={j} className="source-chip">
                                    📄 {s.filename} <span className="source-score">{Math.round(s.relevanceScore * 100)}%</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="msg-meta">
                              {fmtTime(msg.ts)}
                              {msg.fromCache && <span className="cache-badge">⚡ cached</span>}
                              {msg.relevantChunks > 0 && <span className="chunk-badge">{msg.relevantChunks} chunks</span>}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {msg.type === 'error' && (
                  <div className="msg-bubble error-bubble">
                    <div className="msg-avatar error-avatar">!</div>
                    <div className="msg-content">
                      <div className="msg-text error-text">{msg.text}</div>
                      <div className="msg-meta">{fmtTime(msg.ts)}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form className="query-form" onSubmit={handleQuery}>
        <div className="input-wrapper">
          <textarea
            className="query-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
            placeholder="Ask a question about your knowledge base…"
            rows={1}
            disabled={loading}
          />
          <button type="submit" className={`send-btn ${loading ? 'loading' : ''}`} disabled={!query.trim() || loading}>
            {loading ? <span className="spinner" /> : '↑'}
          </button>
        </div>
        <div className="input-hint">
          <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for newline
          {asyncMode && <span className="async-hint"> · Async mode ON</span>}
        </div>
      </form>
    </div>
  );
}

function fmtTime(date) {
  return date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
