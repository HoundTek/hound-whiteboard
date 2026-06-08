import { Board } from "../board.js";
import { Monitor } from "../monitor.js";
import { createSubDAG } from "../../devices-dag/index.js";
import { createEdgePrefix, createHandoffSubDAG } from "../../prefixs/index.js";
import { Vector } from "../../utils/math.js";
import { StrokeCreatorTool } from "../../tools/creator/stroke-creator.js";
import { PolygonCreatorTool } from "../../tools/creator/polygon-creator.js";
import { RectangleObjectChooserTool } from "../../tools/chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { createMouseDevice } from "../../devices/mouse-device.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { createNoopCanvas } from "../../test-support/noop-canvas.js";
import { CollectingTool } from "../../test-support/mock-tools.js";
import {
  KEYBOARD_DEVICE_SIGNAL_TYPES,
  createKeyboardDevice,
} from "../../devices/keyboard-device.js";

describe("Board input flow", () => {
  function createCanvas() {
    return createNoopCanvas({ width: 800, height: 600 });
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;
    const monitor = new Monitor(
      createCanvas(),
      board,
      { width: 800, height: 600 },
      monitorId,
    );
    board.monitors.set(monitorId, monitor);
    return monitor;
  }

  test("input 事件应经由 Board、Monitor 与 DevicesDAG 落到工具节点", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new CollectingTool();

    const sampleBuilder = createSubDAG("/sample-device");
    const sampleRoot = sampleBuilder.node().defaultRoute("tool");
    const sampleTool = sampleBuilder
      .node()
      .handler(tool.createProcessor({ board, monitor }));
    sampleBuilder.edge("tool", sampleRoot, sampleTool);

    monitor.mountSubDAG("", sampleBuilder.build());

    const emitResults = board.signalsEventBus.emit("input", {
      to: "/main/sample-device",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(emitResults).toEqual([undefined]);
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0].signalPacket.to).toBe("");
    expect(tool.calls[0].signalPacket.signals).toEqual([
      { type: "position", context: { value: { x: 3, y: 4 } } },
    ]);
    expect(tool.calls[0].deviceContext).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({ board, monitor }),
        path: "/main/sample-device/tool",
      }),
    );
  });

  test("input 事件指向不存在的 monitor 时应被忽略", () => {
    const board = new Board();

    expect(() =>
      board.signalsEventBus.emit("input", {
        to: "/missing/sample-device",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).not.toThrow();
  });

  test("mount 与 umount 事件应在运行时挂载和卸载工具节点", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new CollectingTool();

    const emptyBuilder = createSubDAG("/sample-device");
    emptyBuilder.node().defaultRoute("tool");

    monitor.mountSubDAG("", emptyBuilder.build());

    const mountResults = board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "sample-device-tool",
      workflow: tool,
      edges: [{ from: "/sample-device", edge: "tool" }],
    });

    expect(mountResults).toHaveLength(1);
    expect(
      monitor.devicesDAG.getNode("/main/sample-device/tool"),
    ).not.toBeNull();

    board.signalsEventBus.emit("input", {
      to: "/main/sample-device",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0].deviceContext).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({ board, monitor }),
        path: "/main/sample-device/tool",
      }),
    );

    const umountResults = board.signalsEventBus.emit("umount", {
      monitorId: "main",
      name: "sample-device-tool",
      edges: [{ from: "/sample-device", edge: "tool" }],
    });

    expect(umountResults).toEqual([true]);
    expect(
      monitor.devicesDAG.getNode("/main/sample-device/tool"),
    ).toBeUndefined();
  });

  test("mount 事件应支持 edge.prefix 在设备节点与 workflow 之间注入边级 prefix 链", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const keyboardDevice = createKeyboardDevice();

    monitor.mountSubDAG("", keyboardDevice);

    const receivedPackets = [];
    const workflow = {
      createProcessor: () => (packet) => {
        receivedPackets.push({ to: packet.to, signals: packet.signals });
        return [];
      },
    };

    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "strafe-workflow",
      workflow,
      edges: [
        {
          from: "/keyboard/code/KeyW",
          edge: "default",
          prefix: createEdgePrefix({
            handler(packet) {
              const signals = packet.signals
                .filter(
                  (signal) =>
                    signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
                )
                .map(() => ({
                  type: "position",
                  context: { value: { x: 1, y: 0 }, code: "KeyW" },
                }));
              return signals.length === 0 ? [] : { signals };
            },
          }),
        },
      ],
    });

    monitor.devicesDAG.dispatch({
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    expect(receivedPackets).toHaveLength(1);
    expect(receivedPackets[0].signals).toHaveLength(1);
    expect(receivedPackets[0].signals[0]).toMatchObject({
      type: "position",
      context: {
        value: { x: 1, y: 0 },
        code: "KeyW",
      },
    });
  });

  test("挂载后的 StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new StrokeCreatorTool();
    monitor.origin = new Vector(100, 50);
    monitor.zoom = 2;

    monitor.mountSubDAG("", createMouseDevice());
    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "primary-stroke",
      workflow: tool,
      edges: [{ from: "/mouse/primary", edge: "default" }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(105, 60),
            buttons: 1,
            button: 0,
          },
        },
      ],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(110, 65),
            buttons: 1,
            button: 0,
          },
        },
      ],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "end",
          context: {
            buttons: 0,
            button: 0,
          },
        },
      ],
    });

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(tool.obj.id).toBe(1);
    expect(board.objectCounterPool.counter).toBe(1);
    expect(ownerChunk.objectManager.getObject(tool.obj.id)).toBe(tool.obj);
    expect(tool.obj.position.serialize()).toEqual({ x: 105, y: 60 });
    expect(
      tool.obj.localPathRange.points.map((point) => point.serialize()),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  test("挂载后的 StrokeCreatorTool 在绘制中应将对象加入 activeObjectManager 层", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new StrokeCreatorTool();
    monitor.origin = new Vector(100, 50);
    monitor.zoom = 2;

    monitor.mountSubDAG("", createMouseDevice());

    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "primary-stroke",
      workflow: tool,
      edges: [{ from: "/mouse/primary", edge: "default" }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(105, 60),
            buttons: 1,
            button: 0,
          },
        },
      ],
    });

    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(board.activeObjectManager.layerOrder.length).toBe(1);
    expect(
      board.activeObjectManager.layerOrder[0].activeObjects.has(tool.obj.id),
    ).toBe(true);
  });

  test("挂载后的 StrokeCreatorTool 与 CommonObjectModifierTool 同一路径中共享上下文并修改对象", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const creatorTool = new StrokeCreatorTool();
    let firstObjectId = null;

    // 直接用 handoff 子树，不经过 mouse device 路由
    monitor.mountSubDAG(
      "",
      createHandoffSubDAG({
        rootPath: "workflow",
        first: creatorTool,
        second: new CommonObjectModifierTool(),
      }),
    );

    // 创建阶段：发送 position + end 信号到 handoff 根节点
    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [
        { type: "position", context: { value: { x: 2, y: 2 } } },
        { type: "end", context: {} },
      ],
    });

    expect(creatorTool.obj).not.toBeNull();
    expect(creatorTool.obj.id).toBe(1);
    firstObjectId = creatorTool.obj.id;
    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(board.getObjectById(creatorTool.obj.id)).toBeUndefined();

    // 修改阶段：handoff 已切换到 second（modifier）
    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [{ type: "displacement", context: { value: { x: 3, y: 0 } } }],
    });

    expect(creatorTool.obj).not.toBeNull();
    expect(board.activeObjectManager.activeObjects.size).toBe(1);

    // 提交
    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [{ type: "success", context: {} }],
    });

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(creatorTool.obj.id)).toBe(
      creatorTool.obj,
    );
    expect(monitor.devicesDAG.getNodeState("/main/workflow")).toEqual({
      phase: "first",
      activeChild: "first",
    });
    expect(monitor.devicesDAG.getNode("/main/workflow/second")).not.toBeNull();

    // 再次进入 creator，验证 handoff 周期可重复
    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [{ type: "position", context: { value: { x: 4, y: 4 } } }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/workflow",
      signals: [
        { type: "position", context: { value: { x: 5, y: 5 } } },
        { type: "end", context: {} },
      ],
    });

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
    const monitor = createMonitor(board, "main");
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

    board.signalsEventBus.emit("input", {
      to: "/main/choose-and-modify",
      signals: [{ type: "position", context: { value: { x: 5, y: 5 } } }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/choose-and-modify",
      signals: [
        { type: "position", context: { value: { x: 25, y: 25 } } },
        { type: "end", context: {} },
      ],
    });

    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(
      board.activeObjectManager.activeObjectIndex.has(targetObject.id),
    ).toBe(true);
    expect(monitor.devicesDAG.getNodeState("/main/choose-and-modify")).toEqual({
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

    // 首个 position → 启动手势（对象暂不动，保持光标偏移）
    board.signalsEventBus.emit("input", {
      to: "/main/choose-and-modify",
      signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
    });

    // 第二个 position → 应用位移
    board.signalsEventBus.emit("input", {
      to: "/main/choose-and-modify",
      signals: [{ type: "position", context: { value: { x: 14, y: 8 } } }],
    });

    // dx=14-10=4, dy=8-10=-2 → (14, 8)
    expect(targetObject.position.serialize()).toEqual({ x: 14, y: 8 });
    expect(board.activeObjectManager.activeObjects.size).toBe(1);

    board.signalsEventBus.emit("input", {
      to: "/main/choose-and-modify",
      signals: [{ type: "success", context: {} }],
    });

    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(board.getObjectById(targetObject.id)).toBe(targetObject);
    expect(monitor.devicesDAG.getNodeState("/main/choose-and-modify")).toEqual({
      phase: "first",
      activeChild: "first",
    });
    expect(
      monitor.devicesDAG.getNodeState("/main/choose-and-modify/second"),
    ).toEqual({});
  });

  test("挂载后的 PolygonCreatorTool 应可经由输入链路完成 object-end 提交", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new PolygonCreatorTool();
    monitor.origin = new Vector(100, 50);
    monitor.zoom = 2;

    monitor.mountSubDAG("", createMouseDevice());
    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "primary-polygon",
      workflow: tool,
      edges: [{ from: "/mouse/primary", edge: "default" }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse/primary",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(125, 80),
          },
        },
        {
          type: "end",
          context: {},
        },
      ],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse/primary",
      signals: [
        {
          type: "object-end",
          context: {},
        },
      ],
    });

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(tool.obj.id).toBe(1);
    expect(board.objectCounterPool.counter).toBe(1);
    expect(ownerChunk.objectManager.getObject(tool.obj.id)).toBe(tool.obj);
    expect(tool.obj.position.serialize()).toEqual({ x: 125, y: 80 });
    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
  });
});
