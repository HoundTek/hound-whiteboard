/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";

import { BoardCore } from "../board-core.js";
import { MonitorCore } from "../monitor-core.js";
import { RectangleRange } from "../../../range/index.js";
import { Vector } from "../../../utils/math.js";
import {
  createNoopCanvasContext2D,
  createNoopImageBitmap,
  installNoopOffscreenCanvas,
} from "../../../test-support/noop-canvas.js";

describe("MonitorCore", () => {
  /**
   * OffscreenCanvas 恢复函数
   * @type {Function | null}
   */
  let restoreOffscreenCanvas = null;

  beforeEach(() => {
    restoreOffscreenCanvas = installNoopOffscreenCanvas();
  });

  afterEach(() => {
    restoreOffscreenCanvas?.();
    restoreOffscreenCanvas = null;
  });

  /**
   * 创建 MonitorCore 测试上下文
   * @param {{
   *   width?: number,
   *   height?: number,
   *   boardWidth?: number,
   *   boardHeight?: number,
   *   monitorId?: string,
   * }} [options={}] - 测试选项
   * @returns {{ boardCore: BoardCore, monitorCore: MonitorCore, postedFrames: Array<{ message: Object, transferList: Transferable[] }> }}
   */
  function createMonitorCoreContext(options = {}) {
    const postedFrames = [];
    const boardCore = new BoardCore({
      width: options.boardWidth ?? 800,
      height: options.boardHeight ?? 600,
    });
    const monitorCore = new MonitorCore({
      boardCore,
      monitorId: options.monitorId ?? "worker-monitor",
      width: options.width ?? 800,
      height: options.height ?? 600,
      postRenderFrame(message, transferList = []) {
        postedFrames.push({ message, transferList });
      },
    });

    return { boardCore, monitorCore, postedFrames };
  }

  test("构造后应初始化 chunkLoader、baseRenderer 和 liveRenderer", () => {
    const { monitorCore } = createMonitorCoreContext();

    expect(monitorCore.chunkLoader).toBeDefined();
    expect(monitorCore.baseRenderer).toBeDefined();
    expect(monitorCore.liveRenderer).toBeDefined();
    expect(monitorCore.baseRenderer._scheduler).toBeDefined();
    expect(monitorCore.liveRenderer._scheduler).toBeDefined();
    expect(monitorCore.origin).toEqual(new Vector(0, 0));
    expect(monitorCore.zoom).toBe(1);
    expect(monitorCore.getViewportScreenRect()).toEqual(
      new RectangleRange(0, 0, 800, 600),
    );
  });

  test("onViewportChange 应触发 base/live 重绘请求", () => {
    const { monitorCore } = createMonitorCoreContext();
    const requestBaseRenderSpy = jest.spyOn(
      monitorCore,
      "requestViewportBaseRender",
    );
    const requestLiveRenderSpy = jest.spyOn(
      monitorCore,
      "requestViewportLiveRender",
    );

    const changed = monitorCore.onViewportChange({
      origin: { x: 120, y: 80 },
      zoom: 2,
    });

    expect(changed).toBe(true);
    expect(requestBaseRenderSpy).toHaveBeenCalledTimes(1);
    expect(requestLiveRenderSpy).toHaveBeenCalledTimes(1);
    expect(monitorCore.origin).toEqual(new Vector(120, 80));
    expect(monitorCore.zoom).toBe(2);
  });

  test("flushRenderFrame 应输出 render-frame 消息并将位图画回源 OffscreenCanvas", () => {
    const { monitorCore, postedFrames } = createMonitorCoreContext();
    const baseCanvas = monitorCore.baseRenderer.canvas;
    const liveCanvas = monitorCore.liveRenderer.canvas;
    const baseBitmap = createNoopImageBitmap({ width: 800, height: 600 });
    const liveBitmap = createNoopImageBitmap({ width: 800, height: 600 });
    const baseContext = {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    const liveContext = {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };

    baseCanvas.getContext = jest.fn(() => baseContext);
    liveCanvas.getContext = jest.fn(() => liveContext);
    baseCanvas.transferToImageBitmap = jest.fn(() => baseBitmap);
    liveCanvas.transferToImageBitmap = jest.fn(() => liveBitmap);

    monitorCore.requestRenderLayersRefresh();
    const flushed = monitorCore.flushRenderFrame();

    expect(flushed).toBe(true);
    expect(postedFrames).toHaveLength(1);
    expect(postedFrames[0].message).toEqual(
      expect.objectContaining({
        type: "render-frame",
        monitorId: "worker-monitor",
        frameId: 1,
        baseBitmap,
        liveBitmap,
      }),
    );
    expect(postedFrames[0].transferList).toEqual([baseBitmap, liveBitmap]);
    expect(baseContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(baseContext.drawImage).toHaveBeenCalledWith(baseBitmap, 0, 0);
    expect(liveContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(liveContext.drawImage).toHaveBeenCalledWith(liveBitmap, 0, 0);
  });

  test("worldToChunk 应按 BoardCore 的区块尺寸解析目标区块", () => {
    const { monitorCore } = createMonitorCoreContext();

    expect(monitorCore.worldToChunk(new Vector(400, 300))).toEqual({
      chunkId: 1,
      x: 400,
      y: 300,
    });
    expect(monitorCore.worldToChunk(new Vector(1000, 300))).toEqual({
      chunkId: 2,
      x: 200,
      y: 300,
    });
    expect(monitorCore.worldToChunk(new Vector(-200, 150))).toEqual({
      chunkId: 6,
      x: 600,
      y: 150,
    });
  });
});
