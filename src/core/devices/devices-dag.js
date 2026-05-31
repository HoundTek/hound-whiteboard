/**
 * @file 设备图（Devices DAG）
 * @description 提供基于有向无环图的设备信号路由、路径解析与分发的核心实现。
 * @module core/devices/devices-dag
 * @author Zhou Chenyu
 */

import {
  joinPath,
  normalizePath,
  resolvePath,
  toAbsolutePath,
} from "../utils/path.js";
import { SignalPacket } from "./signal.js";

// ---------------------------------------------------------------------------
// 类型定义（JSDoc）
// ---------------------------------------------------------------------------

/**
 * 设备图处理器上下文
 * @description
 * 处理器上下文包含当前节点元数据、累积上下文以及节点状态访问接口，
 * 供节点处理器在处理信号包时使用。
 *
 * 累积上下文（`context`）是沿分发路径逐步追加的只读对象。
 * 在 DAG 中，分发沿单一路径进行，上下文只沿该路径累积，
 * 节点的多入边不影响单次分发的上下文。
 *
 * @typedef {Object} DevicesDAGHandlerContext
 * @property {DevicesDAGNode} node - 当前正在处理的节点
 * @property {DevicesDAG} dag - 所属设备图
 * @property {string} path - 当前节点路径（分发所用路径；同一节点可能有多条路径）
 * @property {Object} semantics - 当前节点语义元数据快照
 * @property {string} defaultRoute - 当前节点声明的默认出边名
 * @property {string} resolvedDefaultRoutePath - 当前默认出边对应的绝对路径
 * @property {number} depth - 当前分发深度
 * @property {SignalPacket|undefined} signalPacket - 当前已规整的输入信号包
 * @property {Object} context - 累积上下文（沿分发路径逐层追加，只读）
 * @property {(path?: string) => any} getNodeState - 读取节点状态（接受路径或节点 id）
 * @property {(pathOrId: string|number, state: any) => any} setNodeState - 写入节点状态
 */

/**
 * 设备图处理器输出
 * @typedef {Object} DevicesDAGHandlerResult
 * @property {SignalPacket[]} packets - 继续路由到后继节点的信号包列表
 * @property {Object} [context] - 要合并到累积上下文的键值对
 * @property {string} [redirect] - 覆盖 dispatcher 原本要走的下一段出边名
 * @property {boolean} [stop] - 强制终止当前链路路由
 */

/**
 * 设备图节点处理器
 * @description 处理节点收到的信号包，返回结果、上下文变更或路由指令。
 * @callback DevicesDAGHandler
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesDAGHandlerContext} context - 当前处理上下文
 * @returns {DevicesDAGHandlerResult|SignalPacket|Object|Array|undefined|null}
 */

/**
 * 设备图节点卸载钩子
 * @description 节点卸载时触发，用于清理工具或释放资源。
 * @callback DevicesDAGNodeUmountHandler
 * @param {DevicesDAGHandlerContext} context - 卸载上下文
 * @returns {*}
 */

/**
 * 结构化子图节点定义
 * @typedef {Object} SubDAGNodeDefinition
 * @property {DevicesDAGHandler|null} [handler] - 节点处理器
 * @property {Object} [semantics] - 节点语义元数据
 * @property {string} [defaultRoute] - 默认出边名
 * @property {import("../tools/tool.js").Tool} [tool] - 工具实例
 * @property {Object} [toolContext] - 工具固定上下文
 * @property {DevicesDAGNodeUmountHandler|null} [umount] - 卸载钩子
 */

/**
 * 结构化子图边定义
 * @typedef {Object} SubDAGEdgeDefinition
 * @property {string} name - 边名
 * @property {number} fromNodeId - 源节点（子图内局部 id）
 * @property {number} toNodeId - 目标节点（子图内局部 id）
 */

/**
 * 结构化子图定义
 * @typedef {Object} SubDAGDefinition
 * @property {string} rootPath - 子图根路径前缀
 * @property {number} rootNodeId - 子图根节点（局部 id）
 * @property {Map<number, SubDAGNodeDefinition>} nodes - 节点定义（局部 id → 定义）
 * @property {SubDAGEdgeDefinition[]} edges - 边定义列表
 * @property {() => void} [resetState] - 重置子图内部状态
 * @property {() => any} [getState] - 读取子图内部状态
 */

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 判断值是否为纯对象
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 将 handler 的原始返回值规整为标准结果结构
 * @param {*} rawResult
 * @param {{ defaultTo?: string }} [options={}]
 * @returns {DevicesDAGHandlerResult}
 */
function normalizeHandlerResult(rawResult, options = {}) {
  if (
    isPlainObject(rawResult) &&
    (Array.isArray(rawResult.packets) ||
      "stop" in rawResult ||
      "redirect" in rawResult ||
      "context" in rawResult)
  ) {
    return {
      ...rawResult,
      packets: SignalPacket.normalizeResult(rawResult.packets ?? [], options),
      explicitPackets: Object.prototype.hasOwnProperty.call(
        rawResult,
        "packets",
      ),
    };
  }

  if (rawResult === undefined || rawResult === null) {
    return { packets: [], explicitPackets: false };
  }

  if (Array.isArray(rawResult)) {
    const packets = [];
    for (const item of rawResult) {
      if (
        isPlainObject(item) &&
        (Array.isArray(item.packets) ||
          "stop" in item ||
          "redirect" in item ||
          "context" in item)
      ) {
        packets.push(
          ...SignalPacket.normalizeResult(item.packets ?? [], options),
        );
      } else {
        packets.push(SignalPacket.from(item, options));
      }
    }
    return { packets, explicitPackets: true };
  }

  return {
    packets: SignalPacket.normalizeResult(rawResult, options),
    explicitPackets: true,
  };
}

// ---------------------------------------------------------------------------
// DevicesDAGNode
// ---------------------------------------------------------------------------

/**
 * 设备图节点
 * @class
 * @description 图中一个信号处理单元，持有处理器、语义元数据、可变状态和入边/出边集合。
 */
class DevicesDAGNode {
  /**
   * @param {number} id - 节点唯一标识
   */
  constructor(id) {
    /** @type {number} 节点唯一标识（自增整数） */
    this.id = id;
    /** @type {DevicesDAGHandler|null} 节点处理器 */
    this.handler = null;
    /** @type {Object} 节点语义元数据 */
    this.semantics = {};
    /** @type {Object} 节点可变状态 */
    this.state = {};
    /** @type {DevicesDAGNodeUmountHandler|null} 卸载钩子 */
    this.umount = null;
    /** @type {string} 默认出边名 */
    this.defaultRoute = "";
    /** @type {Map<string, DevicesDAGEdge>} 出边（边名 → 边） */
    this.outEdges = new Map();
    /** @type {Set<DevicesDAGEdge>} 入边集合 */
    this.inEdges = new Set();
    /** @type {string|null} 节点的 canonical path 表示 */
    this.path = null;
  }

  /**
   * 设置节点处理器
   * @param {DevicesDAGHandler|null} handler
   * @returns {DevicesDAGNode}
   */
  setHandler(handler) {
    this.handler = typeof handler === "function" ? handler : null;
    return this;
  }

  /**
   * 设置节点职责语义
   * @param {Object|null} semantics
   * @returns {DevicesDAGNode}
   */
  setSemantics(semantics = {}) {
    this.semantics = isPlainObject(semantics) ? { ...semantics } : {};
    return this;
  }

  /**
   * 设置默认出边
   * @param {string} defaultRoute
   * @returns {DevicesDAGNode}
   */
  setDefaultRoute(defaultRoute = "") {
    this.defaultRoute = typeof defaultRoute === "string" ? defaultRoute : "";
    return this;
  }

  /**
   * 兼容旧命名：设置默认子链路
   * @param {string} defaultChild
   * @returns {DevicesDAGNode}
   */
  setDefaultChild(defaultChild = "") {
    return this.setDefaultRoute(defaultChild);
  }

  /**
   * 设置卸载钩子
   * @param {DevicesDAGNodeUmountHandler|null} umountHandler
   * @returns {DevicesDAGNode}
   */
  setUmountHandler(umountHandler) {
    this.umount = typeof umountHandler === "function" ? umountHandler : null;
    return this;
  }

  /**
   * 获取节点处理器
   * @returns {DevicesDAGHandler|null}
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
   * 兼容旧命名：获取默认子链路
   * @returns {string}
   */
  getDefaultChild() {
    return this.getDefaultRoute();
  }

  /**
   * 获取卸载钩子
   * @returns {DevicesDAGNodeUmountHandler|null}
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
 * @description 连接两个节点的有向边，携带边名；边名在源节点下唯一。
 */
class DevicesDAGEdge {
  /**
   * @param {string} name - 边名
   * @param {DevicesDAGNode} source - 源节点
   * @param {DevicesDAGNode} target - 目标节点
   */
  constructor(name, source, target) {
    /** @type {string} 边名（在源节点下唯一） */
    this.name = name;
    /** @type {DevicesDAGNode} 源节点 */
    this.source = source;
    /** @type {DevicesDAGNode} 目标节点 */
    this.target = target;
  }
}

// ---------------------------------------------------------------------------
// DevicesDAG
// ---------------------------------------------------------------------------

/**
 * 设备图
 * @class
 * @description
 * DevicesDAG 是 Core 输入系统的唯一路由引擎。
 *
 * 它是一个有向无环图（DAG）：
 * - 有且只有一个源（入度为 0 的节点）：根节点 "/"
 * - 汇（出度为 0 的节点）是 Tool 节点或未挂工具的 Device 节点
 * - 信号沿边名序列从前驱向后继逐段传递
 * - 一个节点可以有多条入边（多条路径可达同一节点），实现设备聚合
 *
 * 路径模型：
 * - 边有名字，路径 = "/" + 边名 + "/" + 边名 + ...
 * - "/" 是根节点
 * - "/a/b" 表示从根走边 "a" 到达节点 X，再从 X 走边 "b" 到达节点 Y
 * - 相对路径以 "./" 开头或不以 "/" 开头
 *
 * @author Zhou Chenyu
 */
class DevicesDAG {
  /**
   * @param {Object} [options={}] - 构造选项
   * @param {number} [options.maxDispatchDepth=32] - 最大分发深度（防止环路）
   */
  constructor(options = {}) {
    /** @type {Map<number, DevicesDAGNode>} 所有节点（id → 节点） */
    this._nodes = new Map();
    /** @type {number} 下一个可用节点 id */
    this._nextNodeId = 1;
    /** @type {number} 最大分发深度 */
    this._maxDispatchDepth = options.maxDispatchDepth ?? 32;

    // 创建根节点（id=0，唯一的源）
    this._root = this._createNode(0);
    this._root.semantics = { root: true };
    this._root.path = "/";
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 创建节点并注册到内部表
   * @param {number} id - 节点 id
   * @returns {DevicesDAGNode} 新创建的节点
   */
  _createNode(id) {
    const node = new DevicesDAGNode(id);
    this._nodes.set(id, node);
    return node;
  }

  /**
   * 分配新节点 id
   * @returns {number} 下一个可用节点 id
   */
  _allocateNodeId() {
    return this._nextNodeId++;
  }

  /**
   * 在源节点和目标节点之间创建有向边
   * @param {DevicesDAGNode} source - 源节点
   * @param {string} edgeName - 边名
   * @param {DevicesDAGNode} target - 目标节点
   * @returns {DevicesDAGEdge}
   * @throws {Error} 当边名在源节点下已存在时
   */
  _connectNodes(source, edgeName, target) {
    if (source.outEdges.has(edgeName)) {
      throw new Error(
        `Edge "${edgeName}" already exists from node ${source.id}.`,
      );
    }

    const edge = new DevicesDAGEdge(edgeName, source, target);
    source.outEdges.set(edgeName, edge);
    target.inEdges.add(edge);
    if (!target.path && source.path) {
      target.path = joinPath(source.path, edgeName);
    }
    return edge;
  }

  /**
   * 断开边（不触发清理）
   * @param {DevicesDAGEdge} edge
   */
  _disconnectEdge(edge) {
    edge.source.outEdges.delete(edge.name);
    edge.target.inEdges.delete(edge);
  }

  /**
   * 递归清理孤立节点及其下游子图
   * @param {DevicesDAGNode} node - 待检查的节点
   * @param {Set<number>} [cleaned=new Set()] - 已清理节点 id 集合（防止重复）
   */
  _cleanupOrphanChain(node, cleaned = new Set()) {
    if (cleaned.has(node.id)) return;
    if (node.inEdges.size > 0) return; // 仍有入边，不是孤立节点
    if (node.id === 0) return; // 根节点永不清理

    cleaned.add(node.id);

    // 先递归检查所有后继节点
    const outgoingEdges = [...node.outEdges.values()];
    for (const edge of outgoingEdges) {
      this._disconnectEdge(edge);
      this._cleanupOrphanChain(edge.target, cleaned);
    }

    // 移除节点本身
    this._nodes.delete(node.id);
  }

  // -----------------------------------------------------------------------
  // 路径解析
  // -----------------------------------------------------------------------

  /**
   * 从根节点沿路径解析到目标节点
   * @param {string} path - 绝对或相对路径（相对路径相对于根）
   * @returns {DevicesDAGNode|undefined}
   */
  getNode(path = "/") {
    const absolutePath = resolvePath("/", path);
    if (absolutePath === "/") return this._root;

    const segments = normalizePath(absolutePath);
    let current = this._root;

    for (const segment of segments) {
      const edge = current.outEdges.get(segment);
      if (!edge) return undefined;
      current = edge.target;
    }

    if (!current.path) {
      current.path = absolutePath;
    }

    return current;
  }

  /**
   * 确保路径存在（自动创建缺失的边和节点）
   * @param {string} path - 绝对或相对路径
   * @returns {DevicesDAGNode}
   */
  ensureNode(path = "/") {
    const absolutePath = resolvePath("/", path);
    if (absolutePath === "/") {
      this._root.path = "/";
      return this._root;
    }

    const segments = normalizePath(absolutePath);
    let current = this._root;

    for (const segment of segments) {
      let edge = current.outEdges.get(segment);
      if (!edge) {
        const target = this._createNode(this._allocateNodeId());
        edge = this._connectNodes(current, segment, target);
      }
      current = edge.target;
    }

    if (!current.path) {
      current.path = absolutePath;
    }

    return current;
  }

  /**
   * 从指定节点解析相对路径
   * @param {DevicesDAGNode} fromNode - 起始节点
   * @param {string} relativePath - 相对路径
   * @returns {DevicesDAGNode|undefined}
   */
  resolveRelativeNode(fromNode, relativePath = "") {
    if (!fromNode) return undefined;
    // 从根解析绝对路径，然后从 fromNode 的相对偏移来推算？不，直接用路径解析。
    // 我们需要先得到 fromNode 的某个路径表示，再拼接 relativePath。
    // 简单方案：用 getNode 解析绝对路径，但 relativePath 可能以 "./" 开头。
    // 采用 resolvePath 工具函数
    const absolutePath = resolvePath("/", relativePath);
    return this.getNode(absolutePath);
  }

  /**
   * 获取节点的某一可达路径（用于日志/调试）
   * 返回该节点的一条绝对路径；若节点不可达则返回 undefined
   * @param {DevicesDAGNode} node
   * @returns {string|undefined}
   */
  getNodePath(node) {
    if (!node) return undefined;
    if (node.id === 0) return "/";

    // BFS 从根找一条到目标节点的路径
    const visited = new Set();
    const queue = [{ node: this._root, path: "/" }];
    visited.add(this._root.id);

    while (queue.length > 0) {
      const { node: current, path: currentPath } = queue.shift();
      for (const [edgeName, edge] of current.outEdges) {
        if (visited.has(edge.target.id)) continue;
        visited.add(edge.target.id);
        const nextPath =
          currentPath === "/" ? `/${edgeName}` : `${currentPath}/${edgeName}`;
        if (edge.target === node) return nextPath;
        queue.push({ node: edge.target, path: nextPath });
      }
    }

    return undefined; // 不可达
  }

  // -----------------------------------------------------------------------
  // 边管理
  // -----------------------------------------------------------------------

  /**
   * 添加一条有向边
   * @param {string} fromPath - 源节点路径
   * @param {string} edgeName - 边名
   * @param {string} [toPath] - 目标节点路径；省略则创建新节点作为目标
   * @returns {DevicesDAGEdge}
   * @throws {Error} 当源路径不存在或边名冲突时
   */
  addEdge(fromPath, edgeName, toPath) {
    const source = this.getNode(fromPath);
    if (!source) {
      throw new Error(`Source node not found at path "${fromPath}".`);
    }

    const target = toPath
      ? this.ensureNode(toPath)
      : this._createNode(this._allocateNodeId());

    return this._connectNodes(source, edgeName, target);
  }

  /**
   * 移除一条有向边，并递归清理因此变成孤立的节点
   * @param {string} fromPath - 源节点路径
   * @param {string} edgeName - 边名
   * @returns {boolean} 是否成功移除
   */
  removeEdge(fromPath, edgeName) {
    const source = this.getNode(fromPath);
    if (!source) return false;

    const edge = source.outEdges.get(edgeName);
    if (!edge) return false;

    const target = edge.target;
    this._disconnectEdge(edge);
    this._cleanupOrphanChain(target);

    return true;
  }

  // -----------------------------------------------------------------------
  // 节点状态
  // -----------------------------------------------------------------------

  /**
   * 读取节点状态
   * @param {string|number} pathOrId - 节点路径或节点 id
   * @returns {Object}
   */
  getNodeState(pathOrId) {
    const node =
      typeof pathOrId === "number"
        ? this._nodes.get(pathOrId)
        : this.getNode(pathOrId);
    return node ? { ...node.state } : {};
  }

  /**
   * 写入节点状态
   * @param {string|number} pathOrId - 节点路径或节点 id
   * @param {Object} state - 新状态
   * @returns {Object} 写入后的状态
   */
  setNodeState(pathOrId, state = {}) {
    const node =
      typeof pathOrId === "number"
        ? this._nodes.get(pathOrId)
        : this.ensureNode(pathOrId);
    node.state = isPlainObject(state) ? { ...state } : {};
    return { ...node.state };
  }

  // -----------------------------------------------------------------------
  // 节点配置
  // -----------------------------------------------------------------------

  /**
   * 运行时更新节点配置
   * @param {string} path - 节点路径
   * @param {Object} options - 配置选项
   * @param {DevicesDAGHandler|null} [options.handler] - 新处理器
   * @param {Object|null} [options.semantics] - 新语义
   * @param {string|null} [options.defaultRoute] - 新默认出边
   * @param {DevicesDAGNodeUmountHandler|null} [options.umount] - 新卸载钩子
   */
  configureNode(path, options = {}) {
    const node = this.ensureNode(path);

    if ("handler" in options) {
      node.handler =
        typeof options.handler === "function" ? options.handler : null;
    }
    if ("semantics" in options) {
      node.semantics = isPlainObject(options.semantics)
        ? { ...options.semantics }
        : {};
    }
    if ("defaultRoute" in options) {
      node.defaultRoute =
        typeof options.defaultRoute === "string" ? options.defaultRoute : "";
    } else if ("defaultChild" in options) {
      node.defaultRoute =
        typeof options.defaultChild === "string" ? options.defaultChild : "";
    }
    if ("umount" in options) {
      node.umount =
        typeof options.umount === "function" ? options.umount : null;
    }

    return node;
  }

  /**
   * 直接挂载一个运行时节点
   * @param {string} path
   * @param {DevicesDAGHandler|null} [handler=null]
   * @param {{semantics?: Object, defaultChild?: string, defaultRoute?: string, umount?: DevicesDAGNodeUmountHandler|null}} [options={}]
   * @returns {DevicesDAGNode}
   */
  mount(path, handler = null, options = {}) {
    const node = this.ensureNode(path);

    if (arguments.length >= 2) {
      node.handler = typeof handler === "function" ? handler : null;
    }
    if (isPlainObject(options.semantics)) {
      node.semantics = { ...node.semantics, ...options.semantics };
    }

    const defaultRoute =
      typeof options.defaultRoute === "string"
        ? options.defaultRoute
        : typeof options.defaultChild === "string"
          ? options.defaultChild
          : null;
    if (defaultRoute !== null) {
      node.defaultRoute = defaultRoute;
    }
    if ("umount" in options) {
      node.umount =
        typeof options.umount === "function" ? options.umount : null;
    }

    return node;
  }

  // -----------------------------------------------------------------------
  // Tool 挂载
  // -----------------------------------------------------------------------

  /**
   * 在指定路径节点挂载一个 Tool
   * @param {string} path - 节点路径
   * @param {import("../tools/tool.js").Tool} tool - 工具实例
   * @param {Object} [toolContext={}] - 工具固定上下文
   * @returns {DevicesDAGNode} 挂载后的节点
   */
  mountTool(path, tool, toolContext = {}) {
    const node = this.ensureNode(path);

    if (node.handler) {
      throw new Error(
        `Cannot mount tool at "${path}": node already has a handler.`,
      );
    }

    const processor = tool.createProcessor(toolContext);

    node.handler = processor;
    node.semantics = { ...node.semantics, tool: true };

    const previousUmount = node.umount;
    node.umount = (handlerContext) => {
      try {
        processor.dispose?.(handlerContext);
      } catch {
        // 静默吞掉 dispose 错误
      }
      try {
        tool.umount?.(tool.createDeviceContext(handlerContext, toolContext));
      } catch {
        // 静默吞掉 umount 错误
      }
      if (typeof previousUmount === "function") {
        previousUmount(handlerContext);
      }
    };

    return node;
  }

  // -----------------------------------------------------------------------
  // 子图挂载
  // -----------------------------------------------------------------------

  /**
   * 挂载结构化子图
   * @param {string} basePath - 挂载基准路径
   * @param {SubDAGDefinition} subDAGDef - 子图定义
   * @param {Object} [context={}] - 挂载时累积上下文
   */
  mountSubDAG(basePath, subDAGDef, context = {}) {
    if (!subDAGDef || typeof subDAGDef !== "object") return [];

    const { rootPath = "/", rootNodeId = 0, nodes, edges = [] } = subDAGDef;
    const targetRootPath = joinPath(basePath, rootPath);

    /** @type {Map<number, DevicesDAGNode>} */
    const idMap = new Map();
    /** @type {DevicesDAGNode[]} */
    const mountedNodes = [];

    // 1. 创建节点：根节点用 ensureNode 定位到 targetRootPath，其余节点直接创建
    if (nodes) {
      for (const [localId, nodeDef] of nodes) {
        let globalNode;
        if (localId === rootNodeId) {
          globalNode = this.ensureNode(targetRootPath);
        } else {
          globalNode = this._createNode(this._allocateNodeId());
        }
        this._applyNodeDefinition(globalNode, nodeDef);
        idMap.set(localId, globalNode);
        mountedNodes.push(globalNode);
      }
    }

    // 2. 挂载边
    for (const edgeDef of edges) {
      const fromNode = idMap.get(edgeDef.fromNodeId);
      const toNode = idMap.get(edgeDef.toNodeId);
      if (!fromNode || !toNode) continue;
      try {
        this._connectNodes(fromNode, edgeDef.name, toNode);
      } catch {
        // 边已存在时跳过（幂等挂载）
      }
    }

    for (const node of mountedNodes) {
      if (!node.path) {
        node.path = this.getNodePath(node) ?? null;
      }
    }

    return mountedNodes;
  }

  /**
   * 将子图节点定义应用到已有节点
   * @param {DevicesDAGNode} node
   * @param {SubDAGNodeDefinition} def
   */
  _applyNodeDefinition(node, def) {
    if (!def) return;

    if (def.handler != null) {
      node.handler = typeof def.handler === "function" ? def.handler : null;
    }
    if (isPlainObject(def.semantics)) {
      node.semantics = { ...node.semantics, ...def.semantics };
    }
    if (typeof def.defaultRoute === "string") {
      node.defaultRoute = def.defaultRoute;
    }
    if (def.umount != null) {
      node.umount = typeof def.umount === "function" ? def.umount : null;
    }
    if (def.tool) {
      const processor = def.tool.createProcessor(def.toolContext ?? {});
      node.handler = processor;
      node.semantics = { ...node.semantics, tool: true };

      const previousUmount = node.umount;
      node.umount = (handlerContext) => {
        try {
          processor.dispose?.(handlerContext);
        } catch {
          // 静默吞掉 dispose 错误
        }
        try {
          def.tool.umount?.(
            def.tool.createDeviceContext(handlerContext, def.toolContext ?? {}),
          );
        } catch {
          // 静默吞掉 umount 错误
        }
        if (typeof previousUmount === "function") {
          previousUmount(handlerContext);
        }
      };
    }
  }

  /**
   * 创建节点处理器上下文
   * `path` 是本次实际分发所走的活动路径；同一节点可有多条路径
   * @param {DevicesDAGNode} node
   * @param {string} path
   * @param {SignalPacket|undefined} signalPacket
   * @param {Object} accumulatedContext
   * @param {number} depth
   * @returns {DevicesDAGHandlerContext & {ddag: DevicesDAG, defaultChild: string, resolvedDefaultChildPath: string}}
   */
  _createHandlerContext(
    node,
    path,
    signalPacket,
    accumulatedContext = {},
    depth = 0,
  ) {
    const defaultRoute = node.getDefaultRoute?.() ?? node.defaultRoute ?? "";
    const resolvedDefaultRoutePath = defaultRoute
      ? joinPath(path, defaultRoute)
      : path;

    return {
      node,
      dag: this,
      ddag: this,
      path,
      semantics: node.getSemantics?.() ?? { ...node.semantics },
      defaultRoute,
      resolvedDefaultRoutePath,
      defaultChild: defaultRoute,
      resolvedDefaultChildPath: resolvedDefaultRoutePath,
      depth,
      signalPacket,
      context: { ...accumulatedContext },
      getNodeState: (pathOrId = path) => this.getNodeState(pathOrId),
      setNodeState: (pathOrId, state) => this.setNodeState(pathOrId, state),
    };
  }

  // -----------------------------------------------------------------------
  // 分发
  // -----------------------------------------------------------------------

  /**
   * 从根节点开始分发信号包
   * @param {SignalPacket|Object} packet - 信号包
   * @param {Object} [context={}] - 初始累积上下文
   * @param {number} [depth=0] - 当前分发深度（内部使用）
   * @returns {{ packets: SignalPacket[], context?: Object }} 分发结果
   */
  dispatch(packet, context = {}, depth = 0) {
    if (depth > this._maxDispatchDepth) {
      throw new Error(
        `Dispatch depth exceeded (${this._maxDispatchDepth}). Possible cycle detected.`,
      );
    }

    const startPacket = SignalPacket.from(packet, { defaultTo: "" });
    let segments = normalizePath(startPacket.to || "");

    if (segments.length === 0) {
      if (this._root.getDefaultRoute()) {
        segments = normalizePath(this._root.getDefaultRoute());
      } else {
        return { packets: [startPacket] };
      }
    }

    let currentNode = this._root;
    let currentPath = "/";
    let currentPacket = startPacket;
    let mergedContext = { ...context };
    let contextChanged = false;
    const finalPackets = [];
    const deferredRoutes = [];
    let nodeVisitCount = depth;

    const flushDeferredRoutes = () => {
      for (const deferredRoute of deferredRoutes) {
        const subResult = this._routeFromNode(
          deferredRoute.fromNode,
          deferredRoute.fromPath,
          deferredRoute.packet,
          deferredRoute.context,
          depth + 1,
        );
        if (subResult.packets.length > 0) {
          finalPackets.push(...subResult.packets);
        }
      }
      deferredRoutes.length = 0;
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const edge = currentNode.outEdges.get(segment);
      const child = edge?.target;

      if (!child) {
        flushDeferredRoutes();
        return {
          packets:
            finalPackets.length > 0
              ? finalPackets
              : [new SignalPacket("", currentPacket.signals)],
          context: contextChanged ? mergedContext : undefined,
        };
      }

      const childPath = joinPath(currentPath, segment);

      nodeVisitCount++;
      if (nodeVisitCount > this._maxDispatchDepth) {
        throw new Error(`Dispatch depth exceeded (${this._maxDispatchDepth}).`);
      }

      const handler = child.getHandler?.() ?? child.handler;
      const handlerContext = this._createHandlerContext(
        child,
        childPath,
        currentPacket,
        mergedContext,
        nodeVisitCount,
      );

      const result = handler
        ? normalizeHandlerResult(handler(currentPacket, handlerContext))
        : { packets: [new SignalPacket("", currentPacket.signals)] };

      if (result.context && isPlainObject(result.context)) {
        for (const key of Object.keys(result.context)) {
          if (Object.prototype.hasOwnProperty.call(mergedContext, key)) {
            throw new Error(
              `Context key "${key}" already exists in accumulated context. Cannot override.`,
            );
          }
        }
        mergedContext = { ...mergedContext, ...result.context };
        contextChanged = true;
      }

      if (result.stop) {
        if (result.packets.length > 0) {
          finalPackets.push(...result.packets);
        }
        flushDeferredRoutes();
        return {
          packets: finalPackets.length > 0 ? finalPackets : result.packets,
          context: contextChanged ? mergedContext : undefined,
        };
      }

      if (result.redirect) {
        const redirectSegments = normalizePath(result.redirect);
        segments.splice(i + 1, segments.length - i - 1, ...redirectSegments);
      }

      if (result.packets.length > 0) {
        const primaryPacket = SignalPacket.from(result.packets[0]);
        const remainingPackets = result.packets.slice(1);

        for (const extraPacket of remainingPackets) {
          const p = SignalPacket.from(extraPacket);
          if (p.to) {
            deferredRoutes.push({
              fromNode: child,
              fromPath: childPath,
              packet: p,
              context: mergedContext,
            });
          }
        }

        if (primaryPacket.to) {
          const primarySegments = normalizePath(primaryPacket.to);
          segments.splice(i + 1, segments.length - i - 1, ...primarySegments);
          currentPacket = primaryPacket;
        } else if (child.getDefaultRoute()) {
          segments = [...segments.slice(0, i + 1), child.getDefaultRoute()];
          currentPacket = primaryPacket;
        } else if (i === segments.length - 1) {
          finalPackets.push(primaryPacket);
          break;
        }
      } else if (result.explicitPackets) {
        break;
      } else if (i === segments.length - 1 && child.getDefaultRoute()) {
        segments = [...segments.slice(0, i + 1), child.getDefaultRoute()];
      }

      currentNode = child;
      currentPath = childPath;
    }

    flushDeferredRoutes();
    return {
      packets: finalPackets.length > 0 ? finalPackets : [],
      context: contextChanged ? mergedContext : undefined,
    };
  }

  /**
   * 从指定节点开始路由信号包
   * @param {DevicesDAGNode} fromNode - 起始节点
   * @param {string} fromPath - 起始节点路径
   * @param {SignalPacket} signalPacket - 信号包
   * @param {Object} accumulatedContext - 累积上下文
   * @param {number} depth - 当前深度
   * @returns {{ packets: SignalPacket[], context?: Object }} 路由结果
   * @private
   */
  _routeFromNode(
    fromNode,
    fromPath,
    signalPacket,
    accumulatedContext = {},
    depth = 0,
  ) {
    const segments = normalizePath(signalPacket.to || "");
    if (segments.length === 0) {
      if (fromNode.getDefaultRoute()) {
        return this._routeFromNode(
          fromNode,
          fromPath,
          new SignalPacket(fromNode.getDefaultRoute(), signalPacket.signals),
          accumulatedContext,
          depth,
        );
      }
      return { packets: [] };
    }

    let currentNode = fromNode;
    let currentPath = fromPath;
    let currentPacket = signalPacket;
    let mergedContext = { ...accumulatedContext };
    let contextChanged = false;
    const finalPackets = [];
    const deferredRoutes = [];

    const flushDeferredRoutes = () => {
      for (const deferredRoute of deferredRoutes) {
        const subResult = this._routeFromNode(
          deferredRoute.fromNode,
          deferredRoute.fromPath,
          deferredRoute.packet,
          deferredRoute.context,
          depth,
        );
        finalPackets.push(...subResult.packets);
      }
      deferredRoutes.length = 0;
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const edge = currentNode.outEdges.get(segment);
      const child = edge?.target;
      if (!child) {
        flushDeferredRoutes();
        return {
          packets: finalPackets,
          context: contextChanged ? mergedContext : undefined,
        };
      }

      const childPath = joinPath(currentPath, segment);
      const handler = child.getHandler?.() ?? child.handler;
      const handlerContext = this._createHandlerContext(
        child,
        childPath,
        currentPacket,
        mergedContext,
        depth,
      );
      const result = handler
        ? normalizeHandlerResult(handler(currentPacket, handlerContext))
        : { packets: [new SignalPacket("", currentPacket.signals)] };

      if (result.context && isPlainObject(result.context)) {
        for (const key of Object.keys(result.context)) {
          if (Object.prototype.hasOwnProperty.call(mergedContext, key)) {
            throw new Error(
              `Context key "${key}" already exists in accumulated context. Cannot override.`,
            );
          }
        }
        mergedContext = { ...mergedContext, ...result.context };
        contextChanged = true;
      }

      if (result.stop) {
        if (result.packets.length > 0) {
          finalPackets.push(...result.packets);
        }
        flushDeferredRoutes();
        return {
          packets: finalPackets,
          context: contextChanged ? mergedContext : undefined,
        };
      }

      if (result.packets.length > 0) {
        const primaryPacket = SignalPacket.from(result.packets[0]);
        const remainingPackets = result.packets.slice(1);

        for (const extraPacket of remainingPackets) {
          const p = SignalPacket.from(extraPacket);
          if (p.to) {
            deferredRoutes.push({
              fromNode: child,
              fromPath: childPath,
              packet: p,
              context: mergedContext,
            });
          }
        }

        if (primaryPacket.to) {
          const primarySegments = normalizePath(primaryPacket.to);
          segments.splice(i + 1, segments.length - i - 1, ...primarySegments);
          currentPacket = primaryPacket;
        } else if (child.getDefaultRoute()) {
          segments.splice(
            i + 1,
            segments.length - i - 1,
            child.getDefaultRoute(),
          );
          currentPacket = primaryPacket;
        } else if (i === segments.length - 1) {
          finalPackets.push(primaryPacket);
          break;
        }
      } else if (result.explicitPackets) {
        flushDeferredRoutes();
        return {
          packets: finalPackets,
          context: contextChanged ? mergedContext : undefined,
        };
      } else if (i === segments.length - 1 && child.getDefaultRoute()) {
        segments.splice(
          i + 1,
          segments.length - i - 1,
          child.getDefaultRoute(),
        );
      }

      currentNode = child;
      currentPath = childPath;
    }

    flushDeferredRoutes();
    return {
      packets: finalPackets,
      context: contextChanged ? mergedContext : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // 卸载
  // -----------------------------------------------------------------------

  /**
   * 卸载指定路径的工具节点（便捷方法）
   * @param {string} path - 工具节点路径
   * @param {Object} [context={}] - 卸载上下文
   */
  unmountTool(path, context = {}) {
    return this.unmount(path, context);
  }

  /**
   * 卸载指定路径的节点及其出边子图
   * 若目标节点有多个入边，只移除从该路径可达的入边
   * @param {string} path - 节点路径
   * @param {Object} [context={}] - 卸载上下文
   */
  unmount(path, context = {}) {
    const node = this.getNode(path);
    if (!node) return false;
    if (node.id === 0) return false; // 不能卸载根节点

    // 找到从根到此节点的最后一条边
    const absolutePath = resolvePath("/", path);
    if (absolutePath === "/") return false;

    const segments = normalizePath(absolutePath);
    if (segments.length === 0) return false;

    // 逐段走到目标节点前，断开最后一段边
    let current = this._root;
    for (let i = 0; i < segments.length - 1; i++) {
      const edge = current.outEdges.get(segments[i]);
      if (!edge) return false;
      current = edge.target;
    }

    const lastName = segments[segments.length - 1];
    const lastEdge = current.outEdges.get(lastName);
    if (!lastEdge) return false;

    const target = lastEdge.target;

    // 执行卸载钩子（深度优先：先子后父）
    this._umountSubgraph(target, context);
    return true;
  }

  /**
   * 深度优先执行卸载钩子并清理子图
   * @param {DevicesDAGNode} root - 子图根节点
   * @param {Object} context - 卸载上下文
   * @param {Set<number>} [visited=new Set()] - 已访问节点
   * @private
   */
  _umountSubgraph(root, context = {}, visited = new Set()) {
    if (!root || visited.has(root.id)) return;
    visited.add(root.id);

    // 在断开边之前解析路径（断开后节点将不可达）
    const nodePath = this.getNodePath(root) ?? "";

    // 先递归卸载所有后继
    const outgoingEdges = [...root.outEdges.values()];
    for (const edge of outgoingEdges) {
      this._umountSubgraph(edge.target, context, visited);
      this._disconnectEdge(edge);
    }

    // 清理入边
    const incomingEdges = [...root.inEdges];
    for (const edge of incomingEdges) {
      this._disconnectEdge(edge);
    }

    // 执行卸载钩子
    if (typeof root.umount === "function") {
      const handlerContext = {
        node: root,
        dag: this,
        path: nodePath,
        semantics: { ...root.semantics },
        defaultRoute: root.defaultRoute,
        resolvedDefaultRoutePath: "",
        depth: 0,
        signalPacket: undefined,
        context: { ...context },
        getNodeState: (pathOrId) => this.getNodeState(pathOrId),
        setNodeState: (pathOrId, state) => this.setNodeState(pathOrId, state),
      };
      try {
        root.umount(handlerContext);
      } catch {
        // 静默吞掉 umount 错误
      }
    }

    // 重置节点状态
    root.handler = null;
    root.semantics = {};
    root.state = {};
    root.umount = null;
    root.defaultRoute = "";

    // 从全局表中移除
    if (root.id !== 0) {
      this._nodes.delete(root.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Builder DSL（方案 B：edge 和 node 显式分离）
// ---------------------------------------------------------------------------

/**
 * 子图节点构建器
 * @class
 */
class DAGNodeBuilder {
  /**
   * @param {DAGBuilder} dagBuilder - 所属子图构建器
   * @param {number} localId - 子图内局部 id
   */
  constructor(dagBuilder, localId) {
    /** @type {DAGBuilder} */
    this._dagBuilder = dagBuilder;
    /** @type {number} */
    this._localId = localId;
  }

  /**
   * 设置节点处理器
   * @param {DevicesDAGHandler|null} handler
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
   * @param {DevicesDAGHandler|null} handler
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
   * @param {DevicesDAGNodeUmountHandler|null} umountHandler
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
 * 子图构建器（方案 B：声明式）
 * @class
 */
class DAGBuilder {
  /**
   * @param {string} rootPath - 子图根路径前缀
   */
  constructor(rootPath = "/") {
    /** @type {string} */
    this._rootPath = toAbsolutePath(normalizePath(rootPath));
    /** @type {number} */
    this._nextLocalId = 0;
    /** @type {Map<number, SubDAGNodeDefinition>} */
    this._nodeDefs = new Map();
    /** @type {SubDAGEdgeDefinition[]} */
    this._edges = [];
    /** @type {number|null} */
    this._rootNodeId = null;
    /** @type {Object} */
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
   * @returns {SubDAGDefinition}
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

  // ---- 内部方法 ----

  /**
   * @param {number} localId
   * @param {Partial<SubDAGNodeDefinition>} patch
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
 * @param {string} rootPath - 子图根路径前缀（挂载时与 basePath 拼接）
 * @returns {DAGBuilder}
 */
function createSubDAG(rootPath = "/") {
  return new DAGBuilder(rootPath);
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export {
  DevicesDAG,
  DevicesDAGNode,
  DevicesDAGEdge,
  DAGBuilder,
  DAGNodeBuilder,
  createSubDAG,
};
