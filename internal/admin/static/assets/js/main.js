// 入口模块：登录、tab 路由、全局事件委托与各功能模块的装配。

import { api, setToken, hasToken } from "./api.js";
import { toast, copyText } from "./ui.js";
import { state } from "./state.js";
import { hideModal, toggleSection } from "./modal.js";
import { initTheme, toggleTheme } from "./theme.js";
import {
  loadNodes,
  renderHeadStatus,
  initNodes,
  nodeActions,
} from "./nodes.js";
import { closeNodeModal, nodeFormActions } from "./node-form.js";
import { loadStats, initStats, statsActions } from "./stats.js";
import { loadCharts, initCharts, chartsActions } from "./charts.js";
import {
  loadLogs,
  stopLogRealtime,
  syncRealtimeIfAllowed,
  initLogs,
  logsActions,
} from "./logs.js";
import { configActions } from "./config.js";
import { createActionDispatcher } from "./events.js";

// ---- 动作注册表 + 事件委托 ----
// 所有 data-action 元素（静态 HTML 与节点卡片模板）经此分发，
// 替代原 83 处 inline onclick/onchange/oninput。

const { registerActions, dispatchEvent } = createActionDispatcher();

registerActions(nodeActions());
registerActions(nodeFormActions());
registerActions(statsActions());
registerActions(chartsActions());
registerActions(logsActions());
registerActions(configActions());

// 弹窗：backdrop 点击关闭（仅当点击目标就是遮罩层本身）；按钮显式关闭。
registerActions({
  "modal-dismiss": (e, el) => {
    if (e.target !== el) return;
    if (el.id === "nodeModal") closeNodeModal();
    else hideModal(el.id);
  },
  "modal-hide": (_e, el) => {
    const layer = el.closest(".sheet-layer");
    if (!layer) return;
    if (layer.id === "nodeModal") closeNodeModal();
    else hideModal(layer.id);
  },
  "toggle-section": (_e, el) => toggleSection(el.dataset.target, el),
  copy: (_e, el) => copyText(el.dataset.copy),
  "theme-toggle": () => toggleTheme(),
});

document.addEventListener("click", dispatchEvent);
document.addEventListener("input", dispatchEvent);
document.addEventListener("change", dispatchEvent);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const el = e.target.closest?.("[data-action='log-jump']");
  if (el) dispatchEvent(e);
});

// ---- 登录 / 登出 ----

async function doLogin() {
  const tok = document.getElementById("tokenInput").value.trim();
  if (!tok) return;
  const r = await api("list", {}, tok);
  if (r.ok) {
    setToken(tok);
    initApp();
  } else {
    document.getElementById("loginErr").style.display = "block";
  }
}

function doLogout() {
  setToken("");
  stopLogRealtime();
  document.getElementById("app").style.display = "none";
  document.getElementById("loginWrap").style.display = "grid";
}

function initApp() {
  document.getElementById("loginWrap").style.display = "none";
  document.getElementById("app").style.display = "block";
  const nodeBtn = document.querySelector(".rail-button");
  if (nodeBtn) switchTab("nodes", nodeBtn);
  loadNodes();
}

// 会话 Token 失效：回到登录页（api.js 派发）。
document.addEventListener("ep:unauthorized", () => {
  if (!hasToken()) return;
  toast("登录已失效，请重新登录", "err");
  doLogout();
});

document.getElementById("tokenInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

// ---- Tab 路由 ----

const TAB_META = {
  nodes: ["媒体中枢", "Emby 服务器管理", "统一管理 Emby 服务器访问、线路与策略"],
  stats: ["播放统计", "播放统计", "查看近期播放次数、会话数与客户端分布"],
  logs: ["运行日志", "运行日志", "查看服务运行期间产生的日志"],
  charts: ["播放可视化", "播放可视化", "以图表形式查看播放趋势、节点与客户端分布"],
};

function switchTab(name, btn) {
  state.currentTab = name;
  document
    .getElementById("app")
    ?.classList.toggle("logs-active", name === "logs");
  document
    .querySelectorAll(".rail-button")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  const tabs = {
    nodes: "tabNodes",
    stats: "tabStats",
    logs: "tabLogs",
    charts: "tabCharts",
  };
  for (const [key, id] of Object.entries(tabs)) {
    const el = document.getElementById(id);
    if (el) el.style.display = key === name ? "" : "none";
  }
  const meta = TAB_META[name] || TAB_META.nodes;
  document.getElementById("pageKicker").textContent = meta[0];
  document.getElementById("pageTitle").textContent = meta[1];
  document.getElementById("pageSubtitle").textContent = meta[2];
  if (name === "stats") {
    stopLogRealtime("待机", "paused");
    loadStats();
  } else if (name === "logs") {
    loadLogs();
    if (document.getElementById("logAutoRefresh")?.checked)
      syncRealtimeIfAllowed();
  } else if (name === "charts") {
    stopLogRealtime("待机", "paused");
    loadCharts();
  } else {
    stopLogRealtime("待机", "paused");
    renderHeadStatus();
  }
}

registerActions({
  login: () => doLogin(),
  logout: () => doLogout(),
  tab: (_e, el) => switchTab(el.dataset.tab, el),
});

// ---- 启动 ----

initTheme();
initNodes();
initStats();
initCharts();
initLogs();

if (hasToken()) initApp();
