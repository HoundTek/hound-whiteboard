import { jest } from "@jest/globals";
import {
  BOARD_PERSISTENCE_MODES,
  Board,
} from "../../../core/components/board.js";
import { boardFileOperateBridge } from "../../../core/bridges/file-operate-bridge-renderer.js";
import { Monitor } from "../../../core/components/monitor.js";
import { Vector } from "../../../core/utils/math.js";
import { CircleObject } from "../../../core/objects/graph/circle.js";
import { StrokeObject } from "../../../core/objects/stroke/stroke.js";
import { createNoopCanvas } from "../../../core/test-support/noop-canvas.js";
import {
  configureWhiteboardDemo,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_SECONDARY_STROKE_COLOR,
} from "../whiteboard-demo.js";
import { RandomCircleCreatorTool } from "../random-circle-creator-tool.js";
import { WasdCoordinateTool } from "../wasd-coordinate-tool.js";

describe("whiteboard demo", () => {
  function createDemoBoard() {
    return new Board({
      persistenceMode: BOARD_PERSISTENCE_MODES.MEMORY,
    });
  }

  function createCanvas() {
    return createNoopCanvas({ width: 800, height: 600 });
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;

    const liveCanvas = createCanvas();
    const monitor = new Monitor(
      liveCanvas,
      board,
      { width: 800, height: 600 },
      monitorId,
    );
    monitor.attachRenderLayers({
      rootElement: {},
      baseCanvas: createCanvas(),
      liveCanvas,
      uiCanvas: createCanvas(),
    });
    board.monitors.set(monitorId, monitor);
    return monitor;
  }

  test("demo 配置后左键应创建黑色笔画并写回白板", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const { primaryStrokeTool } = configureWhiteboardDemo(board, monitor);

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(10, 20),
            buttons: 1,
            button: 0,
          },
        },
      ],
    });

    expect(board.activeObjectManager.layerOrder.length).toBe(1);
    expect(
      board.activeObjectManager.layerOrder[0].activeObjects.has(
        primaryStrokeTool.obj.id,
      ),
    ).toBe(true);

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(20, 30),
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

    const object = board.getChunkById(1).objectManager.getObject(1);
    expect(object).toBe(primaryStrokeTool.obj);
    expect(object.property.color).toBe(DEMO_PRIMARY_STROKE_COLOR);
  });

  test("demo 配置后右键应创建红色笔画并写回白板", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const { secondaryStrokeTool } = configureWhiteboardDemo(board, monitor);

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(30, 40),
            buttons: 2,
            button: 2,
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
            value: new Vector(45, 50),
            buttons: 2,
            button: 2,
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
            button: 2,
          },
        },
      ],
    });

    const object = board.getChunkById(1).objectManager.getObject(1);
    expect(object).toBe(secondaryStrokeTool.obj);
    expect(object.property.color).toBe(DEMO_SECONDARY_STROKE_COLOR);
  });

  test("demo 配置后连续两次左键应生成两条独立黑色笔画", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(10, 20),
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
            value: new Vector(20, 30),
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

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(40, 50),
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
            value: new Vector(45, 60),
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

    const ownerChunk = board.getChunkById(1).objectManager;
    expect(ownerChunk.getObject(1).property.color).toBe(
      DEMO_PRIMARY_STROKE_COLOR,
    );
    expect(ownerChunk.getObject(2).property.color).toBe(
      DEMO_PRIMARY_STROKE_COLOR,
    );
    expect(ownerChunk.getObject(1)).not.toBe(ownerChunk.getObject(2));
  });

  test("demo 配置后连续两次右键应生成两条独立红色笔画", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(30, 40),
            buttons: 2,
            button: 2,
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
            value: new Vector(45, 50),
            buttons: 2,
            button: 2,
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
            button: 2,
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
            value: new Vector(60, 70),
            buttons: 2,
            button: 2,
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
            value: new Vector(70, 80),
            buttons: 2,
            button: 2,
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
            button: 2,
          },
        },
      ],
    });

    const ownerChunk = board.getChunkById(1).objectManager;
    expect(ownerChunk.getObject(1).property.color).toBe(
      DEMO_SECONDARY_STROKE_COLOR,
    );
    expect(ownerChunk.getObject(2).property.color).toBe(
      DEMO_SECONDARY_STROKE_COLOR,
    );
    expect(ownerChunk.getObject(1)).not.toBe(ownerChunk.getObject(2));
  });

  test("requestViewportBaseRender 应让 base 层缓冲区覆盖当前视口并承接已提交笔画", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const stroke = new StrokeObject(new Vector(10, 20), 1, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(0, 30)]);

    board.addObject(stroke, 1);
    monitor.requestViewportBaseRender();

    const loadedChunkIds = monitor.chunkBlockLoader
      .getLoadedChunks()
      .map((chunk) => chunk.id);

    expect(loadedChunkIds).toContain(1);
    expect(monitor.baseRenderer.collectStaticDrawables()).toEqual([stroke]);
  });

  test("memory demo 启动时视口补绘不应访问文件桥", async () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    const loadTierGraphSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadTierGraph",
    );
    const loadCoverIndexSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadChunkObjectCoverIndex",
    );

    monitor.requestViewportBaseRender();

    await new Promise((resolve) => setImmediate(resolve));
    expect(loadTierGraphSpy).not.toHaveBeenCalled();
    expect(loadCoverIndexSpy).not.toHaveBeenCalled();
    expect(
      monitor.chunkBlockLoader.getLoadedChunks().map((chunk) => chunk.id),
    ).toContain(1);

    loadTierGraphSpy.mockRestore();
    loadCoverIndexSpy.mockRestore();
  });

  test("demo 配置后空格键应创建随机圆对象并提交到白板", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const randomCircleTool = new RandomCircleCreatorTool({
      random: () => 0.5,
    });

    configureWhiteboardDemo(board, monitor, { randomCircleTool });

    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: " ",
            code: "Space",
            repeat: false,
          },
        },
      ],
    });

    const object = board.getChunkById(1).objectManager.getObject(1);
    expect(object).toBeInstanceOf(CircleObject);
    expect(object.position.serialize()).toEqual({ x: 400, y: 300 });
    expect(object.radius).toBe(36);
    expect(object.property.strokeColor).toBe("hsl(180, 70%, 42%)");
  });

  test("demo 配置后空格 keyup 不应创建随机圆对象", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keyup",
          context: {
            key: " ",
            code: "Space",
            repeat: false,
          },
        },
      ],
    });

    expect(board.getObjectById(1)).toBeUndefined();
  });

  test("demo 配置后 WASD 应路由到 demo 专用坐标工具", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const wasdCoordinateTool = new WasdCoordinateTool({
      logPosition: false,
    });

    configureWhiteboardDemo(board, monitor, { wasdCoordinateTool });

    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "d",
            code: "KeyD",
            repeat: false,
          },
        },
      ],
    });
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "w",
            code: "KeyW",
            repeat: false,
          },
        },
      ],
    });

    expect(wasdCoordinateTool.position.serialize()).toEqual({ x: 1, y: -1 });
  });
});
