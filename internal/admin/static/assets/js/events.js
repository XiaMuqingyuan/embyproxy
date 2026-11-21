// data-action 注册与事件类型过滤，避免一个控件响应多种事件而重复执行。

export function createActionDispatcher() {
  const actions = new Map();

  function registerActions(map) {
    for (const [name, fn] of Object.entries(map)) actions.set(name, fn);
  }

  function acceptsEvent(el, type) {
    if (type === "keydown") return true;
    if (el.matches("select, input[type='checkbox'], input[type='file']"))
      return type === "change";
    if (el.matches("input, textarea")) return type === "input";
    return type === "click";
  }

  function dispatchEvent(e) {
    const el = e.target.closest?.("[data-action]");
    if (!el || !acceptsEvent(el, e.type)) return;
    const fn = actions.get(el.dataset.action);
    if (fn) fn(e, el);
  }

  return { registerActions, dispatchEvent };
}
