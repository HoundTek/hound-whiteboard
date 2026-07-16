/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubDAG 工厂函数，将 first → second 的两阶段工作流
 * 封装为一张结构化子图。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子图；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubDAGDefinition。
 *
 * 通过统一动作完成事件与少量 creator 提交拦截钩子，
 * 实现非侵入的完成通知与流程控制，不再直接替换工具实例方法。
 * @module core/ui-thread/devices-dag/prefixes/handoff-handler
 * @author Zhou Chenyu
 */

import { createSubDAG, isSubDAGDefinition } from "../index.js";
import { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
import {
  attachDAGSubDAG,
  isToolInstance,
  wrapToolForHandoff,
  wrapSubDAGForHandoff,
} from "./handoff-wrappers.js";

/**
 * 解析 handoff 子节点对应的根路径
 * @param {import("../dag.js").DevicesDAGHandlerContext} [context={}] - 当前子节点上下文
 * @returns {string}
 */
function resolveHandoffRootPath(context = {}) {
  if (typeof context.path !== "string" || context.path === "") {
    return "";
  }

  const lastSlashIndex = context.path.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return "/";
  }

  return context.path.slice(0, lastSlashIndex);
}

/**
 * 切换 handoff 根节点的阶段状态
 * @param {import("../dag.js").DevicesDAGHandlerContext} [context={}] - 当前子节点上下文
 * @param {"first"|"second"} phase - 目标阶段
 * @returns {void}
 */
function switchHandoffPhase(context = {}, phase) {
  const handoffRootPath = resolveHandoffRootPath(context);
  if (
    !handoffRootPath ||
    typeof context.getNodeState !== "function" ||
    typeof context.setNodeState !== "function"
  ) {
    return;
  }

  const currentState = context.getNodeState(handoffRootPath) ?? {};
  context.setNodeState(handoffRootPath, {
    ...currentState,
    phase,
    activeChild: phase,
  });
}

/**
 * 创建 handoff 完成回调
 * @param {Tool|import("../devices-dag/dag.js").SubDAGDefinition} second - 第二阶段工具或子图
 * @returns {(phase: "first"|"second", context: import("../dag.js").DevicesDAGHandlerContext, objects?: Array<*>) => void}
 */
function createHandoffCompletionHandler(second) {
  return (phase, context = {}, objects) => {
    if (phase === "first") {
      // 空数组 = first tool 完成了但没产出对象 → 不切换
      if (Array.isArray(objects) && objects.length === 0) return;

      if (objects && objects.length > 0) {
        const secondTool =
          typeof second?.receiveHandoffObjects === "function" ? second : null;
        secondTool?.receiveHandoffObjects(objects, context);
      }

      switchHandoffPhase(context, "second");
      return;
    }

    switchHandoffPhase(context, "first");

    // 触发 UI overlay 刷新，去除残留的 modifier / chooser 渲染条目
    (
      context.services?.viewport ?? context.acc?.viewport
    )?.requestViewportUiRender?.();
  };
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

  // 判断 second 类型
  const secondIsModifier =
    isToolInstance(second) && typeof second.applyModifiedObjects === "function";
  const secondIsSubDAG = isSubDAGDefinition(second);

  const handleHandoffComplete = createHandoffCompletionHandler(second);

  // 构建子树
  const builder = createSubDAG(rootPath);
  const root = builder
    .node()
    .defaultRoute("first")
    .prefix(
      createMultiToolPrefixHandler({
        defaultChild: "first",
        initialState: { phase: "first" },
        resolveTransition({ state, fromPhase }) {
          const activeChild =
            typeof state.activeChild === "string" && state.activeChild
              ? state.activeChild
              : fromPhase || "first";
          const nextRouteContext = {};

          // creator/chooser 所在阶段阻止 creator 提前 commit
          if (activeChild === "first") {
            nextRouteContext.autoCommit = false;
          }

          // modifier 所在阶段阻止其提交后自卸载
          if (activeChild === "second" && secondIsModifier) {
            nextRouteContext.autoUmountOnApply = false;
          }

          return {
            child: activeChild,
            routeContext: nextRouteContext,
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
        phase: "first",
        bridgeObjects: autoBridgeObjects,
        onComplete: handleHandoffComplete,
      }),
    );
  } else if (firstIsSubDAG) {
    firstSubDAGDef = wrapSubDAGForHandoff(first, {
      phase: "first",
      onComplete: handleHandoffComplete,
    });
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
        phase: "second",
        completeOnCancel: secondIsModifier,
        onComplete: handleHandoffComplete,
      }),
    );
  } else if (secondIsSubDAG) {
    secondSubDAGDef = wrapSubDAGForHandoff(second, {
      phase: "second",
      onComplete: handleHandoffComplete,
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

  return handoffSubDAG;
}

export { createHandoffSubDAG, wrapSubDAGForHandoff };
