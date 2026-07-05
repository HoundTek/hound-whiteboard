/**
 * @file 设备图核心引擎
 * @description
 * 提供基于有向无环图的设备信号路由、路径解析与分发的核心实现。
 *
 * 文件结构：
 * - `dag.js`（本文件）：DevicesDAG 类 + JSDoc 类型定义
 * - `dag-utils.js`：内部工具函数（isPlainObject、normalizeHandlerResult 等）
 * - `dag-node-edge.js`：DevicesDAGNode 与 DevicesDAGEdge 基础数据结构
 * - `dag-builder.js`：DAGBuilder / DAGNodeBuilder 声明式 DSL
 * - `dag-debug.js`：dagToString（树状文本）/ toMermaid（流程图）
 * - `index.js`：统一 re-export 入口
 *
 * 外部使用者通过 `import { ... } from "../devices-dag"` 引入。
 * @module core/devices-dag/dag
 * @author Zhou Chenyu
 */

import { joinPath, normalizePath, resolvePath } from "../utils/path.js";
import { SignalPacket } from "./signal.js";
import { CounterPool } from "../utils/counter-pool.js";
import {
  isPlainObject,
  isSubDAGDefinition,
  normalizeHandlerResult,
} from "./dag-utils.js";
import { DevicesDAGNode } from "./dag-node-edge.js";
import { DevicesDAGEdge } from "./dag-node-edge.js";
import { dagToString } from "./dag-debug.js";

// ---------------------------------------------------------------------------
// 类型定义（JSDoc）
// ---------------------------------------------------------------------------

/**
 * 设备图处理器上下文
 * @description
 * 处理器上下文包含当前节点元数据、累积上下文以及节点状态访问接口，
 * 供节点处理器在处理信号包时使用。
 *
 * 累积上下文（\`acc\`）是沿分发路径逐步追加的只读对象。
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
 * @property {Object} acc - 累积上下文（沿分发路径逐层追加，handler 不能在此平级新增键）
 * @property {Object} state - 当前节点状态的只读快照
 * @property {() => any} getState - 重读节点最新状态
 * @property {(nextState: Object) => Object} setState - 全量写入节点状态
 * @property {(partial: Object) => Object} patchState - 浅合并写入节点状态
 * @property {(to: string, signals?: Array) => DevicesDAGHandlerResult} routeToChild - 路由到子节点
 * @property {() => DevicesDAGHandlerResult} stop - 终止当前链路
 * @property {(type: string, value: any, extra?: Object) => Object} signal - 构造标准信号 { type, context: { value, ...extra } }
 * @property {(pathOrId?: string|number) => any} getNodeState - 读取任意节点状态
 * @property {(pathOrId: string|number, state: any) => any} setNodeState - 写入任意节点状态
 */

/**
 * 设备图处理器输出
 * @typedef {Object} DevicesDAGHandlerResult
 * @property {SignalPacket[]} packets - 继续路由到后继节点的信号包列表
 * @property {Object} [acc] - 要合并到累积上下文的键值对
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
 * @example
 * // 基础用法：通过 configureNode 配置 Monitor 下的设备路由，再分发信号
 * const dag = new DevicesDAG();
 *
 * // 标记 Monitor 根节点（通常由 Board.createMonitor 自动完成）
 * dag.configureNode("/monitor", { semantics: { monitor: true } });
 *
 * // 配置 Monitor 下的设备路由节点
 * dag.configureNode("/monitor/mouse", { defaultRoute: "primary" });
 * dag.configureNode("/monitor/mouse/primary", {
 *   handler(pkt, ctx) {
 *     return { stop: true, packets: [pkt] };
 *   },
 * });
 *
 * // 挂载 workflow 工具实例
 * dag.mountWorkflow("/monitor/workflows/pen", myPenTool, { board });
 *
 * // 分发信号
 * dag.dispatch({
 *   to: "/monitor/mouse",
 *   signals: [{ type: "pointerdown", x: 100, y: 200 }],
 * });
 *
 * @example
 * // 使用 Builder DSL 构建子图并挂载（详见 dag-builder.js）
 * const builder = createSubDAG("/keyboard");
 * const r = builder.node().handler(codeRouter);
 * const k = builder.node().handler(keyHandler).defaultRoute("wasd");
 * builder.edge("code", r, k);
 * dag.mountSubDAG("", builder.build());
 */
class DevicesDAG {
  /**
   * 所有节点（id → 节点）
   * @type {Map<number, DevicesDAGNode>}
   */
  _nodes;

  /**
   * 节点 id 分配池
   * @type {CounterPool}
   */
  _nodeIdPool;

  /**
   * 最大分发深度
   * @type {number}
   */
  _maxDispatchDepth;

  /**
   * 已挂载 tool 实例集合（禁止重复挂载）
   * @type {Set<import("../tools/tool.js").Tool>}
   */
  _mountedToolInstances;

  /**
   * 根节点
   * @type {DevicesDAGNode}
   */
  _root;

  /**
   * @param {Object} [options={}] - 构造选项
   * @param {number} [options.maxDispatchDepth=32] - 最大分发深度（防止环路）
   */
  constructor(options = {}) {
    this._nodes = new Map();
    this._nodeIdPool = new CounterPool(0);
    this._maxDispatchDepth = options.maxDispatchDepth ?? 32;
    this._mountedToolInstances = new Set();

    // 创建根节点（id = 0，唯一的源）
    this._root = this._createNode(0);
    this._root.semantics = { root: true };
    this._root.path = "/";
  }

  /**
   * 注册 tool 实例到 DAG（禁止重复注册）
   * @param {import("../tools/tool.js").Tool} tool
   * @throws {Error} 如果该 tool 实例已在 DAG 中
   * @private
   */
  _registerToolInstance(tool) {
    if (this._mountedToolInstances.has(tool)) {
      throw new Error(
        `Tool instance is already mounted in this DAG. A tool instance cannot be mounted more than once.`,
      );
    }
    this._mountedToolInstances.add(tool);
  }

  /**
   * 从 DAG 中取消 tool 实例注册
   * @param {import("../tools/tool.js").Tool} tool
   * @private
   */
  _unregisterToolInstance(tool) {
    this._mountedToolInstances.delete(tool);
  }

  /**
   * 创建节点并注册到内部表
   * @private
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
   * @private
   * @returns {number} 下一个可用节点 id
   */
  _allocateNodeId() {
    return this._nodeIdPool.generate();
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

  /**
   * 读取节点状态
   * @param {string|number} pathOrId - 节点路径或节点 id
   * @returns {Object} 节点状态快照
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

  /**
   * 运行时更新节点配置
   * @param {string} path - 节点路径
   * @param {Object} options - 配置选项
   * @param {DevicesDAGHandler|null} [options.handler] - 新处理器
   * @param {Object|null} [options.semantics] - 新语义
   * @param {string|null} [options.defaultRoute] - 新默认出边
   * @param {DevicesDAGNodeUmountHandler|null} [options.umount] - 新卸载钩子
   * @returns {DevicesDAGNode} 更新后的节点
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
    }
    if ("umount" in options) {
      node.umount =
        typeof options.umount === "function" ? options.umount : null;
    }

    return node;
  }

  /**
   * 直接挂载一个运行时节点
   * @param {string} path - 节点路径
   * @param {DevicesDAGHandler|null} [handler=null] - 节点处理器
   * @param {{semantics?: Object, defaultRoute?: string, umount?: DevicesDAGNodeUmountHandler|null}} [options={}] - 配置选项
   * @returns {DevicesDAGNode} 挂载后的节点
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
      typeof options.defaultRoute === "string" ? options.defaultRoute : null;
    if (defaultRoute !== null) {
      node.defaultRoute = defaultRoute;
    }
    if ("umount" in options) {
      node.umount =
        typeof options.umount === "function" ? options.umount : null;
    }

    return node;
  }

  /**
   * 在指定路径节点挂载一个 workflow 入口。
   * @param {string} path - 节点路径
   * @param {import("../tools/tool.js").Tool|SubDAGDefinition} workflow - workflow 入口实例或单源 workflow 子图
   * @returns {DevicesDAGNode|DevicesDAGNode[]} 挂载后的节点或节点列表
   */
  mountWorkflow(path, workflow) {
    if (isSubDAGDefinition(workflow)) {
      return this.mountSubDAG("/", {
        ...workflow,
        rootPath: path,
      });
    }

    const node = this.ensureNode(path);

    if (node.handler) {
      throw new Error(
        `Cannot mount workflow at "${path}": node already has a handler.`,
      );
    }

    this._registerToolInstance(workflow);

    const processor = workflow.createProcessor();

    node.handler = processor;
    node.semantics = { ...node.semantics, tool: true };
    node._toolInstance = workflow;

    const previousUmount = node.umount;
    node.umount = (handlerContext) => {
      try {
        processor.dispose?.(handlerContext);
      } catch {
        // 静默吞掉 dispose 错误
      }
      try {
        workflow.umount?.(handlerContext);
      } catch {
        // 静默吞掉 umount 错误
      }
      if (typeof previousUmount === "function") {
        previousUmount(handlerContext);
      }
    };

    return node;
  }

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
      this._registerToolInstance(def.tool);
      const processor = def.tool.createProcessor();
      node.handler = processor;
      node.semantics = { ...node.semantics, tool: true };
      node._toolInstance = def.tool;

      const previousUmount = node.umount;
      node.umount = (handlerContext) => {
        try {
          processor.dispose?.(handlerContext);
        } catch {
          // 静默吞掉 dispose 错误
        }
        try {
          def.tool.umount?.(handlerContext);
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
   * @returns {DevicesDAGHandlerContext}
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

    const readNodeState = () => this.getNodeState(path);

    return {
      node,
      dag: this,
      path,
      semantics: node.getSemantics?.() ?? { ...node.semantics },
      defaultRoute,
      resolvedDefaultRoutePath,
      depth,
      signalPacket,
      acc: { ...accumulatedContext },
      state: readNodeState(),
      getState: readNodeState,
      setState: (nextState) => this.setNodeState(path, nextState),
      patchState(partial = {}) {
        const current = readNodeState();
        return this.setNodeState(
          path,
          isPlainObject(partial) ? { ...current, ...partial } : current,
        );
      },
      getNodeState: (pathOrId = path) => this.getNodeState(pathOrId),
      setNodeState: (pathOrId, state) => this.setNodeState(pathOrId, state),
      delNodeState(pathOrId = path, ...keys) {
        const current = this.getNodeState(pathOrId);
        for (const key of keys) {
          delete current[key];
        }
        this.setNodeState(pathOrId, current);
      },
      routeToChild(to, signals = signalPacket?.signals) {
        return { packets: [new SignalPacket(to, signals)] };
      },
      stop() {
        return { packets: [] };
      },
      signal(type, value, extra) {
        const base = isPlainObject(extra) ? { ...extra } : {};
        if (value !== undefined) {
          base.value = value;
        }
        return { type, context: base };
      },
    };
  }

  /**
   * 统一的图走法引擎
   * @description
   * 从指定节点出发，沿 segments 逐段下钻，每经过一个节点调用其 handler，
   * 根据返回结果动态调整后续路由（redirect、stop、多路分发、默认出边等）。
   *
   * dispatch 和 _routeFromNode 都是此方法的薄包装。
   *
   * @param {Object} params
   * @param {DevicesDAGNode} params.startNode - 起始节点
   * @param {string} params.startPath - 起始节点路径
   * @param {string[]} params.segments - 路径段列表（可被循环内修改）
   * @param {SignalPacket} params.startPacket - 起始信号包
   * @param {Object} params.accumulatedContext - 初始累积上下文
   * @param {number} params.depth - 递归深度（内部计算用）
   * @param {(currentPacket: SignalPacket) => SignalPacket[]} [params.edgeNotFoundFallback]
   *   - 边不存在时的回退；传入当前信号包，返回回退结果。
   *   - 不传则返回空数组。
   * @returns {{ packets: SignalPacket[], context?: Object }}
   * @private
   */
  _walkSegments({
    startNode,
    startPath,
    segments,
    startPacket,
    accumulatedContext,
    depth,
    edgeNotFoundFallback,
  }) {
    let currentNode = startNode;
    let currentPath = startPath;
    let currentPacket = startPacket;
    let mergedContext = { ...accumulatedContext };
    let contextChanged = false;
    const finalPackets = [];
    const deferredRoutes = [];

    /**
     * 刷新延迟路由队列
     * @description 将 deferredRoutes 中累积的额外信号包逐一通过 _routeFromNode 分发，
     * 结果追加到 finalPackets，最后清空队列。
     */
    const flushDeferredRoutes = () => {
      for (const deferredRoute of deferredRoutes) {
        const subResult = this._routeFromNode(
          deferredRoute.fromNode,
          deferredRoute.fromPath,
          deferredRoute.packet,
          deferredRoute.acc,
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
        const fallback =
          finalPackets.length > 0
            ? finalPackets
            : edgeNotFoundFallback
              ? edgeNotFoundFallback(currentPacket)
              : [];
        return {
          packets: fallback,
          acc: contextChanged ? mergedContext : undefined,
        };
      }

      const childPath = joinPath(currentPath, segment);

      depth++;
      if (depth > this._maxDispatchDepth) {
        throw new Error(
          `Dispatch depth exceeded (${this._maxDispatchDepth}). Possible cycle detected.`,
        );
      }

      const handler = child.getHandler?.() ?? child.handler;
      const handlerContext = this._createHandlerContext(
        child,
        childPath,
        currentPacket,
        mergedContext,
        depth,
      );

      let rawResult;
      if (typeof handler === "function") {
        try {
          rawResult = handler(currentPacket, handlerContext);
        } catch (error) {
          console.error(`[DevicesDAG] handler error at "${childPath}":`, error);
          rawResult = undefined;
        }

        if (rawResult instanceof Promise) {
          rawResult.catch((error) => {
            console.error(
              `[DevicesDAG] async handler rejection at "${childPath}":`,
              error,
            );
          });
          rawResult = undefined;
        }
      }

      const result =
        typeof handler === "function"
          ? normalizeHandlerResult(rawResult)
          : { packets: [new SignalPacket("", currentPacket.signals)] };

      // 累积上下文合并（禁止覆盖已有键）
      if (result.acc && isPlainObject(result.acc)) {
        for (const key of Object.keys(result.acc)) {
          if (Object.prototype.hasOwnProperty.call(mergedContext, key)) {
            throw new Error(
              `Context key "${key}" already exists in accumulated context. Cannot override.`,
            );
          }
        }
        mergedContext = { ...mergedContext, ...result.acc };
        contextChanged = true;
      }

      // stop：终止当前链路
      if (result.stop) {
        if (result.packets.length > 0) {
          finalPackets.push(...result.packets);
        }
        flushDeferredRoutes();
        return {
          packets: finalPackets.length > 0 ? finalPackets : result.packets,
          acc: contextChanged ? mergedContext : undefined,
        };
      }

      // redirect：覆盖后续路径段
      if (result.redirect) {
        const redirectSegments = normalizePath(result.redirect);
        segments.splice(i + 1, segments.length - i - 1, ...redirectSegments);
      }

      if (result.packets.length > 0) {
        const primaryPacket = SignalPacket.from(result.packets[0]);
        const remainingPackets = result.packets.slice(1);

        // 额外信号包 → 延迟路由队列
        for (const extraPacket of remainingPackets) {
          const p = SignalPacket.from(extraPacket);
          if (p.to) {
            deferredRoutes.push({
              fromNode: child,
              fromPath: childPath,
              packet: p,
              acc: mergedContext,
            });
          }
        }

        if (primaryPacket.to) {
          // 主包指定了下一段路由 → 替换后续路径
          const primarySegments = normalizePath(primaryPacket.to);
          segments.splice(i + 1, segments.length - i - 1, ...primarySegments);
          currentPacket = primaryPacket;
        } else if (child.getDefaultRoute()) {
          // 主包无 to → 走节点的默认出边
          segments.splice(
            i + 1,
            segments.length - i - 1,
            child.getDefaultRoute(),
          );
          currentPacket = primaryPacket;
        } else if (i === segments.length - 1) {
          // 路径终点 → 收入最终结果
          finalPackets.push(primaryPacket);
          break;
        }
      } else if (result.explicitPackets) {
        // handler 显式返回了空 packets → 终止
        flushDeferredRoutes();
        return {
          packets: finalPackets,
          acc: contextChanged ? mergedContext : undefined,
        };
      } else if (i === segments.length - 1 && child.getDefaultRoute()) {
        // handler 无输出但节点有默认出边 → 继续走
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
      acc: contextChanged ? mergedContext : undefined,
    };
  }

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

    return this._walkSegments({
      startNode: this._root,
      startPath: "/",
      segments,
      startPacket,
      accumulatedContext: context,
      depth,
      edgeNotFoundFallback: (pkt) => [new SignalPacket("", pkt.signals)],
    });
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

    return this._walkSegments({
      startNode: fromNode,
      startPath: fromPath,
      segments,
      startPacket: signalPacket,
      accumulatedContext,
      depth,
    });
  }

  /**
   * 生成设备图的树状字符串表示（委托 dag-debug.js）
   * @see {@link module:core/devices-dag/dag-debug.dagToString}
   * @returns {string}
   */
  toString() {
    return dagToString(this);
  }

  /**
   * 卸载指定路径的 workflow 节点（便捷方法）
   * @param {string} path - workflow 节点路径
   * @param {Object} [context={}] - 卸载上下文
   */
  unmountWorkflow(path, context = {}) {
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
        acc: { ...context },
        getNodeState: (pathOrId) => this.getNodeState(pathOrId),
        setNodeState: (pathOrId, state) => this.setNodeState(pathOrId, state),
      };
      try {
        root.umount(handlerContext);
      } catch {
        // 静默吞掉 umount 错误
      }
    }

    // 取消 tool 实例注册
    if (root._toolInstance != null) {
      this._unregisterToolInstance(root._toolInstance);
    }

    // 重置节点状态
    root.handler = null;
    root.semantics = {};
    root.state = {};
    root.umount = null;
    root._toolInstance = null;
    root.defaultRoute = "";

    // 从全局表中移除
    if (root.id !== 0) {
      this._nodes.delete(root.id);
    }
  }
}

export { DevicesDAG };
