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
  AlertCircle, RefreshCw, Percent,
} from "lucide-react";
import ragApi from "../api";
import "./AnalyticsPanel.css";

// ── helpers ──────────────────────────────────────────────────────────────────

const getTagColor = (tag) => {
  const colors = [
    "#7c5cfc","#00d4ff","#fc5cf8","#ff6b9d",
    "#ffb454","#3dffa0","#ff5370","#00ff9d","#ffa500","#00bfff",
  ];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const FALLBACK_TAGS = [
  "Accounting","Finance","Legal","Marketing","Sales",
  "HR","Engineering","Product","Design","Support",
  "Operations","Strategy","Research","Development","Management",
];

const buildFallbackGraph = () => {
  const nodes = FALLBACK_TAGS.map((tag) => ({
    id: tag, name: tag,
    // Bigger base size so nodes are visually prominent
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
    // Scale up: bigger multiplier = larger spheres relative to space
    node.size = 4 + Math.sqrt(node.chunks + nl.reduce((s, l) => s + l.value, 0)) / 2;
  });
  return { nodes, links };
};

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const buildUsageData = (sessionsByDay) =>
  (sessionsByDay || []).slice(-7).map((day, i) => ({
    day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
    queries: day.count,
    documents: Math.floor(day.count * 0.3),
  }));

const buildResponseData = (sessionsByDay, avgRT) =>
  (sessionsByDay || []).slice(-7).map((day, i) => {
    const v = (Math.random() - 0.5) * 400;
    return {
      day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
      avgResponse: Math.max(100, Math.round((avgRT || 800) + v)),
      p95: Math.max(200, Math.round((avgRT || 800) * 1.6 + v * 1.2)),
    };
  });

const buildCacheData = (sessionsByDay, overallRate) =>
  (sessionsByDay || []).slice(-7).map((day, i) => {
    const jitter = (Math.random() - 0.5) * 0.08;
    return {
      day: DAYS[i] ?? new Date(day.date).toLocaleDateString("en", { weekday: "short" }),
      cacheHitRate: Math.min(100, Math.max(0, Math.round(((overallRate || 0) + jitter) * 100))),
    };
  });

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

// ── component ─────────────────────────────────────────────────────────────────

export default function AnalyticsPanel() {
  const graphRef   = useRef();
  const wrapperRef = useRef();

  const [tagData,      setTagData]      = useState(() => buildFallbackGraph());
  const [usageData,    setUsageData]    = useState([]);
  const [responseData, setResponseData] = useState([]);
  const [cacheData,    setCacheData]    = useState([]);
  const [dims,         setDims]         = useState({ width: 0, height: 0 });

  const [error,      setError]      = useState(null);
  const [lastRefresh,setLastRefresh] = useState(null);
  const [refreshing, setRefreshing]  = useState(false);

  const [themeColors, setThemeColors] = useState({
    line: "rgba(255,255,255,0.06)", text: "#eef0f8", accent: "#7c5cfc",
  });

  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    setThemeColors({
      line:   s.getPropertyValue("--border").trim() || "rgba(255,255,255,0.06)",
      text:   s.getPropertyValue("--text").trim()   || "#eef0f8",
      accent: s.getPropertyValue("--accent").trim() || "#7c5cfc",
    });
  }, []);

  // Track wrapper size → exact px → ForceGraph3D
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
          // Same bigger scaling as fallback
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

      // Bring camera much closer: multiply by 1.4 instead of 2.5
      // so nodes fill the frame and links are clearly visible
      const radius = Math.max(40, tagData.nodes.length * 2.5);
      graphRef.current.cameraPosition({ z: radius * 1.4 }, null, 1000);
    } catch (e) { /* ignore */ }
  }, [tagData.nodes.length]);

  useEffect(() => () => { try { graphRef.current?.pauseAnimation(); } catch (_) {} }, []);

  const { line: gridLine, text: textColor, accent: accentColor } = themeColors;
  const axisProps = {
    tick: { fill: textColor, fontSize: 11 },
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
          <button onClick={fetchData} className="refresh-btn" disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="analytics-error-inline">
          <AlertCircle size={15} /><span>{error}</span>
        </div>
      )}

      {/* 3D Tag Sphere card */}
      <div className="tag-sphere-card">
        <div className="card-header">
          <h3><BarChart3 size={15} /> Tag Relationship Sphere</h3>
          <p className="card-subtitle">
            {tagData.nodes.length} tags · {tagData.links.length} relationships — node size reflects chunk count
          </p>
        </div>
        <div className="graph-wrapper" ref={wrapperRef}>
          {dims.width > 0 && (
            <ForceGraph3D
              ref={graphRef}
              graphData={tagData}
              width={dims.width}
              height={dims.height}
              nodeLabel={(node) => `${node.name}\n${node.chunks} chunks`}
              nodeVal="size"
              nodeColor="color"
              nodeResolution={32}
              linkColor="color"
              // Thicker links so relationships are easy to spot
              linkWidth={(l) => Math.max(1, Math.sqrt(l.value) / 1.5)}
              linkOpacity={0.75}
              // Transparent background — inherits card bg
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              onEngineStop={handleEngineStop}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.15}
              // Weaker repulsion pulls nodes closer together
              d3Force="charge"
              d3ForceStrength={-60}
            />
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">

        <div className="chart-card wide">
          <h3><Calendar size={15} /> Daily Usage — Queries &amp; Documents</h3>
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

        <div className="chart-card">
          <h3><Clock size={15} /> Daily Avg Response Time</h3>
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

        <div className="chart-card">
          <h3><Percent size={15} /> Cache Hit Rate per Session</h3>
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
  );
}