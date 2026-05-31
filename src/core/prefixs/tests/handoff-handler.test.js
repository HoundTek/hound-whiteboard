import { jest } from "@jest/globals";
import { DevicesTree, createSubTree } from "../../devices/devices-tree.js";
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
      const tree = new DevicesTree();
      const creator = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, { objects: [{ id: 1 }] });
      });
      const onToolComplete = jest.fn();

      const subTree = createSubTree("/handoff")
        .node("")
        .handler(wrapCreatorForHandoff(creator))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
      const result = tree.dispatch(
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
      const tree = new DevicesTree();
      const creator = createMockCreator();
      const onToolComplete = jest.fn();

      const subTree = createSubTree("/wf")
        .node("")
        .handler(wrapFirstForHandoff(creator))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
      const result = tree.dispatch(
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
      const tree = new DevicesTree();
      const selectedObject = { id: 1 };
      const onToolComplete = jest.fn();
      // chooser 需要实际写入对象到上下文，wrapper 才会触发 handoff
      const chooser = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          object: selectedObject,
          objects: [selectedObject],
        });
      });

      const subTree = createSubTree("/wf")
        .node("")
        .handler(wrapFirstForHandoff(chooser))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      const r1 = tree.dispatch(
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

      const r2 = tree.dispatch(
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
      const tree = new DevicesTree();
      // 不写入对象 → 选择失败
      const chooser = createMockChooser();
      const onToolComplete = jest.fn();

      const subTree = createSubTree("/wf")
        .node("")
        .handler(wrapFirstForHandoff(chooser))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      const r = tree.dispatch(
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
      const tree = new DevicesTree();
      const first = createMockCreator();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/workflow",
        first,
        second,
      });

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      const root = tree.getNode("/monitor/workflow");
      expect(root).not.toBeNull();
      expect(tree.getNode("/monitor/workflow/first")).not.toBeNull();
      expect(tree.getNode("/monitor/workflow/second")).not.toBeNull();
      expect(root.getSemantics()).toEqual({
        prefix: true,
        prefixKind: "handoff",
        routePolicy: "state-machine",
      });

      tree.dispatch({
        to: "/monitor/workflow",
        signals: [{ type: "position" }],
      });
      expect(tree.getNodeState("/monitor/workflow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
    });

    test("应自动桥接对象上下文", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      tree.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "position" }],
      });

      expect(tree.getNodeState("/monitor/ce/first")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });
      expect(tree.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
      });

      tree.dispatch({
        to: "/monitor/ce",
        signals: [{ type: "transform" }],
      });
      expect(tree.getNodeState("/monitor/ce/second")).toEqual({
        objects: [{ id: 42, type: "circle" }],
        touched: true,
      });
    });

    test("应在 second 调用完成回调后切回 first", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      tree.dispatch({ to: "/monitor/toggle", signals: [{ type: "position" }] });
      expect(tree.getNodeState("/monitor/toggle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      tree.dispatch({
        to: "/monitor/toggle",
        signals: [{ type: "transform" }],
      });
      expect(tree.getNodeState("/monitor/toggle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
    });

    test("应在真实 CommonObjectModifierTool 提交成功后切回 first 且保留 second 节点", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, accumulatedContext);

      tree.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "position" }],
        },
        accumulatedContext,
      );
      expect(tree.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      tree.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [
            { type: "displacement", context: { value: { x: 3, y: 1 } } },
          ],
        },
        accumulatedContext,
      );
      tree.dispatch(
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
      expect(tree.getNodeState("/monitor/modifier-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(tree.getNode("/monitor/modifier-cycle/second")).not.toBeNull();
      expect(tree.getNodeState("/monitor/modifier-cycle/second")).toEqual({});
    });

    test("应支持 chooser 作为 first", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      // Position signal: chooser selects, but no completion callback yet (no "end")
      tree.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "position" }],
      });
      // 初始状态在 prefix 内部 merge，未写入 node state
      expect(tree.getNodeState("/monitor/chooser-flow")).toEqual({});

      // End 信号触发 chooser 的完成回调 → handoff
      tree.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "end" }],
      });
      expect(tree.getNodeState("/monitor/chooser-flow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(tree.getNodeState("/monitor/chooser-flow/second")).toEqual({
        objects: [{ id: 7, type: "stroke" }],
      });
    });

    test("应支持 SubTreeDefinition 作为 first", () => {
      const tree = new DevicesTree();
      const firstSubTree = createSubTree("/chain")
        .node("")
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
        )
        .defaultChild("tool")
        .node("tool")
        .handler(() => ({
          to: "",
          signals: [{ type: "created" }],
        }))
        .end()
        .end()
        .build();

      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/nested",
        first: firstSubTree,
        second,
      });

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      expect(tree.getNode("/monitor/nested/first")).not.toBeNull();
      expect(tree.getNode("/monitor/nested/first/tool")).not.toBeNull();

      tree.dispatch({ to: "/monitor/nested", signals: [{ type: "trigger" }] });
      expect(tree.getNodeState("/monitor/nested")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(tree.getNodeState("/monitor/nested/second")).toEqual({
        objects: [{ id: 99 }],
      });
    });

    test("autoBridgeObjects = false 时应跳过对象桥接", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      tree.dispatch({
        to: "/monitor/no-bridge",
        signals: [{ type: "position" }],
      });
      // 对象不应被桥接到 second
      expect(tree.getNodeState("/monitor/no-bridge/second")).toEqual({});
    });

    test("first 无对象时不应崩溃", () => {
      const tree = new DevicesTree();
      // creator 不写入任何对象到 state
      const first = createMockCreator();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/empty",
        first,
        second,
      });

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      // 不应抛出异常
      expect(() => {
        tree.dispatch({
          to: "/monitor/empty",
          signals: [{ type: "position" }],
        });
      }).not.toThrow();

      // second 状态保持为空
      expect(tree.getNodeState("/monitor/empty/second")).toEqual({});
    });

    test("连续两次完成回调不应导致状态紊乱", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      // 第一次完成回调：first → second
      tree.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      expect(tree.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // 第二次 dispatch 信号路由到 second（modifier），first 的 process 不会被调用
      tree.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      // 状态保持 second（second 未发出完成回调，不会触发切换）
      expect(tree.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(toggleCount).toBe(1);
    });
  });

  describe("integration scenarios", () => {
    test("完整周期：creator 创建 → modifier 修改 → 切回 creator 重新创建", () => {
      const tree = new DevicesTree();
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

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      // 第一轮：creator → modifier
      tree.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
      });
      expect(tree.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(1);

      // modifier 收到 displacement
      tree.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "displacement", context: { value: { x: 5, y: 0 } } }],
      });
      // modifier 收到 success → 切回 first
      tree.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "success" }],
      });
      expect(tree.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "first",
        activeChild: "first",
      });

      // 第二轮：creator 再次创建
      tree.dispatch({
        to: "/monitor/full-cycle",
        signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
      });
      expect(tree.getNodeState("/monitor/full-cycle")).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(createdCount).toBe(2);
      expect(createdIds).toEqual([1, 2]);
    });
  });

  describe("wrapSubTreeForHandoff", () => {
    test("应在 end 信号后调用 onToolComplete 并保留原始输出", () => {
      const tree = new DevicesTree();
      const inner = createSubTree("/inner")
        .node("")
        .handler(() => ({
          to: "",
          signals: [{ type: "inner-done" }],
        }))
        .end()
        .build();

      const wrapped = wrapSubTreeForHandoff(inner);
      const outer = createSubTree("/outer")
        .node("")
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
        )
        .defaultChild("child")
        .node("child")
        .handler(wrapped.nodes.handler)
        .end()
        .end()
        .build();

      tree.mountSubTree("/monitor", outer, { board: {}, monitor: {} });

      const result = tree.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "end" }],
      });
      const secondResult = tree.dispatch({
        to: "/monitor/outer",
        signals: [{ type: "trigger" }],
      });

      expect(
        result.packets.some((p) =>
          p.signals.some((s) => s.type === "inner-done"),
        ),
      ).toBe(true);
      expect(tree.getNodeState("/monitor/outer")).toEqual({ completed: true });
      expect(
        secondResult.packets.some((p) =>
          p.signals.some((s) => s.type === "handled"),
        ),
      ).toBe(true);
    });
  });
});
