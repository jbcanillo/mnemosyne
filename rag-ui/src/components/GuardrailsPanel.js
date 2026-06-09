import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Shield,
  ShieldCheck,
  Keyboard,
  AlertTriangle,
  Eye,
  EyeOff,
  MessageSquareDashed,
  Filter,
  FileSearch,
} from "lucide-react";
import { ragApi } from "../api";

export default function GuardrailsPanel({ onRefresh }) {
  const [settings, setSettings] = useState({
    enableInputValidation: true,
    enablePromptHardening: true,
    enableOutputFiltering: true,
    enableEnhancedLogging: true,
    enableDocumentSensitivity: true,
    inputValidationBlocked: 0,
    outputFiltered: 0,
    queriesFiltered: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  
  // Poll guardrail metrics every 2 seconds
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await ragApi.getUsage();
        if (response.guardrails) {
          setSettings(prev => ({
            ...prev,
            inputValidationBlocked: response.guardrails.inputValidationBlocked || 0,
            outputFiltered: response.guardrails.outputFiltered || 0,
            queriesFiltered: response.guardrails.queriesFiltered || 0,
          }));
        }
      } catch (err) {
        // Silent fail - metrics are optional
      }
    };
    
    const interval = setInterval(fetchMetrics, 2000);
    fetchMetrics();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await ragApi.getSettings();
      // Merge with defaults to ensure all properties exist
      setSettings((prev) => ({
        ...prev,
        ...(response.settings || response || {}),
      }));
      setLoaded(true);
    } catch (err) {
      console.error("Load settings error:", err);
      toast.error("Failed to load guardrails settings - using defaults");
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleSetting = async (key) => {
    if (!settings || !loaded) return;

    const newValue = !settings[key];

    // Optimistically update UI
    setSettings((prev) => ({ ...prev, [key]: newValue }));

    // Save to backend
    setSaving(true);
    try {
      const response = await ragApi.updateSettings({ [key]: newValue });
      // Update with server response to ensure sync
      setSettings((prev) => ({
        ...prev,
        ...(response.settings || response || {}),
      }));
      toast.success("Guardrails setting updated");
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Update setting error:", err);
      toast.error("Failed to update setting");
      // Revert on error
      setSettings((prev) => ({ ...prev, [key]: !newValue }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "256px",
        }}
      >
        <div
          style={{
            animation: "spin 1s linear infinite",
            borderRadius: "50%",
            height: "32px",
            width: "32px",
            borderBottom: "2px solid var(--accent)",
          }}
        ></div>
      </div>
    );
  }

  return (
    <div className="panel-content">
      {/* Security Monitoring Cards - Moved to top level */}
      <div className="guardrails-monitoring-cards">
        <div className="guardrails-metric-card">
          <div
            className="guardrails-metric-value"
            style={{ color: "var(--danger)" }}
          >
            {settings.inputValidationBlocked}
          </div>
          <div className="guardrails-metric-label">
            Injection Attempts Blocked
          </div>
        </div>
        <div className="guardrails-metric-card">
          <div
            className="guardrails-metric-value"
            style={{ color: "var(--warn)" }}
          >
            {settings.outputFiltered}
          </div>
          <div className="guardrails-metric-label">Responses Filtered</div>
        </div>
        <div className="guardrails-metric-card">
          <div
            className="guardrails-metric-value"
            style={{ color: "var(--success)" }}
          >
            {settings.queriesFiltered}
          </div>
          <div className="guardrails-metric-label">Queries Processed</div>
        </div>
      </div>

      {/* Security Configurations Section */}
      <div className="sp-section">
        <div className="sp-section-header">
          <div className="sp-section-title">
            <ShieldCheck size={14} />
            Security Configurations
          </div>
        </div>
        <div className="sp-section-body">
          <div className="guardrails-notice">
            <div className="guardrails-notice-header">
              <AlertTriangle size={20} />
              <span>Security Notice</span>
            </div>
            <p>
              These settings control security measures for the RAG system.
              Disabling them may increase vulnerability to prompt injection
              attacks. Ensure you understand the risks before making changes.
            </p>
          </div>
          <div className="guardrails-toggles">
            {/* Input Validation Toggle */}
            <div className="guardrails-toggle">
              <div className="guardrails-toggle-content">
                <Keyboard
                  size={20}
                  className={`guardrails-toggle-icon${settings.enableInputValidation ? " enabled" : ""}`}
                />
                <div className="guardrails-toggle-text">
                  <h4>
                    <span>Input Validation</span>
                    <span
                      className={`guardrails-toggle-badge ${settings.enableInputValidation ? "enabled" : "disabled"}`}
                    >
                      {settings.enableInputValidation ? "Enabled" : "Disabled"}
                    </span>
                  </h4>
                  <p>
                    Detect and block potential jailbreak attempts in user
                    queries using pattern matching.
                  </p>
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={settings.enableInputValidation}
                  onChange={() => toggleSetting("enableInputValidation")}
                  disabled={saving || !loaded}
                  className="toggle-input"
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {/* Prompt Hardening Toggle */}
            <div className="guardrails-toggle">
              <div className="guardrails-toggle-content">
                <MessageSquareDashed
                  size={20}
                  className={`guardrails-toggle-icon${settings.enablePromptHardening ? " enabled" : ""}`}
                />
                <div className="guardrails-toggle-text">
                  <h4>
                    <span>Prompt Hardening</span>
                    <span
                      className={`guardrails-toggle-badge ${settings.enablePromptHardening ? "enabled" : "disabled"}`}
                    >
                      {settings.enablePromptHardening ? "Enabled" : "Disabled"}
                    </span>
                  </h4>
                  <p>
                    Add security instructions to the system prompt to resist
                    override attempts.
                  </p>
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={settings.enablePromptHardening}
                  onChange={() => toggleSetting("enablePromptHardening")}
                  disabled={saving || !loaded}
                  className="toggle-input"
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {/* Output Filtering Toggle */}
            <div className="guardrails-toggle">
              <div className="guardrails-toggle-content">
                <Filter
                  size={20}
                  className={`guardrails-toggle-icon ${settings.enableOutputFiltering ? "enabled" : ""}`}
                />
                <div className="guardrails-toggle-text">
                  <h4>
                    <span>Output Filtering</span>
                    <span
                      className={`guardrails-toggle-badge ${settings.enableOutputFiltering ? "enabled" : "disabled"}`}
                    >
                      {settings.enableOutputFiltering ? "Enabled" : "Disabled"}
                    </span>
                  </h4>
                  <p>
                    Filter and redact suspicious content in AI responses to
                    prevent data leaks.
                  </p>
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={settings.enableOutputFiltering}
                  onChange={() => toggleSetting("enableOutputFiltering")}
                  disabled={saving || !loaded}
                  className="toggle-input"
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {/* Enhanced Logging Toggle */}
            <div className="guardrails-toggle">
              <div className="guardrails-toggle-content">
                <Eye
                  size={20}
                  className={`guardrails-toggle-icon ${settings.enableEnhancedLogging ? "enabled" : ""}`}
                />
                <div className="guardrails-toggle-text">
                  <h4>
                    <span>Enhanced Logging</span>
                    <span
                      className={`guardrails-toggle-badge ${settings.enableEnhancedLogging ? "enabled" : "disabled"}`}
                    >
                      {settings.enableEnhancedLogging ? "Enabled" : "Disabled"}
                    </span>
                  </h4>
                  <p>
                    Enable detailed audit logging for compliance and security
                    monitoring.
                  </p>
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={settings.enableEnhancedLogging}
                  onChange={() => toggleSetting("enableEnhancedLogging")}
                  disabled={saving || !loaded}
                  className="toggle-input"
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {/* Document Sensitivity Toggle */}
            <div className="guardrails-toggle">
              <div className="guardrails-toggle-content">
                <FileSearch
                  size={20}
                  className={`guardrails-toggle-icon ${settings.enableDocumentSensitivity ? "enabled" : ""}`}
                />
                <div className="guardrails-toggle-text">
                  <h4>
                    <span>Document Sensitivity</span>
                    <span
                      className={`guardrails-toggle-badge ${settings.enableDocumentSensitivity ? "enabled" : "disabled"}`}
                    >
                      {settings.enableDocumentSensitivity
                        ? "Enabled"
                        : "Disabled"}
                    </span>
                  </h4>
                  <p>
                    Enable sensitivity tagging for uploaded documents to control
                    access.
                  </p>
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={settings.enableDocumentSensitivity}
                  onChange={() => toggleSetting("enableDocumentSensitivity")}
                  disabled={saving || !loaded}
                  className="toggle-input"
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
