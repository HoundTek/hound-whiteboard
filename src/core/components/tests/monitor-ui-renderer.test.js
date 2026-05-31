import { jest } from "@jest/globals";
import { Monitor } from "../monitor.js";
import { Chunk } from "../chunk.js";
import { DevicesTree } from "../../devices/devices-tree.js";
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
    const liveCanvas = createNoopCanvas({ width: 800, height: 600 });
    const baseCanvas = createNoopCanvas({ width: 800, height: 600 });
    const uiCanvas = createNoopCanvas({
      width: 800,
      height: 600,
      context: uiContext,
    });
    const board = {
      width: 800,
      height: 600,
      devicesTree: null,
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

    board.devicesTree = new DevicesTree();

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
});