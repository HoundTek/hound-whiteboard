import { jest } from "@jest/globals";
import { LiveRenderer } from "../live-renderer.js";
import { Layer } from "../../../../shared/components/orchestration/active-object-manager.js";
import { BasicObject } from "../../../../shared/objects/basic-obj.js";
import { CircleObject } from "../../../../shared/objects/graph/circle.js";
import { StrokeObject } from "../../../../shared/objects/stroke/stroke.js";
import { DirectedGraph } from "../../../../utils/directed-graph.js";
import { RectangleRange } from "../../../../shared/range/rectangle.js";
import { Vector } from "../../../../utils/math.js";

describe("LiveRenderer", () => {
  class FakeObject extends BasicObject {
    constructor(id, position, calls) {
      super(id, position);
      this.calls = calls;
      this.rich.boundingBox = new RectangleRange(0, 0, 10, 10);
    }

    render(ctx) {
      this.calls.push({ type: "render", id: this.id });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, this.position.x, this.position.y);
      ctx.fillRect(0, 0, 10, 10);
      ctx.restore();
    }
  }

  function createContext(calls) {
    return {
      save() {
        calls.push({ type: "save" });
      },
      restore() {
        calls.push({ type: "restore" });
      },
      setTransform(a, b, c, d, e, f) {
        calls.push({ type: "setTransform", args: [a, b, c, d, e, f] });
      },
      clearRect(x, y, width, height) {
        calls.push({ type: "clearRect", args: [x, y, width, height] });
      },
      beginPath() {
        calls.push({ type: "beginPath" });
      },
      rect(x, y, width, height) {
        calls.push({ type: "rect", args: [x, y, width, height] });
      },
      clip() {
        calls.push({ type: "clip" });
      },
      fillRect(x, y, width, height) {
        calls.push({ type: "fillRect", args: [x, y, width, height] });
      },
      drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
        calls.push({
          type: "drawImage",
          args: [sx, sy, sw, sh, dx, dy, dw, dh],
        });
      },
    };
  }

  function createCanvas(width, height, contextResolver) {
    return {
      width,
      height,
      getContext() {
        return contextResolver();
      },
    };
  }

  function createLayer(id, activeObjectIds = [], inactiveGraph) {
    const layer = new Layer(id);
    for (const objectId of activeObjectIds) {
      layer.activeObjects.add(objectId);
    }
    if (inactiveGraph) {
      layer.inactiveGraph = inactiveGraph;
    }
    return layer;
  }

  function createReceiverSensitiveContext(calls) {
    const ctx = {
      save() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "save" });
      },
      restore() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "restore" });
      },
      setTransform(a, b, c, d, e, f) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "setTransform", args: [a, b, c, d, e, f] });
      },
      clearRect(x, y, width, height) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "clearRect", args: [x, y, width, height] });
      },
      beginPath() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "beginPath" });
      },
      rect(x, y, width, height) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "rect", args: [x, y, width, height] });
      },
      clip() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "clip" });
      },
      fillRect(x, y, width, height) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "fillRect", args: [x, y, width, height] });
      },
      drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({
          type: "drawImage",
          args: [sx, sy, sw, sh, dx, dy, dw, dh],
        });
      },
    };

    Object.defineProperty(ctx, "fillStyle", {
      configurable: true,
      enumerable: true,
      get() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        return "#000000";
      },
      set(value) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push({ type: "fillStyle", value });
      },
    });

    return ctx;
  }

  test("应按 layerOrder 顺序渲染活动对象", () => {
    const calls = [];
    const lower = new FakeObject(1, new Vector(10, 20), calls);
    const upper = new FakeObject(2, new Vector(30, 40), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const aom = {
      layerOrder: [createLayer(1, [1]), createLayer(2, [2])],
      activeObjectIndex: new Map([
        [1, lower],
        [2, upper],
      ]),
      activeObjects: new Set([lower, upper]),
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });
    const drawables = renderer.render();

    expect(drawables).toEqual([lower, upper]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 1 },
      { type: "render", id: 2 },
    ]);
  });

  test("应将对象世界坐标折算为 viewport 屏幕坐标", () => {
    const calls = [];
    const object = new FakeObject(7, new Vector(110, 70), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(400, 300, () => ctx);
    const viewport = {
      zoom: 2,
      origin: new Vector(100, 50),
    };
    const aom = {
      layerOrder: [createLayer(7, [7])],
      activeObjectIndex: new Map([[7, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });
    renderer.render();

    expect(calls).toContainEqual({
      type: "setTransform",
      args: [2, 0, 0, 2, 20, 40],
    });
  });

  test("viewportContext 应保持原生 context accessor 的合法 receiver", () => {
    const calls = [];
    class StyledFakeObject extends BasicObject {
      constructor() {
        super(301, new Vector(10, 20));
        this.rich.boundingBox = new RectangleRange(0, 0, 10, 10);
      }

      render(ctx) {
        ctx.save();
        ctx.fillStyle = "#ff0000";
        ctx.setTransform(1, 0, 0, 1, this.position.x, this.position.y);
        ctx.fillRect(0, 0, 10, 10);
        ctx.restore();
      }
    }

    const object = new StyledFakeObject();
    const ctx = createReceiverSensitiveContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 2,
      origin: new Vector(5, 10),
    };
    const aom = {
      layerOrder: [createLayer(1, [301])],
      activeObjectIndex: new Map([[301, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });

    expect(() => renderer.render()).not.toThrow();
    expect(calls).toContainEqual({ type: "fillStyle", value: "#ff0000" });
    expect(calls).toContainEqual({
      type: "setTransform",
      args: [2, 0, 0, 2, 10, 20],
    });
  });

  test("应先在层内绘制活动对象，再按 inactiveGraph 拓扑序绘制非活动对象", () => {
    const calls = [];
    const inactiveLower = new FakeObject(11, new Vector(0, 0), calls);
    const inactiveUpper = new FakeObject(12, new Vector(5, 5), calls);
    const active = new FakeObject(13, new Vector(10, 10), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const inactiveGraph = DirectedGraph.parse([
      [11, [12]],
      [12, []],
    ]);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const layer = createLayer(3, [13], inactiveGraph);
    const aom = {
      layerOrder: [layer],
      activeObjectIndex: new Map([[13, active]]),
      activeObjects: new Set([active]),
      findBoardObjectInstance(objectId) {
        return new Map([
          [11, inactiveLower],
          [12, inactiveUpper],
        ]).get(objectId);
      },
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });
    const drawables = renderer.render();

    expect(drawables).toEqual([active, inactiveLower, inactiveUpper]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 13 },
      { type: "render", id: 11 },
      { type: "render", id: 12 },
    ]);
  });

  test("未落入 layerOrder 的活动对象应走 activeObjects 回退路径", () => {
    const calls = [];
    const object = new FakeObject(21, new Vector(15, 25), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const aom = {
      layerOrder: [createLayer(4, [])],
      activeObjectIndex: new Map([[21, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });
    const drawables = renderer.render();

    expect(drawables).toEqual([object]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 21 },
    ]);
  });

  test("collectDrawablesByObjectIds 应复用解析器并跳过重复或非法对象", () => {
    const calls = [];
    const first = new FakeObject(31, new Vector(0, 0), calls);
    const second = new FakeObject(32, new Vector(5, 5), calls);
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });
    const seenObjectIds = new Set([31]);
    const resolveObject = (objectId) =>
      new Map([
        [31, first],
        [32, second],
        [33, { id: 33 }],
      ]).get(objectId);

    const drawables = renderer.collectDrawablesByObjectIds(
      [31, 32, 33, 32],
      resolveObject,
      seenObjectIds,
    );

    expect(drawables).toEqual([second]);
    expect(seenObjectIds).toEqual(new Set([31, 32]));
  });

  test("collectLayerDrawables 应保持同层 active 在前、inactive 在后", () => {
    const calls = [];
    const inactive = new FakeObject(41, new Vector(0, 0), calls);
    const active = new FakeObject(42, new Vector(10, 10), calls);
    const inactiveGraph = DirectedGraph.parse([[41, []]]);
    const layer = createLayer(8, [42], inactiveGraph);
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const aom = {
      activeObjectIndex: new Map([[42, active]]),
      findBoardObjectInstance(objectId) {
        return new Map([[41, inactive]]).get(objectId);
      },
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    const drawables = renderer.collectLayerDrawables(layer, new Set());

    expect(drawables).toEqual([active, inactive]);
  });

  test("inactive layer 中保留下来的 activeObjects 应按 inactive 语义参与绘制", () => {
    const calls = [];
    const retained = new FakeObject(43, new Vector(0, 0), calls);
    const layer = createLayer(9, [43], DirectedGraph.parse([]));
    layer.active = false;
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const aom = {
      layerOrder: [layer],
      activeObjectIndex: new Map(),
      activeObjects: new Set(),
      findBoardObjectInstance(objectId) {
        return objectId === 43 ? retained : undefined;
      },
    };

    const renderer = new LiveRenderer(viewport, aom, { canvas });
    const drawables = renderer.render();

    expect(drawables).toEqual([retained]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 43 },
    ]);
  });

  test("render 传入 dirtyRects 时应只清理并重绘命中的对象", () => {
    const calls = [];
    const leftObject = new FakeObject(51, new Vector(0, 0), calls);
    const rightObject = new FakeObject(52, new Vector(100, 0), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
      worldRectToScreenRect(rect, padding = 0) {
        return new RectangleRange(
          rect.left - padding,
          rect.top - padding,
          rect.width + padding * 2,
          rect.height + padding * 2,
        );
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(9, [51, 52])],
      activeObjectIndex: new Map([
        [51, leftObject],
        [52, rightObject],
      ]),
      activeObjects: new Set([leftObject, rightObject]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    const drawables = renderer.render([
      { left: -2, top: -2, width: 20, height: 20, right: 18, bottom: 18 },
    ]);

    expect(drawables).toEqual([leftObject, rightObject]);
    expect(calls.filter((entry) => entry.type === "clearRect")).toEqual([
      { type: "clearRect", args: [-2, -2, 20, 20] },
    ]);
    expect(calls.filter((entry) => entry.type === "drawImage")).toEqual([
      { type: "drawImage", args: [-2, -2, 20, 20, -2, -2, 20, 20] },
    ]);
    expect(calls).toContainEqual({
      type: "rect",
      args: [-2, -2, 20, 20],
    });
    expect(calls).toContainEqual({ type: "clip" });
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 51 },
    ]);
  });

  test("clearDirtyRects 应把浮点脏区向外扩张到整像素清理矩形", () => {
    const calls = [];
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    renderer.clearDirtyRects([new RectangleRange(10.2, 20.4, 5.1, 6.2)]);

    expect(calls).toContainEqual({
      type: "clearRect",
      args: [10, 20, 6, 7],
    });
  });

  test("invalidateObjects 应同时失效对象变更前后的屏幕范围", () => {
    const calls = [];
    const object = new FakeObject(61, new Vector(0, 0), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const invalidateSpy = jest.fn().mockReturnValue(false);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      worldRectToScreenRect(rect, padding = 0) {
        return new RectangleRange(
          rect.left - padding,
          rect.top - padding,
          rect.width + padding * 2,
          rect.height + padding * 2,
        );
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(10, [61])],
      activeObjectIndex: new Map([[61, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });
    jest.spyOn(renderer, "invalidate").mockImplementation(invalidateSpy);

    renderer.render();
    object.position = new Vector(100, 0);

    renderer.invalidateObjects([object]);

    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(100, 0, 10, 10),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 10, 10),
    );
  });

  test("captureObjectSnapshot 应在未经历上一帧 render 时保留旧几何范围", () => {
    const calls = [];
    const object = new FakeObject(62, new Vector(0, 0), calls);
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const invalidateSpy = jest.fn().mockReturnValue(false);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      worldRectToScreenRect(rect, padding = 0) {
        return new RectangleRange(
          rect.left - padding,
          rect.top - padding,
          rect.width + padding * 2,
          rect.height + padding * 2,
        );
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(12, [62])],
      activeObjectIndex: new Map([[62, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });
    jest.spyOn(renderer, "invalidate").mockImplementation(invalidateSpy);

    renderer.captureObjectSnapshot([object]);
    object.position = new Vector(100, 0);
    renderer.invalidateObjects([object]);

    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(100, 0, 10, 10),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 10, 10),
    );
  });

  test("getObjectScreenRect 应应用对象级渲染 padding", () => {
    const calls = [];
    const object = new FakeObject(71, new Vector(0, 0), calls);
    object.getRenderPadding = () => 2;
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      worldRectToScreenRect(rect) {
        return new RectangleRange(rect.left, rect.top, rect.width, rect.height);
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(11, [71])],
      activeObjectIndex: new Map([[71, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    expect(renderer.getObjectScreenRect(object)).toEqual(
      new RectangleRange(-2, -2, 14, 14),
    );
  });

  test("真实对象应根据 property 动态提供渲染 padding", () => {
    const circle = new CircleObject(81, new Vector(0, 0), {}, { radius: 10 });
    const stroke = new StrokeObject(82, new Vector(0, 0));
    stroke.setData({ points: [new Vector(0, 0), new Vector(10, 0)].map(p => ({ x: p.x, y: p.y })) });

    expect(circle.getRenderPadding()).toBe(1.5);
    expect(stroke.getRenderPadding()).toBe(0.5);

    circle.setProperty({ strokeWidth: 6 });
    stroke.setProperty({ width: 4 });

    expect(circle.getRenderPadding()).toBe(3);
    expect(stroke.getRenderPadding()).toBe(2);
  });

  test("PathRange 对象的屏幕矩形应包含额外的抗锯齿安全留白", () => {
    const calls = [];
    const stroke = new StrokeObject(84, new Vector(10, 20));
    stroke.setData({ points: [new Vector(0, 0), new Vector(0, 12)].map(p => ({ x: p.x, y: p.y })) });

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      worldRectToScreenRect(rect) {
        return new RectangleRange(rect.left, rect.top, rect.width, rect.height);
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(13, [84])],
      activeObjectIndex: new Map([[84, stroke]]),
      activeObjects: new Set([stroke]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    expect(renderer.getObjectScreenRect(stroke)).toEqual(
      new RectangleRange(8.5, 18.5, 3, 15),
    );
  });

  test("copyBase 应把整个 baseCanvas 拷贝到 liveCanvas", () => {
    const calls = [];
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    renderer.copyBase();

    expect(calls.filter((entry) => entry.type === "setTransform")).toEqual([
      { type: "setTransform", args: [1, 0, 0, 1, 0, 0] },
    ]);
    expect(calls.filter((entry) => entry.type === "drawImage")).toEqual([
      {
        type: "drawImage",
        args: [
          0,
          0,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ],
      },
    ]);
  });

  test("copyBase 应在 baseCanvas 不存在时静默返回", () => {
    const calls = [];
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: null },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    renderer.copyBase();

    expect(calls.filter((entry) => entry.type === "drawImage")).toEqual([]);
  });

  test("copyBase 应在 context 不存在时静默返回", () => {
    const canvas = {
      width: 320,
      height: 240,
      getContext() {
        return null;
      },
    };
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    expect(() => renderer.copyBase()).not.toThrow();
  });

  test("copyBaseRects 应为每个脏区拷贝对应的 baseCanvas 区域", () => {
    const calls = [];
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    renderer.copyBaseRects([
      new RectangleRange(10, 20, 30, 40),
      new RectangleRange(50, 60, 70, 80),
    ]);

    expect(calls.filter((entry) => entry.type === "drawImage")).toEqual([
      { type: "drawImage", args: [10, 20, 30, 40, 10, 20, 30, 40] },
      { type: "drawImage", args: [50, 60, 70, 80, 50, 60, 70, 80] },
    ]);
  });

  test("copyBaseRects 应在传入空数组时不产生 drawImage", () => {
    const calls = [];
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    renderer.copyBaseRects([]);

    expect(calls.filter((entry) => entry.type === "drawImage")).toEqual([]);
  });

  test("copyBaseRects 应在 context 不存在时静默返回", () => {
    const canvas = {
      width: 320,
      height: 240,
      getContext() {
        return null;
      },
    };
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
    };
    const renderer = new LiveRenderer(viewport, undefined, { canvas });

    expect(() =>
      renderer.copyBaseRects([new RectangleRange(0, 0, 10, 10)]),
    ).not.toThrow();
  });

  test("render 无参调用应执行 clear → copyBase → 渲染活动对象", () => {
    const calls = [];
    const object = new FakeObject(91, new Vector(10, 20), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer: { canvas: {} },
      worldRectToScreenRect(rect) {
        return new RectangleRange(rect.left, rect.top, rect.width, rect.height);
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(14, [91])],
      activeObjectIndex: new Map([[91, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    const drawables = renderer.render();

    expect(drawables).toEqual([object]);
    const clearCalls = calls.filter((entry) => entry.type === "clearRect");
    const drawImageCalls = calls.filter((entry) => entry.type === "drawImage");
    const renderCalls = calls.filter((entry) => entry.type === "render");
    expect(clearCalls.length).toBe(1);
    expect(drawImageCalls.length).toBe(1);
    expect(renderCalls).toEqual([{ type: "render", id: 91 }]);
    const clearIndex = calls.indexOf(clearCalls[0]);
    const drawImageIndex = calls.indexOf(drawImageCalls[0]);
    expect(clearIndex).toBeLessThan(drawImageIndex);
  });

  test("render 在 baseScheduler 有待处理帧时应同步 flush", () => {
    const calls = [];
    const flushCalls = [];
    const object = new FakeObject(92, new Vector(0, 0), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const baseRenderer = {
      canvas: {},
      _scheduler: {
        framePending: true,
        flush() {
          flushCalls.push("flush");
          this.framePending = false;
        },
        invalidate() {},
      },
    };
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer,
      worldRectToScreenRect(rect) {
        return new RectangleRange(rect.left, rect.top, rect.width, rect.height);
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(15, [92])],
      activeObjectIndex: new Map([[92, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    renderer.render();

    expect(flushCalls).toEqual(["flush"]);
  });

  test("render 在 baseScheduler 无待处理帧时应不触发 flush", () => {
    const calls = [];
    const flushCalls = [];
    const object = new FakeObject(93, new Vector(0, 0), calls);
    const ctx = createContext(calls);
    const canvas = createCanvas(320, 240, () => ctx);
    const baseRenderer = {
      canvas: {},
      _scheduler: {
        framePending: false,
        flush() {
          flushCalls.push("flush");
        },
        invalidate() {},
      },
    };
    const viewport = {
      zoom: 1,
      origin: new Vector(0, 0),
      baseRenderer,
      worldRectToScreenRect(rect) {
        return new RectangleRange(rect.left, rect.top, rect.width, rect.height);
      },
    };
    const aom = {
      getObjectWorldRange(objectInstance) {
        return objectInstance.getRange().withPosition(objectInstance.position);
      },
      layerOrder: [createLayer(16, [93])],
      activeObjectIndex: new Map([[93, object]]),
      activeObjects: new Set([object]),
    };
    const renderer = new LiveRenderer(viewport, aom, { canvas });

    renderer.render();

    expect(flushCalls).toEqual([]);
  });
});
