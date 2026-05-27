import { Board } from "../board.js";
import { Monitor } from "../monitor.js";
import { createSubTree } from "../../devices/devices-tree.js";
import { Tool } from "../../tools/tool.js";
import { Matrix, Vector } from "../../utils/math.js";
import { StrokeCreatorTool } from "../../tools/creator/stroke-creator.js";
import { PolygonCreatorTool } from "../../tools/creator/polygon-creator.js";
import { CommonObjectModifierTool } from "../../tools/modifier/common-object-modifier.js";
import { createMouseDevice } from "../../devices/mouse-device.js";
import { createNoopCanvas } from "../../test-support/noop-canvas.js";
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

  test("input 事件应经由 Board、Monitor 与 DevicesTree 落到工具节点", () => {
    class CollectingTool extends Tool {
      calls = [];

      process(signalPacket, deviceContext) {
        this.calls.push({ signalPacket, deviceContext });
      }

      reset() {
        this.calls = [];
      }
    }

    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new CollectingTool();

    monitor.mountSubTree(
      "",
      createSubTree("/sample-device")
        .node("")
        .defaultChild("tool")
        .end()
        .node("tool")
        .handler(tool.createProcessor({ board, monitor }))
        .end()
        .build(),
    );

    const emitResults = board.signalsEventBus.emit("input", {
      to: "/main/sample-device",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(emitResults).toEqual([undefined]);
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: {
        to: "/main/sample-device/tool",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      },
      deviceContext: expect.objectContaining({
        board,
        monitor,
        path: "/main/sample-device/tool",
      }),
    });
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
    class CollectingTool extends Tool {
      calls = [];

      process(signalPacket, deviceContext) {
        this.calls.push({ signalPacket, deviceContext });
      }

      reset() {
        this.calls = [];
      }
    }

    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new CollectingTool();

    monitor.mountSubTree(
      "",
      createSubTree("/sample-device")
        .node("")
        .defaultChild("tool")
        .end()
        .build(),
    );

    const mountResults = board.signalsEventBus.emit("mount", {
      to: "/main/sample-device/tool",
      tool,
    });

    expect(mountResults).toHaveLength(1);
    expect(
      monitor.devicesTree.getNode("/main/sample-device/tool"),
    ).not.toBeNull();

    board.signalsEventBus.emit("input", {
      to: "/main/sample-device",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0].deviceContext).toEqual(
      expect.objectContaining({
        board,
        monitor,
        path: "/main/sample-device/tool",
      }),
    );

    const umountResults = board.signalsEventBus.emit("umount", {
      to: "/main/sample-device/tool",
    });

    expect(umountResults).toEqual([true]);
    expect(monitor.devicesTree.getNode("/main/sample-device/tool")).toBeNull();
  });

  test("configure 事件应在运行时更新设备节点配置", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const keyboardDevice = createKeyboardDevice({
      nodeConfigs: {
        "/code/KeyW": {
          handler(packet) {
            const signals = packet.signals
              .filter(
                (signal) =>
                  signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
              )
              .map(() => ({
                type: "position",
                context: { value: { x: 0, y: -1 }, code: "KeyW" },
              }));

            return signals.length === 0
              ? []
              : { to: "../../tools/move/tool", signals };
          },
        },
      },
    });

    monitor.mountSubTree("", keyboardDevice);
    monitor.devicesTree.mount(
      "/main/keyboard/tools/move/tool",
      (packet, context) => ({
        to: context.eventContext.path,
        signals: packet.signals,
      }),
    );
    monitor.devicesTree.mount(
      "/main/keyboard/tools/strafe/tool",
      (packet, context) => ({
        to: context.eventContext.path,
        signals: packet.signals,
      }),
    );

    const configureResults = board.signalsEventBus.emit("configure", {
      to: "/main/keyboard/code/KeyW",
      options: {
        handler(packet) {
          const signals = packet.signals
            .filter(
              (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
            )
            .map(() => ({
              type: "position",
              context: { value: { x: 1, y: 0 }, code: "KeyW" },
            }));

          return signals.length === 0
            ? []
            : { to: "../../tools/strafe/tool", signals };
        },
      },
    });

    expect(configureResults).toHaveLength(1);
    expect(configureResults[0]).toEqual(
      expect.objectContaining({ path: "/main/keyboard/code/KeyW" }),
    );

    expect(
      monitor.devicesTree.dispatch({
        to: "/main/keyboard/code/KeyW",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      }),
    ).toEqual([
      {
        to: "/main/keyboard/tools/strafe/tool",
        signals: [
          {
            type: "position",
            context: { value: { x: 1, y: 0 }, code: "KeyW" },
          },
        ],
      },
    ]);
  });

  test("挂载后的 StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new StrokeCreatorTool();
    monitor.origin = new Vector(100, 50);
    monitor.zoom = 2;

    monitor.mountSubTree("", createMouseDevice());
    board.signalsEventBus.emit("mount", {
      to: "/main/mouse/primary/tool",
      tool,
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

    monitor.mountSubTree("", createMouseDevice());

    board.signalsEventBus.emit("mount", {
      to: "/main/mouse/primary/tool",
      tool,
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
    const creatorTool = new StrokeCreatorTool({
      completionMode: "handoff",
      createModifierTool: () => new CommonObjectModifierTool(),
    });

    monitor.mountSubTree("", createMouseDevice());

    board.signalsEventBus.emit("mount", {
      to: "/main/mouse/primary/tool",
      tool: creatorTool,
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 1, y: 1 }, buttons: 1, button: 0 },
        },
      ],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 2, y: 2 }, buttons: 1, button: 0 },
        },
        {
          type: "end",
          context: {},
        },
      ],
    });

    const ownerChunk = board.getChunkById(1);
    expect(creatorTool.obj).not.toBeNull();
    expect(creatorTool.obj.id).toBe(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(
      monitor.devicesTree.getNode("/main/mouse/primary/tool/tool"),
    ).not.toBeNull();
    expect(board.getObjectById(creatorTool.obj.id)).toBeUndefined();

    board.signalsEventBus.emit("input", {
      to: "/main/mouse/primary/tool/tool",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 10 } },
        },
        {
          type: "transform",
          context: {
            value: { a: 2, b: 0, c: 0, d: 2 },
          },
        },
      ],
    });

    expect(creatorTool.obj).not.toBeNull();
    expect(creatorTool.obj.id).toBe(1);
    expect(creatorTool.obj.transform).toEqual(new Matrix(2, 0, 0, 2));
    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(board.getObjectById(creatorTool.obj.id)).toBeUndefined();

    board.signalsEventBus.emit("input", {
      to: "/main/mouse/primary/tool/tool",
      signals: [{ type: "apply", context: {} }],
    });

    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(monitor.devicesTree.getNode("/main/mouse/primary/tool/tool")).toBeNull();
    expect(ownerChunk.objectManager.getObject(creatorTool.obj.id)).toBe(
      creatorTool.obj,
    );
  });

  test("挂载后的 PolygonCreatorTool 应可经由输入链路完成 object-end 提交", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new PolygonCreatorTool();
    monitor.origin = new Vector(100, 50);
    monitor.zoom = 2;

    monitor.mountSubTree("", createMouseDevice());
    board.signalsEventBus.emit("mount", {
      to: "/main/mouse/primary/tool",
      tool,
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
