import { jest } from "@jest/globals";
import { RectangleRange } from "../shared/range/index.js";
import { Vector } from "../utils/math.js";
import { createWorkerBoardContext } from "../test-support/worker-mode-fixtures.js";

describe("Viewport/ui renderer", () => {
  test("构造后应接上 uiRenderer 并初始化内部调度器", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      expect(viewport.uiRenderer).toBeDefined();
      expect(viewport.uiRenderer._scheduler).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("视口变化与 flushViewportRender 应触发 ui 层补绘", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const invalidateSpy = jest
        .spyOn(viewport.uiRenderer, "invalidate")
        .mockImplementation(() => false);

      viewport.setViewportPosition(new Vector(10, 20));
      expect(invalidateSpy).toHaveBeenCalledWith(
        new RectangleRange(0, 0, 800, 600),
      );

      invalidateSpy.mockClear();

      viewport.flushViewportRender();
      expect(invalidateSpy).toHaveBeenCalledWith(
        new RectangleRange(0, 0, 800, 600),
      );

      invalidateSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test("registerUiOverlayProvider 应注册 provider 并触发 ui 层补绘", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const invalidateSpy = jest
        .spyOn(viewport.uiRenderer, "invalidate")
        .mockImplementation(() => false);

      viewport.registerUiOverlayProvider(() => ({
        source: "test-provider",
        type: "rect",
        geometry: {
          screenRect: new RectangleRange(10, 20, 30, 40),
        },
        draw: jest.fn(),
      }));

      expect(invalidateSpy).toHaveBeenCalledTimes(1);

      invalidateSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test("overlay provider 返回 null 或非对象条目时应被安全过滤", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const goodDraw = jest.fn();

      viewport.uiRenderer.registerOverlayProvider(() => [
        null,
        undefined,
        123,
        {
          source: "good-entry",
          type: "rect",
          geometry: {
            screenRect: new RectangleRange(10, 20, 30, 40),
          },
          draw: goodDraw,
        },
      ]);

      expect(() => {
        viewport.uiRenderer.flush([new RectangleRange(0, 0, 800, 600)]);
      }).not.toThrow();

      expect(goodDraw).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("overlay provider 抛出异常时不应中断其他 provider 的收集", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const goodDraw = jest.fn();
      viewport.uiRenderer.registerOverlayProvider(() => {
        throw new Error("provider crash");
      });
      viewport.uiRenderer.registerOverlayProvider(() => [
        {
          source: "good-entry",
          type: "rect",
          geometry: {
            screenRect: new RectangleRange(50, 60, 20, 10),
          },
          draw: goodDraw,
        },
      ]);

      expect(() => {
        viewport.uiRenderer.flush([new RectangleRange(0, 0, 800, 600)]);
      }).not.toThrow();

      expect(goodDraw).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("flush 在 canvas context 返回 falsy 时应安全返回空数组", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const getContextSpy = jest
        .spyOn(viewport.uiRenderer, "_getContext")
        .mockReturnValue(null);

      const result = viewport.uiRenderer.flush([
        new RectangleRange(0, 0, 800, 600),
      ]);
      expect(result).toEqual([]);

      getContextSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test("resize 应触发 uiRenderer.resize", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const resizeSpy = jest.spyOn(viewport.uiRenderer, "resize");

      viewport.resizeRenderLayers(400, 300);

      expect(resizeSpy).toHaveBeenCalledTimes(1);

      resizeSpy.mockRestore();
    } finally {
      cleanup();
    }
  });
});
