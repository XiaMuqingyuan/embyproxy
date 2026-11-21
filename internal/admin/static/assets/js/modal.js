// 右侧抽屉式弹窗的通用开关与折叠区。

export function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}

export function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// 表单分区折叠（节点编辑弹窗的"高级访问"/"保号提醒"）。
export function toggleSection(id, btn) {
  const el = document.getElementById(id);
  const collapsed = btn.classList.toggle("collapsed");
  if (collapsed) {
    el.style.display = "none";
  } else {
    el.style.display = "grid";
  }
}
