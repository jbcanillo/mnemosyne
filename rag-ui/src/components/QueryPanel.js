import React, { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import {
  MessageSquare,
  Trash2,
  Send,
  PanelLeftOpen,
  PanelLeftClose,
  Bot,
  AlertTriangle,
  User,
  FileText,
  Zap,
  Eraser,
  Tag,
  X,
  Copy,
  Share2,
  Info,
} from "lucide-react";
import { ragApi } from "../api";

// Load example queries from environment, fallback to defaults
const EXAMPLE_QUERIES = process.env.REACT_APP_EXAMPLE_QUERIES
  ? JSON.parse(process.env.REACT_APP_EXAMPLE_QUERIES)
  : [
      "What vital data are available on this document?",
      "Summarize the key points in the knowledge base",
      "How does the information in the documents relate to each other?",
      "Who are the persons involved?",
      "When were the events described in the documents?",
    ];

// history and setHistory come from App.js so chat persists across tab switches
export default function QueryPanel({
  history,
  setHistory,
  onLoadingChange,
  onNewMessage,
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [asyncMode, setAsyncMode] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showSessions, setShowSessions] = useState(() => {
    // Open on desktop, closed on mobile
    if (typeof window !== "undefined") {
      return window.innerWidth > 768;
    }
    return true;
  });
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [availableTags, setAvailableTags] = useState([]);
  // Tags are now stored per-session: { sessionId: [tag1, tag2, ...] }
  const [sessionTags, setSessionTags] = useState({});
  // Track which sessions have active processing jobs
  const [processingSessions, setProcessingSessions] = useState({});
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [showMetaSidebar, setShowMetaSidebar] = useState(false);
  const [selectedMetaMsg, setSelectedMetaMsg] = useState(null);
  const [filterDate, setFilterDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const bottomRef = useRef(null);
  const sessionsLoadedRef = useRef(false);

  // Get selected tags for the current session
  const selectedTags = currentSessionId
    ? Array.isArray(sessionTags[currentSessionId])
      ? sessionTags[currentSessionId]
      : []
    : [];

  function setSelectedTags(tags) {
    if (!currentSessionId) return;
    setSessionTags((prev) => ({ ...prev, [currentSessionId]: tags }));
  }

  // Load sessions and tags on mount (only once)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadSessions();
    loadTags();
  }, []);

  async function loadTags() {
    try {
      const data = await ragApi.getTags();
      setAvailableTags(data.tags || []);
    } catch (err) {
      console.warn("Failed to load tags:", err.message);
    }
  }

  function toggleTag(tag) {
    if (!currentSessionId) return;
    const current = sessionTags[currentSessionId] || [];
    const updated = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    setSessionTags((prev) => ({ ...prev, [currentSessionId]: updated }));
    // Persist to server
    ragApi.updateSession(currentSessionId, { tags: updated }).catch((err) => {
      console.warn("Failed to save tags:", err.message);
    });
  }

  function clearSelectedTags() {
    if (!currentSessionId) return;
    setSessionTags((prev) => ({ ...prev, [currentSessionId]: [] }));
    // Persist to server
    ragApi.updateSession(currentSessionId, { tags: [] }).catch((err) => {
      console.warn("Failed to clear tags:", err.message);
    });
  }

  // When switching sessions, the selectedTags will automatically update
  // because it's derived from sessionTags[currentSessionId]

  // Create initial session only after sessions have loaded AND there are truly none
  useEffect(() => {
    if (
      sessionsLoadedRef.current &&
      !sessionsLoading &&
      currentSessionId === null &&
      sessions.length === 0
    ) {
      createNewSession();
    }
  }, [sessionsLoading, currentSessionId, sessions.length]);

  // Scroll to bottom when history changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function loadSessions() {
    try {
      setSessionsLoading(true);
      const r = await ragApi.getSessions();
      // Ensure all sessions have createdAt and lastMessageAt timestamps
      const sessionsWithDates = (r.sessions || []).map((s) => ({
        ...s,
        createdAt:
          s.createdAt || s.created_at || s.created || new Date().toISOString(),
        lastMessageAt:
          s.lastMessageAt ||
          s.modified ||
          s.createdAt ||
          s.created_at ||
          s.created ||
          new Date().toISOString(),
        tags: Array.isArray(s.tags) ? s.tags : [],
      }));
      setSessions(sessionsWithDates);

      // Restore session tags from server
      const tagsMap = {};
      sessionsWithDates.forEach((s) => {
        if (Array.isArray(s.tags) && s.tags.length > 0) {
          tagsMap[s.id] = s.tags;
        }
      });
      setSessionTags(tagsMap);

      // Set current session to the first one if not set
      // Only set current session if we don't already have a valid one
      if (!currentSessionId && sessionsWithDates?.length > 0) {
        setCurrentSessionId(sessionsWithDates[0].id);
        await loadSessionMessages(sessionsWithDates[0].id);
      }
    } catch (err) {
      toast.error("Failed to load sessions: " + err.message);
    } finally {
      setSessionsLoading(false);
      sessionsLoadedRef.current = true;
    }
  }

  // Update session message count and last message time when history changes
  useEffect(() => {
    if (currentSessionId && history.length > 0) {
      const lastMsg = history[history.length - 1];

      setSessions((s) =>
        s.map((sess) => {
          if (sess.id !== currentSessionId) return sess;

          let safeDate = sess.lastMessageAt;

          if (lastMsg.ts) {
            const d = new Date(lastMsg.ts);
            if (!isNaN(d)) {
              // ✅ ALWAYS store ISO string (consistent format)
              safeDate = d.toISOString();
            }
          }

          return {
            ...sess,
            messageCount: history.length,
            lastMessageAt: safeDate,
          };
        }),
      );
    }
  }, [history, currentSessionId]);

  async function loadSessionMessages(sessionId) {
    try {
      const r = await ragApi.getSession(sessionId, 100, 0);
      if (r.messages) {
        // Convert Redis messages to history format
        const messagesConverted = r.messages.map((msg) => ({
          type: msg.type,
          text: msg.text,
          sources: msg.sources || [],
          fromCache: msg.fromCache || false,
          relevantChunks: msg.relevantChunks || 0,
          ts: new Date(msg.ts),
          jobId: msg.jobId,
        }));
        setHistory(messagesConverted);
      }
    } catch (err) {
      console.warn("Failed to load session messages:", err.message);
    }
  }

  async function createNewSession() {
    try {
      const title =
        newSessionTitle.trim() ||
        `Conversation ${new Date().toLocaleTimeString()}`;
      const session = await ragApi.createSession(title);
      // Add createdAt timestamp for display
      const sessionWithDate = {
        ...session,
        createdAt: session.createdAt || new Date().toISOString(),
      };
      setSessions((s) => [sessionWithDate, ...s]);
      setCurrentSessionId(session.id);
      setHistory([]);
      setNewSessionTitle("");
      toast.success("New conversation created");
    } catch (err) {
      toast.error("Failed to create session: " + err.message);
    }
  }

  async function switchSession(sessionId) {
    setCurrentSessionId(sessionId);
    await loadSessionMessages(sessionId);

    // Only auto-close on mobile
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setShowSessions(false);
    }
  }

  async function deleteSession(sessionId, e) {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await ragApi.deleteSession(sessionId);
      setSessions((s) => s.filter((x) => x.id !== sessionId));
      if (currentSessionId === sessionId) {
        if (sessions.length > 1) {
          const newCurrent = sessions.find((x) => x.id !== sessionId);
          await switchSession(newCurrent.id);
        } else {
          createNewSession();
        }
      }
      toast.success("Conversation deleted");
    } catch (err) {
      toast.error("Failed to delete: " + err.message);
    }
  }

  async function renameSession(sessionId, newTitle, e) {
    e.stopPropagation();
    try {
      await ragApi.updateSession(sessionId, { title: newTitle });
      setSessions((s) =>
        s.map((x) => (x.id === sessionId ? { ...x, title: newTitle } : x)),
      );
      toast.success("Conversation renamed");
    } catch (err) {
      toast.error("Failed to rename: " + err.message);
    }
  }

  function startEditingTitle(sessionId, currentTitle) {
    setEditingTitleId(sessionId);
    setEditingTitleValue(currentTitle);
  }

  async function saveEditingTitle() {
    if (!editingTitleId) return;
    const newTitle = editingTitleValue.trim();
    if (!newTitle) {
      toast.error("Title cannot be empty");
      return;
    }
    try {
      await ragApi.updateSession(editingTitleId, { title: newTitle });
      setSessions((s) =>
        s.map((x) => (x.id === editingTitleId ? { ...x, title: newTitle } : x)),
      );
      setEditingTitleId(null);
      setEditingTitleValue("");
      toast.success("Title updated");
    } catch (err) {
      toast.error("Failed to update title: " + err.message);
    }
  }

  function cancelEditingTitle() {
    setEditingTitleId(null);
    setEditingTitleValue("");
  }

  function handleShowMeta(msg) {
    setSelectedMetaMsg(msg);
    setShowMetaSidebar(true);
  }

  function handleCopyResponse(text) {
    if (!text) {
      toast.error("Nothing to copy");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success("Copied response to clipboard (Ctrl+C)");
      })
      .catch((err) => {
        console.warn("Clipboard copy failed", err);
        toast.error("Copy failed; please copy manually.");
      });
  }

  function handleShareResponse(text) {
    if (!text) {
      toast.error("Nothing to share");
      return;
    }

    if (navigator.share) {
      navigator
        .share({
          title: "Mnemosyne response",
          text,
        })
        .catch((err) => {
          console.warn("Web Share failed", err);
          toast.error("Share cancelled or failed");
        });
    } else {
      // Fallback: copy and prompt
      navigator.clipboard
        .writeText(text)
        .then(() => {
          toast.success(
            "No native share available; response copied to clipboard",
          );
        })
        .catch((err) => {
          console.warn("Fallback copy failed", err);
          toast.error("Share not supported on this browser");
        });
    }
  }

  async function handleQuery(e) {
    e?.preventDefault();
    if (!query.trim() || loading) return;
    if (!currentSessionId) {
      toast.error("No conversation selected");
      return;
    }

    const q = query.trim();
    setQuery("");
    setLoading(true);

    // Capture the session ID at query time to avoid issues when switching conversations
    const querySessionId = currentSessionId;

    // Mark this session as processing
    console.log(
      "[QueryPanel] Setting processing state for session:",
      querySessionId,
    );
    setProcessingSessions((prev) => {
      const newState = { ...prev, [querySessionId]: true };
      console.log("[QueryPanel] processingSessions updated:", newState);
      return newState;
    });
    onLoadingChange?.(true);
    console.log("[QueryPanel] onLoadingChange(true) called");

    // Add user message to history
    const userMsg = { type: "user", text: q, ts: new Date() };
    setHistory((h) => [...h, userMsg]);
    onNewMessage?.();

    // Save user message to Redis
    try {
      await ragApi.addMessage(currentSessionId, userMsg);
    } catch (err) {
      console.warn("Failed to save user message:", err);
    }

    const clearProcessing = () => {
      setProcessingSessions((prev) => ({ ...prev, [querySessionId]: false }));
      // Only clear global loading if we're still on the same session
      if (currentSessionId === querySessionId) {
        onLoadingChange?.(false);
      }
    };

    try {
      if (asyncMode) {
        const response = await ragApi.queryAsync(q, {
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });

        // If the server returned a cached result directly (no jobId), render immediately.
        if (!response.jobId && (response.answer || response.fromCache)) {
          const assistantMsg = {
            type: "assistant",
            text: response.answer,
            sources: response.sources,
            fromCache: response.fromCache,
            relevantChunks: response.relevantChunks,
            ts: new Date(),
          };
          setHistory((h) => [...h, assistantMsg]);
          onNewMessage?.();
          try {
            await ragApi.addMessage(currentSessionId, assistantMsg);
          } catch (err) {
            console.warn("Failed to save assistant message:", err);
          }
          clearProcessing();
        } else {
          const assistantMsg = {
            type: "assistant",
            text: null,
            jobId: response.jobId,
            loading: true,
            ts: new Date(),
          };
          setHistory((h) => [...h, assistantMsg]);
          onNewMessage?.();
          try {
            await ragApi.addMessage(currentSessionId, assistantMsg);
          } catch (err) {
            console.warn("Failed to save assistant message:", err);
          }
          pollJob(response.jobId, clearProcessing);
        }
      } else {
        const result = await ragApi.query(q, {
          includeChunks: true,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });

        // Auto-name session if it's still generic on first query
        if (currentSessionId && sessions.length > 0) {
          const sess = sessions.find((s) => s.id === currentSessionId);
          if (sess && sess.title?.includes("Conversation")) {
            const newTitle = q.substring(0, 50) + (q.length > 50 ? "..." : "");
            try {
              setSessions((s) =>
                s.map((x) =>
                  x.id === currentSessionId ? { ...x, title: newTitle } : x,
                ),
              );
              await ragApi.updateSession(currentSessionId, { title: newTitle });
            } catch (err) {
              console.warn("Failed to auto-name session:", err);
            }
          }
        }

        const assistantMsg = {
          type: "assistant",
          text: result.answer,
          sources: result.sources,
          fromCache: result.fromCache,
          relevantChunks: result.relevantChunks,
          ts: new Date(),
        };
        setHistory((h) => [...h, assistantMsg]);
        onNewMessage?.();

        // Save to Redis
        try {
          await ragApi.addMessage(currentSessionId, assistantMsg);
        } catch (err) {
          console.warn("Failed to save assistant message:", err);
        }
        // Sync mode: clear processing immediately after response
        clearProcessing();
      }
    } catch (err) {
      const errorMsg = { type: "error", text: err.message, ts: new Date() };
      setHistory((h) => [...h, errorMsg]);
      // Save error to Redis
      try {
        await ragApi.addMessage(currentSessionId, errorMsg);
      } catch (saveErr) {
        console.warn("Failed to save error message:", saveErr);
      }
      toast.error(err.message);
      clearProcessing();
    } finally {
      setLoading(false);
    }
  }

  async function pollJob(jobId, onDone) {
    let failureCount = 0;
    const poll = async () => {
      try {
        const status = await ragApi.getJobStatus(jobId);
        failureCount = 0; // Reset on success

        if (status.state === "completed") {
          const result = status.result;
          const assistantMsg = {
            type: "assistant",
            text: result.answer,
            sources: result.sources,
            fromCache: result.fromCache,
            relevantChunks: result.relevantChunks,
            ts: new Date(),
          };
          setHistory((h) =>
            h.map((m) =>
              m.jobId === jobId ? { ...m, loading: false, ...assistantMsg } : m,
            ),
          );
          // Save completed message to Redis
          try {
            await ragApi.addMessage(currentSessionId, assistantMsg);
          } catch (err) {
            console.warn("Failed to save async result:", err);
          }
          onDone();
          return;
        }
        if (status.state === "failed") {
          setHistory((h) =>
            h.map((m) =>
              m.jobId === jobId
                ? {
                    ...m,
                    loading: false,
                    type: "error",
                    text: status.failedReason,
                  }
                : m,
            ),
          );
          // Save error to Redis
          try {
            const errorMsg = {
              type: "error",
              text: status.failedReason,
              ts: new Date(),
            };
            await ragApi.addMessage(currentSessionId, errorMsg);
          } catch (err) {
            console.warn("Failed to save error:", err);
          }
          onDone();
          return;
        }
        setTimeout(poll, 1500);
      } catch (err) {
        // Exponential backoff on errors (rate limit or network issues)
        failureCount++;
        const backoffDelay = 1500 * Math.pow(1.5, Math.min(failureCount, 3));
        console.warn(
          `[Poll job ${jobId}] Error (attempt ${failureCount}), backing off ${Math.round(backoffDelay)}ms:`,
          err.message,
        );
        setTimeout(poll, backoffDelay);
      }
    };
    setTimeout(poll, 500);
  }

  async function clearChat() {
    if (currentSessionId) {
      try {
        await ragApi.clearSession(currentSessionId);
      } catch (err) {
        console.warn("Failed to clear session:", err);
      }
    }
    setHistory([]);
    toast.success("Conversation cleared");
  }

  async function clearAllChats() {
    if (!window.confirm("Delete ALL conversations? This cannot be undone."))
      return;
    try {
      for (const s of sessions) {
        await ragApi.deleteSession(s.id);
      }
      setSessions([]);
      setCurrentSessionId(null);
      setHistory([]);
      sessionsLoadedRef.current = false;
      await loadSessions();
      toast.success("All conversations deleted");
    } catch (err) {
      toast.error("Failed to clear all: " + err.message);
    }
  }

  const filteredSessions = sessions.filter((s) => {
    const sessionTs = s.lastMessageAt || s.createdAt;
    if (!sessionTs || typeof sessionTs !== "string") return false;
    const sessionDate = String(sessionTs).split("T")[0];
    return sessionDate === filterDate;
  });

  return (
    <div className="query-panel">
      {/* ── Sidebar: Conversations ── */}
      <aside className={`conv-sidebar ${showSessions ? "open" : "closed"}`}>
        <div className="conv-sidebar-header">
          <span className="conv-sidebar-title">
            <MessageSquare size={14} /> Conversations
          </span>
        </div>

        {showSessions && (
          <div className="conv-sidebar-content">
            <div className="conv-new">
              <input
                type="text"
                placeholder="New conversation name..."
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                className="conv-input"
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={createNewSession}
                disabled={sessionsLoading}
              >
                + New
              </button>
            </div>

            {/* Date filter */}
            <div className="conv-filter-date">
              <label className="conv-filter-label">Show by date:</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="conv-date-input"
                title="Filter conversations by date"
              />
            </div>

            <div className="conv-list">
              {sessionsLoading ? (
                <div className="conv-empty">Loading...</div>
              ) : filteredSessions.length === 0 ? (
                <div className="conv-empty">No conversations on this date</div>
              ) : (
                <div className="conv-items">
                  {filteredSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`conv-item ${currentSessionId === session.id ? "active" : ""}`}
                      onClick={() => switchSession(session.id)}
                    >
                      <div className="conv-item-text">
                        <div className="conv-item-title">
                          {session.title}
                          {processingSessions[session.id] && (
                            <span className="conv-processing-dot">
                              <span />
                              <span />
                              <span />
                            </span>
                          )}
                        </div>
                        <div className="conv-item-meta">
                          <span>{session.messageCount || 0} msgs</span>
                          {session.lastMessageAt && (
                            <span className="conv-item-date">
                              {new Date(
                                session.lastMessageAt,
                              ).toLocaleDateString()}
                              {new Date(
                                session.lastMessageAt,
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        className="btn-icon btn-danger btn-xs conv-delete"
                        onClick={(e) => deleteSession(session.id, e)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Clear All button at bottom of sidebar */}
            {sessions.length > 0 && (
              <div className="conv-sidebar-footer">
                <button
                  className="btn btn-danger btn-xs btn-clear-all"
                  onClick={clearAllChats}
                >
                  <Eraser size={12} /> Clear All Conversations
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Main: Chat area ── */}
      <div className="query-main">
        {/* Top bar */}
        <div className="query-topbar">
          <button
            className="btn-icon btn-ghost border-none outline-none"
            onClick={() => setShowSessions(!showSessions)}
            title="Toggle conversations"
          >
            {showSessions ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>
          {editingTitleId === currentSessionId ? (
            <div className="query-topbar-title-edit">
              <input
                type="text"
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditingTitle();
                  if (e.key === "Escape") cancelEditingTitle();
                }}
                autoFocus
                className="query-topbar-title-input"
              />
              <button
                className="btn btn-xs btn-success"
                onClick={saveEditingTitle}
              >
                Save
              </button>
              <button
                className="btn btn-xs btn-ghost"
                onClick={cancelEditingTitle}
              >
                Cancel
              </button>
            </div>
          ) : (
            <span
              className="query-topbar-title"
              onClick={() =>
                currentSessionId &&
                startEditingTitle(
                  currentSessionId,
                  sessions.find((s) => s.id === currentSessionId)?.title ||
                    "New Conversation",
                )
              }
              title="Click to edit title"
            >
              {sessions.find((s) => s.id === currentSessionId)?.title ||
                "New Conversation"}
            </span>
          )}
          <div className="query-topbar-actions">
            <label className="toggle-wrap">
              <span className="toggle-label">Async</span>
              <input
                type="checkbox"
                checked={asyncMode}
                onChange={(e) => setAsyncMode(e.target.checked)}
                className="toggle-input"
              />
              <span className="toggle-slider" />
            </label>
            {history.length > 0 && (
              <button className="btn btn-ghost btn-xs" onClick={clearChat}>
                Clear Chat
              </button>
            )}
          </div>
        </div>

        {/* Chat messages */}
        <div className="chat-area">
          {history.length === 0 ? (
            <div className="chat-welcome">
              <div className="welcome-icon">
                <MessageSquare size={48} />
              </div>
              <div className="welcome-title">
                Ask anything about your knowledge base
              </div>
              <div className="welcome-subtitle">
                Responses are grounded exclusively in your uploaded documents.
              </div>
              <div className="example-queries">
                {EXAMPLE_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    className="example-btn"
                    onClick={() => setQuery(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {history.map((msg, i) => (
                <div key={i} className={`message message-${msg.type}`}>
                  {msg.type === "user" && (
                    <div className="msg-bubble user-bubble">
                      <div className="msg-avatar user-avatar">
                        <User size={16} />
                      </div>
                      <div className="msg-content">
                        <div className="msg-text">{msg.text}</div>
                        <div className="msg-meta">{fmtTime(msg.ts)}</div>
                      </div>
                    </div>
                  )}
                  {msg.type === "assistant" && (
                    <div className="msg-bubble assistant-bubble">
                      <div className="msg-avatar sofia-avatar">
                        <Bot size={16} />
                      </div>
                      <div className="msg-content">
                        {msg.loading ? (
                          <div className="typing-indicator">
                            <span />
                            <span />
                            <span />
                            <span className="typing-label">
                              Thinking
                              {msg.jobId
                                ? ` (job ${msg.jobId.toString().slice(0, 8)})`
                                : ""}
                              …
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="msg-text">{msg.text}</div>
                            <div className="msg-footer">
                              <div className="msg-meta-row">
                                <div className="msg-meta">
                                  {fmtTime(msg.ts)}
                                </div>
                                <div className="msg-actions-bottom">
                                  <button
                                    type="button"
                                    className="msg-action-btn msg-action-btn-small"
                                    onClick={() => handleShowMeta(msg)}
                                    title="View metadata"
                                  >
                                    <Info size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="msg-action-btn msg-action-btn-small"
                                    onClick={() => handleCopyResponse(msg.text)}
                                    title="Copy response (Ctrl+C)"
                                  >
                                    <Copy size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="msg-action-btn msg-action-btn-small"
                                    onClick={() =>
                                      handleShareResponse(msg.text)
                                    }
                                    title="Share response"
                                  >
                                    <Share2 size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {msg.type === "error" && (
                    <div className="msg-bubble error-bubble">
                      <div className="msg-avatar error-avatar">
                        <AlertTriangle size={16} />
                      </div>
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
          {/* Tag selector - per conversation */}
          {availableTags.length > 0 && (
            <div className="chat-tag-selector">
              <div className="chat-tag-label">
                <Tag size={12} /> Filter by tags
              </div>
              <div className="chat-tag-chips">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`chat-tag-chip ${selectedTags.includes(tag) ? "active" : ""}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs chat-tag-clear"
                  onClick={clearSelectedTags}
                >
                  <X size={10} /> Unfilter
                </button>
              )}
            </div>
          )}
          <div className="input-wrapper">
            <textarea
              className="query-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleQuery();
                }
              }}
              placeholder="Type your inquiry here..."
              rows={2}
              disabled={loading}
            />
            <button
              type="submit"
              className={`send-btn ${loading ? "loading" : ""}`}
              disabled={!query.trim() || loading}
            >
              {loading ? <span className="spinner" /> : <Send size={16} />}
            </button>
          </div>
          <div className="input-hint">
            <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for newline
          </div>
        </form>
      </div>

      {/* Meta Sidebar */}
      {showMetaSidebar && selectedMetaMsg && (
        <div
          className="meta-sidebar-overlay"
          onClick={() => setShowMetaSidebar(false)}
        >
          <div className="meta-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="meta-sidebar-header">
              <span>Message Details</span>
              <button
                className="btn-icon btn-ghost"
                onClick={() => setShowMetaSidebar(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="meta-sidebar-content">
              <div className="meta-item">
                <strong>Timestamp:</strong> {fmtDateTime(selectedMetaMsg.ts)}
              </div>
              {selectedMetaMsg.fromCache && (
                <div className="meta-item">
                  <strong>Status:</strong>{" "}
                  <span className="cache-badge">
                    <Zap size={10} /> Cached
                  </span>
                </div>
              )}
              {selectedMetaMsg.relevantChunks > 0 && (
                <div className="meta-item">
                  <strong>Chunks:</strong> {selectedMetaMsg.relevantChunks}
                </div>
              )}
              {selectedMetaMsg.sources?.length > 0 && (
                <div className="meta-item">
                  <strong>Sources:</strong>
                  <div className="meta-sources">
                    {selectedMetaMsg.sources.map((s, j) => (
                      <div key={j} className="meta-source-item">
                        <FileText size={12} /> {s.filename} (
                        {Math.round(s.relevanceScore * 100)}%)
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(date) {
  return date
    ? new Date(date).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

function fmtDateTime(date) {
  if (!date) return "";
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
}
