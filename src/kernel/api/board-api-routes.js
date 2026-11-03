/**
 * @file Board API RPC 路由表
 * @description
 * RPC 方法名到 BoardApi 调用的映射表，声明各方法的参数解包方式与后置渲染 flush 时机。
 * 供 CoreWorkerRuntime 动态分发，与 BoardApi 公共方法的对应关系由 tests/board-api-routes.test.js 双向校验。
 * @module kernel/api/board-api-routes
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/**
 * 渲染帧 flush 时机
 * @description
 * 渲染帧 flush 是指将 AOM 动态图的变更应用到渲染管线中，通常由渲染钩子驱动，有以下三种时机：
 * - `"none"`：不调度 flush（查询、AOM 转移等由渲染钩子自行驱动的调用）。
 * - `"sync"`：调用同步返回后立即调度一次渲染帧 flush。
 * - `"async"`：调用返回的 Promise 兑现后调度一次渲染帧 flush。
 * @typedef {"none" | "sync" | "async"} RouteFlushTiming
 */

/**
 * Board API 路由条目
 * @typedef {Object} BoardApiRoute
 * @property {(api: import("./board-api.js").BoardApi, params: Record<string, any>) => *} invoke - 将 RPC 参数解包并调用 BoardApi 对应方法
 * @property {RouteFlushTiming} flush - 调用完成后的渲染帧 flush 时机
 */

/**
 * Board API RPC 路由表
 * @description
 * key 为 RPC 方法名（与 BoardApiRpc 发送的 method 字段一致）。
 * 生命周期方法（createBoard / destroyBoard / createViewport / destroyViewport）
 * 不属于领域分发，由 CoreWorkerRuntime 单独处理，不在本表。
 * @type {Record<string, BoardApiRoute>}
 */
const BOARD_API_ROUTES = {
  /**
   * 创建对象并注册到 AOM 动态图
   */
  createObject: {
    invoke: (api, p) => api.createObject(p.type, p.props),
    flush: "none",
  },

  /**
   * 创建并提交一个对象（持板侧原子完成 id 分配）
   */
  addObject: {
    invoke: (api, p) => api.addObject(p.type, p.props),
    flush: "sync",
  },

  /**
   * 查询板概要信息
   */
  queryBoardInfo: {
    invoke: (api) => api.queryBoardInfo(),
    flush: "none",
  },

  /**
   * 列出活动与 trash 对象
   */
  queryObjectList: {
    invoke: (api) => api.queryObjectList(),
    flush: "none",
  },

  /**
   * 查询单个对象的序列化数据
   */
  queryObject: {
    invoke: (api, p) => api.queryObject(p.objectId),
    flush: "none",
  },

  /**
   * 查询操作日志记录明细
   */
  queryOperations: {
    invoke: (api, p) => api.queryOperations(p),
    flush: "none",
  },

  /**
   * 查询时间回溯树结构
   */
  queryUndoTree: {
    invoke: (api) => api.queryUndoTree(),
    flush: "none",
  },

  /**
   * 修改单个对象的几何/样式属性
   */
  modifyObject: {
    invoke: (api, p) => api.modifyObject(p.objectId, p.patch),
    flush: "sync",
  },

  /**
   * 批量修改多个对象
   */
  modifyObjects: {
    invoke: (api, p) => api.modifyObjects(p.patches),
    flush: "sync",
  },

  /**
   * 向对象的列表属性追加元素
   */
  appendListItem: {
    invoke: (api, p) => api.appendListItem(p.objectId, p.key, p.items),
    flush: "sync",
  },

  /**
   * 替换对象列表属性中指定索引的元素
   */
  replaceListItem: {
    invoke: (api, p) => api.replaceListItem(p.objectId, p.key, p.index, p.item),
    flush: "sync",
  },

  /**
   * 删除对象列表属性中指定索引的元素
   */
  removeListItem: {
    invoke: (api, p) => api.removeListItem(p.objectId, p.key, p.index),
    flush: "sync",
  },

  /**
   * 永久删除对象集合
   */
  deleteObjects: {
    invoke: (api, p) => api.deleteObjects(p.objectIds, p.options),
    flush: "sync",
  },

  /**
   * 按橡皮轨迹擦除命中对象的数据
   */
  eraseData: {
    invoke: (api, p) => api.eraseData(p, p.options),
    flush: "async",
  },

  /**
   * 将 AOM 动态图中的对象写回静态图
   */
  commitObjects: {
    invoke: (api, p) => api.commitObjects(p.objectIds, p.options),
    flush: "none",
  },

  /**
   * 将对象加入 AOM 动态图
   */
  addActiveObjects: {
    invoke: (api, p) => api.addActiveObjects(p.objectIds, p.options),
    flush: "none",
  },

  /**
   * 将对象从 AOM 动态图移除
   */
  discardActiveObjects: {
    invoke: (api, p) => api.discardActiveObjects(p.objectIds, p.options),
    flush: "none",
  },

  /**
   * 按 id 查询对象摘要
   */
  queryObjects: {
    invoke: (api, p) => api.queryObjects(p.ids),
    flush: "none",
  },

  /**
   * 列出本端的命名选择
   */
  queryChoices: {
    invoke: (api) => api.queryChoices(),
    flush: "none",
  },

  /**
   * 列出全部远程命名选择（awareness 查询面）
   */
  queryRemoteChoices: {
    invoke: (api) => api.queryRemoteChoices(),
    flush: "none",
  },

  /**
   * 上报 UI 侧对象 id 池计数
   */
  reportObjectIdCounter: {
    invoke: (api, p) => api.reportObjectIdCounter(p.source, p.counter),
    flush: "none",
  },

  /**
   * 读取 UI 侧对象 id 池计数表
   */
  getObjectIdCounters: {
    invoke: (api) => api.getObjectIdCounters(),
    flush: "none",
  },

  /**
   * 应用远程 AOM 活动事件
   */
  applyRemoteActivity: {
    invoke: (api, p) => api.applyRemoteActivity(p.events, p.source),
    flush: "none",
  },

  /**
   * 清理某来源的全部远程活动登记
   */
  clearRemoteActivity: {
    invoke: (api, p) => api.clearRemoteActivity(p.source),
    flush: "none",
  },

  /**
   * 按区块查询对象 id
   */
  queryChunkObjects: {
    invoke: (api, p) => api.queryChunkObjects(p.chunkIds),
    flush: "none",
  },

  /**
   * 在合并视图上执行命中查询
   */
  hitTest: {
    invoke: (api, p) => api.hitTest(p.range, p.mode),
    flush: "none",
  },

  /**
   * 执行撤销
   */
  undo: {
    invoke: (api, p) => api.undo(p?.targetNodeId ?? undefined),
    flush: "sync",
  },

  /**
   * 执行重做
   */
  redo: {
    invoke: (api) => api.redo(),
    flush: "sync",
  },

  /**
   * 应用远端到达的分子操作记录
   */
  applyRemoteOperations: {
    invoke: (api, p) => api.applyRemoteOperations(p.records),
    flush: "sync",
  },

  /**
   * 开启一个超分子
   */
  beginSupra: {
    invoke: (api, p) => api.beginSupra(p.key),
    flush: "none",
  },

  /**
   * 闭合一个超分子
   */
  endSupra: {
    invoke: (api, p) => api.endSupra(p.key),
    flush: "none",
  },

  /**
   * 中止一个超分子（丢弃未闭合分子并逐个撤销已物化成员）
   */
  abortSupra: {
    invoke: (api, p) => api.abortSupra(p.key),
    flush: "none",
  },

  /**
   * 开启一个增量式分子（手势 begin，捕获 before 快照）
   */
  beginMol: {
    invoke: (api, p) => api.beginMol(p.objectIds, p.options),
    flush: "none",
  },

  /**
   * 对进行中的分子施加增量修正（手势的每帧）
   */
  amendMol: {
    invoke: (api, p) => api.amendMol(p.molId, p.patchesByObject),
    flush: "sync",
  },

  /**
   * 定稿一个增量式分子（end-amend 物化上链）
   */
  endMol: {
    invoke: (api, p) => api.endMol(p.molId),
    flush: "sync",
  },

  /**
   * 中止一个增量式分子（丢弃 amend 流，实例还原到手势起点）
   */
  abortMol: {
    invoke: (api, p) => api.abortMol(p.molId),
    flush: "sync",
  },

  /**
   * 查询本端未闭合的增量式分子清单（断线重连对账用）
   */
  queryOpenMols: {
    invoke: (api) => api.queryOpenMols(),
    flush: "none",
  },

  /**
   * 取指定分子在给定 seq 水位之后的 amend 段（断线重连对账重发用）
   */
  queryMolAmendSince: {
    invoke: (api, p) => api.queryMolAmendSince(p.molId, p.sinceSeq),
    flush: "none",
  },

  /**
   * 计算对象状态的确定性校验和（同步 digest 用）
   */
  queryStateHash: {
    invoke: (api) => api.queryStateHash(),
    flush: "none",
  },

  /**
   * 计算活动链的确定性校验和（驻留无关，同步 digest 用）
   */
  queryChainHash: {
    invoke: (api) => api.queryChainHash(),
    flush: "none",
  },

  /**
   * 从权威日志重建时间回溯树并对齐白板效果
   */
  repairChainFromLog: {
    invoke: (api) => api.repairChainFromLog(),
    flush: "sync",
  },

  /**
   * 从本端日志重放派生对象状态并对齐活体（效果层分歧自愈）
   */
  repairStateFromLog: {
    invoke: (api) => api.repairStateFromLog(),
    flush: "sync",
  },
};

export { BOARD_API_ROUTES };
