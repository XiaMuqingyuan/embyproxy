// 节点新增 / 编辑弹窗表单。

import { api } from "./api.js";
import { toast } from "./ui.js";
import { showModal, hideModal } from "./modal.js";
import { state } from "./state.js";
import { loadNodes, normalizeImpersonateProfile } from "./nodes.js";

function openAddModal() {
  state.editingNode = null;
  document.getElementById("modalTitle").textContent = "添加 Emby 节点";
  clearNodeForm();
  showModal("nodeModal");
  document.getElementById("f-name").focus();
}

function openEditModal(name) {
  const n = state.allNodes.find((x) => x.name === name);
  if (!n) return;
  state.editingNode = n;
  document.getElementById("modalTitle").textContent = "编辑 Emby 节点";
  fillNodeForm(n);
  showModal("nodeModal");
}

export function closeNodeModal() {
  hideModal("nodeModal");
  state.editingNode = null;
}

function clearNodeForm() {
  ["name", "displayName", "target", "secret", "tag", "note"].forEach((f) => {
    const el = document.getElementById("f-" + f);
    if (el) el.value = "";
  });
  document.getElementById("f-impersonate").checked = true;
  document.getElementById("f-impersonateProfile").value = "yamby";
  document.getElementById("f-impersonateDeviceName").value = "";
  syncImpersonateProfileState();
  document.getElementById("f-directExternal").checked = false;
  document.getElementById("f-renewDays").value = "0";
  document.getElementById("f-remindBeforeDays").value = "3";
  document.getElementById("f-keepaliveAt").value = "03:00";
  document.getElementById("f-keepaliveMaxPerDay").value = "1";
  document.getElementById("f-keepaliveChangeOnly").checked = true;
}

function fillNodeForm(n) {
  const s = (f, v) => {
    const el = document.getElementById("f-" + f);
    if (el) el.value = v || "";
  };
  s("name", n.name);
  s("displayName", n.displayName);
  s("target", n.target);
  s("secret", n.secret);
  s("tag", n.tag);
  s("note", n.note);
  document.getElementById("f-impersonate").checked = n.impersonate !== false;
  document.getElementById("f-impersonateProfile").value =
    normalizeImpersonateProfile(n.impersonateProfile);
  document.getElementById("f-impersonateDeviceName").value =
    n.impersonateDeviceName || "";
  syncImpersonateProfileState();
  document.getElementById("f-directExternal").checked = !!n.directExternal;
  document.getElementById("f-renewDays").value = n.renewDays || "0";
  document.getElementById("f-remindBeforeDays").value = n.remindBeforeDays || "3";
  document.getElementById("f-keepaliveAt").value = n.keepaliveAt || "03:00";
  document.getElementById("f-keepaliveMaxPerDay").value =
    n.keepaliveMaxPerDay || "1";
  document.getElementById("f-keepaliveChangeOnly").checked =
    n.keepaliveChangeOnly !== false;
}

function getNodeFormData() {
  const g = (f) => {
    const el = document.getElementById("f-" + f);
    return el ? el.value : "";
  };
  return {
    name: g("name"),
    displayName: g("displayName"),
    target: g("target"),
    secret: g("secret"),
    tag: g("tag"),
    note: g("note"),
    impersonate: document.getElementById("f-impersonate").checked,
    impersonateProfile: normalizeImpersonateProfile(g("impersonateProfile")),
    impersonateDeviceName: g("impersonateDeviceName"),
    directExternal: document.getElementById("f-directExternal").checked,
    renewDays: parseInt(g("renewDays") || "0", 10) || 0,
    remindBeforeDays: parseInt(g("remindBeforeDays") || "0", 10) || 0,
    keepaliveAt: g("keepaliveAt"),
    keepaliveMaxPerDay: parseInt(g("keepaliveMaxPerDay") || "1", 10) || 1,
    keepaliveChangeOnly: document.getElementById("f-keepaliveChangeOnly")
      .checked,
    fav: state.editingNode?.fav || false,
    rank: state.editingNode?.rank,
  };
}

async function saveNode() {
  const data = getNodeFormData();
  if (state.editingNode) data.oldName = state.editingNode.name;
  const r = await api("save", { node: data });
  if (r.ok) {
    closeNodeModal();
    toast("已保存", "ok");
    await loadNodes();
  } else {
    toast("保存失败: " + r.error, "err");
  }
}

function syncImpersonateProfileState() {
  const enabled = document.getElementById("f-impersonate").checked;
  document.getElementById("f-impersonateProfile").disabled = !enabled;
}

// 保号测试：把节点卡片按钮上的数据集转发给后端。
async function testKeepalive(el) {
  toast("发送保号测试通知…", "info");
  const r = await api("keepalive.test", {
    name: el.dataset.name,
    displayName: el.dataset.display,
    renewDays: parseInt(el.dataset.renew || "0"),
    remindBeforeDays: parseInt(el.dataset.remind || "0"),
    keepaliveAt: el.dataset.at || "00:00",
  });
  toast(
    r.ok ? "保号测试通知已发送" : "发送失败: " + (r.error || ""),
    r.ok ? "ok" : "err",
  );
}

export function nodeFormActions() {
  return {
    "node-add": () => openAddModal(),
    "node-edit": (_e, el) => openEditModal(el.dataset.name),
    "node-save": () => saveNode(),
    "impersonate-sync": () => syncImpersonateProfileState(),
    "keepalive-test": (_e, el) => testKeepalive(el),
  };
}
