/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubDAG 工厂函数，将 first → second 的两阶段工作流
 * 封装为一张结构化子图。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子图；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubDAGDefinition。
 *
 * 通过生命周期钩子（beforeCommit / afterCreate / afterApply）
 * 实现非侵入的完成通知与流程控制，不再直接替换工具实例方法。
 * @module core/prefixs/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubDAG, isSubDAGDefinition } from "../devices-dag/index.js";
import { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
import { isPlainObject } from "./utils.js";
import { Tool } from "../tools/tool.js";
import { SignalPacket } from "../devices-dag/signal.js";

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
 * 规整 wrapper 返回值，同时保留结构化字段（packets、stop、redirect、context）
 * @param {*} rawResult - wrapper 原始返回值
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
 * 规整 tool handler 返回值，并在异步完成后安全释放生命周期订阅
 * @param {*} rawResult - tool handler 原始返回值
 * @param {() => boolean} isCompleted - 当前分发期间是否已触发完成通知
 * @param {Function|null} unsub - 生命周期订阅取消函数
 * @returns {*}
 */
function finalizeLifecycleWrappedResult(rawResult, isCompleted, unsub) {
  if (rawResult instanceof Promise) {
    return rawResult
      .then((resolvedResult) => {
        if (isCompleted()) {
          return normalizeWrappedResult(resolvedResult);
        }
        return resolvedResult;
      })
      .finally(() => {
        unsub?.();
      });
  }

  unsub?.();

  if (isCompleted()) {
    return normalizeWrappedResult(rawResult);
  }

  return rawResult;
}

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
 * 已注册到 handoff 的 tool 实例集合
 * 使用 WeakSet 避免内存泄漏，tool 被 GC 后自动清理。
 * @type {WeakSet<object>}
 */
const registeredHandoffTools = new WeakSet();

/**
 * 将 tool 标记为已参与某个 handoff 工作流
 * @param {Tool} tool - 待注册的工具实例
 * @throws {TypeError} 如果 tool 已在另一个 handoff 中
 */
function registerHandoffTool(tool) {
  if (registeredHandoffTools.has(tool)) {
    throw new TypeError(
      "Tool instance has already been registered in a handoff workflow. " +
        "Each tool instance can only participate in one handoff workflow.",
    );
  }
  registeredHandoffTools.add(tool);
}

/**
 * 将 chooser 工具包装为可通知父 prefix 完成信号的 handler
 *
 * @description
 * chooser 通过 confirmSelection → afterConfirmSelection 钩子宣告完成。
 * handler 在每次分发时临时订阅 afterConfirm，触发后桥接到 onToolComplete。
 * @param {Tool} tool - chooser 工具实例
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler}
 */
function wrapChooserForHandoff(tool) {
  let processor = null;

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor();
    }

    const onToolComplete = context.acc?.onToolComplete;
    let completed = false;

    const unsub =
      typeof tool.on === "function"
        ? tool.on("afterConfirm", (_ctx, objects) => {
            completed = true;
            // 优先取事件参数 objects（mock chooser 提供），fallback acc.objects
            context.acc?.setHandoffObjects?.(
              objects ?? context.acc?.objects ?? [],
            );
            onToolComplete?.();
          })
        : null;

    const rawResult = processor(packet, context);
    return finalizeLifecycleWrappedResult(rawResult, () => completed, unsub);
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
    return normalizeWrappedResult(rawResult);
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
 * 采用生命周期钩子：
 * - creator 的 first：override `beforeCommitCreatedObject → false`，订阅 `afterCreate`
 * - modifier 的 second：订阅 `afterApply`，通过 context 注入 `autoUmountOnApply: false`
 * - chooser 的 first：使用 end 信号 + 对象检测
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

  // 注册 tool 实例，防止同一实例参与多个 handoff
  if (isToolInstance(first)) registerHandoffTool(first);
  if (isToolInstance(second)) registerHandoffTool(second);

  // 保存 handoff 根节点路径用于状态桥接
  let handoffBasePath = "";

  // 闭包变量：存储 first 完成时桥接的对象集合
  // 不写入 DAG state，避免污染 nodeState 的形状
  let handoffObjects = [];
  let handoffExplicitlySet = false;

  // 判断 first 类型
  const firstIsCreator =
    isToolInstance(first) && typeof first.completeCreatedObject === "function";
  const firstIsChooser = isToolInstance(first) && !firstIsCreator;
  const firstIsSubDAG = isSubDAGDefinition(first);

  // 判断 second 类型
  const secondIsModifier =
    isToolInstance(second) && typeof second.applyModifiedObjects === "function";
  const secondIsSubDAG = isSubDAGDefinition(second);

  // 为 creator-first 配置钩子
  /** @type {Function[]} */
  const handoffCleanups = [];

  if (firstIsCreator) {
    // 保存原始 beforeCommit，准备 override
    const originalBeforeCommit = first.beforeCommitCreatedObject?.bind(first);

    // 阻止 creator 将对象提交到静态图（由 modifier 最终提交）
    first.beforeCommitCreatedObject = () => false;

    handoffCleanups.push(() => {
      if (originalBeforeCommit) {
        first.beforeCommitCreatedObject = originalBeforeCommit;
      } else {
        delete first.beforeCommitCreatedObject;
      }
    });
  }

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
          // 捕获 handoff 根路径（首次路由时）
          if (!handoffBasePath) {
            handoffBasePath = prefixContext.path ?? "";
          }

          // 构建 onToolComplete 回调
          const createCompleteCallback = (completedPhase) => () => {
            if (completedPhase === "first") {
              // 仅当 setHandoffObjects 被显式调用且对象为空时才阻止切换
              //   （如 creator 创建失败无对象场景）
              // 未调用 setHandoffObjects（直接 onToolComplete）时始终切换
              if (handoffExplicitlySet && handoffObjects.length === 0) return;

              prefixContext.setState({
                phase: "second",
                activeChild: "second",
              });
            } else if (completedPhase === "second") {
              // 清理 first / second 节点内的旧对象引用，防止 overlay 继续渲染旧选择框
              // 使用 delNodeState 而非设为 []，避免 resolveContextObjects 读到 truthy 空数组
              if (handoffBasePath) {
                prefixContext.delNodeState?.(
                  `${handoffBasePath}/first`,
                  "objects",
                );
                prefixContext.delNodeState?.(
                  `${handoffBasePath}/second`,
                  "objects",
                );
              }

              prefixContext.setState({
                phase: "first",
                activeChild: "first",
              });

              // 清空闭包中的桥接对象
              handoffObjects = [];
              handoffExplicitlySet = false;

              // 触发 UI overlay 刷新，去除残留的 modifier / chooser 渲染条目
              prefixContext.acc?.monitor?.requestViewportUiRender?.();
            }
          };

          return {
            child: state.activeChild,
            acc: {
              onToolComplete: createCompleteCallback(fromPhase || "first"),
              // 阻止 modifier 在 handoff 中自卸载
              autoUmountOnApply: false,
              // 当前阶段持有的对象，供 modifier 直接从 acc 读取
              objects: handoffObjects,
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

  if (firstIsCreator) {
    // Creator 路径：handler 桥接 afterCreate 钩子 → onToolComplete 回调
    let creatorProcessor = null;
    firstNode.handler((packet, context = {}) => {
      const onToolComplete = context.acc?.onToolComplete;
      let completed = false;

      // 临时订阅 afterCreate：工具触发时桥接到 onToolComplete
      const unsub =
        typeof first.on === "function"
          ? first.on("afterCreate", (_interaction, completedObject) => {
              completed = true;
              // 优先取事件参数中的 completedObject，fallback 取 acc.objects
              const objects =
                completedObject != null
                  ? [completedObject]
                  : (context.acc?.objects ?? []);
              context.acc?.setHandoffObjects?.(objects);
              onToolComplete?.();
            })
          : null;

      if (!creatorProcessor) {
        creatorProcessor = first.createProcessor();
      }
      const rawResult = creatorProcessor(packet, context);
      return finalizeLifecycleWrappedResult(rawResult, () => completed, unsub);
    });
  } else if (firstIsChooser) {
    // Chooser 路径：使用信号检测 handler
    const wrappedHandler = wrapChooserForHandoff(first);
    firstNode.handler(wrappedHandler);
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

  if (secondIsModifier) {
    // Modifier 路径：handler 桥接 afterApply 钩子 → onToolComplete 回调
    let modifierProcessor = null;
    secondNode.handler((packet, context = {}) => {
      const onToolComplete = context.acc?.onToolComplete;
      let completed = false;

      // 检测 cancel 信号：modifier 取消时也回切到 first
      const hasCancelSignal =
        Array.isArray(packet.signals) &&
        packet.signals.some((s) => s?.type === "cancel");

      // 临时订阅 afterApply：工具触发时桥接到 onToolComplete
      const unsub =
        typeof second.on === "function"
          ? second.on("afterApply", () => {
              completed = true;
              onToolComplete?.();
            })
          : null;

      if (!modifierProcessor) {
        modifierProcessor = second.createProcessor();
      }
      const rawResult = modifierProcessor(packet, context);

      // cancel 信号：丢弃 AOM 动态图中的对象，再切回 first
      if (hasCancelSignal) {
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

        onToolComplete?.();
      }

      return finalizeLifecycleWrappedResult(rawResult, () => completed, unsub);
    });
  } else if (secondIsSubDAG) {
    secondSubDAGDef = second;
  } else if (isToolInstance(second)) {
    // 通用 Tool 路径：透传，工具通过 context.onToolComplete 自行通知完成
    let genericSecondProcessor = null;
    secondNode.handler((packet, context = {}) => {
      if (!genericSecondProcessor) {
        genericSecondProcessor = second.createProcessor();
      }
      return genericSecondProcessor(packet, context);
    });
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

  // 将钩子清理函数挂到子图上，供外部在卸载 handoff 时恢复 tool 状态
  handoffSubDAG.resetHandoff = () => {
    for (const cleanup of handoffCleanups) {
      try {
        cleanup();
      } catch {
        // 静默吞掉清理错误
      }
    }
    handoffCleanups.length = 0;
  };

  return handoffSubDAG;
}

export { createHandoffSubDAG, wrapSubDAGForHandoff };
