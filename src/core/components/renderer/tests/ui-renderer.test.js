import { jest } from "@jest/globals";
import { UiRenderer } from "../ui-renderer.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { RectangleRange } from "../../../range/index.js";
import { createNoopCanvasContext2D } from "../../../test-support/noop-canvas.js";
import { Vector } from "../../../utils/math.js";

class TestOverlayObject extends BasicObject {
  constructor({ id = 1, position, localRect, property } = {}) {
    super(id, position ?? new Vector(0, 0));
    this.rich.boundingBox = RectangleRange.from(
      localRect ?? new RectangleRange(0, 0, 0, 0),
    );
    this.setProperty(property);
  }

  isDirected() {
    return false;
  }

  isErasable() {
    return true;
  }

  render() {}
}

describe("UiRenderer", () => {
  function createContext() {
    return {
      ...createNoopCanvasContext2D(),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      clearRect: jest.fn(),
      strokeRect: jest.fn(),
      fillRect: jest.fn(),
      setLineDash: jest.fn(),
    };
  }

  function createCanvas(context) {
    return {
      width: 800,
      height: 600,
      getContext() {
        return context;
      },
    };
  }

  function createViewport(board = {}) {
    return {
      viewportId: "main",
      zoom: 1,
      board,
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
      getViewportScreenRect() {
        return new RectangleRange(0, 0, 800, 600);
      },
    };
  }

  test("对象只在 AOM 中但不在 chooser/modifier 当前上下文时，不应显示选择框", () => {
    const context = createContext();
    const board = {};
    const viewport = createViewport(board);
    const canvas2 = createCanvas(context);
    const object = new TestOverlayObject({
      id: 7,
      position: new Vector(10, 20),
      localRect: new RectangleRange(0, 0, 30, 40),
    });
    const aom = {
      activeObjects: new Set([object]),
      getObjectWorldRange() {
        return new RectangleRange(10, 20, 30, 40);
      },
    };
    const renderer = new UiRenderer(viewport, aom, { canvas: canvas2 });

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  test("flush 应执行已注册的自定义 overlay provider", () => {
    const context = createContext();
    const board = {};
    const viewport = createViewport(board);
    const canvas3 = createCanvas(context);
    const renderer = new UiRenderer(viewport, undefined, { canvas: canvas3 });
    const draw = jest.fn();
    const provider = jest.fn(() => ({
      type: "draw",
      worldRect: new RectangleRange(100, 120, 20, 30),
      draw,
    }));

    renderer.registerOverlayProvider(provider);
    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  test("createCompatSelectionEntriesForSummaries 应生成对象级与组合选择框", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, undefined, { canvas });
    const summary1 = {
      id: 17,
      position: { x: 10, y: 20 },
      range: new RectangleRange(0, 0, 30, 40),
      property: {},
    };
    const summary2 = {
      id: 18,
      position: { x: 60, y: 80 },
      range: new RectangleRange(0, 0, 20, 10),
      property: {},
    };

    renderer.registerOverlayProvider(({ renderer: overlayRenderer }) =>
      overlayRenderer.createCompatSelectionEntriesForSummaries(
        [summary1, summary2],
        "chooser",
      ),
    );

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect.mock.calls).toEqual([
      [6, 16, 38, 48],
      [56, 76, 28, 18],
      [6, 16, 78, 78],
    ]);
    expect(context.setLineDash.mock.calls).toEqual([[[]], [[]], [[10, 4]]]);
  });

  test("createCompatSelectionEntriesForSummaries 应支持 RPC 风格的 plain boundingBox", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, undefined, { canvas });
    const summary = {
      id: 17,
      position: { x: 10, y: 20 },
      boundingBox: { left: 0, top: 0, width: 30, height: 40 },
      property: {},
    };

    renderer.registerOverlayProvider(({ renderer: overlayRenderer }) =>
      overlayRenderer.createCompatSelectionEntriesForSummaries(
        [summary],
        "chooser",
      ),
    );

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).toHaveBeenCalledWith(6, 16, 38, 48);
  });

  test("normalizeOverlayEntry 应支持 summary-like 条目直接生成矩形 overlay", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, undefined, { canvas });
    renderer.registerOverlayProvider(() => ({
      source: "summary-like-entry",
      objectId: 77,
      type: "rect",
      position: { x: 10, y: 20 },
      boundingBox: { left: 0, top: 0, width: 30, height: 40 },
      strokeStyle: "#ff0000",
      lineWidth: 1,
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).toHaveBeenCalledWith(6, 16, 38, 48);
  });
});
