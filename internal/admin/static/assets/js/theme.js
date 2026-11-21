// 明暗主题：默认跟随系统，手动切换后记忆到本地偏好存储。
// 图表配色通过 CSS 变量读取，切主题时通知订阅者重建图表。

import { readStored, writeStored } from "./storage.js";

const THEME_KEY = "ep_theme";

const listeners = new Set();
let applied = "";

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme) {
  applied = theme;
  document.documentElement.dataset.theme = theme;
  for (const fn of listeners) {
    try {
      fn(theme);
    } catch {}
  }
}

export function initTheme() {
  apply(readStored(THEME_KEY) || systemTheme());
}

export function toggleTheme() {
  const next = applied === "dark" ? "light" : "dark";
  writeStored(THEME_KEY, next);
  apply(next);
}

export function onThemeChange(fn) {
  listeners.add(fn);
}

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

// 读取当前主题下的图表配色（缓存，主题切换后失效）。
let chartColorCache = null;

export function chartColors() {
  if (chartColorCache) return chartColorCache;
  const palette = [];
  for (let i = 1; i <= 10; i++) {
    palette.push(cssColor(`--chart-c${i}`, "#24594d"));
  }
  chartColorCache = {
    palette,
    axis: cssColor("--chart-axis", "#42483f"),
    grid: cssColor("--chart-grid", "rgba(88, 80, 64, 0.1)"),
  };
  return chartColorCache;
}

onThemeChange(() => {
  chartColorCache = null;
});
