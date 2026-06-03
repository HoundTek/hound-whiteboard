/**
 * @file DAG 节点与有向边
 * @description
 * 设备图中的基础数据结构：处理节点（DevicesDAGNode）和有向边（DevicesDAGEdge）。
 *
 * DevicesDAGNode 是图中的信号处理单元，持有处理器、语义元数据、
 * 可变状态和入边/出边集合。节点通过 DevicesDAG 创建和管理，
 * 不应直接 new。
 *
 * DevicesDAGEdge 连接两个节点，边名在源节点下唯一。
 * @module core/devices-dag/dag-node-edge
 * @author Zhou Chenyu
 */

import { isPlainObject } from "./dag-utils.js";

// ---------------------------------------------------------------------------
// DevicesDAGNode
// ---------------------------------------------------------------------------

/**
 * 设备图节点
 * @class
 * @description
 * 图中一个信号处理单元，持有处理器、语义元数据、可变状态和入边/出边集合。
 *
 * 节点通过 {@link DevicesDAG#ensureNode} 或 {@link DevicesDAG#getNode} 获取，
 * 不应直接构造。节点状态（`state`）按节点身份共享——同一节点被多条路径
 * 到达时，它们看到的是同一份 `state`。
 * @author Zhou Chenyu
 * @example
 * // 通过 DAG 实例获取节点
 * const dag = new DevicesDAG();
 * const node = dag.ensureNode("/keyboard/code/KeyW");
 * node.setHandler((packet, ctx) => { ... });
 * node.setDefaultRoute("wasd");
 */
class DevicesDAGNode {
  /**
   * 节点 id
   * @type {number}
   */
  id;

  /**
   * 节点处理器
   * @type {import("./devices-dag.js").DevicesDAGHandler|null}
   */
  handler;

  /**
   * 节点语义元数据
   * @type {Object}
   */
  semantics;

  /**
   * 节点可变状态
   * @type {Object}
   */
  state;

  /**
   * 节点卸载钩子
   * @type {import("./devices-dag.js").DevicesDAGNodeUmountHandler|null}
   */
  umount;

  /**
   * 默认出边名（当处理器未指定路由时使用）
   * @type {string}
   */
  defaultRoute;

  /**
   * 出边集合（边名 -> 边）
   * @type {Map<string, DevicesDAGEdge>}
   */
  outEdges;

  /**
   * 入边集合
   * @type {Set<DevicesDAGEdge>}
   */
  inEdges;

  /**
   * 节点的 canonical path 表示（由 DAG 维护，确保唯一且稳定）
   * @type {string|null}
   */
  path;

  /**
   * @param {number} id - 节点唯一标识
   * @constructor
   */
  constructor(id) {
    this.id = id;
    this.handler = null;
    this.semantics = {};
    this.state = {};
    this.umount = null;
    this.defaultRoute = "";
    this.outEdges = new Map();
    this.inEdges = new Set();
    this.path = null;
  }

  /**
   * 设置节点处理器
   * @param {import("./devices-dag.js").DevicesDAGHandler|null} handler - 处理器函数
   * @returns {DevicesDAGNode} 返回当前节点以链式调用
   */
  setHandler(handler) {
    this.handler = typeof handler === "function" ? handler : null;
    return this;
  }

  /**
   * 设置节点职责语义
   * @param {Object|null} semantics - 语义键值对
   * @returns {DevicesDAGNode} 返回当前节点以链式调用
   */
  setSemantics(semantics = {}) {
    this.semantics = isPlainObject(semantics) ? { ...semantics } : {};
    return this;
  }

  /**
   * 设置默认出边
   * @param {string} defaultRoute - 边名
   * @returns {DevicesDAGNode} 返回当前节点以链式调用
   */
  setDefaultRoute(defaultRoute = "") {
    this.defaultRoute = typeof defaultRoute === "string" ? defaultRoute : "";
    return this;
  }

  /**
   * 设置卸载钩子
   * @param {import("./devices-dag.js").DevicesDAGNodeUmountHandler|null} umountHandler - 卸载回调
   * @returns {DevicesDAGNode} 返回当前节点以链式调用
   */
  setUmountHandler(umountHandler) {
    this.umount = typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 获取节点处理器
   * @returns {import("./devices-dag.js").DevicesDAGHandler|null} 返回处理器函数或 null
   */
  getHandler() {
    return typeof this.handler === "function" ? this.handler : null;
  }

  /**
   * 获取节点职责语义
   * @returns {Object}
   */
  getSemantics() {
    return isPlainObject(this.semantics) ? { ...this.semantics } : {};
  }

  /**
   * 获取默认出边
   * @returns {string}
   */
  getDefaultRoute() {
    return this.defaultRoute || "";
  }

  /**
   * 获取卸载钩子
   * @returns {import("./devices-dag.js").DevicesDAGNodeUmountHandler|null}
   */
  getUmountHandler() {
    return typeof this.umount === "function" ? this.umount : null;
  }
}

// ---------------------------------------------------------------------------
// DevicesDAGEdge
// ---------------------------------------------------------------------------

/**
 * 设备图有向边
 * @class
 * @description
 * 连接两个节点的有向边，携带边名。边名在源节点下唯一。
 *
 * 边由 {@link DevicesDAG#_connectNodes} 创建，不应直接 new。
 * @author Zhou Chenyu
 */
class DevicesDAGEdge {
  /**
   * 边名（在源节点下唯一）
   * @type {string}
   */
  name;

  /**
   * 源节点
   * @type {DevicesDAGNode}
   */
  source;

  /**
   * 目标节点
   * @type {DevicesDAGNode}
   */
  target;

  /**
   * @param {string} name - 边名
   * @param {DevicesDAGNode} source - 源节点
   * @param {DevicesDAGNode} target - 目标节点
   * @constructor
   */
  constructor(name, source, target) {
    this.name = name;
    this.source = source;
    this.target = target;
  }
}

export { DevicesDAGNode, DevicesDAGEdge };
