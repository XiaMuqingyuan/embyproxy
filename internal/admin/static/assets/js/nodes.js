// 节点列表：加载、搜索过滤、渲染、拖拽排序、选择与批量操作、
// 在线检测、导入导出。事件通过 data-action 委托到 main.js。

import { api } from "./api.js";
import { esc, attr, toast, downloadJson, formatStamp, statusCells } from "./ui.js";
import { state } from "./state.js";

const HIDDEN_PROXY_TEXT = "••••••••••••••••••••••••••••••••";

const IMPERSONATE_LABELS = {
  yamby: "Yamby Android",
  hills_android: "Hills Android",
  hills_windows: "Hills Windows",
};

const EYE_ICONS = {
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  closed:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a3 3 0 0 0 4.1 4.1"></path><path d="M9.5 5.5A10.6 10.6 0 0 1 12 5c6 0 9.5 7 9.5 7a16.6 16.6 0 0 1-2.4 3.2"></path><path d="M6.2 6.8C3.8 8.6 2.5 12 2.5 12s3.5 7 9.5 7c1.3 0 2.5-.3 3.6-.8"></path></svg>',
};

export async function loadNodes() {
  const r = await api("list");
  if (!r.ok) {
    toast("加载节点失败: " + r.error, "err");
    return;
  }
  setAppVersion(r.build);
  state.allNodes = r.nodes || [];
  syncNodeState();
  renderTagFilter();
  filterNodes();
}

function setAppVersion(build) {
  if (build) state.appBuild = build;
  const el = document.getElementById("appVersion");
  if (!el || !state.appBuild) return;
  const version = state.appBuild.version || "dev";
  const commit = state.appBuild.commit || "unknown";
  const builtAt = state.appBuild.builtAt || "unknown";
  el.textContent = version;
  el.title = `版本: ${version}\nCommit: ${commit}\n构建时间: ${builtAt}`;
  el.classList.add("has-build");
}

function syncNodeState() {
  const names = new Set(state.allNodes.map((n) => n.name));
  state.selectedNodes.forEach((name) => {
    if (!names.has(name)) state.selectedNodes.delete(name);
  });
  state.visibleProxyUrls.forEach((name) => {
    if (!names.has(name)) state.visibleProxyUrls.delete(name);
  });
  for (const name of Object.keys(state.nodeChecks))
    if (!names.has(name)) delete state.nodeChecks[name];
  if (state.focusedNodeName && !names.has(state.focusedNodeName))
    state.focusedNodeName = "";
}

function renderTagFilter() {
  const sel = document.getElementById("tagFilter");
  const cur = sel.value;
  const tags = [
    ...new Set(state.allNodes.map((n) => n.tag).filter(Boolean)),
  ];
  sel.innerHTML =
    '<option value="">全部标签</option>' +
    tags
      .map((t) => `<option value="${attr(t)}">${esc(t)}</option>`)
      .join("");
  if (cur) sel.value = cur;
}

function getFilteredNodes() {
  const q = document.getElementById("searchInput").value.toLowerCase();
  const tag = document.getElementById("tagFilter").value;
  return state.allNodes.filter((n) => {
    if (tag && n.tag !== tag) return false;
    if (
      q &&
      !n.name.includes(q) &&
      !(n.displayName || "").toLowerCase().includes(q) &&
      !(n.tag || "").toLowerCase().includes(q)
    )
      return false;
    return true;
  });
}

function splitTargets(target) {
  return String(target || "")
    .split(/[\n;,]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function filterNodes() {
  const nodes = getFilteredNodes();
  renderSignals(nodes);
  renderNodes(nodes);
  renderFocusPanel(nodes);
  renderHeadStatus();
  updateSelBar();
}

export function renderHeadStatus() {
  const el = document.getElementById("headStatus");
  if (!el) return;
  el.innerHTML = statusCells([
    [state.allNodes.length, "Emby 节点"],
    [state.selectedNodes.size, "选中"],
  ]);
}

function renderSignals(visibleNodes) {
  const summary = nodeSummary();
  document.getElementById("nodeOverview").innerHTML = `
    <div class="signal"><b>${state.allNodes.length}</b><div><span>全部 Emby 节点</span><em>${visibleNodes.length} 条当前可见</em></div></div>
    <div class="signal"><b>${summary.fav}</b><div><span>收藏</span><em>置顶关注</em></div></div>
    <div class="signal"><b>${summary.protectedCount}</b><div><span>密钥</span><em>受保护 Emby 节点</em></div></div>
    <div class="signal"><b>${summary.keep}</b><div><span>保号</span><em>${summary.tags} 个标签</em></div></div>
  `;
}

function nodeSummary() {
  const summary = { fav: 0, keep: 0, protectedCount: 0, tags: new Set() };
  for (const n of state.allNodes) {
    if (n.fav) summary.fav++;
    if (Number(n.renewDays || 0) > 0) summary.keep++;
    if (n.secret) summary.protectedCount++;
    if (n.tag) summary.tags.add(n.tag);
  }
  return { ...summary, tags: summary.tags.size };
}

function renderFocusPanel(nodes) {
  const el = document.getElementById("focusPanel");
  if (!el) return;
  const focused = nodes.find((n) => n.name === state.focusedNodeName);
  const focus = focused || nodes[0];
  if (!focus) {
    el.innerHTML =
      "<h2>当前焦点</h2><p>暂无 Emby 节点，创建后这里会显示标签和上游摘要</p>";
    return;
  }
  const targets = splitTargets(focus.target);
  el.innerHTML = `
    <h2>${esc(focus.displayName || focus.name)}</h2>
    <p>${esc(focus.note || "未填写备注")}</p>
    <div class="focus-list">
      <div class="focus-item"><span>Emby 节点</span><b>/${esc(focus.name)}</b></div>
      <div class="focus-item"><span>上游</span><b>${targets.length} 个地址</b></div>
      <div class="focus-item"><span>标签</span><b>${esc(focus.tag || "无")}</b></div>
      <div class="focus-item"><span>身份</span><b>${focus.impersonate === false ? "透传" : esc(impersonateProfileLabel(focus.impersonateProfile))}</b></div>
    </div>
  `;
}

function renderNodes(nodes) {
  const grid = document.getElementById("nodesGrid");
  if (!nodes.length) {
    grid.innerHTML =
      '<div class="empty-state"><b>没有匹配的 Emby 节点</b><span>尝试清空搜索条件，或添加一个新的 Emby 节点</span></div>';
    return;
  }
  grid.innerHTML = `
    <div class="route-board-head"><span>控制</span><span>显示名称</span><span>访问地址</span><span>状态</span><span>动作</span></div>
    ${nodes.map((n) => nodeCard(n)).join("")}
  `;
}

function toggleProxyUrl(name) {
  if (state.visibleProxyUrls.has(name)) state.visibleProxyUrls.delete(name);
  else state.visibleProxyUrls.add(name);
  renderNodes(getFilteredNodes());
}

function focusNodeCard(event, name) {
  const target = event?.target;
  if (
    target?.closest?.('button,input,select,textarea,a,[draggable="true"]')
  )
    return;
  state.focusedNodeName = name;
  const nodes = getFilteredNodes();
  renderNodes(nodes);
  renderFocusPanel(nodes);
}

export function normalizeImpersonateProfile(profile) {
  const value = String(profile || "").toLowerCase();
  return IMPERSONATE_LABELS[value] ? value : "yamby";
}

function impersonateProfileLabel(profile) {
  return IMPERSONATE_LABELS[normalizeImpersonateProfile(profile)];
}

function nodeCard(n) {
  const targets = splitTargets(n.target);
  const proxyUrl = `${location.origin}/${n.name}${n.secret ? "/" + n.secret : ""}`;
  const showProxy = state.visibleProxyUrls.has(n.name);
  const sel = state.selectedNodes.has(n.name);
  const focused = state.focusedNodeName === n.name;
  const identityLabel = impersonateProfileLabel(n.impersonateProfile);
  const check = state.nodeChecks[n.name];
  const checkText = check ? compactCheckText(check.text) : "检测";
  const checkClass = check ? " " + check.type : "";
  const checkTitle = check ? check.text : "检测延时";
  const eyeIcon = showProxy ? EYE_ICONS.open : EYE_ICONS.closed;
  return `<article class="route-row${sel ? " selected" : ""}${focused ? " focused" : ""}" id="row-${attr(n.name)}" data-name="${attr(n.name)}" data-action="focus" draggable="false">
    <div class="route-tools">
      <span class="drag-handle" draggable="true" data-name="${attr(n.name)}" title="拖动排序">↕</span>
      <input type="checkbox" class="row-check" ${sel ? "checked" : ""} data-name="${attr(n.name)}" data-action="toggle-select"/>
      <button class="fav-star ${n.fav ? "on" : ""}" data-name="${attr(n.name)}" data-action="toggle-fav" title="收藏" aria-label="收藏">★</button>
    </div>
    <div class="identity">
      <strong>${esc(n.displayName || n.name)}</strong>
    </div>
    <div class="route-address">
      <div class="proxy-line">
        <div class="mono${showProxy ? "" : " is-hidden"}">
          <span class="proxy-text">${showProxy ? esc(proxyUrl) : HIDDEN_PROXY_TEXT}</span>
          <button class="reveal-button${showProxy ? " on" : ""}" data-name="${attr(n.name)}" data-action="toggle-proxy" title="${showProxy ? "隐藏访问地址" : "显示访问地址"}" aria-label="${showProxy ? "隐藏访问地址" : "显示访问地址"}">${eyeIcon}</button>
        </div>
        <button class="copy-button" data-copy="${attr(proxyUrl)}" data-action="copy">复制</button>
      </div>
    </div>
    <div class="chip-pack">
      ${n.tag ? `<span class="node-tag">${esc(n.tag)}</span>` : ""}
      <span class="chip blue">${targets.length} 上游</span>
      ${n.secret ? '<span class="chip warn">密钥</span>' : '<span class="chip">公开</span>'}
      ${n.directExternal ? '<span class="chip blue">302直连</span>' : ""}
      ${n.renewDays ? '<span class="chip ok">保号</span>' : ""}
      <span class="chip">${!n.impersonate ? "透传" : "伪装：" + esc(identityLabel)}</span>
    </div>
    <div class="row-actions">
      <button class="btn btn-sm btn-primary row-action" data-name="${attr(n.name)}" data-action="node-edit">编辑</button>
      <button class="btn btn-sm row-action check-action${checkClass}" title="${attr(checkTitle)}" data-name="${attr(n.name)}" data-action="node-check">${esc(checkText)}</button>
      ${n.renewDays ? `<button class="btn btn-sm" data-name="${attr(n.name)}" data-display="${attr(n.displayName || n.name)}" data-renew="${Number(n.renewDays || 0)}" data-remind="${Number(n.remindBeforeDays || 0)}" data-at="${attr(n.keepaliveAt || "00:00")}" data-action="keepalive-test">保号测试</button>` : ""}
      <button class="btn btn-sm btn-danger row-action" data-name="${attr(n.name)}" data-action="node-delete">删除</button>
    </div>
  </article>`;
}

// ---- 拖拽排序（事件委托见 initNodes） ----

function onNodeDragStart(event, name) {
  state.draggingNode = name;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", name);
  }
  const row = document.getElementById("row-" + name);
  if (row) row.classList.add("dragging");
}

function onNodeDragOver(event, targetName) {
  if (!state.draggingNode || state.draggingNode === targetName) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function onNodeDragEnter(event, targetName) {
  if (!state.draggingNode || state.draggingNode === targetName) return;
  clearNodeDragClasses();
  const row = document.getElementById("row-" + targetName);
  if (row) row.classList.add("drag-over");
}

function onNodeDrop(event, targetName, row) {
  event.preventDefault();
  const sourceName =
    state.draggingNode || event.dataTransfer?.getData("text/plain") || "";
  const source = state.allNodes.find((n) => n.name === sourceName);
  const target = state.allNodes.find((n) => n.name === targetName);
  const afterTarget = shouldDropAfter(event, row);
  clearNodeDragState();
  if (!source || !target || sourceName === targetName) return;
  if (!!source.fav !== !!target.fav) {
    toast("收藏项会固定在前，请在同组内排序", "info");
    return;
  }
  moveNodeBeforeOrAfter(sourceName, targetName, afterTarget);
  filterNodes();
  toast("排序已调整，点击保存排序生效", "info");
}

function onNodeDragEnd() {
  clearNodeDragState();
}

function shouldDropAfter(event, row) {
  if (!row || !row.getBoundingClientRect) return false;
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function moveNodeBeforeOrAfter(sourceName, targetName, afterTarget) {
  const from = state.allNodes.findIndex((n) => n.name === sourceName);
  let to = state.allNodes.findIndex((n) => n.name === targetName);
  if (from < 0 || to < 0 || from === to) return;
  const [node] = state.allNodes.splice(from, 1);
  if (from < to) to--;
  if (afterTarget) to++;
  to = Math.max(0, Math.min(to, state.allNodes.length));
  state.allNodes.splice(to, 0, node);
}

function clearNodeDragClasses() {
  document
    .querySelectorAll(".route-row.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
}

function clearNodeDragState() {
  state.draggingNode = "";
  document
    .querySelectorAll(".route-row.dragging,.route-row.drag-over")
    .forEach((el) => {
      el.classList.remove("dragging", "drag-over");
    });
}

// ---- 选择与批量 ----

function toggleSelect(name, checked) {
  if (checked) state.selectedNodes.add(name);
  else state.selectedNodes.delete(name);
  filterNodes();
}

function updateSelBar() {
  const bar = document.getElementById("selBar");
  const n = state.selectedNodes.size;
  document.getElementById("selCount").textContent = n;
  bar.classList.toggle("visible", n > 0);
}

function selectAll() {
  getFilteredNodes().forEach((n) => state.selectedNodes.add(n.name));
  filterNodes();
}

function clearSel() {
  state.selectedNodes.clear();
  filterNodes();
}

async function deleteNode(name) {
  if (!confirm(`确认删除节点 "${name}"？`)) return;
  const r = await api("delete", { name });
  if (r.ok) {
    toast("已删除", "ok");
    await loadNodes();
  } else toast("删除失败: " + r.error, "err");
}

async function deleteSelected() {
  if (!state.selectedNodes.size) return;
  if (!confirm(`确认删除选中的 ${state.selectedNodes.size} 个节点？`)) return;
  const r = await api("batchDelete", { names: [...state.selectedNodes] });
  if (r.ok) {
    state.selectedNodes.clear();
    updateSelBar();
    toast("已删除", "ok");
    await loadNodes();
  } else toast("删除失败: " + r.error, "err");
}

async function toggleFav(name) {
  const r = await api("toggleFav", { name });
  if (r.ok) {
    await loadNodes();
  } else toast("操作失败: " + r.error, "err");
}

async function batchTagSelected() {
  const tag = prompt("输入标签名（留空清除）:");
  if (tag === null) return;
  const r = await api("batchTag", { names: [...state.selectedNodes], tag });
  if (r.ok) {
    toast("标签更新", "ok");
    await loadNodes();
  } else toast("失败: " + r.error, "err");
}

// ---- 在线检测 ----

async function checkNodeStatus(name) {
  state.nodeChecks[name] = { type: "info", text: "检测中…" };
  filterNodes();
  const r = await api("checkStatus", { name });
  state.nodeChecks[name] = r.ok
    ? formatCheckResult(r.results?.[0])
    : { type: "err", text: "失败" };
  filterNodes();
}

// 批量检测只重渲两次（开始/全部完成），避免每个结果都整表重建。
async function checkSelectedStatus() {
  const names = [...state.selectedNodes];
  if (!names.length) return;
  for (const name of names)
    state.nodeChecks[name] = { type: "info", text: "检测中…" };
  filterNodes();
  await Promise.all(
    names.map(async (name) => {
      const r = await api("checkStatus", { name });
      state.nodeChecks[name] = r.ok
        ? formatCheckResult(r.results?.[0])
        : { type: "err", text: "失败" };
    }),
  );
  filterNodes();
}

function compactCheckText(text) {
  return String(text || "").replace(/ · /g, " ");
}

function formatCheckResult(result) {
  if (!result) return { type: "err", text: "失败" };
  const msValue = Number(result.ms);
  const ms = Number.isFinite(msValue) ? `${Math.round(msValue)}ms` : "";
  if (result.error) {
    const error = String(result.error);
    const lowerError = error.toLowerCase();
    if (lowerError.includes("timeout") || lowerError.includes("deadline"))
      return { type: "err", text: "超时" };
    return { type: "err", text: ms ? `${error} · ${ms}` : error };
  }
  if (Number.isFinite(msValue) && msValue > 9999)
    return { type: "err", text: "超时" };
  const status = Number(result.status || 0);
  if (status >= 200 && status < 400)
    return { type: "ok", text: ms || "正常" };
  return {
    type: "warn",
    text: `${status || "异常"}${ms ? " · " + ms : ""}`,
  };
}

// ---- 导入 / 导出 ----

function openImportModal() {
  const file = document.getElementById("importFile");
  if (file) file.value = "";
  document.getElementById("importModal").style.display = "flex";
}

async function loadImportFile(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    toast("文件过大，导入接口限制 4MB", "err");
    return;
  }
  try {
    const text = await file.text();
    document.getElementById("importJson").value = text.trim();
    toast("已读取文件: " + file.name, "ok");
  } catch (e) {
    toast("读取文件失败: " + (e?.message || ""), "err");
  }
}

async function doImport() {
  let nodes;
  try {
    nodes = JSON.parse(document.getElementById("importJson").value);
  } catch {
    toast("JSON 格式错误", "err");
    return;
  }
  if (!Array.isArray(nodes)) nodes = [nodes];
  const r = await api("import", { nodes });
  if (r.ok) {
    const ok = r.results.filter((x) => x.ok).length;
    const fail = r.results.filter((x) => !x.ok);
    document.getElementById("importModal").style.display = "none";
    toast(
      `导入完成: ${ok} 成功${fail.length ? " / " + fail.length + " 失败" : ""}`,
      ok ? "ok" : "err",
    );
    if (fail.length) console.warn("Import failures:", fail);
    await loadNodes();
  } else {
    toast("导入失败: " + r.error, "err");
  }
}

async function doExport() {
  const names = [...state.selectedNodes];
  const r = await api("export", names.length ? { names } : {});
  if (!r.ok) {
    toast("导出失败: " + r.error, "err");
    return;
  }
  const nodes = Array.isArray(r.nodes) ? r.nodes : [];
  if (!nodes.length) {
    toast("没有可导出的节点", "info");
    return;
  }
  const scope = names.length ? "selected" : "all";
  downloadJson(
    `emby-proxy-nodes-${scope}-${formatStamp(new Date())}.json`,
    nodes,
  );
  toast(`已导出 ${nodes.length} 个节点`, "ok");
}

async function doSaveOrder() {
  const order = state.allNodes.map((n) => n.name);
  const r = await api("saveOrder", { order });
  toast(
    r.ok ? "排序已保存" : "失败: " + (r.error || ""),
    r.ok ? "ok" : "err",
  );
}

// 节点网格上的拖拽事件委托（drag 系列事件会冒泡）。
export function initNodes() {
  const grid = document.getElementById("nodesGrid");
  if (!grid) return;
  grid.addEventListener("dragstart", (e) => {
    const handle = e.target.closest?.(".drag-handle");
    if (handle) onNodeDragStart(e, handle.dataset.name);
  });
  grid.addEventListener("dragend", () => onNodeDragEnd());
  for (const type of ["dragover", "dragenter", "drop"]) {
    grid.addEventListener(type, (e) => {
      const row = e.target.closest?.(".route-row");
      if (!row || !row.dataset.name) return;
      if (type === "dragover") onNodeDragOver(e, row.dataset.name);
      else if (type === "dragenter") onNodeDragEnter(e, row.dataset.name);
      else onNodeDrop(e, row.dataset.name, row);
    });
  }
}

// 暴露给 main.js 动作注册表的节点相关动作。
export function nodeActions() {
  return {
    "filter-nodes": () => filterNodes(),
    "toggle-proxy": (_e, el) => toggleProxyUrl(el.dataset.name),
    focus: (e, el) => focusNodeCard(e, el.dataset.name),
    "toggle-select": (_e, el) => toggleSelect(el.dataset.name, el.checked),
    "toggle-fav": (_e, el) => toggleFav(el.dataset.name),
    "select-all": () => selectAll(),
    "clear-sel": () => clearSel(),
    "batch-tag": () => batchTagSelected(),
    "check-selected": () => checkSelectedStatus(),
    "delete-selected": () => deleteSelected(),
    "node-check": (_e, el) => checkNodeStatus(el.dataset.name),
    "node-delete": (_e, el) => deleteNode(el.dataset.name),
    "import-open": () => openImportModal(),
    "import-file": (_e, el) =>
      loadImportFile(el.files && el.files[0]),
    "import-run": () => doImport(),
    export: () => doExport(),
    "save-order": () => doSaveOrder(),
  };
}
