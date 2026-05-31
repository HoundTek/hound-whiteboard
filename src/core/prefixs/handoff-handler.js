/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubTree 工厂函数，将 first → second 的两阶段工作流
 * 封装为一棵结构化子树。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子树；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubTreeDefinition。
 * @module core/prefixs/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubTree } from "../devices/devices-tree.js";
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

  if (rawResult != null) {
    return [SignalPacket.from(rawResult)];
  }

  return [];
}

/**
 * 判断值是否是 SubTreeDefinition
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isSubTreeDefinition(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.root === "string" &&
    value.nodes != null &&
    typeof value.nodes === "object"
  );
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
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler}
 */
function wrapCreatorForHandoff(tool) {
  let processor = null;
  let completeRequested = false;

  // 替换 completeCreatedObject，拦截完成信号但不调用原始实现
  // handoff 工作流中由 createHandoffSubTree 的 autoBridgeObjects 负责
  // 将对象从 creator 节点状态桥接到 modifier 节点状态
  tool.completeCreatedObject = function (interaction) {
    tool.syncCreatedObjectContext?.(interaction?.deviceContext, tool.obj);
    if (Object.prototype.hasOwnProperty.call(tool, "isObjectCreationCompleted")) {
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

      return { packets: normalizeResultPackets(rawResult) };
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
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler}
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

    return { packets: normalizeResultPackets(rawResult) };
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
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler}
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
      return { packets: normalizeResultPackets(rawResult) };
    }

    return rawResult;
  };
}

/**
 * 将 SubTreeDefinition 的根节点及其子节点递归挂载到 builder 的当前节点下
 * @param {import("../devices/devices-tree.js").SubTreeNodeBuilder} builder - 当前节点的构建器
 * @param {import("../devices/devices-tree.js").SubTreeNodeDefinition} nodeDef - 子树节点定义
 */
function attachSubTreeNodes(builder, nodeDef) {
  if (!nodeDef || typeof nodeDef !== "object") return;

  if (typeof nodeDef.handler === "function") {
    builder.handler(nodeDef.handler);
  }
  if (nodeDef.semantics && Object.keys(nodeDef.semantics).length) {
    builder.semantics(nodeDef.semantics);
  }
  if (nodeDef.defaultChild) {
    builder.defaultChild(nodeDef.defaultChild);
  }
  if (nodeDef.tool !== undefined) {
    builder.tool(nodeDef.tool, nodeDef.toolContext ?? {});
  }
  if (typeof nodeDef.umount === "function") {
    builder.umount(nodeDef.umount);
  }

  for (const [childName, childDef] of Object.entries(nodeDef.children ?? {})) {
    const childBuilder = builder.node(childName);
    attachSubTreeNodes(childBuilder, childDef);
    childBuilder.end();
  }
}

/**
 * 为 subTree 的根节点追加完成通知包装
 * @param {import("../devices/devices-tree.js").SubTreeDefinition} subTreeDef - 原始子树定义
 * @param {Object} [options={}] - 包装选项
 * @param {Function} [options.shouldComplete] - 决定是否发出完成通知，接收 (packet, context)，省略时在收到 "end" 信号后发出
 * @returns {import("../devices/devices-tree.js").SubTreeDefinition} 包装后的子树定义
 */
function wrapSubTreeForHandoff(subTreeDef, options = {}) {
  const { shouldComplete } = options;
  const originalHandler = subTreeDef.nodes?.handler;

  const wrappedNodes = {
    ...subTreeDef.nodes,
    handler: originalHandler
      ? (packet, context) => {
          const rawResult = originalHandler(packet, context);
          const should = shouldComplete
            ? shouldComplete(packet, context)
            : packet.signals?.some((s) => s?.type === "end");

          if (!should) return rawResult;

          // 通过回调通知，不再使用冒泡
          context.context?.onToolComplete?.();

          return { packets: normalizeResultPackets(rawResult) };
        }
      : null,
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
 *   first: Tool|import("../devices/devices-tree.js").SubTreeDefinition,
 *   second: Tool|import("../devices/devices-tree.js").SubTreeDefinition,
 *   autoBridgeObjects?: boolean,
 * }} options - handoff 子树配置
 * @param {string} [options.rootPath="/handoff"] - 子树根路径
 * @param {Tool|import("../devices/devices-tree.js").SubTreeDefinition} options.first - 第一阶段工具或子树（creator / chooser 等）
 * @param {Tool|import("../devices/devices-tree.js").SubTreeDefinition} options.second - 第二阶段工具或子树（通常为 modifier）
 * @param {boolean} [options.autoBridgeObjects=true] - 是否在 handoff 时自动桥接对象上下文
 * @returns {import("../devices/devices-tree.js").SubTreeDefinition}
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
 *   // SubTreeDefinition + wrapSubTreeForHandoff
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

  const builder = createSubTree(rootPath)
    .node("")
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
              const tree = prefixContext.tree;
              const firstState = tree?.getNodeState?.(
                `${handoffBasePath}/first`,
              );
              const objects = firstState?.objects ?? [];
              if (objects.length > 0) {
                tree?.setNodeState?.(`${handoffBasePath}/second`, { objects });
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
    )
    .defaultChild("first");

  // ── first 子节点 ──
  const firstBuilder = builder.node("first");
  if (isToolInstance(first)) {
    firstBuilder.handler(wrapFirstForHandoff(first));
  } else if (isSubTreeDefinition(first)) {
    attachSubTreeNodes(firstBuilder, first.nodes);
  } else {
    throw new TypeError(
      "createHandoffSubTree: first must be a Tool or SubTreeDefinition.",
    );
  }
  firstBuilder.end();

  // ── second 子节点 ──
  const secondBuilder = builder.node("second");
  if (isToolInstance(second)) {
    secondBuilder.handler(wrapSecondForHandoff(second));
  } else if (isSubTreeDefinition(second)) {
    attachSubTreeNodes(secondBuilder, second.nodes);
  } else {
    throw new TypeError(
      "createHandoffSubTree: second must be a Tool or SubTreeDefinition.",
    );
  }
  secondBuilder.end();

  return builder.end().build();
}

export {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
};
