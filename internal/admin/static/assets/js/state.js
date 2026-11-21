// 跨模块共享的页面状态。
// 日志、统计、图表各自的状态保留在对应模块内。

export const state = {
  allNodes: [],
  editingNode: null,
  selectedNodes: new Set(),
  draggingNode: "",
  nodeChecks: {},
  visibleProxyUrls: new Set(),
  focusedNodeName: "",
  appBuild: null,
  currentTab: "nodes",
};
