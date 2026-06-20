import { jest } from "@jest/globals";
import { Board } from "../../../core/components/index.js";
import { boardFileOperateBridge } from "../../../core/bridges/file-operate-bridge-renderer.js";
import { Monitor } from "../../../core/components/index.js";
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
import { RectangleObjectChooserTool } from "../../../core/tools/chooser/rectangle-object-chooser.js";
import { createRandomCircleSubDAG } from "../random-circle-creator-tool.js";

describe("whiteboard demo", () => {
  function createDemoBoard() {
    return new Board();
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;

    const liveCanvas = createNoopCanvas();
    const monitor = new Monitor(
      {
        rootElement: {},
        baseCanvas: createNoopCanvas(),
        liveCanvas,
        uiCanvas: createNoopCanvas(),
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

  test("demo 配置后右键应通过 handoff 选择并桥接覆盖对象", () => {
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

    // 对象仍在 AOM 动态图（handoff 未提交到静态图）
    expect(board.activeObjectManager.activeObjectIndex.get(1)).toBe(stroke);
    // handoff 已将对象桥接到 second 节点
    expect(
      monitor.devicesDAG.getNode("/main/workflows/secondary-chooser/second")
        ?.state?.objects?.[0],
    ).toBe(stroke);
    // handoff 状态机已切换到 second 阶段
    expect(
      monitor.devicesDAG.getNode("/main/workflows/secondary-chooser")?.state,
    ).toEqual({
      phase: "second",
      activeChild: "second",
    });
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

  test("demo 配置后 handoff 工作流应支持 chooser → modifier → 重新 chooser 的完整周期", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const firstStroke = new StrokeObject(new Vector(30, 40), 1, 1);
    firstStroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    const secondStroke = new StrokeObject(new Vector(90, 100), 2, 1);
    secondStroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);

    board.addObject(firstStroke, 1);
    board.addObject(secondStroke, 1);

    configureWhiteboardDemo(board, monitor);

    // ── 阶段 1: 第一次右键选择 firstStroke ──
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

    // firstStroke 被选择进入 AOM
    expect(board.activeObjectManager.activeObjectIndex.get(1)).toBe(
      firstStroke,
    );
    // handoff 切换到 second（modifier）阶段
    expect(
      monitor.devicesDAG.getNode("/main/workflows/secondary-chooser")?.state,
    ).toEqual({
      phase: "second",
      activeChild: "second",
    });

    // ── 阶段 2: 通过 modifier 拖拽修改 firstStroke ──
    // firstStroke 世界矩形: (30, 40) 起，宽 20，高 10 → (30..50, 40..50)
    // 首个 position (35, 45) 在合矩形内 → 准入通过，锚点=(35, 45)
    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(35, 45),
            buttons: 2,
            button: 2,
          },
        },
      ],
    });
    // 第二个 position (45, 50) → 位移 (10, 5) → firstStroke 移至 (40, 45)
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
    expect(firstStroke.position.serialize()).toEqual({ x: 40, y: 45 });

    // end → 暂停手势，对象留在 AOM
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

    // success 是应用层信号，绕过鼠标设备直接 dispatch 给 handoff workflow
    // 触发 modifier.applyModifiedObjects → 提交到静态图 → handoff 切回 first(chooser)
    monitor.devicesDAG.dispatch(
      {
        to: "/main/workflows/secondary-chooser",
        signals: [{ type: "success", context: {} }],
      },
      { board, monitor },
    );

    // firstStroke 已提交到静态图，不在 AOM 中
    expect(
      board.activeObjectManager.activeObjectIndex.has(firstStroke.id),
    ).toBe(false);
    expect(
      monitor.devicesDAG.getNode("/main/workflows/secondary-chooser")?.state,
    ).toEqual({
      phase: "first",
      activeChild: "first",
    });

    // ── 阶段 3: 第二次右键选择 secondStroke ──
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

    expect(
      board.activeObjectManager.activeObjectIndex.get(secondStroke.id),
    ).toBe(secondStroke);
  });

  test("demo 配置后 handoff 中 Escape 应取消修改并回退对象位置", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const stroke = new StrokeObject(new Vector(30, 40), 1, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    board.addObject(stroke, 1);

    configureWhiteboardDemo(board, monitor);
    const dag = monitor.devicesDAG;
    const wp = "/main/workflows/secondary-chooser";
    const emit = (signals) =>
      board.signalsEventBus.emit("input", { to: "/main/mouse", signals });

    // 选择对象
    emit([
      {
        type: "position",
        context: { value: new Vector(30, 40), buttons: 2, button: 2 },
      },
    ]);
    emit([
      {
        type: "position",
        context: { value: new Vector(45, 50), buttons: 2, button: 2 },
      },
    ]);
    emit([{ type: "end", context: { buttons: 0, button: 2 } }]);

    // 拖拽修改
    emit([
      {
        type: "position",
        context: { value: new Vector(35, 45), buttons: 2, button: 2 },
      },
    ]);
    emit([
      {
        type: "position",
        context: { value: new Vector(50, 55), buttons: 2, button: 2 },
      },
    ]);
    emit([{ type: "end", context: { buttons: 0, button: 2 } }]);
    expect(stroke.position.serialize()).toEqual({ x: 45, y: 50 });

    // Escape → cancel → 位置回退 → handoff 切回 first
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { key: "Escape", code: "Escape", repeat: false },
        },
      ],
    });

    expect(stroke.position.serialize()).toEqual({ x: 30, y: 40 });
    expect(dag.getNodeState(wp)).toEqual({
      phase: "first",
      activeChild: "first",
    });
    // cancel 已将对象从 AOM 丢弃，回到静态图
    expect(board.activeObjectManager.activeObjectIndex.has(stroke.id)).toBe(
      false,
    );
  });

  test("demo 配置后 handoff 中连续多轮 modifier 手势后 Escape 应回退到首次手势前的位置", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const stroke = new StrokeObject(new Vector(30, 40), 1, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    board.addObject(stroke, 1);

    configureWhiteboardDemo(board, monitor);
    const dag = monitor.devicesDAG;
    const wp = "/main/workflows/secondary-chooser";
    const emit = (signals) =>
      board.signalsEventBus.emit("input", { to: "/main/mouse", signals });

    // 选择对象
    emit([
      {
        type: "position",
        context: { value: new Vector(30, 40), buttons: 2, button: 2 },
      },
    ]);
    emit([
      {
        type: "position",
        context: { value: new Vector(45, 50), buttons: 2, button: 2 },
      },
    ]);
    emit([{ type: "end", context: { buttons: 0, button: 2 } }]);

    // 第一轮 modifier 拖拽：锚点 (35,45) → (45,50)，位置 (30,40) → (40,45)
    emit([
      {
        type: "position",
        context: { value: new Vector(35, 45), buttons: 2, button: 2 },
      },
    ]);
    emit([
      {
        type: "position",
        context: { value: new Vector(45, 50), buttons: 2, button: 2 },
      },
    ]);
    emit([{ type: "end", context: { buttons: 0, button: 2 } }]);
    expect(stroke.position.serialize()).toEqual({ x: 40, y: 45 });

    // 第二轮 modifier 拖拽：锚点 (42,48) → (52,54)，位置 (40,45) → (50,51)
    emit([
      {
        type: "position",
        context: { value: new Vector(42, 48), buttons: 2, button: 2 },
      },
    ]);
    emit([
      {
        type: "position",
        context: { value: new Vector(52, 54), buttons: 2, button: 2 },
      },
    ]);
    emit([{ type: "end", context: { buttons: 0, button: 2 } }]);
    expect(stroke.position.serialize()).toEqual({ x: 50, y: 51 });

    // Escape → 回退到首次手势前的位置 (30, 40)，不是第二轮手势前 (40, 45)
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { key: "Escape", code: "Escape", repeat: false },
        },
      ],
    });

    expect(stroke.position.serialize()).toEqual({ x: 30, y: 40 });
    expect(dag.getNodeState(wp)).toEqual({
      phase: "first",
      activeChild: "first",
    });
    expect(board.activeObjectManager.activeObjectIndex.has(stroke.id)).toBe(
      false,
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
    const randomCircleSubDAG = createRandomCircleSubDAG({
      rootPath: "/keyboard/code/Space/create-circle",
      random: () => 0.5,
    });

    configureWhiteboardDemo(board, monitor, { randomCircleSubDAG });

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

  test("demo 配置后 WASD 应通过 handoff 发送 displacement 到 modifier", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const target = new StrokeObject(new Vector(30, 40), 1, 1);
    target.setPathPoints([new Vector(0, 0), new Vector(20, 10)]);
    board.addObject(target, 1);

    configureWhiteboardDemo(board, monitor);

    // 右键拖拽选择 target 进入 modifier 阶段
    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: { value: new Vector(30, 40), buttons: 2, button: 2 },
        },
      ],
    });
    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: { value: new Vector(45, 50), buttons: 2, button: 2 },
        },
      ],
    });
    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "end",
          context: { buttons: 0, button: 2 },
        },
      ],
    });

    // 确认 handoff 已切换到 modifier 阶段
    expect(
      monitor.devicesDAG.getNode("/main/workflows/secondary-chooser")?.state,
    ).toEqual({
      phase: "second",
      activeChild: "second",
    });

    // 首个 position 启动手势（锚点 = 光标位置）
    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [
        {
          type: "position",
          context: { value: new Vector(35, 45), buttons: 2, button: 2 },
        },
      ],
    });
    // 对象位置锚点=(35,45)，dx=0 → (30,40)
    expect(target.position.serialize()).toEqual({ x: 30, y: 40 });

    // WASD: KeyD → displacement {x: 1, y: 0} → 对象移到 (31, 40)
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { key: "d", code: "KeyD", repeat: false },
        },
      ],
    });
    expect(target.position.serialize()).toEqual({ x: 31, y: 40 });

    // WASD: KeyW → displacement {x: 0, y: -1} → 对象移到 (31, 39)
    board.signalsEventBus.emit("input", {
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { key: "w", code: "KeyW", repeat: false },
        },
      ],
    });
    expect(target.position.serialize()).toEqual({ x: 31, y: 39 });
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

  test("demo 配置后 R 键应触发视口全屏刷新", () => {
    const board = createDemoBoard();
    const monitor = createMonitor(board, "main");
    const baseInvalidateSpy = jest
      .spyOn(monitor.baseRenderScheduler, "invalidate")
      .mockImplementation(() => false);
    const liveInvalidateSpy = jest
      .spyOn(monitor.renderScheduler, "invalidate")
      .mockImplementation(() => false);

    configureWhiteboardDemo(board, monitor);

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
  });
});
