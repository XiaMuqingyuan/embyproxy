// 系统配置、图片缓存、流量抓包与 Telegram 通知。
// 配置弹窗的回填/保存由同一份字段描述表驱动，新增字段只改一处。

import { api } from "./api.js";
import {
  toast,
  formatBytes,
  formatCommaList,
  flagEnabled,
  safeLogLevel,
} from "./ui.js";
import { showModal, hideModal } from "./modal.js";

// 字段描述表：
//   id   表单元素 id
//   key  后端 config 字段名
//   load 把后端值转成表单值（缺省直存）
//   read 保存时从表单读取的方式
const CONFIG_FIELDS = [
  { id: "cfg-logLevel", key: "logLevel", load: safeLogLevel, read: "value" },
  { id: "cfg-logAccess", key: "logAccess", load: (v) => v !== false, read: "checked" },
  { id: "cfg-capyStripEmby", key: "capyStripEmby", load: flagEnabled, read: "flag" },
  { id: "cfg-emosCompat", key: "emosCompat", load: (v) => !!v, read: "checked" },
  { id: "cfg-emosMatchHosts", key: "emosMatchHosts", load: formatCommaList, read: "trim" },
  { id: "cfg-emosProxyId", key: "emosProxyId", load: (v) => v || "", read: "trim" },
  { id: "cfg-emosProxyName", key: "emosProxyName", load: (v) => v || "", read: "trim" },
  {
    id: "cfg-imageProxyLimitEnabled",
    key: "imageProxyLimitEnabled",
    load: (v) => v === true,
    read: "checked",
  },
  {
    id: "cfg-imageProxyMaxConcurrent",
    key: "imageProxyMaxConcurrent",
    dft: 4,
    read: "int",
  },
  {
    id: "cfg-imageProxyRequestIntervalMs",
    key: "imageProxyRequestIntervalMs",
    dft: 250,
    read: "int",
  },
  {
    id: "cfg-imageCacheEnabled",
    key: "imageCacheEnabled",
    load: (v) => v === true,
    read: "checked",
  },
  { id: "cfg-imageCacheTtlDays", key: "imageCacheTtlDays", dft: 30, read: "int" },
  { id: "cfg-corsAllowOrigin", key: "corsAllowOrigin", load: formatCommaList, read: "trim" },
  {
    id: "cfg-externalAllowHosts",
    key: "externalAllowHosts",
    load: formatCommaList,
    read: "trim",
  },
  { id: "cfg-externalAllowAny", key: "externalAllowAny", load: (v) => !!v, read: "checked" },
  { id: "cfg-trustProxy", key: "trustProxy", load: (v) => v !== false, read: "checked" },
  {
    id: "cfg-trafficCaptureEnabled",
    key: "trafficCaptureEnabled",
    load: (v) => !!v,
    read: "checked",
  },
  {
    id: "cfg-trafficCaptureFile",
    key: "trafficCaptureFile",
    load: (v) => v || "./data/traffic-captures.jsonl",
    read: "trim",
  },
];

function fillConfigForm(c) {
  for (const field of CONFIG_FIELDS) {
    const el = document.getElementById(field.id);
    if (!el) continue;
    const value = c[field.key];
    if (field.read === "checked" || field.read === "flag") {
      el.checked = field.load ? field.load(value) : !!value;
    } else if (field.load) {
      el.value = field.load(value);
    } else {
      el.value = value ?? field.dft ?? "";
    }
  }
}

function readConfigForm() {
  const config = {};
  for (const field of CONFIG_FIELDS) {
    const el = document.getElementById(field.id);
    if (!el) continue;
    switch (field.read) {
      case "checked":
        config[field.key] = el.checked;
        break;
      case "flag":
        config[field.key] = el.checked ? "1" : "0";
        break;
      case "trim":
        config[field.key] = el.value.trim();
        break;
      case "int":
        config[field.key] = parseInt(el.value || String(field.dft), 10) || field.dft;
        break;
      default:
        config[field.key] = el.value;
    }
  }
  return config;
}

async function openConfigModal() {
  renderImageCacheStats(null);
  const r = await api("config.get");
  if (r.ok && r.config) fillConfigForm(r.config);
  showModal("configModal");
  const panel = document.querySelector("#configForm .config-panel");
  if (panel) panel.scrollTop = 0;
  document
    .querySelectorAll("#configForm .config-nav-button")
    .forEach((btn, index) => btn.classList.toggle("active", index === 0));
  refreshImageCacheStats(false);
  refreshTrafficCaptureStats(false);
}

function scrollConfigGroup(id, btn) {
  const group = document.getElementById(id);
  if (!group) return;
  document
    .querySelectorAll("#configForm .config-nav-button")
    .forEach((x) => x.classList.remove("active"));
  if (btn) btn.classList.add("active");
  group.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveConfig() {
  const r = await api("config.set", { config: readConfigForm() });
  if (r.ok) {
    hideModal("configModal");
    toast("系统配置已保存", "ok");
  } else toast("保存失败: " + r.error, "err");
}

// ---- 图片缓存 ----

function renderImageCacheStats(cache) {
  const bytesEl = document.getElementById("imageCacheBytes");
  const entriesEl = document.getElementById("imageCacheEntries");
  if (!bytesEl || !entriesEl) return;
  if (!cache) {
    bytesEl.textContent = "--";
    entriesEl.textContent = "--";
    return;
  }
  bytesEl.textContent = formatBytes(cache.bytes);
  entriesEl.textContent = `${formatCacheNumber(cache.entries)} 项`;
}

function formatCacheNumber(value) {
  return Math.max(0, Number(value || 0)).toLocaleString("zh-CN");
}

async function refreshImageCacheStats(showToast = true) {
  const r = await api("imageCache.stats");
  if (!r.ok) {
    renderImageCacheStats(null);
    if (showToast)
      toast("刷新图片缓存状态失败: " + (r.error || ""), "err");
    return;
  }
  renderImageCacheStats(r.cache);
  if (showToast) toast("图片缓存状态已刷新", "ok");
}

async function clearImageCache() {
  if (!confirm("确定清理图片缓存？")) return;
  const btn = document.getElementById("imageCacheClearBtn");
  if (btn) btn.disabled = true;
  const r = await api("imageCache.clear");
  if (btn) btn.disabled = false;
  if (!r.ok) {
    toast("清理图片缓存失败: " + (r.error || ""), "err");
    return;
  }
  renderImageCacheStats(r.cache);
  toast("图片缓存已清理", "ok");
}

// ---- 代理流量记录 ----

function renderTrafficCaptureStats(capture) {
  const bytesEl = document.getElementById("trafficCaptureBytes");
  const recordsEl = document.getElementById("trafficCaptureRecords");
  const stagesEl = document.getElementById("trafficCaptureStages");
  if (!bytesEl || !recordsEl) return;
  if (!capture) {
    bytesEl.textContent = "--";
    recordsEl.textContent = "--";
    renderTrafficCaptureStages(stagesEl, []);
    return;
  }
  bytesEl.textContent = formatBytes(capture.bytes);
  recordsEl.textContent = `${formatCacheNumber(capture.records)} 条`;
  renderTrafficCaptureStages(stagesEl, capture.stages || []);
}

function renderTrafficCaptureStages(el, stages) {
  if (!el) return;
  el.innerHTML = "";
  if (!stages.length) {
    const empty = document.createElement("div");
    empty.className = "traffic-stage-empty";
    empty.textContent = "暂无代理流量记录";
    el.appendChild(empty);
    return;
  }
  for (const item of stages) {
    const row = document.createElement("div");
    row.className = "traffic-stage-row";
    const name = document.createElement("div");
    name.className = "traffic-stage-name";
    name.textContent = trafficCaptureStageLabel(item.stage);
    const meta = document.createElement("div");
    meta.className = "traffic-stage-meta";
    meta.textContent = `${formatBytes(item.bytes)} · ${formatCacheNumber(item.records)} 条`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-danger";
    btn.textContent = "清除";
    btn.addEventListener("click", () =>
      clearTrafficCaptureStage(item.stage, btn),
    );
    row.append(name, meta, btn);
    el.appendChild(row);
  }
}

function trafficCaptureStageLabel(stage) {
  const text = String(stage || "").trim();
  return text || "未分类";
}

async function refreshTrafficCaptureStats(showToast = true) {
  const r = await api("trafficCapture.stats");
  if (!r.ok) {
    renderTrafficCaptureStats(null);
    if (showToast)
      toast("刷新代理流量记录状态失败: " + (r.error || ""), "err");
    return;
  }
  renderTrafficCaptureStats(r.capture);
  if (showToast) toast("代理流量记录状态已刷新", "ok");
}

async function clearTrafficCapture() {
  if (!confirm("确定清空代理流量记录？")) return;
  const btn = document.getElementById("trafficCaptureClearBtn");
  if (btn) btn.disabled = true;
  const r = await api("trafficCapture.clear");
  if (btn) btn.disabled = false;
  if (!r.ok) {
    toast("清空代理流量记录失败: " + (r.error || ""), "err");
    return;
  }
  renderTrafficCaptureStats(r.capture);
  toast("代理流量记录已清空", "ok");
}

async function clearTrafficCaptureStage(stage, btn) {
  const label = trafficCaptureStageLabel(stage);
  if (!confirm(`确定清空「${label}」分类下的代理流量记录？`)) return;
  if (btn) btn.disabled = true;
  const r = await api("trafficCapture.clearStage", { stage });
  if (btn) btn.disabled = false;
  if (!r.ok) {
    toast("清空分类记录失败: " + (r.error || ""), "err");
    return;
  }
  renderTrafficCaptureStats(r.capture);
  toast(`「${label}」分类记录已清空`, "ok");
}

// ---- Telegram 通知 ----

async function openTgModal() {
  const r = await api("tg.get");
  if (r.ok && r.config) {
    const c = r.config;
    document.getElementById("tg-enabled").checked = !!c.enabled;
    document.getElementById("tg-token").value = c.token || "";
    document.getElementById("tg-chat").value = c.chat || "";
    document.getElementById("tg-reportEnabled").checked =
      c.reportEnabled === true;
    document.getElementById("tg-reportTime").value = c.reportTime || "08:00";
    document.getElementById("tg-note").value = c.note || "";
  }
  syncTgReportControls();
  showModal("tgModal");
}

function syncTgReportControls() {
  const reportEnabled =
    document.getElementById("tg-reportEnabled").checked;
  document.querySelectorAll(".tg-report-setting").forEach((el) => {
    el.hidden = !reportEnabled;
  });
  document.getElementById("tg-reportTime").disabled = !reportEnabled;
}

async function saveTg() {
  const config = {
    enabled: document.getElementById("tg-enabled").checked,
    token: document.getElementById("tg-token").value.trim(),
    chat: document.getElementById("tg-chat").value.trim(),
    reportEnabled: document.getElementById("tg-reportEnabled").checked,
    reportTime: document.getElementById("tg-reportTime").value,
    note: document.getElementById("tg-note").value.trim(),
  };
  const r = await api("tg.set", { config });
  if (r.ok) {
    hideModal("tgModal");
    toast("TG 配置已保存", "ok");
  } else toast("保存失败: " + r.error, "err");
}

async function testTg() {
  toast("发送测试消息…", "info");
  const r = await api("tg.test");
  toast(
    r.ok ? "测试消息发送成功" : "发送失败: " + r.error,
    r.ok ? "ok" : "err",
  );
}

export function configActions() {
  return {
    "config-open": () => openConfigModal(),
    "config-save": () => saveConfig(),
    "config-scroll": (_e, el) =>
      scrollConfigGroup(el.dataset.target, el),
    "image-cache-refresh": () => refreshImageCacheStats(),
    "image-cache-clear": () => clearImageCache(),
    "capture-refresh": () => refreshTrafficCaptureStats(),
    "capture-clear": () => clearTrafficCapture(),
    "tg-open": () => openTgModal(),
    "tg-sync": () => syncTgReportControls(),
    "tg-test": () => testTg(),
    "tg-save": () => saveTg(),
  };
}
