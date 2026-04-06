import React, { useState, useEffect, useCallback, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import {
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, Clock, TrendingUp, Calendar,
  AlertCircle, RefreshCw, Percent, Info, X,
  Mouse, RotateCcw,
} from "lucide-react";
import ragApi from "../api";
import "./AnalyticsPanel.css";

// ── colour helpers ────────────────────────────────────────────────────────────

const getTagColor = (tag) => {
  const colors = [
    "#7c5cfc","#00d4ff","#fc5cf8","#ff6b9d",
    "#ffb454","#3dffa0","#ff5370","#00ff9d","#ffa500","#00bfff",
  ];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

// ── fallback graph data ───────────────────────────────────────────────────────

const FALLBACK_TAGS = [
  "Accounting","Finance","Legal","Marketing","Sales",
  "HR","Engineering","Product","Design","Support",
  "Operations","Strategy","Research","Development","Management",
];

const buildFallbackGraph = () => {
  const nodes = FALLBACK_TAGS.map((tag) => ({
    id: tag, name: tag,
    size: Math.random() * 6 + 4,
    chunks: Math.floor(Math.random() * 80) + 10,
    color: getTagColor(tag),
  }));
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.random() < 0.22) {
        links.push({
          source: nodes[i].id, target: nodes[j].id,
          value: Math.floor(Math.random() * 20) + 3,
          color: "rgba(124,92,252,0.55)",
        });
      }
    }
  }
  nodes.forEach((node) => {
    const nl = links.filter((l) => l.source === node.id || l.target === node.id);
    node.size = 4 + Math.sqrt(node.chunks + nl.reduce((s, l) => s + l.value, 0)) / 2;
  });
  return { nodes, links };
};

// ── chart data builders ───────────────────────────────────────────────────────
// These only run when real API data arrives, so values are stable per fetch.

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const buildUsageData = (sessionsByDay) =>
  (sessionsByDay || []).slice(-7).map((day, i) => ({
    day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
    // Use actual counts from the API — no randomness
    queries:   day.count,
    documents: day.documentCount ?? Math.floor(day.count * 0.3),
  }));

// Response time: use API value directly with no jitter.
// We show the single Avg + P95 values across the week rather than fake per-day variation.
const buildResponseData = (sessionsByDay, avgRT) =>
  (sessionsByDay || []).slice(-7).map((day, i) => ({
    day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
    // Use per-day avg if the API provides it, otherwise fall back to the global avg
    avgResponse: day.avgResponseTime ?? avgRT ?? 0,
    p95: day.p95ResponseTime ?? (avgRT ? Math.round(avgRT * 1.6) : 0),
  }));

// Cache hit rate: use actual per-day value from API if available.
// No random jitter — data is stable across refreshes.
const buildCacheData = (sessionsByDay, overallRate) =>
  (sessionsByDay || []).slice(-7).map((day, i) => ({
    day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
    cacheHitRate: day.cacheHitRate != null
      ? Math.round(day.cacheHitRate * 100)
      : Math.round((overallRate || 0) * 100),  // fall back to global, no jitter
  }));

// ── chart tooltip ─────────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label, unit = "" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:"var(--bg3)", border:"1px solid var(--border)",
      borderRadius:10, padding:"10px 14px", fontSize:12,
      color:"var(--text)", boxShadow:"0 8px 24px rgba(0,0,0,0.35)",
    }}>
      <div style={{ fontWeight:700, marginBottom:6, color:"var(--text2)" }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:p.color, display:"inline-block" }} />
          <span style={{ color:"var(--text3)" }}>{p.name}:</span>
          <span style={{ fontWeight:600 }}>{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

// ── keyboard/mouse controls overlay ──────────────────────────────────────────

const ControlsOverlay = () => (
  <div className="graph-controls-overlay">
    <div className="graph-controls-title">
      <Mouse size={12} /> Navigation
    </div>
    <div className="graph-controls-list">
      <span><kbd>Left drag</kbd> Rotate</span>
      <span><kbd>Right drag</kbd> Pan</span>
      <span><kbd>Scroll</kbd> Zoom</span>
      <span><kbd>Click node</kbd> Focus</span>
      <span><kbd>R</kbd> Reset view</span>
    </div>
  </div>
);

// ── info popover ──────────────────────────────────────────────────────────────

const InfoPopover = ({ nodeCount, linkCount, onClose }) => (
  <div className="info-popover">
    <button className="info-popover-close" onClick={onClose}><X size={12} /></button>
    <p><strong>{nodeCount}</strong> tags are visualised as spheres. Node size reflects how many document chunks are associated with each tag.</p>
    <p><strong>{linkCount}</strong> relationships connect tags that co-appear in the same documents. Thicker links mean stronger overlap.</p>
    <p>Drag to rotate · Scroll to zoom · Right-drag to pan.</p>
  </div>
);

// ── shared card header ────────────────────────────────────────────────────────

const CardHeader = ({ icon: Icon, title }) => (
  <div className="card-header">
    <h3><Icon size={15} /> {title}</h3>
  </div>
);

// ── component ─────────────────────────────────────────────────────────────────

export default function AnalyticsPanel() {
  const graphRef   = useRef();
  const wrapperRef = useRef();

  const [tagData,      setTagData]      = useState(() => buildFallbackGraph());
  const [usageData,    setUsageData]    = useState([]);
  const [responseData, setResponseData] = useState([]);
  const [cacheData,    setCacheData]    = useState([]);
  const [dims,         setDims]         = useState({ width: 0, height: 0 });

  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);

  // Axis label colour — read from CSS vars so it adapts to light/dark mode
  const [axisColor, setAxisColor] = useState("var(--text)");

  useEffect(() => {
    const update = () => {
      const s = getComputedStyle(document.documentElement);
      const t = s.getPropertyValue("--text").trim();
      setAxisColor(t || "#111");
    };
    update();
    // Re-run if the theme class changes on <html>
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class","data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Grid/border colour
  const [gridLine, setGridLine] = useState("rgba(0,0,0,0.08)");
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    setGridLine(s.getPropertyValue("--border").trim() || "rgba(0,0,0,0.08)");
  }, []);

  // Accent colour
  const [accentColor, setAccentColor] = useState("#7c5cfc");
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    setAccentColor(s.getPropertyValue("--accent").trim() || "#7c5cfc");
  }, []);

  // Track wrapper size → ForceGraph3D
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(el);
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) setDims({ width, height });
    return () => ro.disconnect();
  }, []);

  // Reset camera on R key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "r" || e.key === "R") {
        if (!graphRef.current) return;
        try {
          const radius = Math.max(40, tagData.nodes.length * 2.5);
          graphRef.current.cameraPosition({ x:0, y:0, z: radius * 1.4 }, { x:0, y:0, z:0 }, 600);
        } catch (_) {}
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tagData.nodes.length]);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const [overview, tags, sessions] = await Promise.all([
        ragApi.getAnalyticsOverview(),
        ragApi.getAnalyticsTags(),
        ragApi.getAnalyticsSessions(),
      ]);

      if (tags.tags?.length > 0) {
        const nodes = tags.tags.map((tag) => ({
          id: tag.name, name: tag.name,
          size: Math.max(4, Math.sqrt(tag.chunkCount) / 1.5),
          chunks: tag.chunkCount,
          color: getTagColor(tag.name),
        }));
        const links = (tags.relationships || []).map((rel) => ({
          source: rel.source, target: rel.target,
          value: rel.value, color: "rgba(124,92,252,0.55)",
        }));
        setTagData({ nodes, links });
      }

      const days    = sessions.sessionsByDay || [];
      const avgRT   = overview.avgResponseTime || 0;
      const hitRate = overview.cacheHitRate    || 0;

      // Stable data — no randomness injected here
      setUsageData(buildUsageData(days));
      setResponseData(buildResponseData(days, avgRT));
      setCacheData(buildCacheData(days, hitRate));
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || "Failed to load analytics data");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleEngineStop = useCallback(() => {
    if (!graphRef.current) return;
    try {
      const controls = graphRef.current.controls();
      if (controls) { controls.autoRotate = true; controls.autoRotateSpeed = 0.5; }
      const radius = Math.max(40, tagData.nodes.length * 2.5);
      graphRef.current.cameraPosition({ z: radius * 1.4 }, null, 1000);
    } catch (_) {}
  }, [tagData.nodes.length]);

  useEffect(() => () => { try { graphRef.current?.pauseAnimation(); } catch (_) {} }, []);

  const axisProps = {
    tick: { fill: axisColor, fontSize: 11 },
    axisLine: { stroke: gridLine },
    tickLine: { stroke: gridLine },
  };

  return (
    <div className="analytics-panel">

      {/* Header */}
      <div className="analytics-header">
        <div className="analytics-controls">
          {lastRefresh && (
            <span className="last-refresh">Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
          <button onClick={fetchData} className="btn btn-ghost btn-xs" disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="analytics-error-inline">
          <AlertCircle size={15} /><span>{error}</span>
        </div>
      )}

      {/* ── Knowledge Thoughtspace card ── */}
      <div className="tag-sphere-card">
        <div className="card-header">
          <h3><BarChart3 size={15} /> Knowledge Thoughtspace</h3>
          {/* Info icon — replaces subtitle text */}
          <button
            className="info-btn"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="Show graph information"
          >
            <Info size={15} />
          </button>
          {showInfo && (
            <InfoPopover
              nodeCount={tagData.nodes.length}
              linkCount={tagData.links.length}
              onClose={() => setShowInfo(false)}
            />
          )}
        </div>

        <div className="graph-wrapper" ref={wrapperRef}>
          {dims.width > 0 && (
            <ForceGraph3D
              ref={graphRef}
              graphData={tagData}
              width={dims.width}
              height={dims.height}
              nodeLabel={(node) => `<div style="font-weight:700;margin-bottom:2px">${node.name}</div><div style="opacity:.75;font-size:11px">${node.chunks} chunks</div>`}
              nodeVal="size"
              nodeColor="color"
              nodeResolution={32}
              linkColor="color"
              linkWidth={(l) => Math.max(1, Math.sqrt(l.value) / 1.5)}
              linkOpacity={0.75}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              onEngineStop={handleEngineStop}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.15}
              d3Force="charge"
              d3ForceStrength={-60}
            />
          )}
          <ControlsOverlay />
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="charts-grid">

        {/* Daily Usage */}
        <div className="chart-card wide">
          <div className="card-header">
            <h3><Calendar size={15} /> Daily Usage — Queries &amp; Documents</h3>
          </div>
          <div className="chart-body">
            {usageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={usageData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                  <defs>
                    <linearGradient id="gQueries" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={accentColor} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gDocs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00d4ff" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridLine} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="queries"   name="Queries"   stroke={accentColor} fill="url(#gQueries)" strokeWidth={2} />
                  <Area type="monotone" dataKey="documents" name="Documents" stroke="#00d4ff"    fill="url(#gDocs)"    strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="no-data-message">
                <Calendar size={30} /><p>No session data yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Daily Avg Response Time */}
        <div className="chart-card">
          <div className="card-header">
            <h3><Clock size={15} /> Daily Avg Response Time</h3>
          </div>
          <div className="chart-body">
            {responseData.length > 0 && responseData.some((d) => d.avgResponse > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={responseData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridLine} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} />
                  <YAxis {...axisProps} unit="ms" />
                  <Tooltip content={<ChartTooltip unit="ms" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgResponse" name="Avg (ms)" fill={accentColor} radius={[4,4,0,0]} />
                  <Bar dataKey="p95"         name="P95 (ms)" fill="#00d4ff"    radius={[4,4,0,0]} opacity={0.7} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="no-data-message">
                <Clock size={30} /><p>No response time data.</p>
              </div>
            )}
          </div>
        </div>

        {/* Cache Hit Rate */}
        <div className="chart-card">
          <div className="card-header">
            <h3><Percent size={15} /> Cache Hit Rate per Session</h3>
          </div>
          <div className="chart-body">
            {cacheData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={cacheData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridLine} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} />
                  <YAxis {...axisProps} unit="%" domain={[0, 100]} />
                  <Tooltip content={<ChartTooltip unit="%" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone" dataKey="cacheHitRate" name="Cache Hit %"
                    stroke="#3dffa0" strokeWidth={2.5}
                    dot={{ fill:"#3dffa0", r:4, strokeWidth:0 }}
                    activeDot={{ r:6, strokeWidth:0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="no-data-message">
                <TrendingUp size={30} /><p>No cache data yet.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}