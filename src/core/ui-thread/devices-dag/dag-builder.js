/**
 * @file DAG 构建器 DSL
 * @description
 * 提供声明式子图构建器（DAGBuilder / DAGNodeBuilder），
 * 用于以流畅 API 构建可挂载到 {@link DevicesDAG} 的结构化子图。
 *
 * 典型用法：
 * ```js
 * const builder = createSubDAG("/keyboard");
 * const root = builder.node().handler(codeRouter);
 * const keyW = builder.node().handler(keyHandler).defaultRoute("wasd");
 * builder.edge("code", root, keyW);
 * const subDAG = builder.build();
 * dag.mountSubDAG("", subDAG);
 * ```
 * @module core/ui-thread/devices-dag/dag-builder
 * @author Zhou Chenyu
 */

import { isPlainObject } from "./dag-utils.js";
import { joinPath, normalizePath } from "../../engine/utils/path.js";

/**
 * 子图节点构建器
 * @class
 * @description
 * 声明式子图节点的流畅构建器。通过 {@link DAGBuilder#node} 创建，
 * 提供链式 API 设置处理器、语义、静态服务、默认出边、工具绑定和卸载钩子。
 * @author Zhou Chenyu
 * @example
 * // 在 builder 上下文中创建节点并链式配置
 * const builder = createSubDAG("/pen");
 * const node = builder.node()
 *   .handler((pkt, ctx) => ({ to: "pointer", signals: pkt.signals }))
 *   .defaultRoute("tool")
 *   .semantics({ prefix: true });
 * // 之后通过 builder.edge(..., node, ...) 连接到子图中
 */
class DAGNodeBuilder {
  /**
   * 所属子图构建器
   * @type {DAGBuilder}
   */
  _dagBuilder;

  /**
   * 子图内局部 id
   * @type {number}
   */
  _localId;

  /**
   * @param {DAGBuilder} dagBuilder - 所属子图构建器
   * @param {number} localId - 子图内局部 id
   */
  constructor(dagBuilder, localId) {
    this._dagBuilder = dagBuilder;
    this._localId = localId;
  }

  /**
   * 设置节点处理器
   * @param {import("./devices-dag.js").DevicesDAGHandler|null} handler
   * @returns {DAGNodeBuilder}
   */
  handler(handler) {
    this._dagBuilder._setNodeDef(this._localId, {
      handler: typeof handler === "function" ? handler : null,
    });
    return this;
  }

  /**
   * 合并节点语义
   * @param {Object} semantics
   * @returns {DAGNodeBuilder}
   */
  semantics(semantics = {}) {
    this._dagBuilder._mergeNodeSemantics(this._localId, semantics);
    return this;
  }

  /**
   * 标记为 prefix 语义并设置处理器
   * @param {import("./devices-dag.js").DevicesDAGHandler|null} handler
   * @param {Object} [semantics={}]
   * @returns {DAGNodeBuilder}
   */
  prefix(handler, semantics = {}) {
    return this.handler(handler).semantics({
      prefix: true,
      ...(isPlainObject(semantics) ? semantics : {}),
    });
  }

  /**
   * 设置节点声明的静态服务集合
   * @param {Object} services
   * @returns {DAGNodeBuilder}
   */
  services(services = {}) {
    this._dagBuilder._setNodeDef(this._localId, {
      services: isPlainObject(services) ? services : {},
    });
    return this;
  }

  /**
   * 设置默认出边名
   * @param {string} name
   * @returns {DAGNodeBuilder}
   */
  defaultRoute(name = "") {
    this._dagBuilder._setNodeDef(this._localId, {
      defaultRoute: typeof name === "string" ? name : "",
    });
    return this;
  }

  /**
   * 绑定工具
   * @param {import("../tools/tool.js").Tool} tool
   * @param {Object} [toolContext={}]
   * @returns {DAGNodeBuilder}
   */
  tool(tool, toolContext = {}) {
    this._dagBuilder._setNodeDef(this._localId, {
      tool,
      toolContext: isPlainObject(toolContext) ? { ...toolContext } : {},
    });
    this._dagBuilder._mergeNodeSemantics(this._localId, { tool: true });
    return this;
  }

  /**
   * 设置卸载钩子
   * @param {import("./devices-dag.js").DevicesDAGNodeUmountHandler|null} umountHandler
   * @returns {DAGNodeBuilder}
   */
  umount(umountHandler) {
    this._dagBuilder._setNodeDef(this._localId, {
      umount: typeof umountHandler === "function" ? umountHandler : null,
    });
    return this;
  }

  /**
   * 给当前节点设置标签（可选，便于调试）
   * @param {string} _label
   * @returns {DAGNodeBuilder}
   */
  label(_label = "") {
    // 标签仅用于调试，不影响行为
    return this;
  }
}

/**
 * 子图构建器
 * @class
 * @description
 * 以声明式 API 构建结构化子图定义（SubDAGDefinition），
 * 然后通过 {@link DevicesDAG#mountSubDAG} 挂载到设备图中。
 *
 * 第一个 `node()` 调用隐式成为子图根节点。
 * 构建完成后调用 `build()` 生成不可变的子图定义。
 * @author Zhou Chenyu
 * @example
 * const dag = new DevicesDAG();
 * const builder = createSubDAG("/keyboard");
 *
 * const root = builder.node().handler(codeRouter);
 * const keyW = builder.node().handler(keyHandler).defaultRoute("wasd");
 * const wasd = builder.node().handler(wasdHandler);
 *
 * builder.edge("code", root, keyW);
 * builder.edge("wasd", keyW, wasd);
 *
 * dag.mountSubDAG("", builder.build());
 */
class DAGBuilder {
  /**
   * 子图根路径前缀
   * @type {string}
   */
  _rootPath;

  /**
   * 下一个局部 id
   * @type {number}
   */
  _nextLocalId;

  /**
   * 节点定义（局部 id → 定义）
   * @type {Map<number, import("./devices-dag.js").SubDAGNodeDefinition>}
   */
  _nodeDefs;

  /**
   * 边定义列表
   * @type {import("./devices-dag.js").SubDAGEdgeDefinition[]}
   */
  _edges;

  /**
   * 子图根节点局部 id
   * @type {number|null}
   */
  _rootNodeId;

  /**
   * 暴露的 API 映射
   * @type {Object}
   */
  _exposedApi;

  /**
   * @param {string} rootPath - 子图根路径前缀
   */
  constructor(rootPath = "/") {
    this._rootPath = joinPath(normalizePath(rootPath));
    this._nextLocalId = 0;
    this._nodeDefs = new Map();
    this._edges = [];
    this._rootNodeId = null;
    this._exposedApi = {};
  }

  /**
   * 声明一个节点并返回其构建器
   * 第一个 node() 调用隐式成为子图根节点
   * @returns {DAGNodeBuilder}
   */
  node() {
    const localId = this._nextLocalId++;
    if (this._rootNodeId === null) {
      this._rootNodeId = localId;
    }
    this._nodeDefs.set(localId, {
      handler: null,
      semantics: {},
      services: {},
      defaultRoute: "",
      tool: undefined,
      toolContext: {},
      umount: null,
    });
    return new DAGNodeBuilder(this, localId);
  }

  /**
   * 声明一条有向边
   * @param {string} name - 边名
   * @param {DAGNodeBuilder} from - 源节点构建器
   * @param {DAGNodeBuilder} to - 目标节点构建器
   * @returns {DAGBuilder}
   */
  edge(name, from, to) {
    if (!(from instanceof DAGNodeBuilder) || !(to instanceof DAGNodeBuilder)) {
      throw new TypeError(
        "edge() requires two DAGNodeBuilder instances (from, to).",
      );
    }
    this._edges.push({
      name,
      fromNodeId: from._localId,
      toNodeId: to._localId,
    });
    return this;
  }

  /**
   * 暴露子图级状态 API
   * @param {Record<string, Function>} api
   * @returns {DAGBuilder}
   */
  expose(api = {}) {
    for (const [name, value] of Object.entries(api)) {
      if (typeof value === "function") {
        this._exposedApi[name] = value;
      }
    }
    return this;
  }

  /**
   * 生成子图定义
   * @returns {import("./devices-dag.js").SubDAGDefinition}
   */
  build() {
    return {
      rootPath: this._rootPath,
      rootNodeId: this._rootNodeId ?? 0,
      nodes: new Map(this._nodeDefs),
      edges: [...this._edges],
      ...this._exposedApi,
    };
  }

  /**
   * @param {number} localId
   * @param {Partial<import("./devices-dag.js").SubDAGNodeDefinition>} patch
   */
  _setNodeDef(localId, patch) {
    const existing = this._nodeDefs.get(localId);
    if (!existing) return;
    this._nodeDefs.set(localId, { ...existing, ...patch });
  }

  /**
   * @param {number} localId
   * @param {Object} semantics
   */
  _mergeNodeSemantics(localId, semantics = {}) {
    const existing = this._nodeDefs.get(localId);
    if (!existing) return;
    this._nodeDefs.set(localId, {
      ...existing,
      semantics: {
        ...(isPlainObject(existing.semantics) ? existing.semantics : {}),
        ...(isPlainObject(semantics) ? semantics : {}),
      },
    });
  }
}

/**
 * 创建一个子图构建器
 * @param {string} rootPath - 子图根路径前缀
 * @returns {DAGBuilder} 一个新的子图构建器实例
 * @example
 * // 构建一个键盘设备子图，挂载后分发信号
 * const dag = new DevicesDAG();
 * const builder = createSubDAG("/keyboard");
 *
 * const root = builder.node().handler(codeRouter);
 * const keyW = builder.node().handler(keyHandler).defaultRoute("wasd");
 * const wasd = builder.node().handler(wasdHandler);
 *
 * builder.edge("code", root, keyW);
 * builder.edge("wasd", keyW, wasd);
 *
 * dag.mountSubDAG("", builder.build());
 *
 * dag.dispatch({
 *   to: "/keyboard/code",
 *   signals: [{ type: "keydown", code: "KeyW" }],
 * });
 */
function createSubDAG(rootPath = "/") {
  return new DAGBuilder(rootPath);
}

export { DAGNodeBuilder, DAGBuilder, createSubDAG };
