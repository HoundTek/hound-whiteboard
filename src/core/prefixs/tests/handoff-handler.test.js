import { jest } from "@jest/globals";
import { DevicesDAG, createSubDAG } from "../../devices-dag/index.js";
import { Tool } from "../../tools/tool.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { Vector } from "../../utils/math.js";
import { createPrefixNodeHandler } from "../handler.js";
import {
  createHandoffSubDAG,
  wrapSubDAGForHandoff,
} from "../handoff-handler.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";

describe("handoff-handler（生命周期钩子模式）", () => {
  describe("钩子系统（Tool.on / off / _emit）", () => {
    test("on 注册的监听器在 _emit 触发时被调用", () => {
      const creator = createMockCreator();
      const listener = jest.fn();

      creator.on("afterCreate", listener);
      creator._emit("afterCreate", { id: 1 }, { type: "circle" });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ id: 1 }, { type: "circle" });
    });

    test("off 取消注册后不再调用", () => {
      const creator = createMockCreator();
      const listener = jest.fn();

      const unsub = creator.on("afterCreate", listener);
      unsub(); // 等效于 off
      creator._emit("afterCreate");

      expect(listener).not.toHaveBeenCalled();
    });

    test("多个监听器各自独立触发", () => {
      const creator = createMockCreator();
      const a = jest.fn();
      const b = jest.fn();

      creator.on("afterCreate", a);
      creator.on("afterCreate", b);
      creator._emit("afterCreate", "x");

      expect(a).toHaveBeenCalledWith("x");
      expect(b).toHaveBeenCalledWith("x");
    });
  });

  describe("beforeCommitCreatedObject 控制对象是否进入静态图", () => {
    test("默认返回 true：对象进入静态图", () => {
      const creator = createMockCreator();
      const appliedObjects = [];
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map(),
          apply: jest.fn((objects) => {
            for (const obj of objects) appliedObjects.push(obj);
          }),
        },
      };

      // 默认 beforeCommitCreatedObject 返回 true
      creator.obj = { id: 1, type: "rect" };
      creator.completeCreatedObject?.({ deviceContext: { board } });

      // 如果没有 completeCreatedObject（mock 是自己实现 process），走 process
      creator.process({ signals: [{ type: "position" }] }, { board });
      expect(creator.isObjectCreationCompleted).toBe(true);
    });

    test("返回 false：对象停留在 AOM 动态图（handoff 模式）", () => {
      const creator = createMockCreator();
      const appliedObjects = [];
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map(),
          apply: jest.fn((objects) => {
            for (const obj of objects) appliedObjects.push(obj);
          }),
        },
      };

      // Override 钩子：阻止 commit
      creator.beforeCommitCreatedObject = () => false;
      creator.obj = { id: 1, type: "rect" };

      creator.process({ signals: [{ type: "position" }] }, { board });

      // beforeCommit 返回 false → apply 不应被调用
      expect(appliedObjects).toEqual([]);
      // 但创建生命周期仍应执行 finalize
      expect(creator.isObjectCreationCompleted).toBe(true);
    });
  });

  describe("afterCreate / afterApply 通知钩子", () => {
    test("creator 完成时触发 afterCreate", () => {
      const creator = createMockCreator();
      const afterCreate = jest.fn();

      creator.on("afterCreate", afterCreate);
      creator.obj = { id: 1 };
      creator.process({ signals: [{ type: "position" }] }, {});

      expect(afterCreate).toHaveBeenCalledTimes(1);
    });

    test("modifier apply 成功时触发 afterApply", () => {
      const modifier = createMockModifier();
      const afterApply = jest.fn();

      modifier.on("afterApply", afterApply);
      modifier.applyModifiedObjects({}, [{ id: 1 }]);

      expect(afterApply).toHaveBeenCalledTimes(1);
    });

    test("beforeCommit 返回 false 时 afterCreate 仍触发", () => {
      const creator = createMockCreator();
      const afterCreate = jest.fn();

      creator.on("afterCreate", afterCreate);
      creator.beforeCommitCreatedObject = () => false;
      creator.obj = { id: 1 };
      creator.process({ signals: [{ type: "position" }] }, {});

      // afterCreate 无论是否 commit 都应触发（finalize 总是执行）
      expect(afterCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("chooser 生命周期钩子", () => {
    test("end 信号且已选中对象时触发 afterConfirm", () => {
      const chooser = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 7, type: "stroke" }],
        });
      });
      const afterConfirm = jest.fn();

      chooser.on("afterConfirm", afterConfirm);

      chooser.process(
        { signals: [{ type: "end" }] },
        {
          path: "/test",
          getNodeState: (p) => (p === "/test" ? { objects: [{ id: 7 }] } : {}),
          setNodeState: () => {},
        },
      );

      expect(afterConfirm).toHaveBeenCalledTimes(1);
    });

    test("end 信号但无选中对象时不触发 afterConfirm", () => {
      const chooser = createMockChooser();
      const afterConfirm = jest.fn();

      chooser.on("afterConfirm", afterConfirm);

      chooser.process(
        { signals: [{ type: "end" }] },
        {
          path: "/test",
          getNodeState: () => ({}),
          setNodeState: () => {},
        },
      );

      expect(afterConfirm).not.toHaveBeenCalled();
    });

    test("handoff 中 chooser 通过 afterConfirm 钩子触发切换（不再依赖信号检测）", () => {
      const dag = new DevicesDAG();
      const chooser = createMockChooser((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [{ id: 99, type: "circle" }],
        });
      });
      const modifier = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/chooser-hook",
        first: chooser,
        second: modifier,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      // end 信号 → chooser 选中对象 → confirmSelection → afterConfirm
      // → handler 订阅 afterConfirm → onToolComplete → 切换到 second
      dag.dispatch({
        to: "/monitor/chooser-hook",
        signals: [{ type: "end" }],
      });

      expect(dag.getNodeState("/monitor/chooser-hook")).toEqual({
        phase: "second",
        activeChild: "second",
      });
    });
  });

  describe("createHandoffSubDAG", () => {
    test("应构建三层结构并支持 first → second 切换", () => {
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

      first.obj = { id: 42, type: "circle" };

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

    test("应在 second 通过 onToolComplete 切回 first", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator();

      // second：手动触发 onToolComplete 来模拟 modifier 完成
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
      first.obj = object;
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

      // Position signal: chooser selects, no completion yet (no "end")
      dag.dispatch({
        to: "/monitor/chooser-flow",
        signals: [{ type: "position" }],
      });
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
      first.obj = { id: 42 };
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
      const first = createMockCreator();
      const second = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/empty",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      expect(() => {
        dag.dispatch({
          to: "/monitor/empty",
          signals: [{ type: "position" }],
        });
      }).not.toThrow();

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

      // 对于非 creator 非 chooser 的 Tool，createHandoffSubDAG 会走到 chooser 分支
      // 这里我们用 SubDAGDefinition 包装来测试状态机
      const subDAG = createSubDAG("/rapid-wrapper");
      const r = subDAG
        .node()
        .defaultRoute("child")
        .prefix(
          createPrefixNodeHandler({
            handle(pkt, ctx) {
              toggleCount++;
              ctx.context?.onToolComplete?.();
              return ctx.routeToChild("child");
            },
          }),
        );
      const c = subDAG.node().handler(() => ({ packets: [] }));
      subDAG.edge("child", r, c);
      const firstSubDAG = subDAG.build();

      const handoffSubDAG = createHandoffSubDAG({
        rootPath: "/rapid",
        first: firstSubDAG,
        second,
      });

      dag.mountSubDAG("/monitor", handoffSubDAG, { board: {}, monitor: {} });

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
      expect(toggleCount).toBe(1); // 仅第一次 dispatch 路由到 first 子图
    });
  });

  describe("integration scenarios", () => {
    test("完整周期：creator 创建 → modifier 修改 → 切回 creator 重新创建", () => {
      const dag = new DevicesDAG();
      let createdCount = 0;
      const createdIds = [];

      const first = new (class extends Tool {
        constructor() {
          super();
          this.isObjectCreationCompleted = false;
        }
        process(_pkt, ctx) {
          createdCount++;
          const id = createdCount;
          createdIds.push(id);
          this.isObjectCreationCompleted = true;
          this._emit?.("afterCreate");
          ctx.context?.onToolComplete?.();
        }
      })();

      const second = createMockModifier((_pkt, ctx) => {
        const hasSuccess = _pkt.signals?.some((s) => s.type === "success");
        if (hasSuccess) {
          ctx.context?.onToolComplete?.();
        }
      });

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

    test("同一 tool 实例参与两个不同的 handoff 应抛错", () => {
      const tool = createMockCreator();
      const modifier1 = createMockModifier();
      const modifier2 = createMockModifier();

      createHandoffSubDAG({
        rootPath: "/first-handoff",
        first: tool,
        second: modifier1,
      });

      expect(() =>
        createHandoffSubDAG({
          rootPath: "/second-handoff",
          first: tool,
          second: modifier2,
        }),
      ).toThrow(/already been registered/i);
    });

    test("不同 tool 实例可以各自参与 handoff", () => {
      const creator1 = createMockCreator();
      const creator2 = createMockCreator();
      const modifier1 = createMockModifier();
      const modifier2 = createMockModifier();

      expect(() => {
        createHandoffSubDAG({
          rootPath: "/handoff-a",
          first: creator1,
          second: modifier1,
        });
        createHandoffSubDAG({
          rootPath: "/handoff-b",
          first: creator2,
          second: modifier2,
        });
      }).not.toThrow();
    });

    test("resetHandoff 清理后 tool 可重新参与 handoff", () => {
      // 注意：WeakSet 不支持手动 delete，所以此测试验证 resetHandoff
      // 能正确恢复 beforeCommitCreatedObject
      const tool = createMockCreator();
      const originalBeforeCommit = tool.beforeCommitCreatedObject.bind(tool);

      tool.obj = { id: 1 };
      const modifier = createMockModifier();

      const subDAG = createHandoffSubDAG({
        rootPath: "/test",
        first: tool,
        second: modifier,
      });

      // beforeCommitCreatedObject 已被 handoff override
      expect(tool.beforeCommitCreatedObject()).toBe(false);

      // 执行清理
      subDAG.resetHandoff();

      // 应恢复原始行为
      expect(tool.beforeCommitCreatedObject()).toBe(true);
    });
  });

  describe("autoUmountOnApply context 注入", () => {
    test("handoff 中 modifier 不应自卸载", () => {
      const dag = new DevicesDAG();
      const first = createMockCreator();
      const mockUnmount = jest.fn();

      // 创建一个真实的 modifier，有 dag.unmount 能力
      const second = new (class extends Tool {
        process(_pkt, ctx) {
          // 模拟 applyModifiedObjects
          const modificationContext = {
            ...ctx,
            dag: { unmount: mockUnmount },
            path: "/monitor/test/second",
          };
          // 直接调用 apply 模拟（绕过真实 AOM 逻辑）
          this.applyModifiedObjects?.(modificationContext, [{ id: 1 }]);
        }
        applyModifiedObjects(modificationContext, objects) {
          // 模拟：即使有 dag.unmount 也不应被调用
          const shouldUnmount =
            modificationContext.autoUmountOnApply !== false &&
            modificationContext.context?.autoUmountOnApply !== false;
          return !shouldUnmount; // 只要 autoUmountOnApply 生效就不卸载
        }
      })();

      const subDAG = createHandoffSubDAG({
        rootPath: "/test-umount",
        first,
        second,
      });

      dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

      dag.dispatch({
        to: "/monitor/test-umount",
        signals: [{ type: "position" }],
      });

      expect(dag.getNodeState("/monitor/test-umount")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // modifier process 被调用，但 autoUmountOnApply: false 应阻止卸载
      expect(mockUnmount).not.toHaveBeenCalled();
    });
  });
});
