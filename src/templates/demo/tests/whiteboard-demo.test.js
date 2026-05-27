import { jest } from "@jest/globals";
import { Board } from "../../../core/components/board.js";
import { boardFileOperateBridge } from "../../../core/bridges/file-operate-bridge-renderer.js";
import { Monitor } from "../../../core/components/monitor.js";
import { RectangleRange } from "../../../core/range/index.js";
import { Vector } from "../../../core/utils/math.js";
import { CircleObject } from "../../../core/objects/graph/circle.js";
import { StrokeObject } from "../../../core/objects/stroke/stroke.js";
import { createNoopCanvas } from "../../../core/test-support/noop-canvas.js";
import {
  configureWhiteboardDemo,
  DEMO_PRIMARY_STROKE_COLOR,
} from "../whiteboard-demo.js";
import { DebuggerTool } from "../debugger-tool.js";
import { WasdCoordinateTool } from "../wasd-coordinate-tool.js";
import { RectangleObjectChooserTool } from "../../../core/tools/chooser/rectangle-object-chooser.js";
import { createRandomCircleSubTree } from "../random-circle-creator-tool.js";

describe("whiteboard demo", () => {
  function createDemoBoard() {
    return new Board();
  }

  function createCanvas() {
    return createNoopCanvas({ width: 800, height: 600 });
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;

    const liveCanvas = createCanvas();
    const monitor = new Monitor(
      {
        rootElement: {},
        baseCanvas: createCanvas(),
        liveCanvas,
        uiCanvas: createCanvas(),
      },
      board,
      { width: 800, height: 600 },
      monitorId,
    );
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

  test("demo 配置后右键应使用矩形框选工具选择覆盖对象", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const stroke = new StrokeObject(new Vector(30, 40), 1, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    board.addObject(stroke, 1);
    const { secondarySelectionTool } = configureWhiteboardDemo(board, monitor);

    expect(secondarySelectionTool).toBeInstanceOf(RectangleObjectChooserTool);

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

    expect(board.activeObjectManager.activeObjectIndex.get(1)).toBe(stroke);
    expect(
      monitor.devicesTree.getNode("/main/mouse/secondary/tool")?.state?.object,
    ).toBe(stroke);
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

  test("demo 配置后连续两次右键应替换当前框选结果", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const firstStroke = new StrokeObject(new Vector(30, 40), 1, 1);
    firstStroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    const secondStroke = new StrokeObject(new Vector(90, 100), 2, 1);
    secondStroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);

    board.addObject(firstStroke, 1);
    board.addObject(secondStroke, 1);

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
            value: new Vector(88, 98),
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
            value: new Vector(112, 116),
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

    expect(board.activeObjectManager.activeObjectIndex.has(firstStroke.id)).toBe(
      false,
    );
    expect(board.activeObjectManager.activeObjectIndex.get(secondStroke.id)).toBe(
      secondStroke,
    );
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
    const randomCircleSubTree = createRandomCircleSubTree({
      rootPath: "/keyboard/tools/create-circle",
      random: () => 0.5,
    });

    configureWhiteboardDemo(board, monitor, { randomCircleSubTree });

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

  test("demo 配置后方向键应平移 Monitor 视口", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    monitor.origin = new Vector(0, 0);
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "ArrowRight",
            code: "ArrowRight",
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
            key: "ArrowDown",
            code: "ArrowDown",
            repeat: false,
          },
        },
      ],
    });

    expect(monitor.origin.serialize()).toEqual({ x: 200, y: 200 });
  });

  test("demo 配置后 + 键应以视口中心为锚点缩放", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");

    configureWhiteboardDemo(board, monitor);

    monitor.origin = new Vector(0, 0);
    monitor.zoom = 1;
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "+",
            code: "Equal",
            repeat: false,
            shiftKey: true,
          },
        },
      ],
    });

    expect(monitor.zoom).toBe(2);
    expect(monitor.origin.serialize()).toEqual({ x: 200, y: 150 });
  });

  test("demo 配置后 R 键应触发视口全屏刷新，且不再落到 debugger-tool", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const debugTool = new DebuggerTool();
    const debugSpy = jest.spyOn(debugTool, "process");
    const baseInvalidateSpy = jest
      .spyOn(monitor.baseRenderScheduler, "invalidate")
      .mockImplementation(() => false);
    const liveInvalidateSpy = jest
      .spyOn(monitor.renderScheduler, "invalidate")
      .mockImplementation(() => false);

    configureWhiteboardDemo(board, monitor, { debugTool });

    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "r",
            code: "KeyR",
            repeat: false,
          },
        },
      ],
    });

    expect(baseInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    expect(liveInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    expect(debugSpy).not.toHaveBeenCalled();

    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            key: "m",
            code: "KeyM",
            repeat: false,
          },
        },
      ],
    });

    expect(debugSpy).toHaveBeenCalledTimes(1);

    debugSpy.mockRestore();
    baseInvalidateSpy.mockRestore();
    liveInvalidateSpy.mockRestore();
  });
});
