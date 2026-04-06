import React, { useState, useEffect, useCallback, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import {
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, ScatterChart, PieChart as PieChart3, LineChart as LineChart3, Calendar,
  AlertCircle, RefreshCw, Info, X, Mouse, MessageSquare,
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

// Pie chart uses a wider distinct palette so slices don't clash
const PIE_COLORS = [
  "#7c5cfc","#00d4ff","#fc5cf8","#ff6b9d","#ffb454",
  "#3dffa0","#ff5370","#ffa500","#00bfff","#c084fc",
  "#34d399","#f97316","#60a5fa","#f43f5e","#a78bfa",
];

// ── fallback sphere data ───────────────────────────────────────────────────────

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

// 1. Conversations per day — real: sessionsByDay[].count
// Shows up to 31 days, filtered by month if selected
const buildConversationsData = (sessionsByDay, monthFilter = 'all') => {
  let filtered = sessionsByDay || [];
  
  // Apply month filter if not 'all'
  if (monthFilter !== 'all') {
    filtered = filtered.filter(day => {
      const date = new Date(day.date + "T00:00:00");
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` === monthFilter;
    });
  }
  
  // Take up to 31 days (most recent)
  const recent = filtered.slice(-31);
  
  return recent.map((day) => ({
    day: new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      year: "numeric"
    }),
    conversations: day.count,
    rawDate: day.date // Keep for potential further processing
  }));
};

// 2. Tag document distribution — real: tags[].documentCount (pie chart)
const buildTagPieData = (tags) =>
  (tags || [])
    .filter((t) => (t.documentCount || 0) > 0)
    .sort((a, b) => (b.documentCount || 0) - (a.documentCount || 0))
    .slice(0, 12) // cap at 12 slices for legibility
    .map((t) => ({ name: t.name, value: t.documentCount }));

// 3. Avg messages per day — real: from messagesByDay with user/assistant breakdown
const buildAvgMessagesData = (messagesByDay) =>
  (messagesByDay || []).slice(-7).map((day) => ({
    day: new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      year: "numeric"
    }),
    userMessages: day.userMessages || 0,
    assistantMessages: day.assistantMessages || 0,
  }));

// ── shared tooltip ────────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label, unit = "" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:"var(--bg3)", border:"1px solid var(--border)",
      borderRadius:10, padding:"10px 14px", fontSize:12,
      color:"var(--text)", boxShadow:"0 8px 24px rgba(0,0,0,0.35)",
    }}>
      {label && <div style={{ fontWeight:700, marginBottom:6, color:"var(--text2)" }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:p.color ?? p.fill, display:"inline-block" }} />
          <span style={{ color:"var(--text3)" }}>{p.name}:</span>
          <span style={{ fontWeight:600 }}>{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

// Custom pie label — only show name+% for slices large enough
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
      style={{ fontSize:10, fill:"#fff", fontWeight:600, pointerEvents:"none" }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ── controls / info overlays ──────────────────────────────────────────────────

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

const InfoPopover = ({ nodeCount, linkCount, onClose }) => (
  <div className="info-popover">
    <button className="info-popover-close" onClick={onClose}><X size={12} /></button>
    <p><strong>{nodeCount}</strong> tags are visualised as spheres. Node size reflects how many document chunks are associated with each tag.</p>
    <p><strong>{linkCount}</strong> relationships connect tags that co-appear in the same documents. Thicker links mean stronger overlap.</p>
    <p>Drag to rotate · Scroll to zoom · Right-drag to pan.</p>
  </div>
);

// ── component ─────────────────────────────────────────────────────────────────

export default function AnalyticsPanel() {
  const graphRef   = useRef();
  const wrapperRef = useRef();

   const [tagData,          setTagData]          = useState(() => buildFallbackGraph());
   const [conversationsData,setConversationsData] = useState([]);
   const [tagPieData,       setTagPieData]        = useState([]);
   const [avgMsgsData,      setAvgMsgsData]       = useState([]);
   const [sessionsByDayRaw, setSessionsByDayRaw] = useState([]);
   const [messagesByDay,    setMessagesByDay]     = useState([]);
   const [selectedMonth,    setSelectedMonth]     = useState('all');
   const [dims,             setDims]              = useState({ width: 0, height: 0 });

  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);

  // Theme-adaptive colours
  const [axisColor,   setAxisColor]   = useState("var(--text)");
  const [gridLine,    setGridLine]    = useState("rgba(0,0,0,0.08)");
  const [accentColor, setAccentColor] = useState("#7c5cfc");

  useEffect(() => {
    const update = () => {
      const s = getComputedStyle(document.documentElement);
      setAxisColor(s.getPropertyValue("--text").trim() || "#111");
      setGridLine(s.getPropertyValue("--border").trim() || "rgba(0,0,0,0.08)");
      setAccentColor(s.getPropertyValue("--accent").trim() || "#7c5cfc");
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes:true, attributeFilter:["class","data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Wrapper size → ForceGraph3D dimensions
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

  // R key → reset camera
  useEffect(() => {
    const handle = (e) => {
      if ((e.key === "r" || e.key === "R") && graphRef.current) {
        try {
          const radius = Math.max(40, tagData.nodes.length * 2.5);
          graphRef.current.cameraPosition({ x:0, y:0, z: radius * 1.4 }, { x:0, y:0, z:0 }, 600);
        } catch (_) {}
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [tagData.nodes.length]);

   const fetchData = useCallback(async () => {
     try {
       setRefreshing(true);
       setError(null);

       const [tags, sessions] = await Promise.all([
         ragApi.getAnalyticsTags(),
         ragApi.getAnalyticsSessions(),
       ]);

       // Sphere
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

       // Chart 1 — conversations per day (real) - store raw data
       const days = sessions.sessionsByDay || [];
       setSessionsByDayRaw(days);

       // Chart 2 — tag document pie (real)
       setTagPieData(buildTagPieData(tags.tags || []));

       // Chart 3 — avg messages per day (real breakdown)
       const msgsByDay = sessions.messagesByDay || [];
       setMessagesByDay(msgsByDay);

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

   // Recompute conversations data when raw data or month filter changes
   useEffect(() => {
     setConversationsData(buildConversationsData(sessionsByDayRaw, selectedMonth));
   }, [sessionsByDayRaw, selectedMonth]);

   // Recompute avg messages data when messagesByDay changes
   useEffect(() => {
     setAvgMsgsData(buildAvgMessagesData(messagesByDay));
   }, [messagesByDay]);

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

   const noData = (icon, msg) => (
     <div className="no-data-message">{icon}<p>{msg}</p></div>
   );

   // Get unique months from data for filter dropdown
   const getAvailableMonths = (days) => {
     const months = new Set();
     (days || []).forEach(day => {
       const date = new Date(day.date + "T00:00:00");
       const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
       months.add(monthKey);
     });
     return Array.from(months).sort().reverse(); // Most recent first
   };

   const availableMonths = getAvailableMonths(sessionsByDayRaw);
   const monthOptions = [
     { value: 'all', label: 'All Time' },
     ...availableMonths.map(m => {
       const [year, month] = m.split('-');
       const date = new Date(parseInt(year), parseInt(month) - 1);
       return { 
         value: m, 
         label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
       };
     })
   ];

  return (
    <div className="analytics-panel">
      {/* ── Page header ── */}
      <div className="analytics-header">
        <div className="analytics-controls">
          {lastRefresh && (
            <div className="key-status key-ok">
              <span className="last-refresh">Updated {lastRefresh.toLocaleTimeString()}</span>
            </div>
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

      {/* ── Knowledge ─ */}
      <div className="tag-sphere-card">
        <div className="card-header">
          <h3><ScatterChart size={15} /> Knowledge Thortspace</h3>
          <button className="info-btn" onClick={() => setShowInfo(v => !v)} aria-label="Show info">
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
              nodeLabel={(node) =>
                `<div style="font-weight:700;margin-bottom:2px">${node.name}</div>` +
                `<div style="opacity:.75;font-size:11px">${node.chunks} chunks</div>`
              }
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

        {/* 1. Conversations per day — bar chart */}
         <div className="chart-card wide">
           <div className="card-header">
             <h3><BarChart3 size={15} /> Conversations per Day</h3>
             {availableMonths.length > 0 && (
               <select 
                 className="month-filter"
                 value={selectedMonth}
                 onChange={(e) => setSelectedMonth(e.target.value)}
               >
                 {monthOptions.map(opt => (
                   <option key={opt.value} value={opt.value}>{opt.label}</option>
                 ))}
               </select>
             )}
           </div>
          <div className="chart-body">
            {conversationsData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={conversationsData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridLine} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="conversations"
                    name="Conversations"
                    fill={accentColor}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : noData(<Calendar size={30} />, "No session data yet.")}
          </div>
        </div>

                 {/* 2. Tag document distribution — pie chart */}
        <div className="chart-card">
          <div className="card-header">
            <h3><PieChart3 size={15} /> Document Distribution by Tags</h3>
          </div>
          <div className="chart-body">
            {tagPieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={tagPieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      dataKey="value"
                      labelLine={false}
                      label={renderPieLabel}
                    >
                      {tagPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0];
                        const total = tagPieData.reduce((s, t) => s + t.value, 0);
                        return (
                          <div style={{
                            background:"var(--bg3)", border:"1px solid var(--border)",
                            borderRadius:10, padding:"10px 14px", fontSize:12,
                            color:"var(--text)", boxShadow:"0 8px 24px rgba(0,0,0,0.3)",
                          }}>
                            <div style={{ fontWeight:700, marginBottom:4, color:"var(--text2)" }}>{d.name}</div>
                             <div style={{ color:"var(--text3)" }}>
                               {d.value} documents &nbsp;·&nbsp; {((d.value / total) * 100).toFixed(1)}%
                             </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </>
            ) : noData(<BarChart3 size={30} />, "Upload tagged documents to see this chart.")}
          </div>
        </div>

        {/* 3. Avg Messages per Day — line chart with user/assistant breakdown */}
        <div className="chart-card">
          <div className="card-header">
            <h3><LineChart3 size={15} /> Avg Messages per Day</h3>
          </div>
          <div className="chart-body">
            {avgMsgsData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={avgMsgsData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridLine} vertical={false} />
                    <XAxis dataKey="day" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="userMessages"
                      name="User Messages"
                      stroke="#7c5cfc"
                      strokeWidth={2.5}
                      dot={{ fill:"#7c5cfc", r:4, strokeWidth:0 }}
                      activeDot={{ r:6, strokeWidth:0 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="assistantMessages"
                      name="AI Responses"
                      stroke="#3dffa0"
                      strokeWidth={2.5}
                      dot={{ fill:"#3dffa0", r:4, strokeWidth:0 }}
                      activeDot={{ r:6, strokeWidth:0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : noData(<MessageSquare size={30} />, "No session data yet.")}
          </div>
        </div>

      </div>
    </div>
  );
}