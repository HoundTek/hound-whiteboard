import { jest } from "@jest/globals";
import { DevicesDAG, createSubDAG } from "../../devices/devices-dag.js";
import { Tool } from "../../tools/tool.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { Vector } from "../../utils/math.js";
import { createPrefixNodeHandler } from "../handler.js";
import {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
} from "../handoff-handler.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";

describe("handoff-handler", () => {
  describe("hook functions", () => {
    test("wrapCreatorForHandoff 应在 completeCreatedObject 后调用 onToolComplete 回调", () => {
      const ddag = new DevicesDAG();
      const creator = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, { objects: [{ id: 1 }] });
      });
      const onToolComplete = jest.fn();

      const subDAG = createSubDAG("/handoff");
      subDAG.node().handler(wrapCreatorForHandoff(creator));
      const subTree = subDAG.build();

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });
      const result = ddag.dispatch(
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
      const ddag = new DevicesDAG();
      const creator = createMockCreator();
      const onToolComplete = jest.fn();

      const subDAG = createSubDAG("/wf");
      subDAG.node().handler(wrapFirstForHandoff(creator));
      const subTree = subDAG.build();

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });
      const result = ddag.dispatch(
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
      const ddag = new DevicesDAG();
      const selectedObject = { id: 1 };
      const onToolComplete = jest.fn();
      // chooser 需要实际写入对象到上下文，wrapper 才会触发 handoff
      const chooser = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          object: selectedObject,
          objects: [selectedObject],
        });
      });

      const subDAG = createSubDAG("/wf");
      subDAG.node().handler(wrapFirstForHandoff(chooser));
      const subTree = subDAG.build();

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      const r1 = ddag.dispatch(
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

      const r2 = ddag.dispatch(
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
      const ddag = new DevicesDAG();
      // 不写入对象 → 选择失败
      const chooser = createMockChooser();
      const onToolComplete = jest.fn();

      const subDAG2 = createSubDAG("/wf");
      subDAG2.node().handler(wrapFirstForHandoff(chooser));
      const subTree = subDAG2.build();

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      const r = ddag.dispatch(
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

  describe("createHandoffSubTree", () => {
    test("应构建三层结构并支持 first -> second 切换", () => {
      const ddag = new DevicesDAG();
      const first = createMockCreator();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/workflow",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      const root = ddag.getNode("/monitor/workflow");
      expect(root).not.toBeNull();
      expect(ddag.getNode("/monitor/workflow/first")).not.toBeNull();
      expect(ddag.getNode("/monitor/workflow/second")).not.toBeNull();
      expect(root.getSemantics()).toEqual({
        prefix: true,
        prefixKind: "handoff",
        routePolicy: "state-machine",
      });

      ddag.dispatch({
        to: "/monitor/workflow",
        signals: [{ type: "position" }],
      });
      expect(ddag.getNodeState("/monitor/workflow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
    });

    test("应自动桥接对象上下文", () => {
      const ddag = new DevicesDAG();
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

      const subTree = createHandoffSubTree({
        rootPath: "/ce",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      ddag.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "position" }],
      });

      expect(ddag.getNodeState("/monitor/ce/first")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });
      expect(ddag.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });

      ddag.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "transform" }],
      });
      expect(ddag.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
        touched: true,
      });
    });

    test("应在 second 调用完成回调后切回 first", () => {
      const ddag = new DevicesDAG();
      const first = createMockCreator();
      const second = new (class extends Tool {
        process(_packet, ctx) {
          ctx.context?.onToolComplete?.();
        }
      })();

      const subTree = createHandoffSubTree({
        rootPath: "/toggle",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      ddag.dispatch({ to: "/monitor/toggle", signals: [{ type: "position" }] });
      expect(ddag.getNodeState("/monitor/toggle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      ddag.dispatch({
        to: "/monitor/toggle",
        signals: [{ type: "transform" }],
      });
      expect(ddag.getNodeState("/monitor/toggle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
    });

    test("应在真实 CommonObjectModifierTool 提交成功后切回 first 且保留 second 节点", () => {
      const ddag = new DevicesDAG();
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

      const subTree = createHandoffSubTree({
        rootPath: "/modifier-cycle",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, accumulatedContext);

      ddag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "position" }],
        },
        accumulatedContext,
      );
      expect(ddag.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      ddag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [
            { type: "displacement", context: { value: { x: 3, y: 1 } } },
          ],
        },
        accumulatedContext,
      );
      ddag.dispatch(
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
      expect(ddag.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(ddag.getNode("/monitor/modifier-cycle/second")).not.toBeNull();
      expect(ddag.getNodeState("/monitor/modifier-cycle/second")).toEqual({});
    });

    test("应支持 chooser 作为 first", () => {
      const ddag = new DevicesDAG();
      const first = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 7, type: "stroke" }],
        });
      });
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/chooser-flow",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      // Position signal: chooser selects, but no completion callback yet (no "end")
      ddag.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "position" }],
      });
      // 初始状态在 prefix 内部 merge，未写入 node state
      expect(ddag.getNodeState("/monitor/chooser-flow")).toEqual({});

      // End 信号触发 chooser 的完成回调 → handoff
      ddag.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "end" }],
      });
      expect(ddag.getNodeState("/monitor/chooser-flow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(ddag.getNodeState("/monitor/chooser-flow/second")).toEqual({
        objects: [{ id: 7, type: "stroke" }],
      });
    });

    test("应支持 SubDAGDefinition 作为 first", () => {
      const ddag = new DevicesDAG();
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
      const firstSubTree = chainDAG.build();

      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/nested",
        first: firstSubTree,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      expect(ddag.getNode("/monitor/nested/first")).not.toBeNull();
      expect(ddag.getNode("/monitor/nested/first/tool")).not.toBeNull();

      ddag.dispatch({ to: "/monitor/nested", signals: [{ type: "trigger" }] });
      expect(ddag.getNodeState("/monitor/nested")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(ddag.getNodeState("/monitor/nested/second")).toEqual({
        objects: [{ id: 99 }],
      });
    });

    test("autoBridgeObjects = false 时应跳过对象桥接", () => {
      const ddag = new DevicesDAG();
      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 42 }],
        });
      });
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/no-bridge",
        first,
        second,
        autoBridgeObjects: false,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      ddag.dispatch({
        to: "/monitor/no-bridge",
        signals: [{ type: "position" }],
      });
      // 对象不应被桥接到 second
      expect(ddag.getNodeState("/monitor/no-bridge/second")).toEqual({});
    });

    test("first 无对象时不应崩溃", () => {
      const ddag = new DevicesDAG();
      // creator 不写入任何对象到 state
      const first = createMockCreator();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/empty",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      // 不应抛出异常
      expect(() => {
        ddag.dispatch({
          to: "/monitor/empty",
          signals: [{ type: "position" }],
        });
      }).not.toThrow();

      // second 状态保持为空
      expect(ddag.getNodeState("/monitor/empty/second")).toEqual({});
    });

    test("连续两次完成回调不应导致状态紊乱", () => {
      const ddag = new DevicesDAG();
      let toggleCount = 0;
      // first 每次 process 都通过回调触发完成
      const first = new (class extends Tool {
        process(_pkt, ctx) {
          toggleCount++;
          ctx.context?.onToolComplete?.();
        }
      })();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/rapid",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      // 第一次完成回调：first → second
      ddag.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      expect(ddag.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // 第二次 dispatch 信号路由到 second（modifier），first 的 process 不会被调用
      ddag.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      // 状态保持 second（second 未发出完成回调，不会触发切换）
      expect(ddag.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(toggleCount).toBe(1);
    });
  });

  describe("integration scenarios", () => {
    test("完整周期：creator 创建 → modifier 修改 → 切回 creator 重新创建", () => {
      const ddag = new DevicesDAG();
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

      const subTree = createHandoffSubTree({
        rootPath: "/full-cycle",
        first,
        second,
      });

      ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

      // 第一轮：creator → modifier
      ddag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
      });
      expect(ddag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(1);

      // modifier 收到 displacement
      ddag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "displacement", context: { value: { x: 5, y: 0 } } }],
      });
      // modifier 收到 success → 切回 first
      ddag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "success" }],
      });
      expect(ddag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });

      // 第二轮：creator 再次创建
      ddag.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
      });
      expect(ddag.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(2);
      expect(createdIds).toEqual([1, 2]);
    });
  });

  describe("wrapSubTreeForHandoff", () => {
    test("应在 end 信号后调用 onToolComplete 并保留原始输出", () => {
      const ddag = new DevicesDAG();
      const innerDAG = createSubDAG("/inner");
      innerDAG.node().handler(() => ({
        to: "",
        signals: [{ type: "inner-done" }],
      }));
      const inner = innerDAG.build();

      const wrapped = wrapSubTreeForHandoff(inner);
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

      ddag.mountSubDAG("/monitor", outer, { board: {}, monitor: {} });

      const result = ddag.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "end" }],
      });
      const secondResult = ddag.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "trigger" }],
      });

      expect(
        result.packets.some((p) =>
          p.signals.some((s) => s.type === "inner-done"),
        ),
      ).toBe(true);
      expect(ddag.getNodeState("/monitor/outer")).toEqual({ completed: true });
      expect(
        secondResult.packets.some((p) =>
          p.signals.some((s) => s.type === "handled"),
        ),
      ).toBe(true);
    });
  });
});
