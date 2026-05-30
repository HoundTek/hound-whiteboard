import { DevicesTree, createSubTree } from "../../devices/devices-tree.js";
import { Tool } from "../../tools/tool.js";
import { createPrefixNodeHandler } from "../handler.js";
import {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
} from "../handoff-handler.js";
import { PREFIX_NODE_SIGNAL_TYPES } from "../constants.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";

describe("handoff-handler", () => {
  describe("hook functions", () => {
    test("wrapCreatorForHandoff 应在 completeCreatedObject 后追加 TOOL_COMPLETE", () => {
      const tree = new DevicesTree();
      const creator = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.eventContext?.path, { objects: [{ id: 1 }] });
      });

      const subTree = createSubTree("/handoff")
        .node("")
        .prefix(
          createPrefixNodeHandler({
            handle(packet, ctx) {
              return packet.signals.some(
                (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
              )
                ? ctx.routeToChild("second")
                : ctx.routeToChild("first");
            },
          }),
        )
        .defaultChild("first")
        .node("first")
        .handler(wrapCreatorForHandoff(creator))
        .end()
        .node("second")
        .handler((_pkt, ctx) => ({
          to: ctx.eventContext.path,
          signals: [{ type: "modified" }],
        }))
        .end()
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
      const result = tree.dispatch({
        to: "/monitor/handoff",
        signals: [{ type: "position" }],
      });
      expect(result).toEqual([
        {
          to: "/monitor/handoff/second",
          signals: [{ type: "modified" }],
        },
      ]);
    });

    test("wrapFirstForHandoff 对 creator 应走 completeCreatedObject 路径", () => {
      const tree = new DevicesTree();
      const creator = createMockCreator();

      const subTree = createSubTree("/wf")
        .node("")
        .handler(wrapFirstForHandoff(creator))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
      const result = tree.dispatch({
        to: "/monitor/wf",
        signals: [{ type: "position" }],
      });
      expect(
        result.some((p) =>
          p.signals.some(
            (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
          ),
        ),
      ).toBe(true);
    });

    test("wrapFirstForHandoff 对 chooser 应在 end 信号且已选中对象后追加 TOOL_COMPLETE", () => {
      const tree = new DevicesTree();
      const selectedObject = { id: 1 };
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

      const r1 = tree.dispatch({
        to: "/monitor/wf",
        signals: [{ type: "position" }],
      });
      expect(
        r1.some((p) =>
          p.signals.some(
            (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
          ),
        ),
      ).toBe(false);

      const r2 = tree.dispatch({
        to: "/monitor/wf",
        signals: [{ type: "end" }],
      });
      expect(
        r2.some((p) =>
          p.signals.some(
            (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
          ),
        ),
      ).toBe(true);
    });

    test("wrapFirstForHandoff 对 chooser 选择失败时不应追加 TOOL_COMPLETE", () => {
      const tree = new DevicesTree();
      // 不写入对象 → 选择失败
      const chooser = createMockChooser();

      const subTree = createSubTree("/wf")
        .node("")
        .handler(wrapFirstForHandoff(chooser))
        .end()
        .build();

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      const r = tree.dispatch({
        to: "/monitor/wf",
        signals: [{ type: "end" }],
      });
      expect(
        r.some((p) =>
          p.signals.some(
            (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
          ),
        ),
      ).toBe(false);
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
        ctx.setNodeState?.(ctx.eventContext?.path, {
          objects: [{ id: 42, type: "circle" }],
        });
      });
      const second = createMockModifier((_pkt, ctx) => {
        const st = ctx.getNodeState?.(ctx.eventContext?.path);
        if (st?.objects) {
          ctx.setNodeState?.(ctx.eventContext?.path, { ...st, touched: true });
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

    test("应在 second 返回 TOOL_COMPLETE 后切回 first", () => {
      const tree = new DevicesTree();
      const first = createMockCreator();
      const second = new (class extends Tool {
        process() {
          return {
            to: "..",
            signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
          };
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

    test("应支持 chooser 作为 first", () => {
      const tree = new DevicesTree();
      const first = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.eventContext?.path, {
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

      // Position signal: chooser selects, but no TOOL_COMPLETE (no "end")
      tree.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "position" }],
      });
      // 初始状态在 prefix 内部 merge，未写入 node state
      expect(tree.getNodeState("/monitor/chooser-flow")).toEqual({});

      // End 信号触发 chooser 的 TOOL_COMPLETE → handoff
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
              ctx.setNodeState?.(ctx.eventContext?.path, {
                objects: [{ id: 99 }],
              });
              return [
                ctx.routeToChild("tool"),
                {
                  to: "..",
                  signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
                },
              ];
            },
          }),
        )
        .defaultChild("tool")
        .node("tool")
        .handler((_pkt, ctx) => ({
          to: ctx.eventContext.path,
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
        ctx.setNodeState?.(ctx.eventContext?.path, {
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

    test("连续两次 TOOL_COMPLETE 不应导致状态紊乱", () => {
      const tree = new DevicesTree();
      let toggleCount = 0;
      // first 每次 process 都发出 TOOL_COMPLETE + 写入不同对象
      const first = new (class extends Tool {
        process() {
          toggleCount++;
          return [
            {
              to: "..",
              signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
            },
          ];
        }
      })();
      const second = createMockModifier();

      const subTree = createHandoffSubTree({
        rootPath: "/rapid",
        first,
        second,
      });

      tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

      // 第一次 TOOL_COMPLETE: first → second
      tree.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      expect(tree.getNodeState("/monitor/rapid")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // 第二次 dispatch 信号路由到 second（modifier），first 的 process 不会被调用
      tree.dispatch({ to: "/monitor/rapid", signals: [{ type: "trigger" }] });
      // 状态保持 second（second 无 handler 返回 TOOL_COMPLETE，不会触发切换）
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
        process() {
          createdCount++;
          const id = createdCount;
          createdIds.push(id);
          // 模拟 completeCreatedObject
          return [
            {
              to: "..",
              signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
            },
          ];
        }
      })();

      const second = new (class extends Tool {
        process(pkt) {
          const hasSuccess = pkt.signals?.some((s) => s.type === "success");
          if (hasSuccess) {
            return [
              {
                to: "..",
                signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
              },
            ];
          }
          return undefined;
        }
      })();

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
    test("应在 end 信号后补 TOOL_COMPLETE 并被父 prefix 消费", () => {
      const tree = new DevicesTree();
      const inner = createSubTree("/inner")
        .node("")
        .handler((_pkt, ctx) => ({
          to: ctx.eventContext.path,
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
              return packet.signals.some(
                (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
              )
                ? [
                    {
                      to: ctx.eventContext.path,
                      signals: [{ type: "handled" }],
                    },
                  ]
                : ctx.routeToChild("child");
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

      expect(
        result.some((p) => p.signals.some((s) => s.type === "inner-done")),
      ).toBe(true);
      expect(
        result.some((p) => p.signals.some((s) => s.type === "handled")),
      ).toBe(true);
    });
  });
});
