// 基础工具：转义、提示、复制、下载、格式化。

export function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function attr(s) {
  return esc(s).replace(/'/g, "&#39;");
}

export function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  document.getElementById("toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(
      () => toast("已复制", "ok"),
      () => fallbackCopy(t),
    );
  } else {
    fallbackCopy(t);
  }
}

function fallbackCopy(t) {
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    document.execCommand("copy");
    ta.remove();
    toast("已复制", "ok");
  } catch {
    toast("复制失败，请手动复制", "err");
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 使用浏览器本地时区生成文件名时间戳。
export function formatStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export function formatDuration(ms) {
  let total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const d = Math.floor(total / 86400);
  total -= d * 86400;
  const h = Math.floor(total / 3600);
  total -= h * 3600;
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  if (d > 0) return `${d}天${h}时${m}分`;
  if (h > 0) return `${h}时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes || 0));
  if (n <= 0) return "0B";
  if (n >= 1e15) return `${(n / 1e15).toFixed(2)} PB`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${Math.round(n)}B`;
}

export function formatCommaList(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n");
}

export function flagEnabled(value) {
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

export function safeLogLevel(value) {
  const level = String(value || "info")
    .trim()
    .toLowerCase();
  return ["silent", "error", "warn", "info", "debug"].includes(level)
    ? level
    : "info";
}

// 顶部状态条的双格内容，节点 / 统计 / 日志页共用。
export function statusCells(items) {
  return items
    .map(
      ([value, label]) =>
        `<div class="status-cell"><b>${value}</b><span>${label}</span></div>`,
    )
    .join("");
}
