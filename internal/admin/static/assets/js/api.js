// 管理端 API 访问与 Token 管理。
// 会话 Token 失效（401）时派发 ep:unauthorized 事件，由 main.js 统一登出。

import { readStored, removeStored, writeStored } from "./storage.js";

const TOKEN_KEY = "ep_token";

let token = readStored(TOKEN_KEY, "");

export function getToken() {
  return token;
}

export function hasToken() {
  return !!token;
}

export function setToken(value) {
  token = value || "";
  if (token) writeStored(TOKEN_KEY, token);
  else removeStored(TOKEN_KEY);
}

export async function api(action, data = {}, tok = token) {
  try {
    const r = await fetch("/admin/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + tok,
      },
      body: JSON.stringify({ action, ...data }),
    });
    if (!r.ok) {
      // 只对"已保存的会话 Token"触发登出；登录尝试传入的是显式 Token。
      if (r.status === 401 && tok === token && token) {
        document.dispatchEvent(new CustomEvent("ep:unauthorized"));
        return { ok: false, error: "登录已失效" };
      }
      const text = await r.text().catch(() => "");
      return { ok: false, error: "HTTP " + r.status + (text ? " " + text : "") };
    }
    try {
      return await r.json();
    } catch (e) {
      return { ok: false, error: "响应解析失败: " + e.message };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
