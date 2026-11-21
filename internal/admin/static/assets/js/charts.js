// 播放可视化：四张 Chart.js 图表。
// loadCharts 原为 414 行单函数，这里拆为四个构建器 + 共享的时间轴配置工厂。

import { api } from "./api.js";
import { toast, formatBytes, formatDuration } from "./ui.js";
import { state } from "./state.js";
import { chartColors, onThemeChange } from "./theme.js";

const chartInstances = {};

function destroyChart(key) {
  if (chartInstances[key]) {
    chartInstances[key].destroy();
    delete chartInstances[key];
  }
}

function renderChart(key, ctx, config) {
  destroyChart(key);
  chartInstances[key] = new Chart(ctx, config);
}

function chartFont() {
  return {
    family: getComputedStyle(document.body).fontFamily || "sans-serif",
    color: chartColors().axis,
  };
}

// hex -> rgba，让填充色跟随主题调色板。
function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 客户端名称按字符换行，避免过长标签溢出。
function wrapClientLabel(name, maxCharsPerLine = 24) {
  const s = String(name || "未知");
  const lines = [];
  for (let i = 0; i < s.length; i += maxCharsPerLine) {
    lines.push(s.slice(i, i + maxCharsPerLine));
  }
  return lines;
}

// 客户端名称精简：浏览器 UA 保留到首个括号组，
// Emby 类客户端只保留 "名称/版本"。
function shortClientName(name) {
  const s = String(name || "未知").trim();
  if (!s) return "未知";
  const appVer = s.match(/^([A-Za-z]+ [^(]+\/[^\s(]+)/);
  if (appVer) return appVer[1];
  const ua = s.match(/^(.*?\([^)]*\))/);
  if (ua) return ua[1];
  const sp = s.indexOf(" ");
  return sp > 0 ? s.slice(0, sp) : s;
}

// 按数据集名称格式化 tooltip 文案（流量/时长/计数）。
function formatTooltipLabel(c) {
  if (c.dataset.label === "入站" || c.dataset.label === "出站")
    return `${c.dataset.label}: ${formatBytes(c.parsed.y)}`;
  if (c.dataset.label === "播放时长")
    return `${c.dataset.label}: ${formatDuration(c.parsed.y)}`;
  return `${c.dataset.label}: ${c.parsed.y}`;
}

// 三轴时间序列图的公共 options（按天趋势 / 按小时趋势共用）。
function timeSeriesOptions(axisTitles, xOverrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation: { duration: 800, easing: "easeOutQuart" },
    transitions: {
      show: { animations: { y: { from: 0 } } },
      hide: { animations: { y: { to: 0 } } },
    },
    plugins: {
      legend: { labels: chartFont() },
      tooltip: { callbacks: { label: formatTooltipLabel } },
    },
    scales: {
      y: {
        type: "linear",
        position: "left",
        beginAtZero: true,
        title: { display: true, text: axisTitles.y, ...chartFont() },
        ticks: chartFont(),
        grid: { color: chartColors().grid },
      },
      y1: {
        type: "linear",
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        title: { display: true, text: axisTitles.y1, ...chartFont() },
        ticks: {
          ...chartFont(),
          callback: (v) => formatBytes(v),
        },
      },
      y2: {
        type: "linear",
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        title: { display: true, text: axisTitles.y2, ...chartFont() },
        ticks: {
          ...chartFont(),
          callback: (v) => formatDuration(v),
        },
      },
      x: {
        ticks: { ...chartFont(), ...xOverrides },
        grid: { color: chartColors().grid },
      },
    },
  };
}

const TREND_AXES = { y: "次数 / 会话", y1: "入站 / 出站", y2: "播放时长" };
const HOURLY_AXES = { y: "播放次数", y1: "入站 / 出站", y2: "播放时长" };

function buildTrendChart(daysSorted, dayMap) {
  const { palette } = chartColors();
  const pick = (field) => daysSorted.map((d) => dayMap.get(d)[field]);
  renderChart("chartTrend", document.getElementById("chartTrend"), {
    type: "line",
    data: {
      labels: daysSorted,
      datasets: [
        {
          label: "播放次数",
          data: pick("plays"),
          borderColor: palette[0],
          backgroundColor: withAlpha(palette[0], 0.12),
          yAxisID: "y",
          tension: 0.3,
          fill: true,
        },
        {
          label: "会话数",
          data: pick("sessions"),
          borderColor: palette[1],
          yAxisID: "y",
          tension: 0.3,
          fill: false,
        },
        {
          label: "入站",
          data: pick("inbound"),
          borderColor: palette[2],
          yAxisID: "y1",
          tension: 0.3,
          fill: false,
        },
        {
          label: "出站",
          data: pick("outbound"),
          borderColor: palette[3],
          yAxisID: "y1",
          tension: 0.3,
          fill: false,
        },
        {
          label: "播放时长",
          data: pick("duration"),
          borderColor: palette[4],
          yAxisID: "y2",
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: timeSeriesOptions(TREND_AXES),
  });
}

function buildHourlyChart(hourly) {
  const { palette } = chartColors();
  const hourLabels = hourly.map((h) => {
    const dt = new Date(Number(h.hour));
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    return `${mm}-${dd} ${hh}:00`;
  });
  renderChart("chartHourly", document.getElementById("chartHourly"), {
    type: "bar",
    data: {
      labels: hourLabels,
      datasets: [
        {
          label: "入站",
          data: hourly.map((h) => Number(h.inboundBytes || 0)),
          backgroundColor: withAlpha(palette[2], 0.55),
          yAxisID: "y1",
        },
        {
          label: "出站",
          data: hourly.map((h) => Number(h.outboundBytes || 0)),
          backgroundColor: withAlpha(palette[3], 0.55),
          yAxisID: "y1",
        },
        {
          label: "播放次数",
          data: hourly.map((h) => Number(h.plays || 0)),
          type: "line",
          borderColor: palette[0],
          yAxisID: "y",
          tension: 0.3,
          fill: false,
        },
        {
          label: "播放时长",
          data: hourly.map((h) => Number(h.durationMs || 0)),
          type: "line",
          borderColor: palette[4],
          yAxisID: "y2",
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: timeSeriesOptions(HOURLY_AXES, {
      maxTicksLimit: 12,
      autoSkip: true,
    }),
  });
}

function buildNodeChart(stats, nodeDisplayMap) {
  const { palette } = chartColors();
  const nodeMap = new Map();
  for (const s of stats) {
    nodeMap.set(s.node, (nodeMap.get(s.node) || 0) + Number(s.plays || 0));
  }
  const nodeEntries = [...nodeMap.entries()].sort((a, b) => b[1] - a[1]);
  const total = nodeEntries.reduce((sum, e) => sum + e[1], 0);
  renderChart("chartByNode", document.getElementById("chartByNode"), {
    type: "doughnut",
    data: {
      labels: nodeEntries.map(
        (e) => nodeDisplayMap.get(String(e[0]).toLowerCase()) || e[0],
      ),
      datasets: [
        {
          data: nodeEntries.map((e) => e[1]),
          backgroundColor: nodeEntries.map(
            (_, i) => palette[i % palette.length],
          ),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: chartFont() },
        tooltip: {
          callbacks: {
            label: (c) =>
              `${c.label}: ${c.parsed} 次 (${((c.parsed / total) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

function buildClientChart(stats) {
  const { palette } = chartColors();
  // 按原始 client 聚合（相同精简名的不同参数会归并），
  // 展示精简名，tooltip 显示完整原始名称。
  const clientMap = new Map();
  for (const s of stats) {
    clientMap.set(s.client, (clientMap.get(s.client) || 0) + Number(s.plays || 0));
  }
  const clientEntries = [...clientMap.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(-10);
  const fullClientName = new Map(
    clientEntries.map((e) => [shortClientName(e[0]), e[0]]),
  );
  renderChart("chartByClient", document.getElementById("chartByClient"), {
    type: "bar",
    data: {
      labels: clientEntries.map((e) => shortClientName(e[0])),
      datasets: [
        {
          label: "播放次数",
          data: clientEntries.map((e) => e[1]),
          backgroundColor: palette[2],
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const t = items[0]?.label || "";
              return fullClientName.get(t) || t;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: chartFont(),
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: {
            ...chartFont(),
            callback: function (value) {
              const label = this.getLabelForValue(value);
              return wrapClientLabel(label);
            },
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

let lastChartsDays = null;

export async function loadCharts() {
  const days = parseInt(
    document.getElementById("chartsDays")?.value || "7",
  );
  lastChartsDays = days;
  const [dayRes, hourRes] = await Promise.all([
    api("stats.get", { days }),
    api("stats.hourly", { hours: 72 }),
  ]);
  if (!dayRes.ok) {
    toast("加载统计失败", "err");
    return;
  }
  const stats = dayRes.stats || [];
  const hourly = hourRes.ok ? hourRes.stats || [] : [];

  const isEmpty = stats.length === 0 && hourly.length === 0;
  document.getElementById("chartsEmpty").style.display = isEmpty ? "" : "none";
  if (isEmpty) {
    ["chartTrend", "chartHourly", "chartByNode", "chartByClient"].forEach(
      destroyChart,
    );
    return;
  }

  // 节点名称映射：内部 node -> 对外显示名（displayName）
  const nodeDisplayMap = new Map();
  for (const n of state.allNodes || []) {
    const key = String(n.name || "").toLowerCase();
    if (key && n.displayName) nodeDisplayMap.set(key, n.displayName);
  }

  // 按天聚合
  const dayMap = new Map();
  for (const s of stats) {
    const d = s.day;
    if (!dayMap.has(d))
      dayMap.set(d, { plays: 0, sessions: 0, inbound: 0, outbound: 0, duration: 0 });
    const row = dayMap.get(d);
    row.plays += Number(s.plays || 0);
    row.sessions += Number(s.sessions || 0);
    row.inbound += Number(s.inboundBytes || 0);
    row.outbound += Number(s.outboundBytes || 0);
    row.duration += Number(s.durationMs || 0);
  }
  const daysSorted = [...dayMap.keys()].sort();

  buildTrendChart(daysSorted, dayMap);
  buildHourlyChart(hourly);
  buildNodeChart(stats, nodeDisplayMap);
  buildClientChart(stats);
}

// 主题切换后用当前数据重建图表（配色随 CSS 变量变化）。
onThemeChange(() => {
  if (lastChartsDays !== null && state.currentTab === "charts") {
    loadCharts();
  }
});

// 窗口缩放时重绘图表，确保 vh 高度变化后 chart 填满新容器。
let chartsResizeTimer = null;

export function initCharts() {
  window.addEventListener("resize", () => {
    clearTimeout(chartsResizeTimer);
    chartsResizeTimer = setTimeout(() => {
      for (const key of Object.keys(chartInstances)) {
        try {
          chartInstances[key].resize();
        } catch {}
      }
    }, 150);
  });
}

export function chartsActions() {
  return {
    "charts-load": () => loadCharts(),
  };
}
