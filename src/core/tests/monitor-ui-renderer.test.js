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
      const provider = () => undefined;
      const invalidateSpy = jest
        .spyOn(viewport.uiRenderer, "invalidateViewport")
        .mockImplementation(() => undefined);

      expect(viewport.registerUiOverlayProvider(provider)).toBe(provider);
      expect(viewport.uiRenderer.overlayProviders.has(provider)).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);

      expect(viewport.unregisterUiOverlayProvider(provider)).toBe(true);
      expect(viewport.uiRenderer.overlayProviders.has(provider)).toBe(false);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);

      invalidateSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test("flush 在传入空 dirtyRects 时应回退到全视口刷新", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "ui-viewport",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const uiContext = viewport.uiRenderer.canvas.getContext("2d");
      uiContext.clearRect = jest.fn();

      viewport.uiRenderer.flush([]);

      expect(uiContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
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
          type: "rect",
          screenRect: new RectangleRange(10, 20, 30, 40),
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
          type: "rect",
          screenRect: new RectangleRange(50, 60, 20, 10),
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
      viewport.uiRenderer._canvas = {
        width: 100,
        height: 100,
        getContext() {
          return null;
        },
      };

      const result = viewport.uiRenderer.flush([
        new RectangleRange(0, 0, 100, 100),
      ]);

      expect(result).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
