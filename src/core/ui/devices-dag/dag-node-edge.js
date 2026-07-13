/**
 * @file DAG 节点与有向边
 * @description
 * 设备图中的基础数据结构：处理节点（DevicesDAGNode）和有向边（DevicesDAGEdge）。
 *
 * DevicesDAGNode 是图中的信号处理单元，持有处理器、语义元数据、
 * 可变状态和入边/出边集合。节点自带递归路由能力（{@link DevicesDAGNode#dispatch}），
 * 可独立于 {@link DevicesDAG} 完成信号分发。
 *
 * DevicesDAGEdge 连接两个节点，边名在源节点下唯一。
 * @module core/ui/devices-dag/dag-node-edge
 * @author Zhou Chenyu
 */

import { isPlainObject, normalizeHandlerResult } from "./dag-utils.js";
import { SignalPacket } from "./signal.js";
import { normalizePath, joinPath } from "../../utils/path.js";

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

  /**
   * 从子图定义创建独立的节点图（不挂载到 DAG）
   * @description
   * 对照 {@link DevicesDAG#mountSubDAG}，但创建的是脱离 DAG 的独立节点图。
   * 每次调用都创建全新节点实例，适合 per-touch 子图等需要多份独立副本的场景。
   *
   * 节点的 tool 通过 `createProcessor()` 转为 handler，不注册到全局 tool 表。
   *
   * @param {import("./dag.js").SubDAGDefinition} subDAGDef - 子图定义
   * @returns {DevicesDAGNode} 根入口节点
   */
  static createGraph(subDAGDef) {
    if (!subDAGDef || typeof subDAGDef !== "object") {
      return new DevicesDAGNode(0);
    }

    const { rootNodeId = 0, nodes, edges = [] } = subDAGDef;

    /** @type {Map<number, DevicesDAGNode>} */
    const idMap = new Map();

    // 1. 创建节点
    if (nodes) {
      for (const [localId, nodeDef] of nodes) {
        const node = new DevicesDAGNode(localId);

        if (nodeDef.handler != null) {
          node.handler =
            typeof nodeDef.handler === "function" ? nodeDef.handler : null;
        }
        if (isPlainObject(nodeDef.semantics)) {
          node.semantics = { ...nodeDef.semantics };
        }
        if (nodeDef.tool != null && typeof nodeDef.tool === "object") {
          if (nodeDef.tool.createProcessor) {
            node.handler = nodeDef.tool.createProcessor();
            node.semantics = { ...node.semantics, tool: true };
          }
        }
        if (nodeDef.toolContext) {
          node.semantics = {
            ...node.semantics,
            toolContext: nodeDef.toolContext,
          };
        }
        if (nodeDef.defaultRoute != null) {
          node.defaultRoute = nodeDef.defaultRoute;
        }
        if (typeof nodeDef.umount === "function") {
          node.umount = nodeDef.umount;
        }

        idMap.set(localId, node);
      }
    }

    // 2. 连接边
    for (const edgeDef of edges) {
      const fromNode = idMap.get(edgeDef.fromNodeId);
      const toNode = idMap.get(edgeDef.toNodeId);
      if (!fromNode || !toNode) continue;
      const edge = new DevicesDAGEdge(edgeDef.name, fromNode, toNode);
      fromNode.outEdges.set(edgeDef.name, edge);
      toNode.inEdges.add(edge);
    }

    return idMap.get(rootNodeId) ?? new DevicesDAGNode(0);
  }

  /**
   * 在此节点处理信号包并递归路由到子节点
   * @description
   * 这是设备图的核心路由引擎，原 `DevicesDAG._walkSegments` 的功能。
   *
   * 流程：
   * 1. 构造 handlerContext 并调用 `this.handler`
   * 2. 归一化结果，累积上下文（禁止覆盖已有键）
   * 3. 处理 `stop` / `explicitPackets` / `redirect`
   * 4. 根据 `result.to` / `defaultRoute` / 剩余路径确定下一跳
   * 5. 沿 `outEdges` 递归调用 `child.dispatch()`
   * 6. 额外信号包通过 `_routeFrom()` 延迟分发
   *
   * 无 handler 的节点（如 ghost）直接透传信号到子节点。
   *
   * @param {SignalPacket|Object} packet - 输入信号包
   * @param {Object} [options={}] - 路由选项
   * @param {string} [options.path=""] - 当前节点的路径
   * @param {Object} [options.acc={}] - 累积上下文
   * @param {number} [options.depth=0] - 当前递归深度
   * @param {number} [options.maxDepth=32] - 最大递归深度
   * @param {Object|null} [options.dag=null] - 所属 DAG 实例（用于跨节点状态管理）
   * @param {boolean} [options.strict=false] - strict 模式下 handler 报错直接抛出
   * @param {(packet: SignalPacket) => SignalPacket[]} [options.edgeNotFoundFallback] - 边不存在时的回退
   * @param {string[]|null} [options.remainingSegments=null] - 剩余路径段（用于边查找，独立于 packet.to）
   * @returns {{ packets: SignalPacket[], acc?: Object }} 分发结果
   */
  dispatch(packet, options = {}) {
    const {
      path = this.path ?? "",
      acc = {},
      depth = 0,
      maxDepth = 32,
      dag = null,
      strict = false,
      edgeNotFoundFallback = null,
      remainingSegments = null,
    } = options;

    const pkt = SignalPacket.from(packet);

    // 剩余路径段用于边查找，与 handler 接收的 packet.to 解耦
    let routeSegments =
      remainingSegments ?? normalizePath(pkt.to || "");
    // currentPacket 是 handler 接收的包，仅在 handler 返回路由结果时更新
    let currentPacket = pkt;

    // 1. 构造 handlerContext 并调用 handler
    const handler = this.getHandler?.() ?? this.handler;
    let rawResult;
    if (typeof handler === "function") {
      const handlerContext = this._buildHandlerContext(pkt, {
        path,
        acc,
        depth,
        dag,
      });
      try {
        rawResult = handler(pkt, handlerContext);
      } catch (error) {
        if (strict) throw error;
        console.error(
          `[DevicesDAGNode] handler error at "${path}":`,
          error,
        );
        rawResult = undefined;
      }
      if (rawResult instanceof Promise) {
        if (strict) {
          throw new Error(
            `[DevicesDAGNode] async handler is not supported at "${path}". DAG handlers must be synchronous.`,
          );
        }
        console.warn(
          `[DevicesDAGNode] async handler at "${path}" was ignored. DAG handlers must be synchronous.`,
        );
        rawResult = undefined;
      }
    }

    // 2. 归一化结果
    const result =
      typeof handler === "function"
        ? normalizeHandlerResult(rawResult)
        : { packets: [new SignalPacket("", pkt.signals)], explicitPackets: false };

    // 3. 累积上下文（禁止覆盖已有键）
    let mergedAcc = { ...acc };
    let contextChanged = false;
    if (result.acc && isPlainObject(result.acc)) {
      for (const key of Object.keys(result.acc)) {
        if (Object.prototype.hasOwnProperty.call(mergedAcc, key)) {
          throw new Error(
            `Context key "${key}" already exists in accumulated context. Cannot override.`,
          );
        }
      }
      mergedAcc = { ...mergedAcc, ...result.acc };
      contextChanged = true;
    }

    const contextAcc = contextChanged ? mergedAcc : undefined;

    // 4. stop：终止当前链路
    if (result.stop) {
      return { packets: result.packets, acc: contextAcc };
    }

    // 5. explicitPackets 且空 → 终止
    if (result.explicitPackets && result.packets.length === 0) {
      return { packets: [], acc: contextAcc };
    }

    // 6. 确定路由段
    const finalPackets = [];
    const deferredPackets = [];

    // redirect：覆盖后续路径段
    if (result.redirect) {
      if (result.redirect.startsWith("/")) {
        throw new Error(
          `Handler at "${path}" returned an absolute redirect "${result.redirect}". Redirect must be a relative path.`,
        );
      }
      routeSegments = normalizePath(result.redirect);
    }

    if (result.packets.length > 0) {
      const primaryPacket = SignalPacket.from(result.packets[0]);

      // 额外信号包 → 延迟路由队列
      for (const extraPkt of result.packets.slice(1)) {
        const p = SignalPacket.from(extraPkt);
        if (p.to) {
          if (p.to.startsWith("/")) {
            throw new Error(
              `Handler at "${path}" returned an extra packet with absolute path "${p.to}". Extra packet "to" must be a relative path.`,
            );
          }
          deferredPackets.push(p);
        }
      }

      if (primaryPacket.to) {
        if (primaryPacket.to.startsWith("/")) {
          throw new Error(
            `Handler at "${path}" returned an absolute path "${primaryPacket.to}". Handler "to" must be a relative path.`,
          );
        }
        routeSegments = normalizePath(primaryPacket.to);
        currentPacket = primaryPacket;
      } else if (this.defaultRoute) {
        routeSegments = normalizePath(this.defaultRoute);
        currentPacket = primaryPacket;
      } else if (routeSegments.length === 0) {
        // 路径终点 → 收入最终结果
        finalPackets.push(primaryPacket);
      }
      // else: 无路由指定且仍有剩余路径段 → 保留原信号继续走
    } else if (!result.explicitPackets) {
      // 无 packets，非 explicit → 继续沿路径或默认出边
      if (routeSegments.length === 0 && this.defaultRoute) {
        routeSegments = normalizePath(this.defaultRoute);
      }
    }

    // 7. 路由主包到子节点（优先于延迟路由，与原 _walkSegments 行为一致）
    const deferredResults = [];

    /**
     * 处理延迟路由队列
     */
    const flushDeferredRoutes = () => {
      for (const deferredPkt of deferredPackets) {
        const subResult = this._routeFrom(deferredPkt, {
          path,
          acc: mergedAcc,
          depth: depth + 1,
          maxDepth,
          dag,
          strict,
        });
        if (subResult.packets.length > 0) {
          deferredResults.push(...subResult.packets);
        }
      }
    };

    if (routeSegments.length === 0) {
      flushDeferredRoutes();
      return { packets: [...finalPackets, ...deferredResults], acc: contextAcc };
    }

    const firstSegment = routeSegments[0];
    const edge = this.outEdges.get(firstSegment);

    if (!edge) {
      flushDeferredRoutes();
      const allCollected = [...finalPackets, ...deferredResults];
      if (allCollected.length > 0) {
        return { packets: allCollected, acc: contextAcc };
      }
      const fallback = edgeNotFoundFallback
        ? edgeNotFoundFallback(currentPacket)
        : [];
      return { packets: fallback, acc: contextAcc };
    }

    const child = edge.target;
    const childPath = joinPath(path, firstSegment);
    const childRemaining = routeSegments.slice(1);

    // 深度检测
    const nextDepth = depth + 1;
    if (nextDepth > maxDepth) {
      throw new Error(
        `Dispatch depth exceeded (${maxDepth}). Possible cycle detected.`,
      );
    }

    // 先走主路
    const childResult = child.dispatch(currentPacket, {
      path: childPath,
      acc: mergedAcc,
      depth: nextDepth,
      maxDepth,
      dag,
      strict,
      edgeNotFoundFallback,
      remainingSegments: childRemaining,
    });

    // 8. 延迟路由（额外信号包），在主路完成后处理
    flushDeferredRoutes();

    return {
      packets: [...finalPackets, ...childResult.packets, ...deferredResults],
      acc: childResult.acc || contextAcc,
    };
  }

  /**
   * 从此节点路由信号包（不处理本节点 handler）
   * @description
   * 用于延迟路由：从指定节点出发，沿边走到子节点并递归 dispatch。
   * 不调用本节点的 handler，仅做边查找与子节点递归。
   * @param {SignalPacket} packet - 信号包
   * @param {Object} options - 路由选项（同 {@link DevicesDAGNode#dispatch}）
   * @returns {{ packets: SignalPacket[], acc?: Object }}
   * @private
   */
  _routeFrom(packet, options = {}) {
    const {
      path = this.path ?? "",
      acc = {},
      depth = 0,
      maxDepth = 32,
      dag = null,
      strict = false,
    } = options;

    const segments = normalizePath(packet.to || "");

    if (segments.length === 0) {
      if (this.defaultRoute) {
        return this._routeFrom(
          new SignalPacket(this.defaultRoute, packet.signals),
          { ...options, depth },
        );
      }
      return { packets: [], acc };
    }

    const firstSegment = segments[0];
    const edge = this.outEdges.get(firstSegment);
    if (!edge) {
      return { packets: [], acc };
    }

    const child = edge.target;
    const childPath = joinPath(path, firstSegment);
    const childRemaining = segments.slice(1);

    const nextDepth = depth + 1;
    if (nextDepth > maxDepth) {
      throw new Error(
        `Dispatch depth exceeded (${maxDepth}). Possible cycle detected.`,
      );
    }

    return child.dispatch(packet, {
      path: childPath,
      acc,
      depth: nextDepth,
      maxDepth,
      dag,
      strict,
      remainingSegments: childRemaining,
    });
  }

  /**
   * 构造 handler 上下文
   * @description
   * 当 `dag` 为 null 时（如独立子图场景），状态管理退化为仅读写本节点的 `state`。
   * @param {SignalPacket} packet - 当前信号包
   * @param {Object} opts - 上下文构建选项
   * @param {string} opts.path - 节点路径
   * @param {Object} opts.acc - 累积上下文
   * @param {number} opts.depth - 递归深度
   * @param {Object|null} opts.dag - DAG 实例
   * @returns {Object}
   * @private
   */
  _buildHandlerContext(packet, { path, acc, depth, dag }) {
    const defaultRoute = this.defaultRoute ?? "";
    const resolvedDefaultRoutePath = defaultRoute
      ? joinPath(path, defaultRoute)
      : path;

    const isSelf = (pathOrId) =>
      pathOrId === path || pathOrId === this.id;

    const readNodeState = () => {
      if (dag) return dag.getNodeState(path);
      return { ...this.state };
    };

    return {
      node: this,
      dag,
      path,
      semantics: { ...this.semantics },
      defaultRoute,
      resolvedDefaultRoutePath,
      depth,
      signalPacket: packet,
      acc: { ...acc },
      state: readNodeState(),
      getState: readNodeState,
      setState: (nextState) => {
        if (dag) return dag.setNodeState(path, nextState);
        this.state = isPlainObject(nextState) ? { ...nextState } : {};
        return { ...this.state };
      },
      patchState(partial = {}) {
        const current = readNodeState();
        const next = isPlainObject(partial)
          ? { ...current, ...partial }
          : current;
        if (dag) return dag.setNodeState(path, next);
        this.state = next;
        return { ...this.state };
      },
      getNodeState: (pathOrId = path) => {
        if (dag) return dag.getNodeState(pathOrId);
        return isSelf(pathOrId) ? { ...this.state } : {};
      },
      setNodeState: (pathOrId = path, state) => {
        if (dag) return dag.setNodeState(pathOrId, state);
        if (isSelf(pathOrId)) {
          this.state = isPlainObject(state) ? { ...state } : {};
          return { ...this.state };
        }
        return {};
      },
      delNodeState(pathOrId = path, ...keys) {
        if (dag) {
          const current = dag.getNodeState(pathOrId);
          for (const key of keys) delete current[key];
          dag.setNodeState(pathOrId, current);
        } else if (isSelf(pathOrId)) {
          for (const key of keys) delete this.state[key];
        }
      },
      routeToChild(to, signals = packet?.signals) {
        return { packets: [new SignalPacket(to, signals)] };
      },
      stop() {
        return { packets: [] };
      },
      signal(type, value, extra) {
        const base = isPlainObject(extra) ? { ...extra } : {};
        if (value !== undefined) base.value = value;
        return { type, context: base };
      },
    };
  }
}

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
