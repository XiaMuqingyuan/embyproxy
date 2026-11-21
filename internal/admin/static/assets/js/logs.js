// 运行日志：分页浏览 + SSE 实时流。
// 状态机（去重水位 / 视图代数 / 流代际令牌 / gap 补齐 / 轮询降级）
// 从原单文件脚本 1:1 平移，逻辑未做重设计。

import { api, getToken } from "./api.js";
import { toast, attr, esc, safeLogLevel, copyText, statusCells } from "./ui.js";
import { state } from "./state.js";

const LOG_PAGE_LIMIT = 2000;
const LOG_DOM_LIMIT = 4000;

let logRefreshTimer = null;
let lastLogLines = [];
let currentLogPage = 1;
let currentLogTotalPages = 1;
let currentLogHasOlder = false;
let lastLogEntries = [];
let lastLogMeta = {};
let currentLogLevelFilter = "all";
let currentLogQuery = "";
let logSearchTimer = null;
let logStreamController = null;
let logStreamToken = 0;
let lastLogSeenId = 0;
let lastLogStreamId = 0;
let logViewEpoch = 0;
let logGapRefreshPending = false;
let pendingLogCount = 0;

export async function loadLogs(
  showToast = false,
  page = currentLogPage,
  options = {},
) {
  const requestedPage = Math.max(1, Math.floor(Number(page || 1)));
  const previousNewestId = Number(lastLogMeta?.newestId || 0);
  currentLogPage = requestedPage;
  const requestLevel = currentLogLevelFilter;
  const requestQuery = currentLogQuery;
  const requestLogViewEpoch = logViewEpoch;
  const payload = {
    limit: LOG_PAGE_LIMIT,
    page: requestedPage,
    level: requestLevel,
    query: requestQuery,
  };
  const r = await api("logs.list", payload);
  if (!r.ok) {
    toast("加载日志失败: " + (r.error || ""), "err");
    return false;
  }
  if (
    requestLevel !== currentLogLevelFilter ||
    requestQuery !== currentLogQuery
  ) {
    return false;
  }
  if (requestLogViewEpoch !== logViewEpoch) {
    return false;
  }
  const logs = Array.isArray(r.logs) ? r.logs : [];
  const currentIds = new Set(
    lastLogEntries.map(logEntryId).filter((id) => id > 0),
  );
  const nextNewestId = Number(r.newestId || 0);
  const nextStreamId = Number(r.streamId || nextNewestId || 0);
  const streamSequenceReset =
    lastLogStreamId > 0 && nextStreamId < lastLogStreamId;
  const snapshotNewestId = Math.max(nextNewestId, newestLogId(logs));
  const logSequenceReset =
    previousNewestId > 0 && snapshotNewestId < previousNewestId;
  const newLogCount =
    requestedPage === 1 &&
    previousNewestId > 0 &&
    nextNewestId > previousNewestId
      ? logs.filter((log) => {
          const id = logEntryId(log);
          return id > previousNewestId && !currentIds.has(id);
        }).length
      : 0;
  const resolvedPage = Math.max(1, Number(r.page || requestedPage));
  const mergedLogs =
    resolvedPage === 1
      ? mergeLogsWithStreamedEntries(logs, {
          skipExisting: logSequenceReset,
        })
      : logs;
  const mergedExtraCount = Math.max(0, mergedLogs.length - logs.length);
  const mergedNewestId = Math.max(snapshotNewestId, newestLogId(mergedLogs));
  const mergedMeta = {
    ...r,
    newestId: mergedNewestId,
    totalEntries:
      Math.max(0, Number(r.totalEntries ?? logs.length)) + mergedExtraCount,
  };
  lastLogEntries = mergedLogs;
  lastLogMeta = mergedMeta;
  currentLogPage = resolvedPage;
  currentLogTotalPages = Math.max(
    1,
    Math.ceil(Number(mergedMeta.totalEntries || 0) / payload.limit),
  );
  currentLogHasOlder =
    currentLogTotalPages > currentLogPage || !!r.hasOlder;
  if (currentLogPage === 1) {
    lastLogSeenId = mergedNewestId;
    if (requestQuery === "") {
      lastLogStreamId = streamSequenceReset
        ? nextStreamId
        : Math.max(lastLogStreamId, nextStreamId);
    }
  }
  renderLogs(mergedLogs, { ...mergedMeta, newLogCount });
  if (state.currentTab === "logs" && !options.skipRealtimeSync)
    syncLogRealtime();
  if (showToast) toast("日志已刷新", "ok");
  return true;
}

async function clearLogs() {
  if (!confirm("确定清空运行日志？")) return;
  const r = await api("logs.clear");
  if (!r.ok) {
    toast("清理日志失败: " + (r.error || ""), "err");
    return;
  }
  resetLogViewAfterClear(r);
  if (state.currentTab === "logs") syncLogRealtime();
  toast("日志已清理", "ok");
}

function resetLogViewAfterClear(meta = {}) {
  stopLogStream();
  logViewEpoch++;
  const clearedMeta = {
    ...lastLogMeta,
    ...meta,
    newestId: 0,
    oldestId: 0,
    totalEntries: 0,
    totalPages: 1,
    page: 1,
    hasOlder: false,
  };
  lastLogEntries = [];
  lastLogMeta = clearedMeta;
  currentLogPage = 1;
  currentLogTotalPages = 1;
  currentLogHasOlder = false;
  lastLogSeenId = 0;
  lastLogStreamId = 0;
  logGapRefreshPending = false;
  renderLogs([], { ...clearedMeta, resetPending: true });
}

function renderLogs(logs, meta = {}) {
  const consoleEl = document.getElementById("logConsole");
  const wasAtBottom = isAtBottom(consoleEl);
  updateLogSummary(logs, meta);
  lastLogLines = logs.map((x) => x.line || "");
  renderLogHeadStatus(logs);
  updateLogPager();
  if (!consoleEl) return;
  if (!logs.length) {
    consoleEl.innerHTML = '<div class="log-empty">暂无运行日志</div>';
    resetPendingLogCount();
    return;
  }
  consoleEl.innerHTML = logs
    .map(
      (log) =>
        `<div class="log-line log-${attr(safeLogLevel(log.level))}">${formatLogLine(log)}</div>`,
    )
    .join("");
  if (wasAtBottom || meta.resetPending) {
    scrollLogsToBottom();
  } else if (Number(meta.newLogCount || 0) > 0) {
    addPendingLogCount(Number(meta.newLogCount || 0));
  }
}

function updateLogSummary(logs, meta = {}) {
  const countEl = document.getElementById("logCount");
  const capacityEl = document.getElementById("logCapacity");
  const totalEntries = Math.max(0, Number(meta.totalEntries ?? logs.length));
  const pageText = `第 ${currentLogPage}/${currentLogTotalPages} 页`;
  if (countEl) {
    countEl.textContent =
      totalEntries === logs.length
        ? `${pageText} ${logs.length} 条`
        : `${pageText} 当前 ${logs.length} / 共 ${totalEntries} 条`;
  }
  if (capacityEl)
    capacityEl.textContent = `内存 ${Number(meta.capacity || 0)} / 历史 ${meta.history ? "轮转" : "内存"}`;
}

function formatLogLine(log) {
  const raw = String(log.line || "");
  const m = raw.match(/^(\S+)\s+(\[[A-Z]+\])\s?([\s\S]*)$/);
  if (!m) return `<span class="log-msg">${esc(raw)}</span>`;
  return `<span class="log-time">${esc(m[1])}</span><span class="log-badge">${esc(m[2])}</span><span class="log-msg">${esc(m[3])}</span>`;
}

function logEntryId(entry) {
  const id = Number(entry?.id || 0);
  return Number.isFinite(id) ? id : 0;
}

function newestLogId(logs) {
  return (logs || []).reduce((max, log) => Math.max(max, logEntryId(log)), 0);
}

function mergeLogsWithStreamedEntries(snapshotLogs, options = {}) {
  const snapshotNewestId = newestLogId(snapshotLogs);
  const seenIds = new Set(
    snapshotLogs.map(logEntryId).filter((id) => id > 0),
  );
  const existingLogs = options.skipExisting ? [] : lastLogEntries;
  const streamedLogs = existingLogs
    .filter((log) => {
      const id = logEntryId(log);
      return (
        id > snapshotNewestId &&
        !seenIds.has(id) &&
        logMatchesCurrentFilter(log)
      );
    })
    .sort((a, b) => logEntryId(a) - logEntryId(b));
  return [...snapshotLogs, ...streamedLogs].slice(-LOG_DOM_LIMIT);
}

function setLogLevelFilter(value) {
  const level = String(value || "all").toLowerCase();
  currentLogLevelFilter = [
    "all",
    "error",
    "warn",
    "info",
    "debug",
  ].includes(level)
    ? level
    : "all";
  const select = document.getElementById("logLevelFilter");
  if (select) select.value = currentLogLevelFilter;
  loadLogs(false, 1);
}

function setLogQuery(value) {
  currentLogQuery = String(value || "").trim();
  if (
    currentLogQuery &&
    document.getElementById("logAutoRefresh")?.checked
  ) {
    disableLogAutoRefresh("搜索中", "paused");
  }
  if (logSearchTimer) clearTimeout(logSearchTimer);
  logSearchTimer = setTimeout(() => loadLogs(false, 1), 300);
}

function updateLogPager() {
  const latestBtn = document.getElementById("logLatestBtn");
  const newerBtn = document.getElementById("logNewerBtn");
  const olderBtn = document.getElementById("logOlderBtn");
  updateLogPageInput();
  if (latestBtn) latestBtn.disabled = currentLogPage <= 1;
  if (newerBtn) newerBtn.disabled = currentLogPage <= 1;
  if (olderBtn)
    olderBtn.disabled =
      !currentLogHasOlder || currentLogPage >= currentLogTotalPages;
}

function loadLatestLogs(showToast = false) {
  loadLogs(showToast, 1);
}

function loadOlderLogs() {
  if (!currentLogHasOlder || currentLogPage >= currentLogTotalPages)
    return;
  disableLogAutoRefresh();
  loadLogs(false, currentLogPage + 1);
}

function loadNewerLogs() {
  if (currentLogPage <= 1) return;
  loadLogs(false, currentLogPage - 1);
}

function jumpLogsPage() {
  const input = document.getElementById("logPageInput");
  const page = Math.floor(Number(input?.value || 1));
  if (!Number.isFinite(page) || page < 1) {
    toast("页码不合法", "err");
    updateLogPageInput();
    return;
  }
  if (page > 1) disableLogAutoRefresh();
  loadLogs(false, page);
}

function updateLogPageInput() {
  const input = document.getElementById("logPageInput");
  const total = document.getElementById("logPageTotal");
  if (input) {
    input.value = currentLogPage;
    input.max = currentLogTotalPages;
  }
  if (total) total.textContent = `/ ${currentLogTotalPages}`;
}

function renderLogHeadStatus(logs) {
  const latest = logs.length
    ? String(logs[logs.length - 1].level || "-").toUpperCase()
    : "-";
  document.getElementById("headStatus").innerHTML = statusCells([
    [logs.length, "日志"],
    [latest, "最新等级"],
  ]);
}

function setLogAutoRefresh(enabled) {
  if (!enabled) {
    stopLogRealtime();
    return;
  }
  if (currentLogPage > 1) {
    disableLogAutoRefresh();
    toast("历史页不启用实时日志，请切回最新页", "info");
    return;
  }
  if (currentLogQuery) {
    disableLogAutoRefresh("搜索中", "paused");
    toast("搜索时不启用实时日志，请清空搜索后再打开", "info");
    return;
  }
  if (state.currentTab === "logs") startLogStream();
  else setLogStreamStatus("待机", "paused");
}

function syncLogRealtime() {
  if (!isLogRealtimeEnabled()) {
    stopLogRealtime();
    return;
  }
  if (!isLogStreamAllowed()) {
    stopLogStream();
    stopLogAutoRefresh();
    setLogStreamStatus(currentLogQuery ? "搜索中" : "历史页", "paused");
    return;
  }
  if (!logStreamController && !logRefreshTimer) startLogStream();
}

function isLogStreamAllowed() {
  return (
    state.currentTab === "logs" &&
    currentLogPage === 1 &&
    currentLogQuery === ""
  );
}

function isLogRealtimeEnabled() {
  return !!document.getElementById("logAutoRefresh")?.checked;
}

async function startLogStream() {
  stopLogStream();
  stopLogAutoRefresh();
  if (!isLogStreamAllowed()) {
    setLogStreamStatus(currentLogQuery ? "搜索中" : "待机", "paused");
    return;
  }
  const token = ++logStreamToken;
  const controller = new AbortController();
  logStreamController = controller;
  logGapRefreshPending = false;
  setLogStreamStatus("连接中", "paused");
  try {
    const response = await fetch("/admin/logs/stream", {
      headers: { Authorization: "Bearer " + getToken() },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("日志流不可用");
    setLogStreamStatus("同步中", "stream");
    const streamEpoch = logViewEpoch;
    const hydrated = await loadLogs(false, 1, { skipRealtimeSync: true });
    if (!hydrated) throw new Error("日志补齐失败");
    if (token !== logStreamToken || streamEpoch !== logViewEpoch) return;
    setLogStreamStatus("已连接", "stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      buffer = consumeLogStreamBuffer(buffer, token, streamEpoch);
    }
    if (buffer.trim()) handleLogStreamFrame(buffer, token, streamEpoch);
    if (!controller.signal.aborted && token === logStreamToken)
      startLogAutoRefresh();
  } catch (e) {
    if (!controller.signal.aborted && token === logStreamToken) {
      controller.abort();
      startLogAutoRefresh();
    }
  } finally {
    if (logStreamController === controller) logStreamController = null;
  }
}

function consumeLogStreamBuffer(buffer, token, streamEpoch) {
  let index = buffer.indexOf("\n\n");
  while (index >= 0) {
    handleLogStreamFrame(buffer.slice(0, index), token, streamEpoch);
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf("\n\n");
  }
  return buffer;
}

function handleLogStreamFrame(frame, token, streamEpoch) {
  if (token !== logStreamToken || streamEpoch !== logViewEpoch) return;
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  try {
    handleLogStreamEntry(JSON.parse(data), token, streamEpoch);
  } catch (e) {
    return;
  }
}

function handleLogStreamEntry(entry, token, streamEpoch) {
  if (token !== logStreamToken || streamEpoch !== logViewEpoch) return;
  if (!entry || typeof entry !== "object" || !isLogStreamAllowed())
    return;
  if (entry.type === "clear") {
    resetLogViewAfterClear();
    if (state.currentTab === "logs") syncLogRealtime();
    return;
  }
  const id = logEntryId(entry);
  if (id > 0 && !noteLogStreamId(id)) return;
  if (!logMatchesCurrentFilter(entry)) return;
  if (id > 0 && id <= lastLogSeenId) return;
  appendLogLine(entry);
}

function noteLogStreamId(id) {
  if (id <= 0) return true;
  if (lastLogStreamId > 0 && id <= lastLogStreamId) return false;
  if (lastLogStreamId > 0 && id > lastLogStreamId + 1) {
    scheduleLogGapRefresh();
  }
  lastLogStreamId = id;
  return true;
}

function scheduleLogGapRefresh() {
  if (logGapRefreshPending) return;
  logGapRefreshPending = true;
  const expectedEpoch = logViewEpoch;
  const expectedToken = logStreamToken;
  setLogStreamStatus("同步中", "stream");
  Promise.resolve().then(async () => {
    try {
      await loadLogs(false, 1, { skipRealtimeSync: true });
    } catch (e) {
      return;
    } finally {
      logGapRefreshPending = false;
      if (
        expectedEpoch === logViewEpoch &&
        expectedToken === logStreamToken &&
        logStreamController &&
        isLogStreamAllowed()
      ) {
        setLogStreamStatus("已连接", "stream");
      }
    }
  });
}

function logMatchesCurrentFilter(entry) {
  if (
    currentLogLevelFilter !== "all" &&
    safeLogLevel(entry.level) !== currentLogLevelFilter
  )
    return false;
  const query = currentLogQuery.toLowerCase();
  if (
    query &&
    !String(entry.line || "")
      .toLowerCase()
      .includes(query)
  )
    return false;
  return true;
}

function appendLogLine(entry) {
  const consoleEl = document.getElementById("logConsole");
  if (!consoleEl) return;
  const id = logEntryId(entry);
  if (id > 0 && id <= lastLogSeenId) return;
  const wasAtBottom = isAtBottom(consoleEl);
  if (consoleEl.querySelector(".log-empty")) consoleEl.innerHTML = "";
  const lineEl = document.createElement("div");
  lineEl.className = `log-line log-${safeLogLevel(entry.level)}`;
  lineEl.innerHTML = formatLogLine(entry);
  consoleEl.appendChild(lineEl);
  while (consoleEl.children.length > LOG_DOM_LIMIT) {
    consoleEl.firstElementChild?.remove();
  }

  const previousTotal = Math.max(
    Number(lastLogMeta.totalEntries || 0),
    lastLogEntries.length,
  );
  lastLogEntries = [...lastLogEntries, entry].slice(-LOG_DOM_LIMIT);
  lastLogLines = lastLogEntries.map((x) => x.line || "");
  const totalEntries = previousTotal + 1;
  lastLogMeta = {
    ...lastLogMeta,
    newestId: entry.id || lastLogMeta.newestId,
    totalEntries,
  };
  lastLogSeenId = Math.max(lastLogSeenId, id);
  currentLogTotalPages = Math.max(
    1,
    Math.ceil(totalEntries / LOG_PAGE_LIMIT),
  );
  currentLogHasOlder = currentLogTotalPages > currentLogPage;
  updateLogSummary(lastLogEntries, lastLogMeta);
  renderLogHeadStatus(lastLogEntries);
  updateLogPager();
  if (wasAtBottom) scrollLogsToBottom();
  else addPendingLogCount(1);
}

function startLogAutoRefresh() {
  stopLogAutoRefresh();
  if (!isLogStreamAllowed()) {
    setLogStreamStatus(currentLogQuery ? "搜索中" : "待机", "paused");
    return;
  }
  setLogStreamStatus("自动刷新", "polling");
  logRefreshTimer = setInterval(() => {
    if (isLogStreamAllowed()) loadLogs();
    else stopLogAutoRefresh();
  }, 5000);
  loadLogs();
}

function stopLogAutoRefresh() {
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = null;
  }
}

function stopLogStream() {
  logStreamToken++;
  if (logStreamController) {
    logStreamController.abort();
    logStreamController = null;
  }
}

export function stopLogRealtime(status = "已关闭", mode = "") {
  stopLogStream();
  stopLogAutoRefresh();
  setLogStreamStatus(status, mode);
}

function disableLogAutoRefresh(status = "已关闭", mode = "") {
  const el = document.getElementById("logAutoRefresh");
  if (el) el.checked = false;
  stopLogRealtime(status, mode);
}

function setLogStreamStatus(text, mode = "") {
  const el = document.getElementById("logStreamStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `log-pill log-stream-state${mode ? " " + mode : ""}`;
}

function isAtBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

function scrollLogsToBottom() {
  const consoleEl = document.getElementById("logConsole");
  if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
  resetPendingLogCount();
}

function addPendingLogCount(count) {
  pendingLogCount += Math.max(0, Number(count || 0));
  updateLogNewBadge();
}

function resetPendingLogCount() {
  pendingLogCount = 0;
  updateLogNewBadge();
}

function updateLogNewBadge() {
  const el = document.getElementById("logNewBadge");
  if (!el) return;
  el.hidden = pendingLogCount <= 0;
  el.textContent = `↓ ${pendingLogCount} 条新日志`;
}

function copyLogs() {
  if (!lastLogLines.length) {
    toast("没有可复制的日志", "info");
    return;
  }
  copyText(lastLogLines.join("\n"));
}

export function syncRealtimeIfAllowed() {
  if (state.currentTab === "logs") syncLogRealtime();
}

export function initLogs() {
  document
    .getElementById("logConsole")
    ?.addEventListener("scroll", (e) => {
      if (isAtBottom(e.currentTarget)) resetPendingLogCount();
    });
}

export function logsActions() {
  return {
    "log-query": (_e, el) => setLogQuery(el.value),
    "log-level": (_e, el) => setLogLevelFilter(el.value),
    "log-realtime": (_e, el) => setLogAutoRefresh(el.checked),
    "log-refresh": () => loadLogs(true),
    "log-latest": () => loadLatestLogs(true),
    "log-newer": () => loadNewerLogs(),
    "log-older": () => loadOlderLogs(),
    "log-jump": () => jumpLogsPage(),
    "log-copy": () => copyLogs(),
    "log-clear": () => clearLogs(),
    "log-bottom": () => scrollLogsToBottom(),
  };
}
