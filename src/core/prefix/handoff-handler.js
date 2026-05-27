/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubTree 工厂函数，将 first → second 的两阶段工作流
 * 封装为一棵结构化子树。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子树；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubTreeDefinition。
 * @module core/prefix/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubTree } from "../devices/devices-tree.js";
import { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
import { PREFIX_NODE_SIGNAL_TYPES } from "./constants.js";

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
 * 将 creator 工具包装为可向父 prefix 发出 TOOL_COMPLETE 的 handler，
 * hook tool.completeCreatedObject()——creator 真正完成创建的唯一语义入口
 * @param {import("../tools/tool.js").Tool} tool - creator 工具实例
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler}
 */
function wrapCreatorForHandoff(tool) {
  let processor = null;
  let completeRequested = false;

  const originalComplete = tool.completeCreatedObject;
  if (typeof originalComplete === "function") {
    tool.completeCreatedObject = function (interaction) {
      completeRequested = true;
      return originalComplete.call(this, interaction);
    };
  }

  return (packet, context = {}) => {
    if (!processor) {
      processor = tool.createProcessor({
        board: context.runtimeContext?.board,
        monitor: context.runtimeContext?.monitor,
      });
    }

    completeRequested = false;
    const result = processor(packet, context);

    if (completeRequested) {
      const existing = Array.isArray(result)
        ? result
        : result != null
          ? [result]
          : [];

      return [
        ...existing,
        {
          to: "..",
          signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
        },
      ];
    }

    return result;
  };
}

/**
 * 将 first 阶段工具（creator 或 chooser）包装为可向父 prefix 发出 TOOL_COMPLETE 的 handler。
 * 自动检测工具类型：
 * - 若工具包含 completeCreatedObject（creator），hook 其完成回调
 * - 否则退化为信号检测模式：收到 "end" 信号后追加 TOOL_COMPLETE
 * @param {import("../tools/tool.js").Tool} tool - first 阶段工具实例（creator / chooser）
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
        board: context.runtimeContext?.board,
        monitor: context.runtimeContext?.monitor,
      });
    }

    const result = processor(packet, context);
    const sigs = packet?.signals ?? [];
    const hasEnd = Array.isArray(sigs) && sigs.some((s) => s?.type === "end");

    if (!hasEnd) {
      return result;
    }

    const existing = Array.isArray(result)
      ? result
      : result != null
        ? [result]
        : [];

    return [
      ...existing,
      {
        to: "..",
        signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
      },
    ];
  };
}

/**
 * 将 SubTreeDefinition 的根节点及其子节点递归挂载到 builder 的当前节点下。
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
 * 为 subTree 的根节点追加 TOOL_COMPLETE 冒泡包装
 * @param {import("../devices/devices-tree.js").SubTreeDefinition} subTreeDef - 原始子树定义
 * @param {Object} [options={}] - 包装选项
 * @param {Function} [options.shouldComplete] - 决定是否发出 TOOL_COMPLETE，接收 (packet, context)，省略时在收到 "end" 信号后发出
 * @returns {import("../devices/devices-tree.js").SubTreeDefinition} 包装后的子树定义
 */
function wrapSubTreeForHandoff(subTreeDef, options = {}) {
  const { shouldComplete } = options;
  const originalHandler = subTreeDef.nodes?.handler;

  const wrappedNodes = {
    ...subTreeDef.nodes,
    handler: originalHandler
      ? (packet, context) => {
          const result = originalHandler(packet, context);
          const should = shouldComplete
            ? shouldComplete(packet, context)
            : packet.signals?.some((s) => s?.type === "end");

          if (!should) return result;

          const existing = Array.isArray(result)
            ? result
            : result != null
              ? [result]
              : [];

          return [
            ...existing,
            {
              to: "..",
              signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
            },
          ];
        }
      : null,
  };

  return { ...subTreeDef, nodes: wrappedNodes };
}

/**
 * 创建 handoff 修饰节点子树
 * @description
 * 生成一棵三层子树：根节点为 multi-tool prefix 状态机，默认将信号路由到 first 子节点；
 * 当 first 发送 TOOL_COMPLETE 后切换到 second 子节点；
 * 当 second 发送 TOOL_COMPLETE 后切回 first，开始新周期。
 * first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子树；
 * second 通常是 modifier（对象编辑工具）。
 * 两者均可接受 Tool 实例或 SubTreeDefinition。
 * @param {{
 *   rootPath?: string,
 *   first: import("../tools/tool.js").Tool|import("../devices/devices-tree.js").SubTreeDefinition,
 *   second: import("../tools/tool.js").Tool|import("../devices/devices-tree.js").SubTreeDefinition,
 *   autoBridgeObjects?: boolean,
 * }} options - handoff 子树配置
 * @param {string} [options.rootPath="/handoff"] - 子树根路径
 * @param {import("../tools/tool.js").Tool|import("../devices/devices-tree.js").SubTreeDefinition} options.first - 第一阶段工具或子树（creator / chooser 等）
 * @param {import("../tools/tool.js").Tool|import("../devices/devices-tree.js").SubTreeDefinition} options.second - 第二阶段工具或子树（通常为 modifier）
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

  const builder = createSubTree(rootPath)
    .node("")
    .prefix(
      createMultiToolPrefixHandler({
        defaultChild: "first",
        initialState: { phase: "first" },
        resolveTransition({ signalPacket, state, prefixContext }) {
          const hasToolComplete = signalPacket.signals.some(
            (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
          );

          if (!hasToolComplete) {
            return { child: state.activeChild };
          }

          if (state.phase === "first" && autoBridgeObjects) {
            const tree = prefixContext.eventContext?.tree;
            const basePath = prefixContext.eventContext?.path ?? "";
            const firstState = tree?.getNodeState?.(`${basePath}/first`);
            const objects = firstState?.objects ?? [];
            if (objects.length > 0) {
              tree?.setNodeState?.(`${basePath}/second`, { objects });
            }
          }

          if (state.phase === "first") {
            return {
              patchState: { phase: "second", activeChild: "second" },
              consume: true,
            };
          }

          return {
            patchState: { phase: "first", activeChild: "first" },
            consume: true,
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
    secondBuilder.tool(second);
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
