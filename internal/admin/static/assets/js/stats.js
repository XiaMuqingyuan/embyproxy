// 统计表：卡片汇总 + 可排序表格（排序偏好记忆到本地偏好存储）。

import { api } from "./api.js";
import { readStored, writeStored } from "./storage.js";
import { esc, toast, formatDuration, formatBytes, statusCells } from "./ui.js";

let statsSort = { key: "day", dir: "desc" };
let lastStatsRows = [];

const NUMERIC_KEYS = new Set([
  "plays",
  "sessions",
  "durationMs",
  "inboundBytes",
  "outboundBytes",
]);

function trafficInboundBytes(stat) {
  return Number(stat?.inboundBytes || 0);
}

function trafficOutboundBytes(stat) {
  return Number(stat?.outboundBytes || 0);
}

function sortStatsRows(rows) {
  const { key, dir } = statsSort;
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (NUMERIC_KEYS.has(key)) {
      av = Number(av || 0);
      bv = Number(bv || 0);
    } else {
      av = String(av || "").toLowerCase();
      bv = String(bv || "").toLowerCase();
    }
    if (av < bv) return -1 * mult;
    if (av > bv) return 1 * mult;
    return 0;
  });
}

function renderStatsTable(rows) {
  const tbody = document.getElementById("statsBody");
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (s) => `
    <tr><td>${esc(s.day)}</td><td>${esc(s.node)}</td><td>${esc(s.client)}</td><td>${s.plays}</td><td>${s.sessions}</td><td>${formatDuration(Number(s.durationMs || 0))}</td><td>${formatBytes(trafficInboundBytes(s))}</td><td>${formatBytes(trafficOutboundBytes(s))}</td></tr>
  `,
        )
        .join("")
    : '<tr><td class="table-empty" colspan="8">暂无数据</td></tr>';
  updateStatsHeaderArrows();
}

function updateStatsHeaderArrows() {
  document.querySelectorAll("#statsTable th[data-sort]").forEach((th) => {
    const key = th.getAttribute("data-sort");
    let suffix = "";
    if (key === statsSort.key) {
      suffix = statsSort.dir === "asc" ? " ↑" : " ↓";
      th.classList.add("sort-active");
    } else {
      th.classList.remove("sort-active");
    }
    const base =
      th.getAttribute("data-sort-label") ||
      th.innerText.replace(/[ ↑↓]/g, "");
    th.setAttribute("data-sort-label", base);
    th.innerText = base + suffix;
  });
}

function toggleStatsSort(key) {
  if (statsSort.key === key) {
    statsSort.dir = statsSort.dir === "asc" ? "desc" : "asc";
  } else {
    statsSort = { key, dir: "desc" };
  }
  writeStored("embyproxy_stats_sort", JSON.stringify(statsSort));
  renderStatsTable(sortStatsRows(lastStatsRows));
}

export async function loadStats() {
  const days = parseInt(document.getElementById("statsDays").value);
  const r = await api("stats.get", { days });
  if (!r.ok) {
    toast("加载统计失败", "err");
    return;
  }
  const stats = r.stats || [];
  lastStatsRows = stats;

  let totalPlays = 0,
    totalSessions = 0,
    totalInboundBytes = 0,
    totalOutboundBytes = 0,
    totalDurationMs = 0;
  const nodeSet = new Set(),
    clientSet = new Set();
  for (const s of stats) {
    totalPlays += Number(s.plays || 0);
    totalSessions += Number(s.sessions || 0);
    totalInboundBytes += trafficInboundBytes(s);
    totalOutboundBytes += trafficOutboundBytes(s);
    totalDurationMs += Number(s.durationMs || 0);
    nodeSet.add(s.node);
    clientSet.add(s.client);
  }

  document.getElementById("headStatus").innerHTML = statusCells([
    [totalPlays, "播放"],
    [totalSessions, "会话"],
  ]);
  document.getElementById("statsCards").innerHTML = `
    <div class="stat-block"><div class="val">${totalPlays}</div><div class="lbl">总播放次数</div></div>
    <div class="stat-block"><div class="val">${totalSessions}</div><div class="lbl">总会话数</div></div>
    <div class="stat-block"><div class="val">${formatDuration(totalDurationMs)}</div><div class="lbl">总播放时长</div></div>
    <div class="stat-block"><div class="val">${formatBytes(totalInboundBytes)}</div><div class="lbl">入站流量</div></div>
    <div class="stat-block"><div class="val">${formatBytes(totalOutboundBytes)}</div><div class="lbl">出站流量</div></div>
    <div class="stat-block"><div class="val">${nodeSet.size}</div><div class="lbl">活跃节点</div></div>
    <div class="stat-block"><div class="val">${clientSet.size}</div><div class="lbl">客户端种类</div></div>
  `;
  renderStatsTable(sortStatsRows(stats));
}

export function initStats() {
  try {
    const saved = readStored("embyproxy_stats_sort");
    if (saved) statsSort = JSON.parse(saved);
  } catch {}
  document.querySelectorAll("#statsTable th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.setAttribute("title", "点击排序");
    th.setAttribute("data-action", "stats-sort");
  });
}

export function statsActions() {
  return {
    "stats-load": () => loadStats(),
    "stats-sort": (_e, el) => toggleStatsSort(el.getAttribute("data-sort")),
  };
}
