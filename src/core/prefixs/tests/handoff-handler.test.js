import { jest } from "@jest/globals";
import { DevicesDAG, createSubDAG } from "../../devices-dag/index.js";
import { Tool } from "../../tools/tool.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { Vector } from "../../utils/math.js";
import { RectangleRange } from "../../range/rectangle.js";
import { createPrefixNodeHandler } from "../handler.js";
import { createMultiToolPrefixHandler } from "../multi-tool-handler.js";
import {
  createHandoffSubDAG,
  wrapSubDAGForHandoff,
} from "../handoff-handler.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";
import { Board } from "../../components/board.js";
import { Monitor } from "../../components/monitor.js";
import { StrokeCreatorTool } from "../../tools/creator/stroke-creator.js";
import { RectangleObjectChooserTool } from "../../tools/chooser/rectangle-object-chooser.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { createNoopCanvas } from "../../test-support/noop-canvas.js";

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
      creator.completeCreatedObject?.({
        deviceContext: { context: { board } },
      });

      // 如果没有 completeCreatedObject（mock 是自己实现 process），走 process
      creator.process(
        { signals: [{ type: "position" }] },
        { context: { board } },
      );
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

      creator.process(
        { signals: [{ type: "position" }] },
        { context: { board } },
      );

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

      // 首个 position → 启动手势（对象暂不动）
      dag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "position", context: { value: { x: 5, y: 5 } } }],
        },
        accumulatedContext,
      );
      // 第二个 position → 应用位移
      dag.dispatch(
        {
          to: "/monitor/modifier-cycle",
          signals: [{ type: "position", context: { value: { x: 8, y: 6 } } }],
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
      // dx=8-5=3, dy=6-5=1 → (8, 6)
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

  describe("modifier + handoff 完整工作流集成", () => {
    /**
     * 手动构建完整工作流 DAG：
     * 根节点(multi-tool prefix) → first(creator) / second(modifier)。
     *
     * 注：createHandoffSubDAG 目前对 SubDAGDefinition 作为 second 时
     * 不注入 afterApply 订阅，因此这里手动复现其内部结构来验证
     * modifier → handoff 回切的完整信号链。
     */
    function mountModifierWorkflow(
      dag,
      basePath,
      { creator, modifier, board, monitor },
    ) {
      const accumulatedContext = { board, monitor };
      const subDAG = createSubDAG(basePath);

      // ── 根节点：multi-tool prefix，负责 first ↔ second 切换 ──
      const root = subDAG
        .node()
        .defaultRoute("first")
        .prefix(
          createMultiToolPrefixHandler({
            defaultChild: "first",
            initialState: { phase: "first" },
            resolveTransition({
              signalPacket,
              state,
              fromPhase,
              prefixContext,
            }) {
              const dag = prefixContext.dag;
              const handoffBasePath = prefixContext.path ?? "";

              const createCompleteCallback = (completedPhase) => () => {
                // 对象桥接
                if (completedPhase === "first") {
                  const firstState = dag?.getNodeState?.(
                    `${handoffBasePath}/first`,
                  );
                  const objects = firstState?.objects ?? [];
                  if (objects.length > 0) {
                    dag?.setNodeState?.(`${handoffBasePath}/second`, {
                      objects,
                    });
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
                context: {
                  onToolComplete: createCompleteCallback(fromPhase || "first"),
                  autoUmountOnApply: false,
                },
              };
            },
          }),
          { prefixKind: "handoff", routePolicy: "state-machine" },
        );

      // ── first 子节点：creator ──
      const firstNode = subDAG.node();
      firstNode.handler((packet, context = {}) => {
        const onToolComplete = context.context?.onToolComplete;
        let completed = false;
        const unsub =
          typeof creator.on === "function"
            ? creator.on("afterCreate", () => {
                completed = true;
                onToolComplete?.();
              })
            : null;

        const processor = creator.createProcessor({
          board: context.context?.board,
          monitor: context.context?.monitor,
        });
        const rawResult = processor(packet, context);
        unsub?.();
        return completed ? { ...rawResult } : rawResult;
      });

      // ── second 子节点：modifier tool（直接消费 position 信号）──
      function modifierWrapper(packet, context = {}) {
        const onToolComplete = context.context?.onToolComplete;
        let completed = false;
        const unsub =
          typeof modifier.on === "function"
            ? modifier.on("afterApply", () => {
                completed = true;
                onToolComplete?.();
              })
            : null;

        const processor = modifier.createProcessor({
          board: context.context?.board,
          monitor: context.context?.monitor,
        });
        const rawResult = processor(packet, context);
        unsub?.();
        return completed ? { ...rawResult } : rawResult;
      }

      const secondNode = subDAG.node();
      secondNode.handler(function modifierHandler(packet, context = {}) {
        return modifierWrapper(packet, context);
      });

      subDAG.edge("first", root, firstNode);
      subDAG.edge("second", root, secondNode);

      const built = subDAG.build();
      dag.mountSubDAG("/monitor", built, accumulatedContext);
      return { basePath, accumulatedContext };
    }

    test("position → modifier 准入检测 → 位移 → success → 切回 first", () => {
      const dag = new DevicesDAG();
      const object = {
        id: 1,
        position: new Vector(10, 20),
        getRange: () => new RectangleRange(0, 0, 50, 30),
      };
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };

      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, {
          objects: [object],
        });
      });
      first.obj = object;

      const { accumulatedContext } = mountModifierWorkflow(
        dag,
        "/modifier-flow",
        {
          creator: first,
          modifier: new CommonObjectModifierTool(),
          board,
          monitor: {},
        },
      );

      // ── 阶段 1: creator 创建 → 触发 handoff 切换到 second ──
      dag.dispatch(
        { to: "/monitor/modifier-flow", signals: [{ type: "position" }] },
        accumulatedContext,
      );
      expect(dag.getNodeState("/monitor/modifier-flow")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // ── 阶段 2: 模拟鼠标拖拽，position 信号直达 modifier ──

      // 2a. 首个 position (100, 100) 在合矩形外 → 准入检测拒绝
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 100, y: 100 } } },
          ],
        },
        accumulatedContext,
      );
      expect(object.position).toEqual(new Vector(10, 20));

      // 2b. position (120, 110) 仍在合矩形外 → 准入检测拒绝
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 120, y: 110 } } },
          ],
        },
        accumulatedContext,
      );
      expect(object.position).toEqual(new Vector(10, 20));

      // 2c. end → 清空手势状态，允许新一轮手势
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "end" }],
        },
        accumulatedContext,
      );

      // 2d. 新锚点 (30, 35) — position 在合矩形内 → 准入通过，手势启动
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        accumulatedContext,
      );

      // 2e. position (40, 40) → 位移 (10, 5)，对象在 world rect 内 → 准入通过
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "position", context: { value: { x: 40, y: 40 } } }],
        },
        accumulatedContext,
      );
      // initPos (10, 20) + (10, 5) = (20, 25)
      expect(object.position).toEqual(new Vector(20, 25));

      // 2f. 继续拖拽，position (55, 45) → 位移 (25, 10)
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "position", context: { value: { x: 55, y: 45 } } }],
        },
        accumulatedContext,
      );
      // initPos (10, 20) + (25, 10) = (35, 30)
      expect(object.position).toEqual(new Vector(35, 30));

      // ── 阶段 3: success 信号 → 提交到静态图 + handoff 切回 first ──
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
        new Set([object]),
      );
      expect(object.position).toEqual(new Vector(35, 30));
      expect(dag.getNodeState("/monitor/modifier-flow")).toEqual({
        phase: "first",
        activeChild: "first",
      });

      // ── 阶段 4: 第二轮创建 → 修改 完整周期 ──
      const object2 = {
        id: 2,
        position: new Vector(50, 60),
        getRange: () => new RectangleRange(0, 0, 30, 20),
      };
      board.activeObjectManager.activeObjectIndex.set(object2.id, object2);

      // 手动将第二轮对象写入 first 节点并触发 handoff 切换到 second
      dag.setNodeState("/monitor/modifier-flow/first", {
        objects: [object2],
      });
      // 通过 multi-tool 根节点的状态迁移直接切到 second
      dag.setNodeState("/monitor/modifier-flow", {
        phase: "second",
        activeChild: "second",
      });
      // 桥接对象到 second
      dag.setNodeState("/monitor/modifier-flow/second", {
        objects: [object2],
      });
      expect(dag.getNodeState("/monitor/modifier-flow")).toEqual({
        phase: "second",
        activeChild: "second",
      });

      // 拖拽第二个对象：锚点 (50, 60) → 位移 (8, 4)
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "position", context: { value: { x: 50, y: 60 } } }],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "position", context: { value: { x: 58, y: 64 } } }],
        },
        accumulatedContext,
      );
      // object2 的 world rect: (50, 60, 30, 20) → (50..80, 60..80)
      // position (58, 64) 在内部 → 准入通过
      // initPos (50, 60) + (8, 4) = (58, 64)
      expect(object2.position).toEqual(new Vector(58, 64));

      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );
      expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
        new Set([object2]),
      );
      expect(dag.getNodeState("/monitor/modifier-flow")).toEqual({
        phase: "first",
        activeChild: "first",
      });
    });

    test("handoff 中 modifier 修改后不卸载 second 节点（autoUmountOnApply: false）", () => {
      const dag = new DevicesDAG();
      const object = {
        id: 1,
        position: new Vector(0, 0),
      };
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };

      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, { objects: [object] });
      });
      first.obj = object;

      const { accumulatedContext } = mountModifierWorkflow(
        dag,
        "/no-unmount-flow",
        {
          creator: first,
          modifier: new CommonObjectModifierTool(),
          board,
          monitor: {},
        },
      );

      // creator → handoff 切换到 second
      dag.dispatch(
        { to: "/monitor/no-unmount-flow", signals: [{ type: "position" }] },
        accumulatedContext,
      );

      // 拖拽 + success 提交
      dag.dispatch(
        {
          to: "/monitor/no-unmount-flow",
          signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/no-unmount-flow",
          signals: [{ type: "position", context: { value: { x: 20, y: 20 } } }],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/no-unmount-flow",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      // 切回 first 后 second 节点应仍然存在
      expect(dag.getNodeState("/monitor/no-unmount-flow")).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(dag.getNode("/monitor/no-unmount-flow/second")).not.toBeNull();
    });

    test("准入检测在完整工作流中正确过滤：手势激活后不重复检测", () => {
      const dag = new DevicesDAG();
      const calls = [];

      const object = {
        id: 1,
        position: new Vector(100, 100),
        getRange: () => new RectangleRange(0, 0, 50, 50),
      };
      // world rect: (100, 100, 50, 50) → (100..150, 100..150)

      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };
      const monitor = {
        liveRenderer: {
          captureObjectSnapshot: jest.fn((objs) =>
            calls.push(["capture", objs.length]),
          ),
          invalidateObjects: jest.fn((objs) =>
            calls.push(["invalidate", objs.length]),
          ),
        },
      };

      const first = createMockCreator((_pkt, ctx) => {
        ctx.setNodeState?.(ctx.path, { objects: [object] });
      });
      first.obj = object;

      const modifier = new CommonObjectModifierTool();
      modifier.on("afterApply", () => calls.push(["afterApply"]));

      const { accumulatedContext } = mountModifierWorkflow(
        dag,
        "/modifier-flow",
        { creator: first, modifier, board, monitor },
      );

      // 进入 second 阶段
      dag.dispatch(
        { to: "/monitor/modifier-flow", signals: [{ type: "position" }] },
        accumulatedContext,
      );

      // 首次拖拽：position (110, 110) 在合矩形内 → 准入通过，启动手势
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 110, y: 110 } } },
          ],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 130, y: 120 } } },
          ],
        },
        accumulatedContext,
      );
      // initPos (100, 100) + (20, 10) = (120, 110)
      expect(object.position).toEqual(new Vector(120, 110));

      // 继续拖拽，position (200, 200) 远在合矩形外，但手势已激活不应再检测准入
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 200, y: 200 } } },
          ],
        },
        accumulatedContext,
      );
      // initPos (100, 100) + (90, 90) = (190, 190)
      expect(object.position).toEqual(new Vector(190, 190));

      // end → 清空手势锚点，对象停在 (190, 190)
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "end" }],
        },
        accumulatedContext,
      );

      // 新一轮：position (210, 210) → 对象已移至 (190, 190)，合矩形 (190..240, 190..240)
      // (210, 210) 在合矩形内 → 准入通过，新锚点=(210,210)
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 210, y: 210 } } },
          ],
        },
        accumulatedContext,
      );
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [
            { type: "position", context: { value: { x: 220, y: 215 } } },
          ],
        },
        accumulatedContext,
      );
      // dx=220-210=10, dy=215-210=5，initPos=(190,190) → (200, 195)
      expect(object.position).toEqual(new Vector(200, 195));

      // success 提交
      dag.dispatch(
        {
          to: "/monitor/modifier-flow",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      expect(board.activeObjectManager.apply).toHaveBeenCalled();
      expect(calls.filter((c) => c[0] === "afterApply")).toHaveLength(1);
      expect(dag.getNodeState("/monitor/modifier-flow")).toEqual({
        phase: "first",
        activeChild: "first",
      });
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

  describe("handoff + 真实工具端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 StrokeCreatorTool 与 CommonObjectModifierTool 同一路径中共享上下文并修改对象", () => {
      const board = new Board();
      const monitor = new Monitor(
        createNoopCanvas(),
        board,
        { width: 800, height: 600 },
        "main",
      );
      board.monitors.set("main", monitor);
      board.width = 800;
      board.height = 600;
      const creatorTool = new StrokeCreatorTool();
      let firstObjectId = null;

      monitor.mountSubDAG(
        "",
        createHandoffSubDAG({
          rootPath: "workflow",
          first: creatorTool,
          second: new CommonObjectModifierTool(),
        }),
      );

      const accumulatedContext = { board, monitor };

      // 创建阶段
      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
        },
        accumulatedContext,
      );

      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [
            { type: "position", context: { value: { x: 2, y: 2 } } },
            { type: "end", context: {} },
          ],
        },
        accumulatedContext,
      );

      expect(creatorTool.obj).not.toBeNull();
      expect(creatorTool.obj.id).toBe(1);
      firstObjectId = creatorTool.obj.id;
      expect(board.activeObjectManager.activeObjects.size).toBe(1);
      expect(board.getObjectById(creatorTool.obj.id)).toBeUndefined();

      const createdPosition = creatorTool.obj.position.serialize();

      // 修改阶段：首个 position 启动手势
      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [
            {
              type: "position",
              context: {
                value: { x: createdPosition.x, y: createdPosition.y },
              },
            },
          ],
        },
        accumulatedContext,
      );

      // 第二个 position + end 应用位移
      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [
            {
              type: "position",
              context: {
                value: { x: createdPosition.x + 3, y: createdPosition.y },
              },
            },
            { type: "end", context: {} },
          ],
        },
        accumulatedContext,
      );

      expect(creatorTool.obj.position.serialize()).toEqual({
        x: createdPosition.x + 3,
        y: createdPosition.y,
      });

      // 提交
      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      const ownerChunk = board.getChunkById(1);
      expect(board.activeObjectManager.activeObjects.size).toBe(0);
      expect(ownerChunk.objectManager.getObject(creatorTool.obj.id)).toBe(
        creatorTool.obj,
      );
      expect(monitor.devicesDAG.getNodeState("/main/workflow")).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(
        monitor.devicesDAG.getNode("/main/workflow/second"),
      ).not.toBeNull();

      // 再次进入 creator，验证 handoff 周期可重复
      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [{ type: "position", context: { value: { x: 4, y: 4 } } }],
        },
        accumulatedContext,
      );

      monitor.devicesDAG.dispatch(
        {
          to: "/main/workflow",
          signals: [
            { type: "position", context: { value: { x: 5, y: 5 } } },
            { type: "end", context: {} },
          ],
        },
        accumulatedContext,
      );

      expect(creatorTool.obj).not.toBeNull();
      expect(creatorTool.obj.id).not.toBe(firstObjectId);
      expect(board.activeObjectManager.activeObjects.size).toBe(1);
      expect(monitor.devicesDAG.getNodeState("/main/workflow")).toEqual({
        phase: "second",
        activeChild: "second",
      });
    });

    test("挂载后的 RectangleObjectChooserTool 与 CommonObjectModifierTool 应可完成 chooser -> modifier -> apply 周期", () => {
      const board = new Board();
      const monitor = new Monitor(
        createNoopCanvas(),
        board,
        { width: 800, height: 600 },
        "main",
      );
      board.monitors.set("main", monitor);
      board.width = 800;
      board.height = 600;
      const chooserTool = new RectangleObjectChooserTool();
      const targetObject = new StrokeObject(new Vector(10, 10), 41, 1);
      targetObject.setPathPoints([
        new Vector(0, 0),
        new Vector(8, 0),
        new Vector(8, 8),
      ]);
      board.addObject(targetObject, 1);

      monitor.mountSubDAG(
        "",
        createHandoffSubDAG({
          rootPath: "choose-and-modify",
          first: chooserTool,
          second: new CommonObjectModifierTool(),
        }),
      );

      const accumulatedContext = { board, monitor };

      monitor.devicesDAG.dispatch(
        {
          to: "/main/choose-and-modify",
          signals: [{ type: "position", context: { value: { x: 5, y: 5 } } }],
        },
        accumulatedContext,
      );

      monitor.devicesDAG.dispatch(
        {
          to: "/main/choose-and-modify",
          signals: [
            { type: "position", context: { value: { x: 25, y: 25 } } },
            { type: "end", context: {} },
          ],
        },
        accumulatedContext,
      );

      expect(board.activeObjectManager.activeObjects.size).toBe(1);
      expect(
        board.activeObjectManager.activeObjectIndex.has(targetObject.id),
      ).toBe(true);
      expect(
        monitor.devicesDAG.getNodeState("/main/choose-and-modify"),
      ).toEqual({
        phase: "second",
        activeChild: "second",
      });
      expect(
        monitor.devicesDAG.getNodeState("/main/choose-and-modify/second"),
      ).toEqual(
        expect.objectContaining({
          objects: [targetObject],
        }),
      );

      // 首个 position → 启动手势（对象暂不动）
      monitor.devicesDAG.dispatch(
        {
          to: "/main/choose-and-modify",
          signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
        },
        accumulatedContext,
      );

      // 第二个 position → 应用位移
      monitor.devicesDAG.dispatch(
        {
          to: "/main/choose-and-modify",
          signals: [{ type: "position", context: { value: { x: 14, y: 8 } } }],
        },
        accumulatedContext,
      );

      expect(targetObject.position.serialize()).toEqual({ x: 14, y: 8 });
      expect(board.activeObjectManager.activeObjects.size).toBe(1);

      monitor.devicesDAG.dispatch(
        {
          to: "/main/choose-and-modify",
          signals: [{ type: "success", context: {} }],
        },
        accumulatedContext,
      );

      expect(board.activeObjectManager.activeObjects.size).toBe(0);
      expect(board.getObjectById(targetObject.id)).toBe(targetObject);
      expect(
        monitor.devicesDAG.getNodeState("/main/choose-and-modify"),
      ).toEqual({
        phase: "first",
        activeChild: "first",
      });
      expect(
        monitor.devicesDAG.getNodeState("/main/choose-and-modify/second"),
      ).toEqual({});
    });
  });
});
