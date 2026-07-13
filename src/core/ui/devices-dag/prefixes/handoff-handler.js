/**
 * @file handoff 修饰节点处理器
 * @description
 * 提供 createHandoffSubDAG 工厂函数，将 first → second 的两阶段工作流
 * 封装为一张结构化子图。first 可以是 creator（对象创建工具）、chooser（对象选择工具）或任意子图；
 * second 通常是 modifier（对象编辑工具）。两者均可接受 Tool 实例或 SubDAGDefinition。
 *
 * 通过统一动作完成事件与少量 creator 提交拦截钩子，
 * 实现非侵入的完成通知与流程控制，不再直接替换工具实例方法。
 * @module core/ui/devices-dag/prefixes/handoff-handler
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
                bridgeObjectCount: handoffObjects.length,
              });
            } else if (completedPhase === "second") {
              prefixContext.setState({
                phase: "first",
                activeChild: "first",
                bridgeObjectCount: 0,
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
