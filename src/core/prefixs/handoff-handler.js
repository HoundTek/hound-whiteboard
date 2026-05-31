/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubTree 工厂函数，将 first → second 的两阶段工作流
 * 封装为一张结构化子图。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子图；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubDAGDefinition。
 * @module core/prefixs/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../devices/devices-dag.js";
import { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
import { Tool } from "../tools/tool.js";
import { SignalPacket } from "../devices/signal.js";

/**
 * 规整 handler 输出中的继续路由包列表
 * @param {*} rawResult - handler 原始返回值
 * @returns {Array<SignalPacket>}
 */
function normalizeResultPackets(rawResult) {
  if (Array.isArray(rawResult)) {
    return rawResult.map((result) => SignalPacket.from(result));
  }

  if (
    rawResult != null &&
    typeof rawResult === "object" &&
    (Array.isArray(rawResult.packets) ||
      "stop" in rawResult ||
      "redirect" in rawResult ||
      "context" in rawResult)
  ) {
    return SignalPacket.normalizeResult(rawResult.packets ?? []);
  }

  if (rawResult != null) {
    return [SignalPacket.from(rawResult)];
  }

  return [];
}

/**
 * 判断值是否是 SubDAGDefinition
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isSubDAGDefinition(value) {
  return (
    value != null &&
    typeof value === "object" &&
    ((typeof value.rootPath === "string" &&
      value.nodes instanceof Map &&
      Array.isArray(value.edges)) ||
      (typeof value.root === "string" &&
        value.nodes != null &&
        typeof value.nodes === "object"))
  );
}

/**
 * 判断值是否是普通对象
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 规整 wrapper 返回值，同时保留结构化字段。
 * @param {*} rawResult
 * @returns {{packets: SignalPacket[], stop?: boolean, redirect?: string, context?: Object}}
 */
function normalizeWrappedResult(rawResult) {
  if (
    rawResult != null &&
    typeof rawResult === "object" &&
    (Array.isArray(rawResult.packets) ||
      "stop" in rawResult ||
      "redirect" in rawResult ||
      "context" in rawResult)
  ) {
    return {
      ...rawResult,
      packets: SignalPacket.normalizeResult(rawResult.packets ?? []),
    };
  }

  return { packets: normalizeResultPackets(rawResult) };
}

/**
 * 克隆 DAG 节点定义，避免共享可变结构。
 * @param {Object} nodeDef
 * @returns {Object}
 */
function cloneDAGNodeDefinition(nodeDef = {}) {
  return {
    handler: typeof nodeDef.handler === "function" ? nodeDef.handler : null,
    semantics: isPlainObject(nodeDef.semantics) ? { ...nodeDef.semantics } : {},
    defaultRoute:
      typeof nodeDef.defaultRoute === "string" ? nodeDef.defaultRoute : "",
    tool: nodeDef.tool,
    toolContext: isPlainObject(nodeDef.toolContext)
      ? { ...nodeDef.toolContext }
      : {},
    umount: typeof nodeDef.umount === "function" ? nodeDef.umount : null,
  };
}

/**
 * 将 source 节点定义合并到 target 节点定义。
 * @param {Object} targetNodeDef
 * @param {Object} sourceNodeDef
 * @returns {Object}
 */
function mergeDAGNodeDefinition(targetNodeDef = {}, sourceNodeDef = {}) {
  const merged = cloneDAGNodeDefinition(targetNodeDef);

  if (typeof sourceNodeDef.handler === "function") {
    merged.handler = sourceNodeDef.handler;
  }
  if (isPlainObject(sourceNodeDef.semantics)) {
    merged.semantics = { ...merged.semantics, ...sourceNodeDef.semantics };
  }
  if (typeof sourceNodeDef.defaultRoute === "string") {
    merged.defaultRoute = sourceNodeDef.defaultRoute;
  }
  if (sourceNodeDef.tool !== undefined) {
    merged.tool = sourceNodeDef.tool;
    merged.toolContext = isPlainObject(sourceNodeDef.toolContext)
      ? { ...sourceNodeDef.toolContext }
      : {};
  }
  if (typeof sourceNodeDef.umount === "function") {
    merged.umount = sourceNodeDef.umount;
  }

  return merged;
}

/**
 * 将 DAG 子图定义附着到目标节点上。
 * 目标节点复用 source root 的定义，并吸收其下游边与节点。
 * @param {import("../devices/devices-dag.js").SubDAGDefinition} hostSubDAG
 * @param {number} hostNodeId
 * @param {import("../devices/devices-dag.js").SubDAGDefinition} subTreeDef
 * @returns {boolean}
 */
function attachDAGSubTree(hostSubDAG, hostNodeId, subTreeDef) {
  if (
    !(subTreeDef?.nodes instanceof Map) ||
    !Array.isArray(subTreeDef?.edges)
  ) {
    return false;
  }

  const sourceRootId = subTreeDef.rootNodeId;
  const sourceRootDef = subTreeDef.nodes.get(sourceRootId) ?? {};
  const hostRootDef = hostSubDAG.nodes.get(hostNodeId) ?? {};
  hostSubDAG.nodes.set(
    hostNodeId,
    mergeDAGNodeDefinition(hostRootDef, sourceRootDef),
  );

  let nextNodeId = 0;
  for (const nodeId of hostSubDAG.nodes.keys()) {
    if (typeof nodeId === "number" && nodeId >= nextNodeId) {
      nextNodeId = nodeId + 1;
    }
  }

  const idMap = new Map([[sourceRootId, hostNodeId]]);
  for (const [sourceNodeId, sourceNodeDef] of subTreeDef.nodes) {
    if (sourceNodeId === sourceRootId) continue;
    const mappedNodeId = nextNodeId++;
    idMap.set(sourceNodeId, mappedNodeId);
    hostSubDAG.nodes.set(mappedNodeId, cloneDAGNodeDefinition(sourceNodeDef));
  }

  for (const edge of subTreeDef.edges) {
    const fromNodeId = idMap.get(edge.fromNodeId);
    const toNodeId = idMap.get(edge.toNodeId);
    if (fromNodeId == null || toNodeId == null) continue;
    hostSubDAG.edges.push({
      name: edge.name,
      fromNodeId,
      toNodeId,
    });
  }

  return true;
}

/**
 * 判断值是否是 Tool 实例
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isToolInstance(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.createProcessor === "function"
  );
}

/**
 * 将 creator 工具包装为可通知父 prefix 完成信号的 handler
 *
 * @description
 * hook tool.completeCreatedObject()——creator 真正完成创建的唯一语义入口。
 * 通过累积上下文中的 onToolComplete 回调向上通知，不再使用冒泡。
 * @param {import("../tools/tool.js").Tool} tool - creator 工具实例
 * @returns {import("../devices/devices-dag.js").DevicesDAGHandler}
 */
function wrapCreatorForHandoff(tool) {
  let processor = null;
  let completeRequested = false;

  // 替换 completeCreatedObject，拦截完成信号但不调用原始实现
  // handoff 工作流中由 createHandoffSubTree 的 autoBridgeObjects 负责
  // 将对象从 creator 节点状态桥接到 modifier 节点状态
  tool.completeCreatedObject = function (interaction) {
    tool.syncCreatedObjectContext?.(interaction?.deviceContext, tool.obj);
    if (
      Object.prototype.hasOwnProperty.call(tool, "isObjectCreationCompleted")
    ) {
      tool.isObjectCreationCompleted = true;
    }
    completeRequested = true;
    return undefined;
  };

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor({
        board: context.context?.board,
        monitor: context.context?.monitor,
      });
    }

    completeRequested = false;
    const rawResult = processor(packet, context);

    if (completeRequested) {
      // 通过累积上下文中的回调向上通知，不再使用 to: ".."
      context.context?.onToolComplete?.();

      return normalizeWrappedResult(rawResult);
    }

    return rawResult;
  };
}

/**
 * 将 first 阶段工具（creator 或 chooser）包装为可通知父 prefix 完成信号的 handler
 *
 * @description
 * 自动检测工具类型：
 * - 若工具包含 completeCreatedObject（creator），hook 其完成回调
 * - 否则退化为信号检测模式：收到 "end" 信号后调用 onToolComplete 回调
 *
 * 向上通信通过累积上下文中的 onToolComplete 回调，不再使用冒泡。
 * @param {Tool} tool - first 阶段工具实例（creator / chooser）
 * @returns {import("../devices/devices-dag.js").DevicesDAGHandler}
 */
function wrapFirstForHandoff(tool) {
  // Creator 路径：精确 hook completeCreatedObject
  if (typeof tool.completeCreatedObject === "function") {
    return wrapCreatorForHandoff(tool);
  }

  // Chooser / 通用路径：end 信号触发
  let processor = null;

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor({
        board: context.context?.board,
        monitor: context.context?.monitor,
      });
    }

    const rawResult = processor(packet, context);
    const sigs = packet?.signals ?? [];
    const hasEnd = Array.isArray(sigs) && sigs.some((s) => s?.type === "end");

    if (!hasEnd) {
      return rawResult;
    }

    // 仅当确实有选中对象时才触发 handoff
    const nodePath = context.path ?? "";
    const nodeState = context.getNodeState?.(nodePath);
    const objects = nodeState?.objects ?? [];
    if (objects.length === 0) {
      return rawResult;
    }

    // 通过回调通知父 prefix，不再使用 to: ".."
    context.context?.onToolComplete?.();

    return normalizeWrappedResult(rawResult);
  };
}

/**
 * 将 second 阶段工具包装为由 handoff 统一协调的完成通知 handler。
 *
 * @description
 * second 通常是 modifier。它本体只负责提交对象，不直接感知 onToolComplete。
 * handoff wrapper 会 hook 语义完成入口（例如 applyModifiedObjects），在真正提交成功后
 * 触发父 prefix 的 onToolComplete 回调，并在 handoff 工作流中关闭 auto unmount。
 * @param {Tool} tool - second 阶段工具实例
 * @returns {import("../devices/devices-dag.js").DevicesDAGHandler}
 */
function wrapSecondForHandoff(tool) {
  let processor = null;
  let completeRequested = false;

  if (typeof tool.applyModifiedObjects === "function") {
    const originalApplyModifiedObjects = tool.applyModifiedObjects.bind(tool);
    tool.applyModifiedObjects = function (modificationContext, objects) {
      const applied = originalApplyModifiedObjects(
        {
          ...modificationContext,
          autoUmountOnApply: false,
        },
        objects,
      );

      if (applied) {
        completeRequested = true;
      }

      return applied;
    };
  }

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor({
        board: context.context?.board,
        monitor: context.context?.monitor,
      });
    }

    completeRequested = false;
    let completionAlreadyNotified = false;
    const originalOnToolComplete = context.context?.onToolComplete;
    const wrappedContext = {
      ...context,
      context: {
        ...(context.context ?? {}),
        onToolComplete() {
          completionAlreadyNotified = true;
          return originalOnToolComplete?.();
        },
      },
    };

    const rawResult = processor(packet, wrappedContext);

    if (completeRequested && !completionAlreadyNotified) {
      originalOnToolComplete?.();
      return normalizeWrappedResult(rawResult);
    }

    return rawResult;
  };
}

/**
 * 为 subTree 的根节点追加完成通知包装
 * @param {import("../devices/devices-dag.js").SubDAGDefinition} subTreeDef - 原始子图定义
 * @param {Object} [options={}] - 包装选项
 * @param {Function} [options.shouldComplete] - 决定是否发出完成通知，接收 (packet, context)，省略时在收到 "end" 信号后发出
 * @returns {import("../devices/devices-dag.js").SubDAGDefinition} 包装后的子图定义
 */
function wrapSubTreeForHandoff(subTreeDef, options = {}) {
  const { shouldComplete } = options;
  const createWrappedHandler = (originalHandler) => (packet, context) => {
    const rawResult =
      typeof originalHandler === "function"
        ? originalHandler(packet, context)
        : null;
    const should = shouldComplete
      ? shouldComplete(packet, context)
      : packet.signals?.some((s) => s?.type === "end");

    if (!should) return rawResult;

    context.context?.onToolComplete?.();
    return normalizeWrappedResult(rawResult);
  };

  if (subTreeDef?.nodes instanceof Map) {
    const wrappedNodes = new Map();
    for (const [nodeId, nodeDef] of subTreeDef.nodes) {
      wrappedNodes.set(nodeId, cloneDAGNodeDefinition(nodeDef));
    }

    const rootNodeId = subTreeDef.rootNodeId;
    const rootNodeDef = wrappedNodes.get(rootNodeId) ?? {};
    const wrappedHandler = createWrappedHandler(rootNodeDef.handler);
    wrappedNodes.set(rootNodeId, {
      ...cloneDAGNodeDefinition(rootNodeDef),
      handler: wrappedHandler,
    });
    wrappedNodes.handler = wrappedHandler;

    return {
      ...subTreeDef,
      nodes: wrappedNodes,
      edges: [...(subTreeDef.edges ?? [])],
    };
  }

  const originalHandler = subTreeDef.nodes?.handler;

  const wrappedNodes = {
    ...subTreeDef.nodes,
    handler: createWrappedHandler(originalHandler),
  };

  return { ...subTreeDef, nodes: wrappedNodes };
}

/**
 * 创建 handoff 修饰节点子树
 * @description
 * 生成一棵三层子树：根节点为 multi-tool prefix 状态机，默认将信号路由到 first 子节点；
 * 当 first 通过 onToolComplete 回调通知完成时切换到 second；
 * 当 second 通过 onToolComplete 回调通知完成时切回 first，开始新周期。
 *
 * 完成通知通过累积上下文中的回调实现，不再使用冒泡信号。 * @param {{
 *   rootPath?: string,
 *   first: Tool|import("../devices/devices-dag.js").SubDAGDefinition,
 *   second: Tool|import("../devices/devices-dag.js").SubDAGDefinition,
 *   autoBridgeObjects?: boolean,
 * }} options - handoff 子树配置
 * @param {string} [options.rootPath="/handoff"] - 子树根路径
 * @param {Tool|import("../devices/devices-dag.js").SubDAGDefinition} options.first - 第一阶段工具或子图（creator / chooser 等）
 * @param {Tool|import("../devices/devices-dag.js").SubDAGDefinition} options.second - 第二阶段工具或子图（通常为 modifier）
 * @param {boolean} [options.autoBridgeObjects=true] - 是否在 handoff 时自动桥接对象上下文
 * @returns {import("../devices/devices-dag.js").SubDAGDefinition}
 *
 * @example
 *   // creator → modifier
 *   createHandoffSubTree({
 *     first: new StrokeCreatorTool(),
 *     second: new CommonObjectModifierTool(),
 *   });
 *
 * @example
 *   // chooser → modifier
 *   createHandoffSubTree({
 *     first: new RectangleObjectChooserTool(),
 *     second: new CommonObjectModifierTool(),
 *   });
 *
 * @example
 *   // SubDAGDefinition + wrapSubTreeForHandoff
 *   const circle = createRandomCircleSubTree({ rootPath: "/chain" });
 *   createHandoffSubTree({
 *     first: wrapSubTreeForHandoff(circle),
 *     second: new CommonObjectModifierTool(),
 *   });
 */
function createHandoffSubTree(options = {}) {
  const {
    rootPath = "/handoff",
    first,
    second,
    autoBridgeObjects = true,
  } = options;

  if (!first || !second) {
    throw new TypeError("createHandoffSubTree requires both first and second.");
  }

  // 保存 handoff 根节点路径用于状态桥接
  let handoffBasePath = "";

  const builder = createSubDAG(rootPath);
  const root = builder
    .node()
    .defaultRoute("first")
    .prefix(
      createMultiToolPrefixHandler({
        defaultChild: "first",
        initialState: { phase: "first" },
        resolveTransition({ signalPacket, state, fromPhase, prefixContext }) {
          // 捕获 handoff 根路径（首次路由时）
          if (!handoffBasePath) {
            handoffBasePath = prefixContext.path ?? "";
          }

          // 构建 onToolComplete 回调：被 first 或 second 调用时触发状态切换
          const createCompleteCallback = (completedPhase) => () => {
            if (autoBridgeObjects && completedPhase === "first") {
              const dag = prefixContext.ddag;
              const firstState = dag?.getNodeState?.(
                `${handoffBasePath}/first`,
              );
              const objects = firstState?.objects ?? [];
              if (objects.length > 0) {
                dag?.setNodeState?.(`${handoffBasePath}/second`, { objects });
              }
            }

            if (completedPhase === "first") {
              prefixContext.setState({
                phase: "second",
                activeChild: "second",
              });
            } else if (completedPhase === "second") {
              prefixContext.setState({
                phase: "first",
                activeChild: "first",
              });
            }
          };

          return {
            child: state.activeChild,
            // 注入回调到上下文，供子节点调用以向上通知
            context: {
              onToolComplete: createCompleteCallback(fromPhase || "first"),
            },
          };
        },
      }),
      {
        prefixKind: "handoff",
        routePolicy: "state-machine",
      },
    );

  // ── first 子节点 ──
  const firstNode = builder.node();
  let firstSubDAGDef = null;
  if (isToolInstance(first)) {
    firstNode.handler(wrapFirstForHandoff(first));
  } else if (isSubDAGDefinition(first)) {
    firstSubDAGDef = first;
  } else {
    throw new TypeError(
      "createHandoffSubTree: first must be a Tool or SubDAGDefinition.",
    );
  }

  // ── second 子节点 ──
  const secondNode = builder.node();
  let secondSubDAGDef = null;
  if (isToolInstance(second)) {
    secondNode.handler(wrapSecondForHandoff(second));
  } else if (isSubDAGDefinition(second)) {
    secondSubDAGDef = second;
  } else {
    throw new TypeError(
      "createHandoffSubTree: second must be a Tool or SubDAGDefinition.",
    );
  }

  builder.edge("first", root, firstNode);
  builder.edge("second", root, secondNode);

  const handoffSubTree = builder.build();
  if (
    firstSubDAGDef &&
    !attachDAGSubTree(handoffSubTree, firstNode._localId, firstSubDAGDef)
  ) {
    throw new TypeError(
      "createHandoffSubTree: first must be a DAG SubDAGDefinition after migration.",
    );
  }
  if (
    secondSubDAGDef &&
    !attachDAGSubTree(handoffSubTree, secondNode._localId, secondSubDAGDef)
  ) {
    throw new TypeError(
      "createHandoffSubTree: second must be a DAG SubDAGDefinition after migration.",
    );
  }

  return handoffSubTree;
}

export {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
};
