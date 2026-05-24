import { jest } from "@jest/globals";
import { Monitor } from "../monitor.js";
import { Vector } from "../../utils/math.js";
import { Chunk } from "../chunk.js";
import { RectangleRange } from "../../range/index.js";
import {
  createDebuggerDevice,
  DEBUGGER_DEVICE_SIGNAL_TYPES,
} from "../../devices/debugger-device.js";
import {
  createNoopCanvas,
  createNoopCanvasContext2D,
} from "../../test-support/noop-canvas.js";

describe("Monitor", () => {
  function createContext() {
    return createNoopCanvasContext2D();
  }

  function createMonitor(monitorId = "monitor") {
    const canvas = createNoopCanvas({ width: 800, height: 600 });
    const board = {
      width: 800,
      height: 600,
      getChunkById(chunkId) {
        return Chunk.fromId(chunkId);
      },
      createChunkBlockLoader() {
        return {
          chunkLoader: {
            emitBufferUpdated() {
              return true;
            },
          },
          getLoadedChunks() {
            return [];
          },
        };
      },
    };

    return new Monitor(canvas, board, { width: 800, height: 600 }, monitorId);
  }

  test("mountDevice 应自动补上 monitorId 后挂载设备", () => {
    const monitor = createMonitor("alpha");
    const debuggerDevice = createDebuggerDevice();

    const mountedNodes = monitor.mountDevice("/debugger", debuggerDevice);
    const packets = monitor.devicesTree.dispatch({
      to: "/alpha/debugger",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/alpha/debugger",
      "/alpha/debugger/report",
    ]);
    expect(packets).toEqual([
      {
        to: "/alpha/debugger/report",
        signals: [
          {
            type: DEBUGGER_DEVICE_SIGNAL_TYPES.REPORT,
            context: {
              index: 0,
              receivedAt: "/alpha/debugger",
              originalTo: "/alpha/debugger",
              signalCount: 1,
            },
          },
        ],
      },
    ]);
  });

  test("mountDevice 应规整不带前导斜杠的相对路径", () => {
    const monitor = createMonitor("beta");
    const debuggerDevice = createDebuggerDevice();

    const mountedNodes = monitor.mountDevice("debugger", debuggerDevice);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/beta/debugger",
      "/beta/debugger/report",
    ]);
  });

  test("screenToChunk 应按二维区块坐标映射命中对应区块", () => {
    const monitor = createMonitor("gamma");

    expect(monitor.screenToWorld(new Vector(400, 300))).toEqual(
      new Vector(400, 300),
    );

    expect(monitor.worldToChunk(new Vector(400, 300))).toEqual({
      chunkId: 1,
      x: 400,
      y: 300,
    });

    expect(monitor.screenToChunk(new Vector(400, 300))).toEqual({
      chunkId: 1,
      x: 400,
      y: 300,
    });

    expect(monitor.screenToChunk(new Vector(1000, 300))).toEqual({
      chunkId: 2,
      x: 200,
      y: 300,
    });

    expect(monitor.screenToChunk(new Vector(1200, 750))).toEqual({
      chunkId: 3,
      x: 400,
      y: 150,
    });

    expect(monitor.screenToChunk(new Vector(-200, 150))).toEqual({
      chunkId: 6,
      x: 600,
      y: 150,
    });

    monitor.zoom = 2;
    monitor.origin = new Vector(100, 50);

    expect(monitor.screenToChunk(new Vector(400, 250))).toEqual({
      chunkId: 1,
      x: 300,
      y: 175,
    });
  });

  test("attachRenderLayers 应保留 liveCanvas 为兼容入口并同步层尺寸", () => {
    const monitor = createMonitor("delta");
    const baseCanvas = createNoopCanvas({ width: 0, height: 0 });
    const liveCanvas = createNoopCanvas({ width: 320, height: 240 });
    const uiCanvas = createNoopCanvas({ width: 0, height: 0 });
    const rootElement = {};

    monitor.attachRenderLayers({
      rootElement,
      baseCanvas,
      liveCanvas,
      uiCanvas,
    });

    expect(monitor.rootElement).toBe(rootElement);
    expect(monitor.canvas).toBe(liveCanvas);
    expect(monitor.liveCanvas).toBe(liveCanvas);
    expect(monitor.baseCanvas).toBe(baseCanvas);
    expect(monitor.uiCanvas).toBe(uiCanvas);
    expect(baseCanvas.width).toBe(320);
    expect(baseCanvas.height).toBe(240);
    expect(uiCanvas.width).toBe(320);
    expect(uiCanvas.height).toBe(240);
    expect(monitor.getContext("base")?.save).toBeDefined();
    expect(monitor.getContext("live")?.save).toBeDefined();
    expect(monitor.getContext("ui")?.save).toBeDefined();
    expect(monitor.renderScheduler).toBeDefined();
    expect(monitor.baseRenderer).toBeDefined();
    expect(monitor.liveRenderer).toBeDefined();
  });

  test("renderScheduler.flush 应调用 liveRenderer.flush", () => {
    const monitor = createMonitor("epsilon");
    const flushSpy = jest
      .spyOn(monitor.liveRenderer, "flush")
      .mockImplementation(() => []);

    monitor.renderScheduler.invalidate({ type: "dirty" });
    monitor.renderScheduler.flush();

    expect(flushSpy).toHaveBeenCalledTimes(1);
    flushSpy.mockRestore();
  });

  test("base/live 调度器应使用不同的 dirty rect 聚合参数", () => {
    const monitor = createMonitor("epsilon-merge");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(20, 0, 10, 10),
    ];

    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(20, 0, 10, 10),
    ]);
    expect(monitor.renderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 30, 10),
    ]);
  });

  test("dirty rect 聚合阈值应随 zoom 放大而同步放宽", () => {
    const monitor = createMonitor("epsilon-zoom-merge");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(18, 0, 10, 10),
    ];

    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(18, 0, 10, 10),
    ]);
    expect(monitor.renderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 28, 10),
    ]);

    monitor.zoom = 2;

    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 28, 10),
    ]);
    expect(monitor.renderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 28, 10),
    ]);
  });

  test("coverage ratio 阈值应随 zoom 提高而变得更严格", () => {
    const monitor = createMonitor("epsilon-zoom-coverage");
    const baseThresholds = monitor.getDirtyRectThresholds("base");
    const liveThresholds = monitor.getDirtyRectThresholds("live");

    expect(baseThresholds.viewportCoverageRatio).toBeCloseTo(0.92);
    expect(baseThresholds.canonicalRectCoverageRatio).toBeCloseTo(0.55);
    expect(liveThresholds.viewportCoverageRatio).toBeCloseTo(0.72);

    monitor.zoom = 2;

    expect(
      monitor.getDirtyRectThresholds("base").viewportCoverageRatio,
    ).toBeCloseTo(0.95);
    expect(
      monitor.getDirtyRectThresholds("base").canonicalRectCoverageRatio,
    ).toBeCloseTo(0.65);
    expect(
      monitor.getDirtyRectThresholds("live").viewportCoverageRatio,
    ).toBeCloseTo(0.8);
  });

  test("应允许通过替换策略函数调整 dirty rect 聚合阈值", () => {
    const monitor = createMonitor("epsilon-custom-threshold-strategy");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(30, 0, 10, 10),
    ];

    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(30, 0, 10, 10),
    ]);

    monitor.baseDirtyRectThresholdStrategy = () => ({
      axisNearGap: 20,
      diagonalNearGap: 10,
      maxExtraArea: 400,
      maxGrowthRatio: 1.5,
      viewportCoverageRatio: 0.92,
      canonicalRectCoverageRatio: 0.55,
    });

    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 40, 10),
    ]);
  });

  test("应允许通过替换 policy resolver 调整整组 dirty rect 行为", () => {
    const monitor = createMonitor("epsilon-custom-policy-resolver");
    const defaultBasePolicy = monitor.getDirtyRectPolicy("base");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(22, 0, 10, 10),
    ];

    expect(monitor.getDirtyRectPolicy("base").getThresholds().axisNearGap).toBe(
      6,
    );
    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(22, 0, 10, 10),
    ]);

    monitor.baseDirtyRectPolicyResolver = () => ({
      getThresholds: () => ({
        axisNearGap: 12,
        diagonalNearGap: 6,
        maxExtraArea: 256,
        maxGrowthRatio: 1.35,
        viewportCoverageRatio: 0.92,
        canonicalRectCoverageRatio: 0.55,
      }),
      getViewportRect: () => monitor.getViewportScreenRect(),
      getCanonicalRectsForRect: (dirtyRect) =>
        defaultBasePolicy.getCanonicalRectsForRect?.(dirtyRect),
    });

    expect(monitor.getDirtyRectPolicy("base").getThresholds().axisNearGap).toBe(
      12,
    );
    expect(monitor.baseRenderScheduler.mergeDirtyRects(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 32, 10),
    ]);
  });

  test("base policy 应收窄到 dirty rect 真正命中的已加载 chunk 子集", () => {
    const monitor = createMonitor("epsilon-chunk-subset");
    const chunk1 = Chunk.fromId(1);
    const chunk2 = Chunk.fromId(2);
    monitor.chunkBlockLoader = {
      getLoadedChunks() {
        return [chunk1, chunk2];
      },
    };
    monitor.baseRenderer = {
      getChunkScreenRect(chunk) {
        const rectMap = new Map([
          [1, new RectangleRange(0, 0, 800, 600)],
          [2, new RectangleRange(800, 0, 800, 600)],
        ]);
        return rectMap.get(chunk.id);
      },
    };

    expect(
      monitor
        .getDirtyRectPolicy("base")
        .getCanonicalRectsForRect(new RectangleRange(10, 10, 100, 100)),
    ).toEqual([new RectangleRange(0, 0, 800, 600)]);
    expect(
      monitor
        .getDirtyRectPolicy("base")
        .getCanonicalRectsForRect(new RectangleRange(810, 10, 100, 100)),
    ).toEqual([new RectangleRange(800, 0, 800, 600)]);
  });

  test("chunkBlockLoader 缓冲区更新应触发 baseRenderScheduler.invalidate", () => {
    const monitor = createMonitor("zeta");
    const invalidateSpy = jest
      .spyOn(monitor.baseRenderScheduler, "invalidate")
      .mockImplementation(() => false);
    const chunk = Chunk.fromId(1);

    monitor.chunkBlockLoader.chunkLoader.emitBufferUpdated({
      action: "expand",
      direction: "right",
      chunksLoaded: [chunk],
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    invalidateSpy.mockRestore();
  });

  test("设置 origin 或 zoom 应触发 baseRenderScheduler.invalidate", () => {
    const monitor = createMonitor("eta");
    const invalidateSpy = jest
      .spyOn(monitor.baseRenderScheduler, "invalidate")
      .mockImplementation(() => false);

    monitor.zoom = 2;
    monitor.origin = new Vector(100, 50);

    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(800, 0, 800, 600),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 600, 800, 600),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(800, 600, 800, 600),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 1600, 1200),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(-200, -100, 1600, 1200),
    );
    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
    invalidateSpy.mockRestore();
  });

  test("resizeRenderLayers 应在尺寸变化后触发 base/live 补绘请求", () => {
    const monitor = createMonitor("theta");
    const baseInvalidateSpy = jest
      .spyOn(monitor.baseRenderScheduler, "invalidate")
      .mockImplementation(() => false);
    const liveInvalidateSpy = jest
      .spyOn(monitor.renderScheduler, "invalidate")
      .mockImplementation(() => false);

    monitor.resizeRenderLayers(640, 480);

    expect(baseInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    expect(liveInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 640, 480),
    );

    baseInvalidateSpy.mockRestore();
    liveInvalidateSpy.mockRestore();
  });
});
