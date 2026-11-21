import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createActionDispatcher } from "./events.js";
import { readStored, removeStored, writeStored } from "./storage.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.dirname(moduleDir);
const indexHTML = fs.readFileSync(path.join(assetsDir, "../index.html"), "utf8");

function fakeElement(selector, action = "load") {
  return {
    dataset: { action },
    matches: (query) => selector === query || query.split(", ").includes(selector),
    closest: () => null,
  };
}

for (const [selector, expectedEvent] of [
  ["button", "click"],
  ["select", "change"],
  ["input[type='checkbox']", "change"],
  ["input[type='file']", "change"],
  ["input", "input"],
  ["textarea", "input"],
]) {
  test(`${selector} 只在 ${expectedEvent} 时触发一次`, () => {
    const { registerActions, dispatchEvent } = createActionDispatcher();
    let calls = 0;
    registerActions({ load: () => calls++ });
    const el = fakeElement(selector);
    const event = { target: { closest: () => el } };
    for (const type of ["click", "input", "change"])
      dispatchEvent({ ...event, type });
    assert.equal(calls, 1);
    dispatchEvent({ ...event, type: expectedEvent });
    assert.equal(calls, 2);
  });
}

test("复选框动作只触发一次，不冒泡触发外层按钮动作", () => {
  const { registerActions, dispatchEvent } = createActionDispatcher();
  let syncCalls = 0;
  let rowCalls = 0;
  registerActions({ sync: () => syncCalls++, row: () => rowCalls++ });
  const checkbox = fakeElement("input[type='checkbox']", "sync");
  const row = fakeElement("button", "row");
  checkbox.closest = (selector) =>
    selector === "[data-action]" ? checkbox : null;
  row.closest = (selector) => (selector === "[data-action]" ? row : null);
  for (const type of ["click", "input", "change"]) {
    dispatchEvent({ target: checkbox, type });
    dispatchEvent({ target: row, type });
  }
  assert.equal(syncCalls, 1);
  assert.equal(rowCalls, 1);
});

test("按钮事件会调用对应动作并传入事件和元素", () => {
  const { registerActions, dispatchEvent } = createActionDispatcher();
  let received;
  registerActions({ save: (event, el) => (received = { event, el }) });
  const el = fakeElement("button", "save");
  const event = { type: "click", target: { closest: () => el } };
  dispatchEvent(event);
  assert.deepEqual(received, { event, el });
});

test("Enter 跳转仍能触发，未知动作不执行", () => {
  const { registerActions, dispatchEvent } = createActionDispatcher();
  let calls = 0;
  registerActions({ "log-jump": () => calls++ });
  const el = fakeElement("input", "log-jump");
  dispatchEvent({ type: "keydown", target: { closest: () => el } });
  assert.equal(calls, 1);
  el.dataset.action = "missing";
  dispatchEvent({ type: "keydown", target: { closest: () => el } });
  assert.equal(calls, 1);
});

test("存储不可用时，读取、覆盖和删除使用内存副本", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    globalThis.window = {};
    Object.defineProperty(globalThis.window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    assert.equal(readStored("ep_test_fallback", "default"), "default");
    writeStored("ep_test_fallback", "token");
    assert.equal(readStored("ep_test_fallback"), "token");
    removeStored("ep_test_fallback");
    assert.equal(readStored("ep_test_fallback", "logged-out"), "logged-out");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  }
});

test("页面引用的本地静态资源均存在且嵌入白名单覆盖其扩展名", () => {
  const refs = [...indexHTML.matchAll(/(?:src|href)="\/admin\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    if (ref === "chart.js") {
      assert.ok(fs.existsSync(path.join(assetsDir, "../chart.umd.min.js")));
      continue;
    }
    assert.ok(ref.startsWith("assets/"));
    assert.ok([".css", ".js"].includes(path.extname(ref)));
    assert.ok(fs.existsSync(path.join(assetsDir, "..", ref)), ref);
  }
});

test("模块相对导入都有对应文件", () => {
  for (const name of fs.readdirSync(moduleDir)) {
    if (!name.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(moduleDir, name), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
      assert.ok(fs.existsSync(path.join(moduleDir, match[1])), `${name}: ${match[1]}`);
    }
  }
});
