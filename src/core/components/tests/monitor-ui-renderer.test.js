import { jest } from "@jest/globals";
import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { createWorkerBoardContext } from "../../test-support/worker-mode-fixtures.js";

describe("MonitorProxy/ui renderer", () => {
  test("构造后应接上 uiRenderer 并初始化内部调度器", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      expect(monitor.uiRenderer).toBeDefined();
      expect(monitor.uiRenderer._scheduler).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("视口变化与 flushViewportRender 应触发 ui 层补绘", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      const invalidateSpy = jest
        .spyOn(monitor.uiRenderer, "invalidate")
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
    } finally {
      cleanup();
    }
  });

  test("registerUiOverlayProvider 应注册 provider 并触发 ui 层补绘", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      const provider = () => undefined;
      const invalidateSpy = jest
        .spyOn(monitor.uiRenderer, "invalidateViewport")
        .mockImplementation(() => undefined);

      expect(monitor.registerUiOverlayProvider(provider)).toBe(provider);
      expect(monitor.uiRenderer.overlayProviders.has(provider)).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);

      expect(monitor.unregisterUiOverlayProvider(provider)).toBe(true);
      expect(monitor.uiRenderer.overlayProviders.has(provider)).toBe(false);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);

      invalidateSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test("flush 在传入空 dirtyRects 时应回退到全视口刷新", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      const uiContext = monitor.uiRenderer.canvas.getContext("2d");
      uiContext.clearRect = jest.fn();

      monitor.uiRenderer.flush([]);

      expect(uiContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    } finally {
      cleanup();
    }
  });

  test("overlay provider 返回 null 或非对象条目时应被安全过滤", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
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

      expect(goodDraw).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("overlay provider 抛出异常时不应中断其他 provider 的收集", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
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

      expect(goodDraw).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("flush 在 canvas context 返回 falsy 时应安全返回空数组", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "ui-monitor",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      monitor.uiRenderer._canvas = {
        width: 100,
        height: 100,
        getContext() {
          return null;
        },
      };

      const result = monitor.uiRenderer.flush([
        new RectangleRange(0, 0, 100, 100),
      ]);

      expect(result).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
