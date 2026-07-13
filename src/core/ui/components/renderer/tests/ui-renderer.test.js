import { jest } from "@jest/globals";
import { UiRenderer } from "../ui-renderer.js";
import { BasicObject } from "../../../../shared/objects/basic-obj.js";
import { RectangleRange } from "../../../../shared/range/index.js";
import { createNoopCanvasContext2D } from "../../../../test-support/noop-canvas.js";
import { Vector } from "../../../../utils/math.js";
import { createCompatSelectionEntriesForSummaries } from "../../../../shared/renderer/ui-overlay-factory.js";

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

  render() { }
}

describe("UiRenderer", () => {
  function createContext() {
    return {
      ...createNoopCanvasContext2D(),
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
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
    const zoom = 1;
    const origin = { x: 0, y: 0 };
    return {
      viewportId: "main",
      zoom,
      origin,
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
    const renderer = new UiRenderer(viewport, { canvas: canvas2 });

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  test("flush 应执行已注册的自定义 overlay provider", () => {
    const context = createContext();
    const board = {};
    const viewport = createViewport(board);
    const canvas3 = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas: canvas3 });
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
    const renderer = new UiRenderer(viewport, { canvas });
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

    renderer.registerOverlayProvider(
      ({ viewport, renderer: overlayRenderer }) =>
        createCompatSelectionEntriesForSummaries(
          [summary1, summary2],
          "chooser",
          viewport,
          (ctx, entry) => overlayRenderer.drawRectEntry(ctx, entry),
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
    const renderer = new UiRenderer(viewport, { canvas });
    const summary = {
      id: 17,
      position: { x: 10, y: 20 },
      boundingBox: { left: 0, top: 0, width: 30, height: 40 },
      property: {},
    };

    renderer.registerOverlayProvider(
      ({ viewport, renderer: overlayRenderer }) =>
        createCompatSelectionEntriesForSummaries(
          [summary],
          "chooser",
          viewport,
          (ctx, entry) => overlayRenderer.drawRectEntry(ctx, entry),
        ),
    );

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).toHaveBeenCalledWith(6, 16, 38, 48);
  });

  test("point 类型 overlay 应绘制填充圆点", () => {
    const context = {
      ...createContext(),
      _fillStyle: undefined,
      get fillStyle() {
        return this._fillStyle;
      },
      set fillStyle(v) {
        this._fillStyle = v;
      },
    };
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => { });
    context.arc = jest.fn(() => { });
    context.fill = jest.fn(() => { });

    renderer.registerOverlayProvider(() => ({
      source: "test-point",
      type: "point",
      screenPoint: { x: 100, y: 200 },
      radius: 6,
      fillStyle: "#ff6600",
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.beginPath).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalledWith(100, 200, 6, 0, Math.PI * 2);
    expect(context._fillStyle).toBe("#ff6600");
    expect(context.fill).toHaveBeenCalled();
  });

  test("point 类型 overlay 应支持 worldPoint 自动转 screenPoint", () => {
    const context = {
      ...createContext(),
      _fillStyle: undefined,
      get fillStyle() {
        return this._fillStyle;
      },
      set fillStyle(v) {
        this._fillStyle = v;
      },
    };
    const viewport = { ...createViewport({}), origin: { x: 0, y: 0 }, zoom: 2 };
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => { });
    context.arc = jest.fn(() => { });
    context.fill = jest.fn(() => { });

    renderer.registerOverlayProvider(() => ({
      source: "test-point-world",
      type: "point",
      worldPoint: { x: 50, y: 100 },
      radius: 3,
      fillStyle: "#33a1ff",
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    // zoom=2, origin=(0,0) → screenPoint=(100, 200)
    expect(context.arc).toHaveBeenCalledWith(100, 200, 3, 0, Math.PI * 2);
  });

  test("path 类型 overlay 应绘制折线", () => {
    const context = {
      ...createContext(),
      _strokeStyle: undefined,
      _lineWidth: undefined,
      get strokeStyle() {
        return this._strokeStyle;
      },
      set strokeStyle(v) {
        this._strokeStyle = v;
      },
      get lineWidth() {
        return this._lineWidth;
      },
      set lineWidth(v) {
        this._lineWidth = v;
      },
    };
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => { });
    context.moveTo = jest.fn(() => { });
    context.lineTo = jest.fn(() => { });
    context.stroke = jest.fn(() => { });

    renderer.registerOverlayProvider(() => ({
      source: "test-path",
      type: "path",
      screenPoints: [
        { x: 10, y: 20 },
        { x: 100, y: 200 },
        { x: 50, y: 300 },
      ],
      strokeStyle: "#00ff00",
      lineWidth: 2,
      lineDash: [4, 4],
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.beginPath).toHaveBeenCalled();
    expect(context.moveTo).toHaveBeenCalledWith(10, 20);
    expect(context.lineTo).toHaveBeenCalledWith(100, 200);
    expect(context.lineTo).toHaveBeenCalledWith(50, 300);
    expect(context._strokeStyle).toBe("#00ff00");
    expect(context._lineWidth).toBe(2);
    expect(context.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(context.stroke).toHaveBeenCalled();
  });

  test("path 类型 overlay 应支持 closePath", () => {
    const context = {
      ...createContext(),
      _fillStyle: undefined,
      get fillStyle() {
        return this._fillStyle;
      },
      set fillStyle(v) {
        this._fillStyle = v;
      },
    };
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => { });
    context.moveTo = jest.fn(() => { });
    context.lineTo = jest.fn(() => { });
    context.closePath = jest.fn(() => { });
    context.fill = jest.fn(() => { });

    renderer.registerOverlayProvider(() => ({
      source: "test-path-close",
      type: "path",
      screenPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
      ],
      fillStyle: "rgba(0,0,255,0.3)",
      closePath: true,
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.closePath).toHaveBeenCalled();
    expect(context._fillStyle).toBe("rgba(0,0,255,0.3)");
    expect(context.fill).toHaveBeenCalled();
  });

  test("path 类型 overlay 应支持 worldPoints 自动转 screenPoints", () => {
    const context = {
      ...createContext(),
      _strokeStyle: undefined,
      get strokeStyle() {
        return this._strokeStyle;
      },
      set strokeStyle(v) {
        this._strokeStyle = v;
      },
    };
    const viewport = { ...createViewport({}), origin: { x: 10, y: 20 }, zoom: 3 };
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => { });
    context.moveTo = jest.fn(() => { });
    context.lineTo = jest.fn(() => { });
    context.stroke = jest.fn(() => { });

    renderer.registerOverlayProvider(() => ({
      source: "test-path-world",
      type: "path",
      worldPoints: [
        { x: 10, y: 20 },
        { x: 20, y: 30 },
      ],
      strokeStyle: "#333",
    }));

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    // zoom=3, origin=(10,20) → (0,0), (30,30)
    expect(context.moveTo).toHaveBeenCalledWith(0, 0);
    expect(context.lineTo).toHaveBeenCalledWith(30, 30);
  });

  test("flush 无脏区时回退全量清空", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    renderer.flush([]);

    // 无脏区时不调用 _clearDirtyRects，直接 full clearRect
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  test("flush 有脏区时仅清空脏区区域", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    renderer.flush([new RectangleRange(100, 200, 50, 60)]);

    // clearRect 只应在脏区上调用，不应全量
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenCalledWith(100, 200, 50, 60);
  });

  test("flush 有脏区时 clearRect 使用 expandRectForClear 扩边到整数", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    renderer.flush([new RectangleRange(100.3, 200.7, 50.2, 60.9)]);

    // Math.floor(100.3) = 100, Math.floor(200.7) = 200
    // Math.ceil(150.5) = 151, Math.ceil(261.6) = 262
    expect(context.clearRect).toHaveBeenCalledWith(100, 200, 51, 62);
  });

  test("与脏区相交的 rect 条目应被绘制", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
    const draw = jest.fn();

    renderer.registerOverlayProvider(() => ({
      source: "intersecting-rect",
      type: "rect",
      screenRect: new RectangleRange(50, 50, 30, 30),
      strokeStyle: "#f00",
      lineWidth: 1,
      draw,
    }));

    // 脏区与条目相交
    renderer.flush([new RectangleRange(40, 40, 60, 60)]);

    expect(draw).toHaveBeenCalledTimes(1);
  });

  test("不与脏区相交的 rect 条目应被跳过", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
    const draw = jest.fn();

    renderer.registerOverlayProvider(() => ({
      source: "non-intersecting-rect",
      type: "rect",
      screenRect: new RectangleRange(200, 200, 30, 30),
      strokeStyle: "#f00",
      lineWidth: 1,
      draw,
    }));

    // 脏区完全远离条目
    renderer.flush([new RectangleRange(0, 0, 50, 50)]);

    expect(draw).not.toHaveBeenCalled();
  });

  test("不与脏区相交的 point 条目应被跳过", () => {
    const context = {
      ...createContext(),
      _fillStyle: undefined,
      get fillStyle() {
        return this._fillStyle;
      },
      set fillStyle(v) {
        this._fillStyle = v;
      },
    };
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => {});
    context.arc = jest.fn(() => {});

    renderer.registerOverlayProvider(() => ({
      source: "non-intersecting-point",
      type: "point",
      screenPoint: { x: 500, y: 500 },
      radius: 4,
      fillStyle: "#f00",
    }));

    // point 在脏区（0,0,50,50）之外
    renderer.flush([new RectangleRange(0, 0, 50, 50)]);

    expect(context.arc).not.toHaveBeenCalled();
  });

  test("不与脏区相交的 path 条目应被跳过", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });

    context.beginPath = jest.fn(() => {});
    context.moveTo = jest.fn(() => {});
    context.stroke = jest.fn(() => {});

    renderer.registerOverlayProvider(() => ({
      source: "non-intersecting-path",
      type: "path",
      screenPoints: [
        { x: 300, y: 300 },
        { x: 400, y: 400 },
      ],
      strokeStyle: "#f00",
    }));

    // path 在脏区（0,0,50,50）之外
    renderer.flush([new RectangleRange(0, 0, 50, 50)]);

    expect(context.stroke).not.toHaveBeenCalled();
  });

  test("有脏区时围绕条目 draw 应设置 clip", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
    const draw = jest.fn();

    renderer.registerOverlayProvider(() => ({
      source: "clipped-rect",
      type: "rect",
      screenRect: new RectangleRange(100, 100, 50, 50),
      strokeStyle: "#f00",
      lineWidth: 1,
      draw,
    }));

    renderer.flush([new RectangleRange(80, 80, 100, 100)]);

    // clip 管线：save → setTransform → beginPath → rect → clip → draw → restore
    expect(context.save).toHaveBeenCalled();
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(context.beginPath).toHaveBeenCalled();
    expect(context.rect).toHaveBeenCalledWith(80, 80, 100, 100);
    expect(context.clip).toHaveBeenCalled();
    expect(context.restore).toHaveBeenCalled();
  });

  test("有多个脏区时每个条目 draw 前后均有 save/restore 包围", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
    const draw1 = jest.fn();
    const draw2 = jest.fn();

    renderer.registerOverlayProvider(() => [
      {
        source: "entry-a",
        type: "rect",
        screenRect: new RectangleRange(10, 10, 20, 20),
        draw: draw1,
      },
      {
        source: "entry-b",
        type: "rect",
        screenRect: new RectangleRange(200, 200, 20, 20),
        draw: draw2,
      },
    ]);

    renderer.flush([new RectangleRange(0, 0, 50, 50)]);

    // entry-a 在脏区内，应绘制；entry-b 远离脏区，应跳过
    expect(draw1).toHaveBeenCalledTimes(1);
    expect(draw2).not.toHaveBeenCalled();
  });

  test("无 screenRect/screenPoint/screenPoints 的自定义 draw 条目不被跳过", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
    const draw = jest.fn();

    renderer.registerOverlayProvider(() => ({
      source: "custom-draw",
      type: "draw",
      draw,
    }));

    // 自定义 draw 条目无已知边界，即使不在脏区内也应绘制
    renderer.flush([new RectangleRange(0, 0, 10, 10)]);

    expect(draw).toHaveBeenCalledTimes(1);
  });

  test("normalizeOverlayEntry 应支持 summary-like 条目直接生成矩形 overlay", () => {
    const context = createContext();
    const viewport = createViewport({});
    const canvas = createCanvas(context);
    const renderer = new UiRenderer(viewport, { canvas });
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
