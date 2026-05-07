import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import {
  Bot,
  Package,
  Plus,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  Save,
  Network,
  FolderOpen,
  Download,
  Upload,
  Database,
  HardDrive,
  Cloud,
  Shield
} from "lucide-react";
import { ragApi } from "../api";

export default function SettingsPanel({ onRefresh }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");

  // Model management state
  const [models, setModels] = useState([]);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [model, setModel] = useState(""); // FIX: was referenced in loadModels/JSX but never declared
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelType, setNewModelType] = useState("openrouter");
  const [addingModel, setAddingModel] = useState(false);
  const [deletingModel, setDeletingModel] = useState(null);
  const [resettingModels, setResettingModels] = useState(false);
  const [testingModel, setTestingModel] = useState(null);
  const [testResults, setTestResults] = useState({});

  // LLM Engine state
  const [llmEngine, setLlmEngine] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");
  const [ollamaModelStatus, setOllamaModelStatus] = useState("unknown"); // FIX: was used throughout but never declared
  const [ollamaDownloadProgress, setOllamaDownloadProgress] = useState(null);

  // System prompt & RAG settings
  const [systemPrompt, setSystemPrompt] = useState("");
  const [minScore, setMinScore] = useState("");
  const [topK, setTopK] = useState("");
  const [cacheTtl, setCacheTtl] = useState("");
  const [chunkSize, setChunkSize] = useState("");
  const [chunkOvlp, setChunkOvlp] = useState("");

  // Data management state
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [backups, setBackups] = useState([]);

  useEffect(() => {
    loadSettings();
    loadModels();
    loadOllamaModels();
    loadBackups();
  }, []);

  // ── Settings & Models ────────────────────────────────────────────────
  async function loadSettings() {
    setLoading(true);
    try {
      const s = await ragApi.getSettings();
      setSettings(s);
      setLlmEngine(s.llmEngine || "");
      setLocalModel(s.localLlmModel || "llama3.2");
      if (s.openrouterApiKey) setApiKey(s.openrouterApiKey);
      setSystemPrompt(
        s.systemPrompt ||
          `You are Mnemosyne, an AI assistant for a RAG knowledge base system.
Answer questions STRICTLY based on the provided context documents.

RULES:
1. Only use information from the context. Never invent or assume facts.
2. If the answer is not in the context, say: "I don't have information about that in the knowledge base."
3. Be concise and direct. For External Chat Apps: plain text only, no markdown, under 1500 words.`,
      );
      setMinScore(String(s.minRelevanceScore ?? "0.15"));
      setTopK(String(s.topK ?? "5"));
      setCacheTtl(String(s.cacheTtl ?? "3600"));
      setChunkSize(String(s.chunkSize ?? "500"));
      setChunkOvlp(String(s.chunkOverlap ?? "50"));
    } catch (err) {
      toast.error("Failed to load settings: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadModels() {
    try {
      const r = await ragApi.getModels();
      setModels(r.models || []);
      const active = (r.models || []).find((m) => m.active);
      if (active) setModel(active.id);
    } catch (err) {
      console.warn("Failed to load models:", err.message);
    }
  }

  async function loadOllamaModels() {
    try {
      const r = await ragApi.getOllamaModels();
      setOllamaModels(r.models || []);
      // FIX: guard against empty/undefined array before accessing index 0
      if (!localModel && r.models && r.models.length > 0) {
        setLocalModel(r.models[0].name);
      }
    } catch (err) {
      console.warn("Failed to load Ollama models:", err.message);
    }
  }

  async function handleTestApiKey() {
    setSaving(true);
    try {
      const result = await ragApi.testApiKey();
      if (result.ok) {
        toast.success(`Connection successful! (${result.tokens} tokens used)`);
      } else {
        toast.error(`Test failed: ${result.error}`);
      }
    } catch (err) {
      toast.error("Test failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // Save all settings including API key if changed
  async function saveModelSettings() {
    setSaving(true);
    try {
      const updates = {
        llmEngine: llmEngine || undefined,
        systemPrompt: systemPrompt || undefined,
        openrouterModel: model,
        localLlmModel: localModel,
        minRelevanceScore: parseFloat(minScore),
        topK: parseInt(topK),
        cacheTtl: parseInt(cacheTtl),
        chunkSize: parseInt(chunkSize),
        chunkOverlap: parseInt(chunkOvlp),
      };
      if (apiKey.trim()) {
        updates.openrouterApiKey = apiKey.trim();
      }
      await ragApi.updateSettings(updates);
      toast.success("Settings saved");
      onRefresh?.();
    } catch (err) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Combined Model Management ────────────────────────────────────────
  async function handleAddModel() {
    if (!newModelId.trim() || !newModelName.trim()) return;
    setAddingModel(true);
    try {
      if (newModelType === "openrouter") {
        await ragApi.addModel(newModelId.trim(), newModelName.trim());
      } else {
        // Ollama: check if model exists, pull if needed, then set as active
        setOllamaModelStatus("checking");
        const modelId = newModelId.trim();
        try {
          // Check existence
          let checkResult = await ragApi.checkLocalModel({ model: modelId });
          if (!checkResult.exists) {
            // Pull the model
            await ragApi.pullLocalModel({ model: modelId });
            toast.success(`Ollama model "${modelId}" pulled successfully`);
            // Re-check after pull to get exact name
            checkResult = await ragApi.checkLocalModel({ model: modelId });
            if (!checkResult.exists) {
              throw new Error("Model still not found after pull");
            }
          } else {
            toast.success(`Ollama model "${modelId}" is available`);
          }
          // Find exact model name (e.g., "llama3.2:latest" vs "llama3.2")
          const exactMatch = checkResult.models.find((name) =>
            name.toLowerCase().includes(modelId.toLowerCase()),
          );
          const exactModelName = exactMatch || modelId;
          // Set as active local model
          setLocalModel(exactModelName);
          await ragApi.updateSettings({ localLlmModel: exactModelName });
          // Refresh the Ollama models list
          await loadOllamaModels();
        } finally {
          setOllamaModelStatus("available");
        }
      }
      setNewModelId("");
      setNewModelName("");
      await loadModels();
    } catch (err) {
      toast.error("Failed to add model: " + err.message);
    } finally {
      setAddingModel(false);
    }
  }

  async function handleDeleteModel(modelId, type) {
    if (type === "openrouter" && models.find((m) => m.id === modelId)?.active) {
      toast.error("Cannot delete active model. Switch first.");
      return;
    }
    if (type === "ollama" && modelId === localModel) {
      toast.error("Cannot delete active local model. Select another first.");
      return;
    }
    if (!confirm(`Delete ${type} model "${modelId}"?`)) return;
    setDeletingModel(modelId);
    try {
      if (type === "openrouter") {
        await ragApi.deleteModel(modelId);
      } else {
        // Ollama models can't be deleted via API — user must do in Ollama container
        toast.error(
          "Deleting Ollama models not supported via UI. Use: ollama rm " +
            modelId,
        );
        setDeletingModel(null);
        return;
      }
      toast.success("Model deleted");
      await loadModels();
    } catch (err) {
      toast.error("Failed: " + err.message);
    } finally {
      setDeletingModel(null);
    }
  }

  async function handleTestModel(modelId) {
    setTestingModel(modelId);
    setTestResults((prev) => ({ ...prev, [modelId]: null }));
    try {
      const result = await ragApi.testModel(modelId);
      if (result.ok) {
        setTestResults((prev) => ({
          ...prev,
          [modelId]: { ok: true, reply: result.reply, tokens: result.tokens },
        }));
        toast.success(
          `Model "${modelId}" test successful! (${result.tokens} tokens)`,
        );
      } else {
        setTestResults((prev) => ({
          ...prev,
          [modelId]: { ok: false, error: result.error },
        }));
        toast.error(`Test failed: ${result.error}`);
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [modelId]: { ok: false, error: err.message },
      }));
      toast.error("Test failed: " + err.message);
    } finally {
      setTestingModel(null);
    }
  }

  async function handleCheckOllamaModel(modelName) {
    setSelectedOllamaModel(modelName);
    if (!modelName) return;
    setOllamaModelStatus("checking");
    try {
      const r = await ragApi.checkLocalModel({ model: modelName });
      setOllamaModelStatus(r.exists ? "available" : "not_found");
    } catch (err) {
      setOllamaModelStatus("unknown");
      toast.error("Check failed: " + err.message);
    }
  }

  async function handlePullOllamaModel(modelName) {
    setSelectedOllamaModel(modelName);
    setOllamaModelStatus("downloading");
    try {
      await ragApi.pullLocalModel({ model: modelName });
      setOllamaModelStatus("available");
      toast.success(`Model "${modelName}" downloaded`);
      await loadOllamaModels();
    } catch (err) {
      setOllamaModelStatus("not_found");
      toast.error("Download failed: " + err.message);
    }
  }

  async function handleSelectOllamaModel(modelName) {
    setLocalModel(modelName);
    try {
      await ragApi.updateSettings({ localLlmModel: modelName });
      toast.success(`Local model set to "${modelName}"`);
      onRefresh?.();
    } catch (err) {
      toast.error("Failed to set model: " + err.message);
    }
  }

  // ── Data Management ──────────────────────────────────────────────────
  async function loadBackups() {
    try {
      const r = await ragApi.listBackups();
      setBackups(r.backups || []);
    } catch (err) {
      console.warn("Failed to load backups:", err.message);
    }
  }

  // ── API Key Management ────────────────────────────────────────
  async function loadApiKeys() {
    setLoadingKeys(true);
    try {
      const r = await ragApi.getApiKeys();
      setApiKeys(r.keys || []);
    } catch (err) {
      toast.error("Failed to load API keys: " + err.message);
    } finally {
      setLoadingKeys(false);
    }
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }
    setCreatingKey(true);
    try {
      const r = await ragApi.createApiKey(newKeyName.trim());
      setNewlyCreatedKey(r.key);
      setNewKeyName("");
      await loadApiKeys();
      toast.success("API key created successfully");
    } catch (err) {
      toast.error("Failed to create API key: " + err.message);
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleDeleteApiKey(id) {
    if (!window.confirm("Delete this API key? This cannot be undone.")) return;
    try {
      await ragApi.deleteApiKey(id);
      await loadApiKeys();
      toast.success("API key deleted");
    } catch (err) {
      toast.error("Failed to delete: " + err.message);
    }
  }

  async function handleToggleApiKey(id) {
    try {
      await ragApi.toggleApiKey(id);
      await loadApiKeys();
    } catch (err) {
      toast.error("Failed to toggle key: " + err.message);
    }
  }

  async function clearCache() {
    setClearing(true);
    try {
      const r = await ragApi.clearCache();
      toast.success(r.message || "Cache cleared");
      onRefresh?.();
    } catch (err) {
      toast.error("Failed: " + err.message);
    } finally {
      setClearing(false);
    }
  }

  async function resetVectorStore() {
    if (
      !window.confirm(
        "Delete ALL indexed chunks? You will need to re-upload documents.",
      )
    )
      return;
    setResetting(true);
    try {
      await ragApi.resetVectorStore();
      toast.success("Vector store reset");
      onRefresh?.();
    } catch (err) {
      toast.error("Reset failed: " + err.message);
    } finally {
      setResetting(false);
    }
  }

  async function createBackup() {
    if (!window.confirm("Create a backup of knowledge base and config?"))
      return;
    setBackupProgress("Starting...");
    try {
      const r = await ragApi.createBackup();
      toast.success(`Backup created: ${r.filename} (${r.size} MB)`);
      await loadBackups();
      setBackupProgress(null);
    } catch (err) {
      toast.error("Backup failed: " + err.message);
      setBackupProgress(null);
    }
  }

  async function restoreBackup(filename) {
    if (
      !window.confirm(
        `Restore from ${filename}? This will replace your current knowledge base!`,
      )
    )
      return;
    setRestoring(true);
    try {
      await ragApi.restoreBackup(filename);
      toast.success("Restore complete! System restarting...");
      setTimeout(() => window.location.reload(), 3000);
    } catch (err) {
      toast.error("Restore failed: " + err.message);
      setRestoring(false);
    }
  }

  async function deleteBackup(filename) {
    if (!window.confirm(`Delete backup "${filename}"? This cannot be undone.`))
      return;
    try {
      await ragApi.deleteBackup(filename);
      toast.success("Backup deleted");
      await loadBackups();
    } catch (err) {
      toast.error("Failed: " + err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────

  if (loading)
    return (
      <div className="settings-loading">
        <span className="spinner-lg" /> Loading settings…
      </div>
    );

  const showLocalSection =
    llmEngine === "local" || (!llmEngine && !settings?.openrouterApiKey);
  const showOpenRouterSection =
    llmEngine === "openrouter" ||
    (llmEngine === "" && !!settings?.openrouterApiKey);

  return (
    <div className="settings-panel">
      {/* ── Model & LLM Settings ── */}
      <div className="sp-card">
        <div className="sp-card-header">
          <div className="sp-card-title">
            <span className="sp-card-icon">
              <Bot size={16} />
            </span>
            Model & LLM Settings
          </div>
        </div>

        <div className="sp-card-body">
          {/* FIX: replaced <form onSubmit={saveModelSettings}> with <div> + onClick */}
          <div className="settings-form">
            {/* LLM Engine selector */}
            <div className="form-group">
              <label className="form-label">LLM Engine</label>
              <select
                className="sp-select"
                value={llmEngine}
                onChange={(e) => setLlmEngine(e.target.value)}
              >
                <option value="">
                  Auto (OpenRouter if key set, else Local)
                </option>
                <option value="openrouter">OpenRouter (cloud)</option>
                <option value="local">Local Ollama</option>
              </select>
              <div className="form-hint">
                {showLocalSection
                  ? "Using local Ollama models — no API key needed"
                  : "Uses OpenRouter cloud API — requires API key"}
              </div>
            </div>

            {/* OpenRouter Section */}
            {showOpenRouterSection && (
              <>
                <div className="form-group">
                  <label className="form-label">OpenRouter API Key</label>
                  <div className="key-input-wrap">
                    <input
                      className="sp-input"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        settings?.openrouterApiKey
                          ? "Leave empty to keep current key"
                          : "sk-or-v1-…"
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="key-toggle"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm test-key-btn"
                      onClick={handleTestApiKey}
                      disabled={saving || !settings?.openrouterApiKey}
                      title={
                        settings?.openrouterApiKey
                          ? "Test current saved API key"
                          : "No API key configured yet"
                      }
                    >
                      {saving ? (
                        <span className="spinner-xs" />
                      ) : (
                        <Network size={14} />
                      )}
                      Test
                    </button>
                  </div>
                  <div className="form-hint">
                    Get a free key at{" "}
                    <a
                      href="https://openrouter.ai"
                      target="_blank"
                      rel="noreferrer"
                      className="sp-link"
                    >
                      openrouter.ai
                    </a>{" "}
                    → Keys → Create Key. Changes to the key are saved with the
                    main "Save Settings" button below.
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Active OpenRouter Model</label>
                  <select
                    className="sp-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">-- Select a model --</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.active ? "★ " : ""}
                        {m.name} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Local Ollama Section */}
            {showLocalSection && (
              <>
                <div className="form-group">
                  <label className="form-label">
                    Active Local Ollama Model
                  </label>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "flex-end",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <select
                        className="sp-select"
                        value={localModel}
                        onChange={(e) => {
                          setLocalModel(e.target.value);
                          setOllamaModelStatus("unknown"); // reset status on model change
                        }}
                      >
                        <option value="">-- Select a model --</option>
                        {ollamaModels.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleCheckOllamaModel(localModel)}
                      disabled={!localModel || ollamaModelStatus === "checking"}
                    >
                      {ollamaModelStatus === "checking" ? (
                        <>
                          <span className="spinner-xs" /> Checking…
                        </>
                      ) : (
                        "✓ Check"
                      )}
                    </button>
                  </div>

                  {ollamaModelStatus === "available" && (
                    <div
                      className="form-hint"
                      style={{ color: "var(--color-success)" }}
                    >
                      ✓ Model available
                    </div>
                  )}

                  {ollamaModelStatus === "not_found" && (
                    <div style={{ marginTop: "8px" }}>
                      <div
                        className="form-hint"
                        style={{ color: "var(--color-danger)" }}
                      >
                        Model not found in Ollama
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handlePullOllamaModel(localModel)}
                        disabled={!localModel}
                      >
                        <Download size={14} /> Download Model
                      </button>
                    </div>
                  )}

                  {ollamaModelStatus === "downloading" && (
                    <div
                      style={{
                        marginTop: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span className="spinner-xs" />
                      <span style={{ color: "var(--color-warning)" }}>
                        Downloading model, please wait…
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* System Prompt */}
            <div className="form-group">
              <label className="form-label">System Prompt</label>
              <textarea
                className="sp-input"
                rows="6"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter system prompt for AI behavior..."
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              />
              <div className="form-hint">
                Defines the AI's behavior. Default enforces strict RAG (no
                hallucination).
              </div>
            </div>

            {/* RAG tuning */}
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Min Relevance Score</label>
                <input
                  className="sp-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                />
                <div className="form-hint">
                  0–1. Lower = more results. Default: 0.15
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Top-K Chunks</label>
                <input
                  className="sp-input"
                  type="number"
                  min="1"
                  max="20"
                  value={topK}
                  onChange={(e) => setTopK(e.target.value)}
                />
                <div className="form-hint">Chunks per query. Default: 5</div>
              </div>
              <div className="form-group">
                <label className="form-label">Cache TTL (seconds)</label>
                <input
                  className="sp-input"
                  type="number"
                  min="0"
                  value={cacheTtl}
                  onChange={(e) => setCacheTtl(e.target.value)}
                />
                <div className="form-hint">Cache duration. Default: 3600</div>
              </div>
              <div className="form-group">
                <label className="form-label">Chunk Size (words)</label>
                <input
                  className="sp-input"
                  type="number"
                  min="50"
                  max="2000"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(e.target.value)}
                />
                <div className="form-hint">Words per chunk. Default: 500</div>
              </div>
              <div className="form-group">
                <label className="form-label">Chunk Overlap (words)</label>
                <input
                  className="sp-input"
                  type="number"
                  min="0"
                  max="500"
                  value={chunkOvlp}
                  onChange={(e) => setChunkOvlp(e.target.value)}
                />
                <div className="form-hint">
                  Overlap between chunks. Default: 50
                </div>
              </div>
            </div>

            {/* FIX: onClick instead of type="submit" */}
            <button
              className="btn btn-primary"
              onClick={saveModelSettings}
              disabled={saving}
              style={{ width: "auto", alignSelf: "flex-start" }}
            >
              {saving ? <span className="spinner-xs" /> : <Save size={14} />}{" "}
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* ── Manage LLM Models ── */}
      <div className="sp-card">
        {/* ── Manage LLM Models ── */}
        <div className="sp-card">
          <div className="sp-card-header">
            <div className="sp-card-title">
              <span className="sp-card-icon">
                <Package size={16} />
              </span>
              Manage LLM Models
            </div>
          </div>

          <div className="sp-card-body">
            <p className="sp-desc">
              Add and manage models for both OpenRouter and local Ollama.
            </p>

            {/* FIX: replaced <form onSubmit={handleAddModel}> with <div> + onClick */}
            <div
              className="add-model-form"
              style={{ display: "flex", gap: "8px", marginBottom: "16px" }}
            >
              <select
                className="sp-input"
                style={{ width: "150px" }}
                value={newModelType}
                onChange={(e) => setNewModelType(e.target.value)}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama</option>
              </select>
              <input
                className="sp-input"
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder={
                  newModelType === "openrouter"
                    ? "Model ID (e.g., openai/gpt-4o-mini:free)"
                    : "Ollama model (e.g., llama3.2)"
                }
                style={{ flex: 1 }}
              />
              <input
                className="sp-input"
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="Display name"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleAddModel}
                disabled={
                  addingModel || !newModelId.trim() || !newModelName.trim()
                }
              >
                {addingModel ? (
                  <span className="spinner-xs" />
                ) : (
                  <Plus size={14} />
                )}{" "}
                Add
              </button>
            </div>

            {/* Combined Model List */}
            <div className="models-list">
              {/* OpenRouter Models */}
              <div style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Cloud size={14} /> OpenRouter Models
                </div>
                {models.length === 0 ? (
                  <div className="models-empty">
                    No OpenRouter models configured.
                  </div>
                ) : (
                  models.map((m) => (
                    <div
                      key={`or-${m.id}`}
                      className="model-item"
                      style={{ borderLeft: "3px solid var(--color-accent)" }}
                    >
                      <div className="model-info">
                        <div className="model-name">
                          {m.active && (
                            <span className="model-active-badge">★ Active</span>
                          )}
                          {m.name}
                        </div>
                        <div className="model-id">{m.id}</div>
                      </div>
                      <div className="model-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteModel(m.id, "openrouter")}
                          disabled={deletingModel === m.id || m.active}
                          title={
                            m.active ? "Cannot delete active model" : "Delete"
                          }
                        >
                          {deletingModel === m.id ? (
                            <span className="spinner-xs" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Ollama Models */}
              <div>
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <HardDrive size={14} /> Ollama Models
                </div>
                {ollamaModels.length === 0 ? (
                  <div className="models-empty">
                    No Ollama models available. Pull models in the Ollama
                    container.
                  </div>
                ) : (
                  ollamaModels.map((m) => (
                    <div
                      key={`ollama-${m.name}`}
                      className="model-item"
                      style={{ borderLeft: "3px solid var(--color-success)" }}
                    >
                      <div className="model-info">
                        <div className="model-name">
                          {m.name === localModel && (
                            <span className="model-active-badge">★ Active</span>
                          )}
                          {m.name}
                        </div>
                        <div className="model-id">
                          Size: {(m.size / 1024 / 1024 / 1024).toFixed(2)} GB
                        </div>
                      </div>
                      <div className="model-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteModel(m.name, "ollama")}
                          disabled={
                            deletingModel === m.name || m.name === localModel
                          }
                          title={
                            m.name === localModel
                              ? "Cannot delete active model"
                              : "Delete"
                          }
                        >
                          {deletingModel === m.name ? (
                            <span className="spinner-xs" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Data Management ── */}
        <div className="sp-card">
          <div className="sp-card-header">
            <div className="sp-card-title">
              <span className="sp-card-icon">
                <FolderOpen size={16} />
              </span>
              Data Management
            </div>
          </div>

          <div className="sp-card-body">
            <div className="mgmt-grid">
              <div className="mgmt-card">
                <div className="mgmt-card-title">
                  <Database size={14} /> Query Cache
                </div>
                <div className="mgmt-card-detail">
                  Clears cached query results
                </div>
                <button
                  className="btn btn-danger btn-xs"
                  onClick={clearCache}
                  disabled={clearing}
                >
                  {clearing ? (
                    "Clearing…"
                  ) : (
                    <>
                      <Trash2 size={12} /> Clear Cache
                    </>
                  )}
                </button>
              </div>
              <div className="mgmt-card">
                <div className="mgmt-card-title">
                  <Shield size={14} /> Vector Store
                </div>
                <div className="mgmt-card-detail">
                  Resets all indexed chunks
                </div>
                <button
                  className="btn btn-danger btn-xs"
                  onClick={resetVectorStore}
                  disabled={resetting}
                >
                  {resetting ? (
                    "Resetting…"
                  ) : (
                    <>
                      <Shield size={12} /> Reset Collection
                    </>
                  )}
                </button>
              </div>
              <div className="mgmt-card mgmt-card-full">
                <div className="mgmt-card-title">
                  <Download size={14} /> Backup & Restore
                </div>
                <div className="mgmt-card-detail">Knowledge base backup</div>
                <div className="mgmt-actions">
                  <button
                    className="btn btn-primary"
                    onClick={createBackup}
                    disabled={!!backupProgress || restoring}
                  >
                    {backupProgress ? (
                      "Creating..."
                    ) : (
                      <>
                        <Download size={12} /> Create Backup
                      </>
                    )}
                  </button>
                </div>
                {backups.length > 0 && (
                  <div className="backup-list">
                    <div className="backup-list-title">Available:</div>
                    {backups.map((b, i) => (
                      <div key={i} className="backup-item">
                        <div className="backup-info">
                          <div className="backup-name">{b.filename}</div>
                          <div className="backup-meta">
                            {(b.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                            {new Date(b.created).toLocaleString()}
                          </div>
                        </div>
                        <div className="backup-actions">
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => restoreBackup(b.filename)}
                            disabled={restoring}
                          >
                            {restoring ? (
                              "Restoring…"
                            ) : (
                              <>
                                <Upload size={12} /> Restore
                              </>
                            )}
                          </button>
                          <button
                            className="btn btn-danger btn-xs"
                            onClick={() => deleteBackup(b.filename)}
                            title="Delete backup"
                          >
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
    </div>
  );
}
