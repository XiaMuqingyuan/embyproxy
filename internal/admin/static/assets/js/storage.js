// 本地偏好存储的容错访问：禁用站点存储时保留当前页面内存状态。

const memory = new Map();

export function readStored(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? (memory.get(key) ?? fallback) : value;
  } catch {
    return memory.get(key) ?? fallback;
  }
}

export function writeStored(key, value) {
  const text = String(value);
  memory.set(key, text);
  try {
    window.localStorage.setItem(key, text);
  } catch {
    // 内存副本仍让当前页面的登录和主题偏好生效。
  }
}

export function removeStored(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 当前内存会话已清除。
  }
}
