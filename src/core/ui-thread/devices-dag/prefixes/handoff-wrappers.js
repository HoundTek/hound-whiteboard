/**
 * @file handoff 包装器与子图辅助函数
 * @description
 * 从 handoff-handler.js 中提取的工具包装、子图附着和对象桥接辅助函数。
 * @module core/ui-thread/devices-dag/prefixes/handoff-wrappers
 * @author Zhou Chenyu
 */

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
 * @param {import("../dag.js").SubDAGDefinition} hostSubDAG
 * @param {number} hostNodeId
 * @param {import("../dag.js").SubDAGDefinition} subDAGDef
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
 * @returns {Array<*>}
 */
function normalizeHandoffBridgeObjects(result) {
  if (Array.isArray(result)) {
    return result.filter(Boolean);
  }

  if (result != null) {
    return [result].filter(Boolean);
  }

  return [];
}

/**
 * 丢弃 second 阶段当前持有的活动对象
 * @param {Tool} tool - second 阶段工具实例
 * @param {import("../dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
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
 * @returns {import("../dag.js").DevicesDAGHandler}
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
          const objects = bridgeObjects
            ? normalizeHandoffBridgeObjects(result)
            : undefined;
          onToolComplete?.(objects);
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
      onToolComplete?.([]);
    }

    // 异步 case：延迟清理 subscription，等 Promise resolve 后再移除监听
    // 确保 action:complete 事件在 listener 被移除前触发
    if (rawResult instanceof Promise) {
      rawResult.then(
        () => {
          for (const unsub of unsubs) {
            unsub?.();
          }
        },
        () => {
          for (const unsub of unsubs) {
            unsub?.();
          }
        },
      );
      // 不向上传播 Promise，避免触发 DAG 的 async handler ban
      return undefined;
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
 * @param {import("../dag.js").SubDAGDefinition} subDAGDef - 原始子图定义
 * @param {Object} [options={}] - 包装选项
 * @param {Function} [options.shouldComplete] - 决定是否发出完成通知，接收 (packet, context)，省略时在收到 "end" 信号后发出
 * @returns {import("../dag.js").SubDAGDefinition} 包装后的子图定义
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

    // 子图内部工具通过 setContextObjects 写入 node.state.objects，
    // 经由回调参数桥接到 handoff
    const nodeState = context.getNodeState?.() ?? {};
    const objects = nodeState.objects ?? [];
    context.acc?.onToolComplete?.(objects);
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

export {
  cloneDAGNodeDefinition,
  mergeDAGNodeDefinition,
  attachDAGSubDAG,
  isToolInstance,
  normalizeHandoffBridgeObjects,
  discardSecondPhaseObjects,
  wrapToolForHandoff,
  wrapSubDAGForHandoff,
};
