import { jest } from "@jest/globals";
import { Monitor } from "../monitor.js";
import { Chunk } from "../chunk.js";
import { DevicesDAG } from "../../devices-dag/index.js";
import { RectangleRange } from "../../range/index.js";
import {
  createNoopCanvas,
  createNoopCanvasContext2D,
} from "../../test-support/noop-canvas.js";
import { Vector } from "../../utils/math.js";

describe("Monitor/ui renderer", () => {
  function createUiContext() {
    return {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      strokeRect: jest.fn(),
      setLineDash: jest.fn(),
    };
  }

  function createMonitorWithUi() {
    const uiContext = createUiContext();
    const liveCanvas = createNoopCanvas();
    const baseCanvas = createNoopCanvas();
    const uiCanvas = createNoopCanvas({
      width: 800,
      height: 600,
      context: uiContext,
    });
    const board = {
      width: 800,
      height: 600,
      devicesDAG: null,
      activeObjectManager: {
        activeObjects: new Set(),
      },
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

    board.devicesDAG = new DevicesDAG();

    const monitor = new Monitor(
      { baseCanvas, liveCanvas, uiCanvas },
      board,
      { width: 800, height: 600 },
      "ui-monitor",
    );

    return { monitor, uiContext };
  }

  test("构造后应接上 uiRenderer 与 uiRenderScheduler", () => {
    const { monitor } = createMonitorWithUi();

    expect(monitor.uiRenderer).toBeDefined();
    expect(monitor.uiRenderScheduler).toBeDefined();
  });

  test("视口变化与 flushViewportRender 应触发 ui 层补绘", () => {
    const { monitor } = createMonitorWithUi();
    const invalidateSpy = jest
      .spyOn(monitor.uiRenderScheduler, "invalidate")
      .mockImplementation(() => false);

    monitor.setViewportPosition(new Vector(10, 20));
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );

    invalidateSpy.mockClear();

    monitor.flushViewportRender();
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 800, 600),
    );

    invalidateSpy.mockRestore();
  });

  test("registerUiOverlayProvider 应注册 provider 并触发 ui 层补绘", () => {
    const { monitor } = createMonitorWithUi();
    const provider = () => undefined;
    const invalidateSpy = jest
      .spyOn(monitor, "requestViewportUiRender")
      .mockImplementation(() => undefined);

    expect(monitor.registerUiOverlayProvider(provider)).toBe(provider);
    expect(monitor.uiRenderer.overlayProviders.has(provider)).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    expect(monitor.unregisterUiOverlayProvider(provider)).toBe(true);
    expect(monitor.uiRenderer.overlayProviders.has(provider)).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    invalidateSpy.mockRestore();
  });

  test("flush 在传入空 dirtyRects 时应回退到全视口刷新", () => {
    const { monitor, uiContext } = createMonitorWithUi();

    monitor.uiRenderer.flush([]);

    expect(uiContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  test("overlay provider 返回 null 或非对象条目时应被安全过滤", () => {
    const { monitor, uiContext } = createMonitorWithUi();
    const goodDraw = jest.fn();

    monitor.uiRenderer.registerOverlayProvider(() => [
      null,
      undefined,
      123,
      {
        type: "rect",
        screenRect: new RectangleRange(10, 20, 30, 40),
        draw: goodDraw,
      },
    ]);

    expect(() => {
      monitor.uiRenderer.flush([new RectangleRange(0, 0, 800, 600)]);
    }).not.toThrow();

    // 仅合法条目被绘制
    expect(goodDraw).toHaveBeenCalledTimes(1);
  });

  test("overlay provider 抛出异常时不应中断其他 provider 的收集", () => {
    const { monitor, uiContext } = createMonitorWithUi();

    const goodDraw = jest.fn();
    monitor.uiRenderer.registerOverlayProvider(() => {
      throw new Error("provider crash");
    });
    monitor.uiRenderer.registerOverlayProvider(() => [
      {
        type: "rect",
        screenRect: new RectangleRange(50, 60, 20, 10),
        draw: goodDraw,
      },
    ]);

    expect(() => {
      monitor.uiRenderer.flush([new RectangleRange(0, 0, 800, 600)]);
    }).not.toThrow();

    // 异常 provider 被日志系统记录，不应中断其他 provider
    expect(goodDraw).toHaveBeenCalledTimes(1);
  });

  test("flush 在 getContext 返回 falsy 时应安全返回空数组", () => {
    const { monitor } = createMonitorWithUi();
    jest.spyOn(monitor, "getContext").mockReturnValue(null);

    const result = monitor.uiRenderer.flush([
      new RectangleRange(0, 0, 100, 100),
    ]);

    expect(result).toEqual([]);
  });
});
