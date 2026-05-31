import { jest } from "@jest/globals";
import { DevicesDAG, createSubDAG } from "../../devices/devices-dag.js";
import { Tool } from "../../tools/tool.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { Vector } from "../../utils/math.js";
import { createPrefixNodeHandler } from "../handler.js";
import {
  createHandoffSubDAG,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSecondForHandoff,
  wrapSubDAGForHandoff,
} from "../handoff-handler.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";

describe("handoff-handler", () => {
  describe("hook functions", () => {
    test("wrapCreatorForHandoff 应在 completeCreatedObject 后调用 onToolComplete 回调", () => {
      const dag = new DevicesDAG();
      const creator = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, { objects: [{ id: 1 }] });
      });
      const onToolComplete = jest.fn();

      const builder = createSubDAG("/handoff");
      builder.node().handler(wrapCreatorForHandoff(creator));
      const subDAG = builder.build();

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });
      const result = dag.dispatch(
        {
          to: "/monitor/handoff",
          signals: [{ type: "position" }],
        },
        {
          board: {},
          monitor: {},
          onToolComplete,
        },
      );
      expect(onToolComplete).toHaveBeenCalledTimes(1);
      expect(result.packets).toEqual([]);
    });

    test("wrapFirstForHandoff 对 creator 应走 completeCreatedObject 回调路径", () => {
      const dag = new DevicesDAG();
      const creator = createMockCreator();
      const onToolComplete = jest.fn();

      const builder = createSubDAG("/wf");
      builder.node().handler(wrapFirstForHandoff(creator));
      const subDAG = builder.build();

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });
      const result = dag.dispatch(
        {
          to: "/monitor/wf",
          signals: [{ type: "position" }],
        },
        {
          board: {},
          monitor: {},
          onToolComplete,
        },
      );
      expect(onToolComplete).toHaveBeenCalledTimes(1);
      expect(result.packets).toEqual([]);
    });

    test("wrapFirstForHandoff 对 chooser 应在 end 信号且已选中对象后调用 onToolComplete", () => {
      const dag = new DevicesDAG();
      const selectedObject = { id: 1 };
      const onToolComplete = jest.fn();
      // chooser 需要实际写入对象到上下文，wrapper 才会触发 handoff
      const chooser = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          object: selectedObject,
          objects: [selectedObject],
        });
      });

      const builder = createSubDAG("/wf");
      builder.node().handler(wrapFirstForHandoff(chooser));
      const subDAG = builder.build();

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      const r1 = dag.dispatch(
        {
          to: "/monitor/wf",
          signals: [{ type: "position" }],
        },
        {
          board: {},
          monitor: {},
          onToolComplete,
        },
      );
      expect(r1.packets).toEqual([]);
      expect(onToolComplete).not.toHaveBeenCalled();

      const r2 = dag.dispatch(
        {
          to: "/monitor/wf",
          signals: [{ type: "end" }],
        },
        {
          board: {},
          monitor: {},
          onToolComplete,
        },
      );
      expect(r2.packets).toEqual([]);
      expect(onToolComplete).toHaveBeenCalledTimes(1);
    });

    test("wrapFirstForHandoff 对 chooser 选择失败时不应调用 onToolComplete", () => {
      const dag = new DevicesDAG();
      // 不写入对象 → 选择失败
      const chooser = createMockChooser();
      const onToolComplete = jest.fn();

      const builder = createSubDAG("/wf");
      builder.node().handler(wrapFirstForHandoff(chooser));
      const subDAG = builder.build();

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      const r = dag.dispatch(
        {
          to: "/monitor/wf",
          signals: [{ type: "end" }],
        },
        {
          board: {},
          monitor: {},
          onToolComplete,
        },
      );
      expect(r.packets).toEqual([]);
      expect(onToolComplete).not.toHaveBeenCalled();
    });
  });

  describe("createHandoffSubDAG", () => {
    test("应构建三层结构并支持 first -> second 切换", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator();
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/workflow",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      const root = dag.getNode("/monitor/workflow");
      expect(root).not.toBeNull();
      expect(dag.getNode("/monitor/workflow/first")).not.toBeNull();
      expect(dag.getNode("/monitor/workflow/second")).not.toBeNull();
      expect(root.getSemantics()).toEqual({
        prefix: true,
        prefixKind: "handoff",
        routePolicy: "state-machine",
      });

      dag.dispatch({
        to: "/monitor/workflow",
        signals: [{ type: "position" }],
      });
      expect(dag.getNodeState("/monitor/workflow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
    });

    test("应自动桥接对象上下文", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 42, type: "circle" }],
        });
      });
      const second = createMockModifier((_pkt, ctx) => {
        const st = ctx.getNodeState?.(ctx.path);
        if (st?.objects) {
          ctx.setNodeState?.(ctx.path, { ...st, touched: true });
        }
      });

      const subDAG = createHandoffSubDAG({
        rootPath: "/ce",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      dag.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "position" }],
      });

      expect(dag.getNodeState("/monitor/ce/first")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });
      expect(dag.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });

      dag.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "transform" }],
      });
      expect(dag.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
        touched: true,
      });
    });

    test("应在 second 调用完成回调后切回 first", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator();
      const second = new (class extends Tool {
        process(_packet, ctx) {
          ctx.context?.onToolComplete?.();
        }
      })();

      const subDAG = createHandoffSubDAG({
        rootPath: "/toggle",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      dag.dispatch({ to: "/monitor/toggle", signals: [{ type: "position" }] });
      expect(dag.getNodeState("/monitor/toggle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      dag.dispatch({
        to: "/monitor/toggle",
        signals: [{ type: "transform" }],
      });
      expect(dag.getNodeState("/monitor/toggle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
    });

    test("应在真实 CommonObjectModifierTool 提交成功后切回 first 且保留 second 节点", () => {
      const dag = new DevicesDAG();
      const object = {
        id: 7,
        position: new Vector(5, 5),
      };
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };
      const accumulatedContext = { board, monitor: {} };
      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [object],
        });
      });
      const second = new CommonObjectModifierTool();

      const subDAG = createHandoffSubDAG({
        rootPath: "/modifier-cycle",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, accumulatedContext);

      dag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "position" }],
        },
        accumulatedContext,
      );
      expect(dag.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      dag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [
            { type: "displacement", context: { value: { x: 3, y: 1 } } },
          ],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
        new Set([object]),
      );
      expect(object.position).toEqual(new Vector(8, 6));
      expect(dag.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(dag.getNode("/monitor/modifier-cycle/second")).not.toBeNull();
      expect(dag.getNodeState("/monitor/modifier-cycle/second")).toEqual({});
    });

    test("应支持 chooser 作为 first", () => {
      const dag = new DevicesDAG();
      const first = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 7, type: "stroke" }],
        });
      });
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/chooser-flow",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      // Position signal: chooser selects, but no completion callback yet (no "end")
      dag.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "position" }],
      });
      // 初始状态在 prefix 内部 merge，未写入 node state
      expect(dag.getNodeState("/monitor/chooser-flow")).toEqual({});

      // End 信号触发 chooser 的完成回调 → handoff
      dag.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "end" }],
      });
      expect(dag.getNodeState("/monitor/chooser-flow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(dag.getNodeState("/monitor/chooser-flow/second")).toEqual({
        objects: [{ id: 7, type: "stroke" }],
      });
    });

    test("应支持 SubDAGDefinition 作为 first", () => {
      const dag = new DevicesDAG();
      const chainDAG = createSubDAG("/chain");
      const chainRoot = chainDAG
        .node()
        .defaultRoute("tool")
        .prefix(
          createPrefixNodeHandler({
            handle(_pkt, ctx) {
              ctx.setNodeState?.(ctx.path, {
                objects: [{ id: 99 }],
              });
              ctx.context?.onToolComplete?.();
              return ctx.routeToChild("tool");
            },
          }),
        );
      const chainTool = chainDAG.node().handler(() => ({
        to: "",
        signals: [{ type: "created" }],
      }));
      chainDAG.edge("tool", chainRoot, chainTool);
      const firstSubDAG = chainDAG.build();

      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/nested",
        first: firstSubDAG,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      expect(dag.getNode("/monitor/nested/first")).not.toBeNull();
      expect(dag.getNode("/monitor/nested/first/tool")).not.toBeNull();

      dag.dispatch({ to: "/monitor/nested", signals: [{ type: "trigger" }] });
      expect(dag.getNodeState("/monitor/nested")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(dag.getNodeState("/monitor/nested/second")).toEqual({
        objects: [{ id: 99 }],
      });
    });

    test("autoBridgeObjects = false 时应跳过对象桥接", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 42 }],
        });
      });
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/no-bridge",
        first,
        second,
        autoBridgeObjects: false,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      dag.dispatch({
        to: "/monitor/no-bridge",
        signals: [{ type: "position" }],
      });
      // 对象不应被桥接到 second
      expect(dag.getNodeState("/monitor/no-bridge/second")).toEqual({});
    });

    test("first 无对象时不应崩溃", () => {
      const dag = new DevicesDAG();
      // creator 不写入任何对象到 state
      const first = createMockCreator();
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/empty",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      // 不应抛出异常
      expect(() => {
        dag.dispatch({
          to: "/monitor/empty",
          signals: [{ type: "position" }],
        });
      }).not.toThrow();

      // second 状态保持为空
      expect(dag.getNodeState("/monitor/empty/second")).toEqual({});
    });

    test("连续两次完成回调不应导致状态紊乱", () => {
      const dag = new DevicesDAG();
      let toggleCount = 0;
      // first 每次 process 都通过回调触发完成
      const first = new (class extends Tool {
        process(_pkt, ctx) {
          toggleCount++;
          ctx.context?.onToolComplete?.();
        }
      })();
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/rapid",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      // 第一次完成回调：first → second
      dag.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      expect(dag.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // 第二次 dispatch 信号路由到 second（modifier），first 的 process 不会被调用
      dag.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      // 状态保持 second（second 未发出完成回调，不会触发切换）
      expect(dag.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(toggleCount).toBe(1);
    });
  });

  describe("integration scenarios", () => {
    test("完整周期：creator 创建 → modifier 修改 → 切回 creator 重新创建", () => {
      const dag = new DevicesDAG();
      let createdCount = 0;
      const createdIds = [];

      const first = new (class extends Tool {
        process(_pkt, ctx) {
          createdCount++;
          const id = createdCount;
          createdIds.push(id);
          ctx.context?.onToolComplete?.();
        }
      })();

      const second = new (class extends Tool {
        process(pkt) {
          const hasSuccess = pkt.signals?.some((s) => s.type === "success");
          if (hasSuccess) {
            return undefined;
          }
          return undefined;
        }
      })();

      second.process = function (pkt, ctx) {
        const hasSuccess = pkt.signals?.some((s) => s.type === "success");
        if (hasSuccess) {
          ctx.context?.onToolComplete?.();
        }
        return undefined;
      };

      const subDAG = createHandoffSubDAG({
        rootPath: "/full-cycle",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      // 第一轮：creator → modifier
      dag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
      });
      expect(dag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(1);

      // modifier 收到 displacement
      dag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "displacement", context: { value: { x: 5, y: 0 } } }],
      });
      // modifier 收到 success → 切回 first
      dag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "success" }],
      });
      expect(dag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });

      // 第二轮：creator 再次创建
      dag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
      });
      expect(dag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(2);
      expect(createdIds).toEqual([1, 2]);
    });
  });

  describe("wrapSubDAGForHandoff", () => {
    test("应在 end 信号后调用 onToolComplete 并保留原始输出", () => {
      const dag = new DevicesDAG();
      const innerDAG = createSubDAG("/inner");
      innerDAG.node().handler(() => ({
        to: "",
        signals: [{ type: "inner-done" }],
      }));
      const inner = innerDAG.build();

      const wrapped = wrapSubDAGForHandoff(inner);
      const outerDAG = createSubDAG("/outer");
      const outerRoot = outerDAG
        .node()
        .defaultRoute("child")
        .prefix(
          createPrefixNodeHandler({
            handle(packet, ctx) {
              if (ctx.state.completed) {
                return {
                  stop: true,
                  packets: [
                    {
                      to: "",
                      signals: [{ type: "handled" }],
                    },
                  ],
                };
              }

              return {
                packets: [{ to: "child", signals: packet.signals }],
                context: {
                  onToolComplete() {
                    ctx.patchState({ completed: true });
                  },
                },
              };
            },
          }),
        );
      const outerChild = outerDAG.node().handler(wrapped.nodes.handler);
      outerDAG.edge("child", outerRoot, outerChild);
      const outer = outerDAG.build();

      dag.mountSubDAG("/monitor", outer, { board: {}, monitor: {} });

      const result = dag.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "end" }],
      });
      const secondResult = dag.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "trigger" }],
      });

      expect(
        result.packets.some((p) =>
          p.signals.some((s) => s.type === "inner-done"),
        ),
      ).toBe(true);
      expect(dag.getNodeState("/monitor/outer")).toEqual({ completed: true });
      expect(
        secondResult.packets.some((p) =>
          p.signals.some((s) => s.type === "handled"),
        ),
      ).toBe(true);
    });
  });

  describe("重复实例检查", () => {
    test("createHandoffSubDAG 的 first 和 second 为同一 tool 实例时应抛错", () => {
      const tool = createMockCreator();
      expect(() =>
        createHandoffSubDAG({
          rootPath: "/bad",
          first: tool,
          second: tool,
        }),
      ).toThrow(/same tool instance/i);
    });

    test("wrapCreatorForHandoff 对同一 tool 调用两次应抛错", () => {
      const tool = createMockCreator();
      wrapCreatorForHandoff(tool);
      expect(() => wrapCreatorForHandoff(tool)).toThrow(
        /already been wrapped/i,
      );
    });

    test("wrapFirstForHandoff 对 creator 调用两次应抛错（走 wrapCreatorForHandoff）", () => {
      const tool = createMockCreator();
      wrapFirstForHandoff(tool);
      expect(() => wrapFirstForHandoff(tool)).toThrow(
        /already been wrapped/i,
      );
    });

    test("wrapSecondForHandoff 对同一 modifier tool 调用两次应抛错", () => {
      const dag = new DevicesDAG();
      const modifier = new (class extends Tool {
        process() {}
        applyModifiedObjects() {
          return true;
        }
      })();
      wrapSecondForHandoff(modifier);
      expect(() => wrapSecondForHandoff(modifier)).toThrow(
        /already been wrapped/i,
      );
    });
  });
});
