/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";

import { BoardCore } from "../board-core.js";
import { ViewportCore } from "../viewport-core.js";
import { RectangleRange } from "../../../../shared/range/index.js";
import { Vector } from "../../../../utils/math.js";
import {
  createNoopCanvasContext2D,
  createNoopImageBitmap,
  installNoopOffscreenCanvas,
} from "../../../../test-support/noop-canvas.js";

describe("ViewportCore", () => {
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
   * 创建 ViewportCore 测试上下文
   * @param {{
   *   width?: number,
   *   height?: number,
   *   boardWidth?: number,
   *   boardHeight?: number,
   *   viewportId?: string,
   * }} [options={}] - 测试选项
   * @returns {{ boardCore: BoardCore, viewportCore: ViewportCore, postedFrames: Array<{ message: Object, transferList: Transferable[] }> }}
   */
  function createViewportCoreContext(options = {}) {
    const postedFrames = [];
    const boardCore = new BoardCore({
      width: options.boardWidth ?? 800,
      height: options.boardHeight ?? 600,
    });
    const viewportCore = new ViewportCore({
      boardCore,
      viewportId: options.viewportId ?? "worker-viewport",
      width: options.width ?? 800,
      height: options.height ?? 600,
      postRenderFrame(message, transferList = []) {
        postedFrames.push({ message, transferList });
      },
    });

    return { boardCore, viewportCore, postedFrames };
  }

  test("构造后应初始化 chunkLoader 和 renderer", () => {
    const { viewportCore } = createViewportCoreContext();

    expect(viewportCore.chunkLoader).toBeDefined();
    expect(viewportCore.renderer).toBeDefined();
    expect(viewportCore.renderer._scheduler).toBeDefined();
    expect(viewportCore.origin).toEqual(new Vector(0, 0));
    expect(viewportCore.zoom).toBe(1);
    expect(viewportCore.getViewportScreenRect()).toEqual(
      new RectangleRange(0, 0, 800, 600),
    );
  });

  test("onViewportChange 应触发缓存 / 输出刷新请求", () => {
    const { viewportCore } = createViewportCoreContext();
    const requestStaticSpy = jest.spyOn(
      viewportCore,
      "requestViewportStaticRefresh",
    );
    const requestActiveSpy = jest.spyOn(
      viewportCore,
      "requestViewportActiveRefresh",
    );

    const changed = viewportCore.onViewportChange({
      origin: { x: 120, y: 80 },
      zoom: 2,
    });

    expect(changed).toBe(true);
    expect(requestStaticSpy).toHaveBeenCalledTimes(1);
    expect(requestActiveSpy).toHaveBeenCalledTimes(1);
    expect(viewportCore.origin).toEqual(new Vector(120, 80));
    expect(viewportCore.zoom).toBe(2);
  });

  test("flushRenderFrame 应输出 render-frame 消息并将位图画回源 OffscreenCanvas", () => {
    const { viewportCore, postedFrames } = createViewportCoreContext();
    const liveCanvas = viewportCore.renderer.canvas;
    const liveBitmap = createNoopImageBitmap({ width: 800, height: 600 });
    const liveContext = {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };

    liveCanvas.getContext = jest.fn(() => liveContext);
    liveCanvas.transferToImageBitmap = jest.fn(() => liveBitmap);

    viewportCore.requestRenderLayersRefresh();
    const flushed = viewportCore.flushRenderFrame();

    expect(flushed).toBe(true);
    expect(postedFrames).toHaveLength(1);
    expect(postedFrames[0].message).toEqual(
      expect.objectContaining({
        type: "render-frame",
        viewportId: "worker-viewport",
        frameId: 1,
        liveBitmap,
      }),
    );
    expect(postedFrames[0].transferList).toEqual([liveBitmap]);
    expect(liveContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(liveContext.drawImage).toHaveBeenCalledWith(liveBitmap, 0, 0);
  });

  test("worldToChunk 应按 BoardCore 的区块尺寸解析目标区块", () => {
    const { viewportCore } = createViewportCoreContext();

    expect(viewportCore.worldToChunk(new Vector(400, 300))).toEqual({
      chunkId: 1,
      x: 400,
      y: 300,
    });
    expect(viewportCore.worldToChunk(new Vector(1000, 300))).toEqual({
      chunkId: 2,
      x: 200,
      y: 300,
    });
    expect(viewportCore.worldToChunk(new Vector(-200, 150))).toEqual({
      chunkId: 6,
      x: 600,
      y: 150,
    });
  });
});
