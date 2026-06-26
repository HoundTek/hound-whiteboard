import { jest } from "@jest/globals";
import { Monitor } from "../monitor.js";
import { DevicesDAG } from "../../../devices-dag/index.js";
import { Vector } from "../../../utils/math.js";
import { Chunk } from "../../chunk/chunk.js";
import { RectangleRange } from "../../../range/index.js";
import { createSubDAG } from "../../../devices-dag/index.js";
import { createPrefixNodeHandler } from "../../../prefixs/index.js";
import {
  createNoopCanvas,
  createNoopCanvasContext2D,
} from "../../../test-support/noop-canvas.js";

const REPORT_SIGNAL_TYPE = "debug-report";

function createReportSubDAG() {
  let lastReceivedAt = "/";
  let lastOriginalTo = "/";

  const builder = createSubDAG("/debugger");
  const root = builder
    .node()
    .prefix(
      createPrefixNodeHandler({
        initialState: { entryIndex: -1 },
        handle(signalPacket, prefixContext = {}) {
          const sigs = Array.isArray(signalPacket.signals)
            ? signalPacket.signals
            : [];
          lastReceivedAt = prefixContext.path ?? "/";
          lastOriginalTo = signalPacket.to ?? "/";
          prefixContext.patchState({
            entryIndex: (prefixContext.getState().entryIndex ?? -1) + 1,
          });
          return prefixContext.routeToChild("report", sigs);
        },
      }),
      { prefixKind: "debug", routePolicy: "inspect" },
    )
    .defaultRoute("report");

  const report = builder.node().handler((signalPacket, context = {}) => ({
    to: "",
    signals: [
      {
        type: REPORT_SIGNAL_TYPE,
        context: {
          index: 0,
          receivedAt: lastReceivedAt,
          originalTo: lastOriginalTo,
          signalCount: Array.isArray(signalPacket.signals)
            ? signalPacket.signals.length
            : 0,
        },
      },
    ],
  }));

  builder.edge("report", root, report);

  return builder.build();
}

describe("Monitor", () => {
  function createContext() {
    return createNoopCanvasContext2D();
  }

  function createMonitor(monitorId = "monitor") {
    const liveCanvas = createNoopCanvas();
    const baseCanvas = createNoopCanvas();
    const uiCanvas = createNoopCanvas({ width: 0, height: 0 });
    const board = {
      width: 800,
      height: 600,
      devicesDAG: null,
      getChunkById(chunkId) {
        return Chunk.fromId(chunkId);
      },
      createChunkLoader() {
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

    board.devicesDAG = new DevicesDAG();

    return new Monitor(
      { baseCanvas, liveCanvas, uiCanvas },
      board,
      { width: 800, height: 600 },
      monitorId,
    );
  }

  test("mountSubDAG 应自动补上 monitorId 后挂载设备", () => {
    const monitor = createMonitor("alpha");
    const reportSubDAG = createReportSubDAG();

    const mountedNodes = monitor.mountSubDAG("", reportSubDAG);
    const packets = monitor.devicesDAG.dispatch({
      to: "/alpha/debugger",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/alpha/debugger",
      "/alpha/debugger/report",
    ]);
    expect(packets.packets).toEqual([
      {
        to: "",
        signals: [
          {
            type: REPORT_SIGNAL_TYPE,
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

  test("mountSubDAG 应规整不带前导斜杠的相对路径", () => {
    const monitor = createMonitor("beta");
    const reportSubDAG = createReportSubDAG();

    const mountedNodes = monitor.mountSubDAG("debugger", reportSubDAG);

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

  test("构造后应初始化三个渲染器及其内部调度器", () => {
    const monitor = createMonitor("delta");

    expect(monitor.baseRenderer).toBeDefined();
    expect(monitor.liveRenderer).toBeDefined();
    expect(monitor.uiRenderer).toBeDefined();
    expect(monitor.baseRenderer._scheduler).toBeDefined();
    expect(monitor.liveRenderer._scheduler).toBeDefined();
    expect(monitor.uiRenderer._scheduler).toBeDefined();
    expect(monitor.canvas).toBe(monitor.liveRenderer.canvas);
  });

  test("base/live 调度器应使用不同的 dirty rect 聚合参数", () => {
    const monitor = createMonitor("epsilon-merge");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(20, 0, 10, 10),
    ];

    const baseMerger = monitor.baseRenderer._scheduler.mergeDirtyRects;
    const liveMerger = monitor.liveRenderer._scheduler.mergeDirtyRects;

    expect(baseMerger(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(20, 0, 10, 10),
    ]);
    expect(liveMerger(dirtyRects)).toEqual([new RectangleRange(0, 0, 30, 10)]);
  });

  test("dirty rect 聚合阈值应随 zoom 放大而同步放宽", () => {
    const monitor = createMonitor("epsilon-zoom-merge");
    const dirtyRects = [
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(18, 0, 10, 10),
    ];

    const baseMerger = monitor.baseRenderer._scheduler.mergeDirtyRects;
    const liveMerger = monitor.liveRenderer._scheduler.mergeDirtyRects;

    expect(baseMerger(dirtyRects)).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(18, 0, 10, 10),
    ]);
    expect(liveMerger(dirtyRects)).toEqual([new RectangleRange(0, 0, 28, 10)]);

    monitor.zoom = 2;

    expect(baseMerger(dirtyRects)).toEqual([new RectangleRange(0, 0, 28, 10)]);
    expect(liveMerger(dirtyRects)).toEqual([new RectangleRange(0, 0, 28, 10)]);
  });

  test("设置 origin 或 zoom 应触发 baseRenderScheduler.invalidate", () => {
    const monitor = createMonitor("eta");
    const invalidateSpy = jest
      .spyOn(monitor.baseRenderer, "invalidate")
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
      .spyOn(monitor.baseRenderer, "invalidate")
      .mockImplementation(() => false);
    const liveInvalidateSpy = jest
      .spyOn(monitor.liveRenderer, "invalidate")
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

  test("setViewportScaleAroundCenter 应以视口中心为锚点更新 origin 与 zoom", () => {
    const monitor = createMonitor("iota-scale-center");
    const liveInvalidateSpy = jest
      .spyOn(monitor.liveRenderer, "invalidate")
      .mockImplementation(() => false);

    monitor.setViewportScaleAroundCenter(2);

    expect(monitor.zoom).toBe(2);
    expect(monitor.origin.serialize()).toEqual({ x: 200, y: 150 });
    expect(liveInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );

    liveInvalidateSpy.mockRestore();
  });

  test("flushViewportRender 应触发 base/live 全视口刷新", () => {
    const monitor = createMonitor("kappa-flush");
    const syncSpy = jest
      .spyOn(monitor, "syncChunkBufferWithViewport")
      .mockImplementation(() => []);
    const baseInvalidateSpy = jest
      .spyOn(monitor.baseRenderer, "invalidate")
      .mockImplementation(() => false);
    const liveInvalidateSpy = jest
      .spyOn(monitor.liveRenderer, "invalidate")
      .mockImplementation(() => false);

    monitor.flushViewportRender();

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(baseInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );
    expect(liveInvalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );

    syncSpy.mockRestore();
    baseInvalidateSpy.mockRestore();
    liveInvalidateSpy.mockRestore();
  });

  test("memory board 的视口同步应增量扩展 chunk buffer，而不是 reset", () => {
    const chunk1 = Chunk.fromId(1);
    const chunk2 = Chunk.fromId(2);
    const monitor = createMonitor("lambda-memory-sync");
    const bufferState = {
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      chunks: [chunk1],
    };

    monitor.board.isPersistent = () => false;
    monitor.chunkLoader = {
      getLoadedChunks() {
        return bufferState.chunks;
      },
      getChunkById(chunkId) {
        const chunks = [chunk1, chunk2].filter(Boolean);
        return chunks.find((c) => c.id === chunkId) ?? Chunk.fromId(chunkId);
      },
      emitLoadRequest: jest.fn(),
      emitUnloadRequest: jest.fn(),
      untrackChunkById: jest.fn(),
    };

    jest
      .spyOn(monitor, "getVisibleChunksForViewport")
      .mockReturnValue([chunk1, chunk2]);

    const currentChunks = monitor.syncChunkBufferWithViewport();

    expect(currentChunks).toEqual([chunk1, chunk2]);
  });
});
