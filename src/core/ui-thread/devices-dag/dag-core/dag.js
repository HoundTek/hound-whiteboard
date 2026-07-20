/**
 * @file 设备图核心引擎
 * @description
 * 提供基于有向无环图的设备信号路由、路径解析与分发的核心实现。
 *
 * 文件结构：
 * - `dag-core/`：引擎（dag.js / dag-node-edge.js / dag-builder.js / dag-debug.js / dag-utils.js / signal.js）
 * - `dag.js`（本文件）：DevicesDAG 类
 * - `dag-utils.js`：内部工具函数（isPlainObject、normalizeHandlerResult 等）
 * - `dag-node-edge.js`：DevicesDAGNode 与 DevicesDAGEdge 基础数据结构
 * - `dag-builder.js`：DAGBuilder / DAGNodeBuilder 声明式 DSL
 * - `dag-debug.js`：dagToString（树状文本）/ toMermaid（流程图）
 * - `../dag-type.js`：公共类型定义（typedef）
 * - `../index.js`：统一 re-export 入口
 *
 * 外部使用者通过 `import { ... } from "../devices-dag"` 引入。
 * @module core/ui-thread/devices-dag/dag-core/dag
 * @author Zhou Chenyu
 */

import {
  joinPath,
  normalizePath,
  resolvePath,
} from "../../../engine/utils/path.js";
import { SignalPacket } from "./signal.js";
import { CounterPool } from "../../../engine/utils/counter-pool.js";
import { isPlainObject, isSubDAGDefinition } from "./dag-utils.js";
import { DevicesDAGNode } from "./dag-node-edge.js";
import { DevicesDAGEdge } from "./dag-node-edge.js";
import { dagToString } from "./dag-debug.js";
import { Logger } from "../../../../utils/log/logger.js";
import { logBus } from "../../../../utils/log/log-bus.js";

/**
 * 设备图日志
 * @type {Logger}
 */
const dagLog = new Logger("DevicesDAG", "WARN", logBus);

/**
 * 公共类型定义已迁移至 ../dag-type.js，此处保留别名以保持本文件 JSDoc 引用可用。
 * @typedef {import("../dag-type.js").DevicesDAGServiceContext} DevicesDAGServiceContext
 */

/**
 * @typedef {import("../dag-type.js").DevicesDAGHandlerContext} DevicesDAGHandlerContext
 */

/**
 * @typedef {import("../dag-type.js").DevicesDAGHandlerResult} DevicesDAGHandlerResult
 */

/**
 * @typedef {import("../dag-type.js").DevicesDAGHandler} DevicesDAGHandler
 */

/**
 * @typedef {import("../dag-type.js").DevicesDAGNodeUmountHandler} DevicesDAGNodeUmountHandler
 */

/**
 * @typedef {import("../dag-type.js").SubDAGNodeDefinition} SubDAGNodeDefinition
 */

/**
 * @typedef {import("../dag-type.js").SubDAGEdgeDefinition} SubDAGEdgeDefinition
 */

/**
 * @typedef {import("../dag-type.js").SubDAGDefinition} SubDAGDefinition
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
 * // 基础用法：通过 configureNode 配置 Viewport 下的设备路由，再分发信号
 * const dag = new DevicesDAG();
 *
 * // 标记 Viewport 根节点（通常由 Board.createViewport 自动完成）
 * dag.configureNode("/viewport", { semantics: { viewport: true } });
 *
 * // 配置 Viewport 下的设备路由节点
 * dag.configureNode("/viewport/mouse", { defaultRoute: "primary" });
 * dag.configureNode("/viewport/mouse/primary", {
 *   handler(pkt, ctx) {
 *     return { stop: true, packets: [pkt] };
 *   },
 * });
 *
 * // 挂载 workflow 工具实例
 * dag.mountWorkflow("/viewport/workflows/pen", myPenTool);
 *
 * // 分发信号
 * dag.dispatch({
 *   to: "/viewport/mouse",
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
   * 是否启用 strict 模式（handler 报错直接抛出，禁止 async handler）
   * @type {boolean}
   */
  _strict;

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
   * @param {boolean} [options.strict=false] - 是否启用 strict 模式
   */
  constructor(options = {}) {
    this._nodes = new Map();
    this._nodeIdPool = new CounterPool(0);
    this._maxDispatchDepth = options.maxDispatchDepth ?? 32;
    this._strict = options.strict ?? false;
    this._mountedToolInstances = new Set();

    // 幽灵节点（-1，分发起点，对外不可见）
    this._ghost = this._createNode(-1);
    this._ghost.semantics = { ghost: true };

    // 真实根节点（id = 0，路径 "/"），通过边 "/" 从幽灵节点可达
    this._root = this._createNode(0);
    this._connectNodes(this._ghost, "/", this._root);
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
    if (node === this._ghost) return; // 幽灵节点永不清理

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
    let current = this._ghost;

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
    let current = this._ghost;

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
    if (node === this._ghost) return undefined;
    if (node === this._root) return "/";

    // BFS 从真实根找一条到目标节点的路径
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
   * 解析某一路径可见的静态服务上下文
   * @description
   * 沿绝对路径从根节点逐段收集节点声明的 `services`，返回浅合并快照。
   * 不会执行 handler，因此可用于调试和装配时检查。
   * @param {string} [path="/"] - 目标节点路径
   * @returns {DevicesDAGServiceContext} 服务上下文快照
   */
  getServiceContext(path = "/") {
    const absolutePath = resolvePath("/", path);
    const segments = normalizePath(absolutePath);
    let current = this._ghost;
    let mergedServices = {};

    for (const segment of segments) {
      const edge = current.outEdges.get(segment);
      if (!edge) return {};
      current = edge.target;

      if (!isPlainObject(current.services)) continue;
      for (const key of Object.keys(current.services)) {
        if (Object.prototype.hasOwnProperty.call(mergedServices, key)) {
          throw new Error(
            `Service context key "${key}" already exists along path "${absolutePath}".`,
          );
        }
      }
      mergedServices = { ...mergedServices, ...current.services };
    }

    return { ...mergedServices };
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
    // 校验：addEdge 的路径必须是绝对路径
    if (!fromPath.startsWith("/")) {
      throw new Error(
        `addEdge() requires an absolute path for fromPath, got "${fromPath}".`,
      );
    }
    if (toPath && !toPath.startsWith("/")) {
      throw new Error(
        `addEdge() requires an absolute path for toPath, got "${toPath}".`,
      );
    }

    const source = this.getNode(fromPath);
    if (!source) {
      throw new Error(`Source node not found at path "${fromPath}".`);
    }

    const target = toPath
      ? this.ensureNode(toPath)
      : this._createNode(this._allocateNodeId());

    this._checkNoCycle(source, edgeName, target);
    return this._connectNodes(source, edgeName, target);
  }

  /**
   * 检查新增边是否会形成环
   * @description
   * 如果 target 已能经由现有边到达 source，则新增 source→target 会产生环。
   * @param {DevicesDAGNode} source - 源节点
   * @param {string} edgeName - 边名
   * @param {DevicesDAGNode} target - 目标节点
   * @throws {Error} 当新增边会形成环时
   * @private
   */
  _checkNoCycle(source, edgeName, target) {
    if (this._wouldCreateCycle(source, target)) {
      throw new Error(`Edge "${edgeName}" would create a cycle.`);
    }
  }

  /**
   * 判断 target 是否已能到达 source（DFS）
   * @param {DevicesDAGNode} source - 源节点
   * @param {DevicesDAGNode} target - 目标节点
   * @returns {boolean} target 可达 source 则为 true
   * @private
   */
  _wouldCreateCycle(source, target) {
    if (source === target) return true;
    const visited = new Set();
    const stack = [target];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === source) return true;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      for (const edge of node.outEdges.values()) {
        stack.push(edge.target);
      }
    }
    return false;
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
   * @param {DevicesDAGServiceContext|null} [options.services] - 节点声明的静态服务集合
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
    if ("services" in options) {
      node.services = isPlainObject(options.services) ? options.services : {};
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
   * @param {{semantics?: Object, services?: DevicesDAGServiceContext, defaultRoute?: string, umount?: DevicesDAGNodeUmountHandler|null}} [options={}] - 配置选项
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
    if (isPlainObject(options.services)) {
      node.services = {
        ...node.services,
        ...options.services,
      };
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

    node.umount = this._chainToolUmount(node, workflow, processor);

    return node;
  }

  /**
   * 串联 tool 卸载钩子链
   * @description
   * 生成节点的 umount 钩子：依次执行 `processor.dispose`、`tool.umount` 与原卸载钩子。
   * `dispose` / `umount` 的错误记录告警日志后不中断后续钩子执行。
   * @param {DevicesDAGNode} node - 目标节点
   * @param {import("../tools/tool.js").Tool} tool - 工具实例
   * @param {Function} processor - 工具处理器（由 `tool.createProcessor()` 生成）
   * @returns {Function} 卸载钩子
   * @private
   */
  _chainToolUmount(node, tool, processor) {
    const previousUmount = node.umount;
    return (handlerContext) => {
      try {
        processor.dispose?.(handlerContext);
      } catch (error) {
        dagLog.warn(`processor.dispose failed at "${node.path}":`, error);
      }
      try {
        tool.umount?.(handlerContext);
      } catch (error) {
        dagLog.warn(`tool.umount failed at "${node.path}":`, error);
      }
      if (typeof previousUmount === "function") {
        previousUmount(handlerContext);
      }
    };
  }

  /**
   * 挂载结构化子图
   * @param {string} basePath - 挂载基准路径
   * @param {SubDAGDefinition} subDAGDef - 子图定义
   */
  mountSubDAG(basePath, subDAGDef) {
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
      if (fromNode.outEdges.has(edgeDef.name)) continue;
      this._checkNoCycle(fromNode, edgeDef.name, toNode);
      this._connectNodes(fromNode, edgeDef.name, toNode);
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
    if (isPlainObject(def.services)) {
      node.services = { ...node.services, ...def.services };
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

      node.umount = this._chainToolUmount(node, def.tool, processor);
    }
  }

  /**
   * 从根节点开始分发信号包
   * @description
   * 静态服务上下文由路径上的节点 `services` 声明提供。
   * 核心路由逻辑委托给 {@link DevicesDAGNode#dispatch}。
   * @param {SignalPacket|Record<string, any>} packet - 信号包
   * @returns {{ packets: SignalPacket[], services?: Object }} 分发结果
   */
  dispatch(packet) {
    const startPacket = SignalPacket.from(packet, { defaultTo: "" });

    // 校验：dispatch 必须使用从根节点出发的绝对路径
    if (startPacket.to && !startPacket.to.startsWith("/")) {
      throw new Error(
        `dispatch() requires an absolute path starting with "/", got "${startPacket.to}".`,
      );
    }

    let to = startPacket.to || "";

    if (!to) {
      if (this._root.getDefaultRoute()) {
        // 走 ghost→"/"→root 后再走默认出边
        to = "/" + this._root.getDefaultRoute();
      } else {
        return { packets: [startPacket] };
      }
    }

    return this._ghost.dispatch(new SignalPacket(to, startPacket.signals), {
      path: "",
      services: {},
      depth: 0,
      maxDepth: this._maxDispatchDepth,
      strict: this._strict,
      dag: this,
      edgeNotFoundFallback: (pkt) => [new SignalPacket("", pkt.signals)],
    });
  }

  /**
   * 从根节点开始分发信号包并返回路由追踪信息
   * @description
   * 与 {@link DevicesDAG#dispatch} 行为一致，额外收集路由追踪信息。
   * 返回结果中包含 `trace` 数组，可通过 `traceToString()` 格式化。
   * @param {SignalPacket|Record<string, any>} packet - 信号包
   * @returns {{ packets: SignalPacket[], services?: Object, trace: Array }} 分发结果与追踪信息
   */
  dispatchWithTrace(packet) {
    const trace = [];
    const startPacket = SignalPacket.from(packet, { defaultTo: "" });

    if (startPacket.to && !startPacket.to.startsWith("/")) {
      throw new Error(
        `dispatchWithTrace() requires an absolute path starting with "/", got "${startPacket.to}".`,
      );
    }

    let to = startPacket.to || "";

    if (!to) {
      if (this._root.getDefaultRoute()) {
        to = "/" + this._root.getDefaultRoute();
      } else {
        return { packets: [startPacket], trace };
      }
    }

    const result = this._ghost.dispatch(
      new SignalPacket(to, startPacket.signals),
      {
        path: "",
        services: {},
        depth: 0,
        maxDepth: this._maxDispatchDepth,
        strict: this._strict,
        dag: this,
        trace,
        edgeNotFoundFallback: (pkt) => [new SignalPacket("", pkt.signals)],
      },
    );

    return { ...result, trace };
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
   * @param {Record<string, any>} [context={}] - 卸载上下文
   */
  unmountWorkflow(path, context = {}) {
    return this.unmount(path, context);
  }

  /**
   * 卸载指定路径的节点及其出边子图
   * 若目标节点有多个入边，只移除从该路径可达的入边
   * @param {string} path - 节点路径
   * @param {Record<string, any>} [context={}] - 卸载上下文
   */
  unmount(path, context = {}) {
    const node = this.getNode(path);
    if (!node) return false;
    if (node === this._ghost || node === this._root) return false;

    // 找到从幽灵节点到此节点的最后一条边
    const absolutePath = resolvePath("/", path);
    if (absolutePath === "/") return false;

    const segments = normalizePath(absolutePath);
    if (segments.length === 0) return false;

    // 逐段走到目标节点前，断开最后一段边
    let current = this._ghost;
    for (let i = 0; i < segments.length - 1; i++) {
      const edge = current.outEdges.get(segments[i]);
      if (!edge) return false;
      current = edge.target;
    }

    const lastName = segments[segments.length - 1];
    const lastEdge = current.outEdges.get(lastName);
    if (!lastEdge) return false;

    const target = lastEdge.target;

    // 先断开指定路径的最后一条入边，再递归清理因此变成孤立的节点
    this._disconnectEdge(lastEdge);
    this._umountSubgraph(target, context, new Set(), absolutePath);
    return true;
  }

  /**
   * 深度优先执行卸载钩子并清理子图
   * @description
   * 仅清理因入边断开而变成孤立的节点（inEdges.size === 0）。
   * 仍有其他入边的节点（多入边共享节点）保持不动。
   * @param {DevicesDAGNode} root - 子图根节点
   * @param {Record<string, any>} context - 卸载上下文
   * @param {Set<number>} [visited=new Set()] - 已访问节点
   * @param {string} [nodePath=""] - 当前节点的路径（由调用方传入，因断边后 getNodePath 不可用）
   * @private
   */
  _umountSubgraph(root, context = {}, visited = new Set(), nodePath = "") {
    if (!root || visited.has(root.id)) return;
    if (root === this._ghost || root === this._root) return;
    // 仅清理因入边断开而变成孤立的节点；仍有其他入边的节点保持不动
    if (root.inEdges.size > 0) return;

    visited.add(root.id);

    // 先断开出边再递归，使子节点的孤立检测能正确反映边变化
    const outgoingEdges = [...root.outEdges.values()];
    for (const edge of outgoingEdges) {
      const childPath = nodePath ? `${nodePath}/${edge.name}` : `/${edge.name}`;
      this._disconnectEdge(edge);
      this._umountSubgraph(edge.target, context, visited, childPath);
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
        services: { ...context },
        getNodeState: (pathOrId) => this.getNodeState(pathOrId),
        setNodeState: (pathOrId, state) => this.setNodeState(pathOrId, state),
      };
      try {
        root.umount(handlerContext);
      } catch (error) {
        dagLog.warn(`umount hook failed at "${nodePath}":`, error);
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
    root.services = {};
    root.umount = null;
    root._toolInstance = null;
    root.defaultRoute = "";

    // 从全局表中移除
    if (root !== this._ghost) {
      this._nodes.delete(root.id);
    }
  }
}

export { DevicesDAG };
