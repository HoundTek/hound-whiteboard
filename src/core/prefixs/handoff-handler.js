/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubDAG 工厂函数，将 first → second 的两阶段工作流
 * 封装为一张结构化子图。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子图；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubDAGDefinition。
 *
 * 通过统一动作完成事件与少量 creator 提交拦截钩子，
 * 实现非侵入的完成通知与流程控制，不再直接替换工具实例方法。
 * @module core/prefixs/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubDAG, isSubDAGDefinition } from "../devices-dag/index.js";
import { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
import { isPlainObject } from "./utils.js";
import { Tool } from "../tools/tool.js";

/**
 * 克隆 DAG 节点定义，避免共享可变结构
 * @param {Object} nodeDef - 原始节点定义
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
 * 将 source 节点定义合并到 target 节点定义
 * @param {Object} targetNodeDef - 目标节点定义
 * @param {Object} sourceNodeDef - 源节点定义
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
 * 将 DAG 子图定义附着到目标节点上
 * @param {import("../devices-dag/dag.js").SubDAGDefinition} hostSubDAG
 * @param {number} hostNodeId
 * @param {import("../devices-dag/dag.js").SubDAGDefinition} subDAGDef
 * @returns {boolean}
 */
function attachDAGSubDAG(hostSubDAG, hostNodeId, subDAGDef) {
  if (!(subDAGDef?.nodes instanceof Map) || !Array.isArray(subDAGDef?.edges)) {
    return false;
  }

  const sourceRootId = subDAGDef.rootNodeId;
  const sourceRootDef = subDAGDef.nodes.get(sourceRootId) ?? {};
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
  for (const [sourceNodeId, sourceNodeDef] of subDAGDef.nodes) {
    if (sourceNodeId === sourceRootId) continue;
    const mappedNodeId = nextNodeId++;
    idMap.set(sourceNodeId, mappedNodeId);
    hostSubDAG.nodes.set(mappedNodeId, cloneDAGNodeDefinition(sourceNodeDef));
  }

  for (const edge of subDAGDef.edges) {
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
 * 将动作完成结果规整为 handoff 可桥接的对象数组
 * @param {*} result - `action:complete` 事件的结果载荷
 * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
 * @returns {Array<*>}
 */
function normalizeHandoffBridgeObjects(result, context = {}) {
  if (Array.isArray(result)) {
    return result.filter(Boolean);
  }

  if (result != null) {
    return [result].filter(Boolean);
  }

  const contextObjects = context.acc?.objects;
  if (Array.isArray(contextObjects)) {
    return contextObjects.filter(Boolean);
  }
  if (contextObjects != null) {
    return [contextObjects].filter(Boolean);
  }

  return [];
}

/**
 * 丢弃 second 阶段当前持有的活动对象
 * @param {Tool} tool - second 阶段工具实例
 * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
 * @returns {void}
 */
function discardSecondPhaseObjects(tool, context = {}) {
  if (typeof tool?.discardAction === "function") {
    tool.discardAction(context);
    return;
  }

  const cancelState = context.getNodeState?.(context.path) ?? {};
  const cancelObjects = Array.isArray(cancelState?.objects)
    ? cancelState.objects
    : [];
  const boardApi = context.acc?.boardApi;
  const cancelObjectIds = cancelObjects
    .map((objectEntry) =>
      typeof objectEntry?.id === "number" ? objectEntry.id : null,
    )
    .filter((objectId) => objectId != null);

  if (boardApi && cancelObjectIds.length > 0) {
    boardApi.discardActiveObjects(cancelObjectIds);
  }
}

/**
 * 将 tool 包装为基于统一事件的 handoff handler
 * @param {Tool} tool - tool 实例
 * @param {{
 *   bridgeObjects?: boolean,
 *   completeOnCancel?: boolean,
 * }} [options={}] - 包装选项
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler}
 */
function wrapToolForHandoff(tool, options = {}) {
  const { bridgeObjects = false, completeOnCancel = false } = options;
  let processor = null;

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor();
    }

    const onToolComplete = context.acc?.onToolComplete;
    let completed = false;
    const unsubs = [];

    if (typeof tool.on === "function") {
      unsubs.push(
        tool.on("action:complete", (eventContext, result) => {
          completed = true;
          if (bridgeObjects) {
            context.acc?.setHandoffObjects?.(
              normalizeHandoffBridgeObjects(result, eventContext ?? context),
            );
          }
          onToolComplete?.(context);
        }),
      );
    }

    const rawResult = processor(packet, context);

    const hasCancelSignal =
      completeOnCancel &&
      Array.isArray(packet.signals) &&
      packet.signals.some((signal) => signal?.type === "cancel");

    if (hasCancelSignal && !completed) {
      discardSecondPhaseObjects(tool, context);
      completed = true;
      onToolComplete?.(context);
    }

    // 异步 case：延迟清理 subscription，等 Promise resolve 后再移除监听
    if (rawResult instanceof Promise) {
      return rawResult.then((resolvedResult) => {
        for (const unsub of unsubs) {
          unsub?.();
        }
        return resolvedResult;
      });
    }

    // 同步 case：直接清理
    for (const unsub of unsubs) {
      unsub?.();
    }

    return rawResult;
  };
}

/**
 * 为 subDAG 的根节点追加完成通知包装
 * @param {import("../devices-dag/dag.js").SubDAGDefinition} subDAGDef - 原始子图定义
 * @param {Object} [options={}] - 包装选项
 * @param {Function} [options.shouldComplete] - 决定是否发出完成通知，接收 (packet, context)，省略时在收到 "end" 信号后发出
 * @returns {import("../devices-dag/dag.js").SubDAGDefinition} 包装后的子图定义
 */
function wrapSubDAGForHandoff(subDAGDef, options = {}) {
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

    // 将子图写入 acc.objects 的对象桥接到 handoff root 状态
    const objects = context.acc?.objects ?? [];
    context.acc?.setHandoffObjects?.(objects);
    context.acc?.onToolComplete?.();
    return rawResult;
  };

  if (subDAGDef?.nodes instanceof Map) {
    const wrappedNodes = new Map();
    for (const [nodeId, nodeDef] of subDAGDef.nodes) {
      wrappedNodes.set(nodeId, cloneDAGNodeDefinition(nodeDef));
    }

    const rootNodeId = subDAGDef.rootNodeId;
    const rootNodeDef = wrappedNodes.get(rootNodeId) ?? {};
    const wrappedHandler = createWrappedHandler(rootNodeDef.handler);
    wrappedNodes.set(rootNodeId, {
      ...cloneDAGNodeDefinition(rootNodeDef),
      handler: wrappedHandler,
    });
    wrappedNodes.handler = wrappedHandler;

    return {
      ...subDAGDef,
      nodes: wrappedNodes,
      edges: [...(subDAGDef.edges ?? [])],
    };
  }

  const originalHandler = subDAGDef.nodes?.handler;

  const wrappedNodes = {
    ...subDAGDef.nodes,
    handler: createWrappedHandler(originalHandler),
  };

  return { ...subDAGDef, nodes: wrappedNodes };
}

/**
 * 创建 handoff 修饰节点子树
 *
 * @description
 * 生成一棵三层子树：根节点为 multi-tool prefix 状态机，默认将信号路由到 first 子节点；
 * 当 first 完成后切换到 second；当 second 完成后切回 first。
 *
 * 采用统一动作完成事件：
 * - first / second 的 Tool 优先通过 `action:complete` 通知 handoff 切换
 * - first 的 creator 通过注入 `autoCommit: false` 阻止提前进入静态图
 * - second 的 modifier cancel 路径保留显式对象丢弃逻辑
 *
 * @param {{
 *   rootPath?: string,
 *   first: Tool|import("../devices-dag/dag.js").SubDAGDefinition,
 *   second: Tool|import("../devices-dag/dag.js").SubDAGDefinition,
 *   autoBridgeObjects?: boolean,
 * }} options - handoff 子树配置
 * @param {string} [options.rootPath="/handoff"] - 子树根路径
 * @param {Tool|import("../devices-dag/dag.js").SubDAGDefinition} options.first - 第一阶段工具或子图（creator / chooser 等）
 * @param {Tool|import("../devices-dag/dag.js").SubDAGDefinition} options.second - 第二阶段工具或子图（通常为 modifier）
 * @param {boolean} [options.autoBridgeObjects=true] - 是否在 handoff 时自动桥接对象上下文
 * @returns {import("../devices-dag/dag.js").SubDAGDefinition}
 *
 * @example
 *   // creator → modifier（生命周期钩子模式）
 *   createHandoffSubDAG({
 *     first: new StrokeCreatorTool(),
 *     second: new CommonObjectModifierTool(),
 *   });
 *
 * @example
 *   // chooser → modifier
 *   createHandoffSubDAG({
 *     first: new RectangleObjectChooserTool(),
 *     second: new CommonObjectModifierTool(),
 *   });
 */
function createHandoffSubDAG(options = {}) {
  const {
    rootPath = "/handoff",
    first,
    second,
    autoBridgeObjects = true,
  } = options;

  if (!first || !second) {
    throw new TypeError("createHandoffSubDAG requires both first and second.");
  }

  if (isToolInstance(first) && isToolInstance(second) && first === second) {
    throw new TypeError(
      "createHandoffSubDAG: first and second cannot be the same tool instance.",
    );
  }

  // 闭包变量：存储 first 完成时桥接的对象集合
  // 不写入 DAG state，避免污染 nodeState 的形状
  let handoffObjects = [];
  let handoffExplicitlySet = false;

  // 判断 second 类型
  const secondIsModifier =
    isToolInstance(second) && typeof second.applyModifiedObjects === "function";
  const secondIsSubDAG = isSubDAGDefinition(second);

  // 构建子树
  const builder = createSubDAG(rootPath);
  const root = builder
    .node()
    .defaultRoute("first")
    .prefix(
      createMultiToolPrefixHandler({
        defaultChild: "first",
        initialState: { phase: "first" },
        resolveTransition({ signalPacket, state, fromPhase, prefixContext }) {
          // 构建 onToolComplete 回调
          // dagContext 是 first 工具包装器中传入的 DAG 上下文（用于 handoff 同步）
          const createCompleteCallback = (completedPhase) => (dagContext) => {
            if (completedPhase === "first") {
              // 仅当 setHandoffObjects 被显式调用且对象为空时才阻止切换
              //   （如 creator 创建失败无对象场景）
              // 未调用 setHandoffObjects（直接 onToolComplete）时始终切换
              if (handoffExplicitlySet && handoffObjects.length === 0) return;

              // 将桥接对象立即同步到 second 工具的私有字段
              // 不写 node state——process() 执行时会通过 setContextObjects 写入正确的路径
              // 工具内部会调用 requestUiOverlayRefresh 触发 overlay 刷新
              if (handoffObjects.length > 0) {
                const secondTool =
                  typeof second?.receiveHandoffObjects === "function"
                    ? second
                    : null;
                if (secondTool) {
                  secondTool.receiveHandoffObjects(handoffObjects, dagContext);
                }
              }

              prefixContext.setState({
                phase: "second",
                activeChild: "second",
              });
            } else if (completedPhase === "second") {
              prefixContext.setState({
                phase: "first",
                activeChild: "first",
              });

              // 清空闭包中的桥接对象
              handoffObjects = [];
              handoffExplicitlySet = false;

              // 触发 UI overlay 刷新，去除残留的 modifier / chooser 渲染条目
              prefixContext.acc?.viewport?.requestViewportUiRender?.();
            }
          };

          return {
            child: state.activeChild,
            acc: {
              onToolComplete: createCompleteCallback(fromPhase || "first"),
              // 阻止 modifier 在 handoff 中自卸载
              autoUmountOnApply: false,
              // 阻止 creator 在 handoff 中提前 commit
              autoCommit: false,
              // handoff 桥接对象（仅由 createCompleteCallback 在 first 完成时立即同步）
              handoffObjects,
              // first tool 调用此回调将对象写入 handoff 闭包变量
              setHandoffObjects: (objects) => {
                handoffObjects = Array.isArray(objects) ? [...objects] : [];
                handoffExplicitlySet = true;
              },
            },
          };
        },
      }),
      {
        prefixKind: "handoff",
        routePolicy: "state-machine",
      },
    );

  // first 子节点
  const firstNode = builder.node();
  let firstSubDAGDef = null;

  const firstIsSubDAG = isSubDAGDefinition(first);

  if (isToolInstance(first)) {
    firstNode.handler(
      wrapToolForHandoff(first, {
        bridgeObjects: autoBridgeObjects,
      }),
    );
  } else if (firstIsSubDAG) {
    firstSubDAGDef = first;
  } else {
    throw new TypeError(
      "createHandoffSubDAG: first must be a Tool or SubDAGDefinition.",
    );
  }

  // second 子节点
  const secondNode = builder.node();
  let secondSubDAGDef = null;

  if (isToolInstance(second)) {
    secondNode.handler(
      wrapToolForHandoff(second, {
        completeOnCancel: secondIsModifier,
      }),
    );
  } else if (secondIsSubDAG) {
    secondSubDAGDef = second;
  } else {
    throw new TypeError(
      "createHandoffSubDAG: second must be a Tool or SubDAGDefinition.",
    );
  }

  builder.edge("first", root, firstNode);
  builder.edge("second", root, secondNode);

  const handoffSubDAG = builder.build();

  // 附着 SubDAGDefinition
  if (
    firstSubDAGDef &&
    !attachDAGSubDAG(handoffSubDAG, firstNode._localId, firstSubDAGDef)
  ) {
    throw new TypeError(
      "createHandoffSubDAG: first must be a DAG SubDAGDefinition after migration.",
    );
  }
  if (
    secondSubDAGDef &&
    !attachDAGSubDAG(handoffSubDAG, secondNode._localId, secondSubDAGDef)
  ) {
    throw new TypeError(
      "createHandoffSubDAG: second must be a DAG SubDAGDefinition after migration.",
    );
  }

  return handoffSubDAG;
}

export { createHandoffSubDAG, wrapSubDAGForHandoff };
