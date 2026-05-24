import { LiveRenderer } from "../live-renderer.js";
import { Layer } from "../active-object-manager.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { CircleObject } from "../../objects/graph/circle.js";
import { TextObject } from "../../objects/one-dim/text.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { DirectedGraph } from "../../utils/directed-graph.js";
import { RectangleRange } from "../../range/rectangle.js";
import { Vector } from "../../utils/math.js";

describe("LiveRenderer", () => {
  class FakeObject extends BasicObject {
    constructor(id, position, calls) {
      super(position, id, 1);
      this.calls = calls;
      this.boundingBox = new RectangleRange(0, 0, 10, 10);
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
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
    };
    const aom = {
      layerOrder: [createLayer(1, [1]), createLayer(2, [2])],
      activeObjectIndex: new Map([
        [1, lower],
        [2, upper],
      ]),
      activeObjects: new Set([lower, upper]),
    };

    const renderer = new LiveRenderer(monitor, aom);
    const drawables = renderer.render();

    expect(drawables).toEqual([lower, upper]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 1 },
      { type: "render", id: 2 },
    ]);
  });

  test("应将对象世界坐标折算为 monitor 屏幕坐标", () => {
    const calls = [];
    const object = new FakeObject(7, new Vector(110, 70), calls);
    const ctx = createContext(calls);
    const monitor = {
      zoom: 2,
      origin: new Vector(100, 50),
      liveCanvas: { width: 400, height: 300 },
      getContext() {
        return ctx;
      },
    };
    const aom = {
      layerOrder: [createLayer(7, [7])],
      activeObjectIndex: new Map([[7, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(monitor, aom);
    renderer.render();

    expect(calls).toContainEqual({
      type: "setTransform",
      args: [1, 0, 0, 1, 0, 0],
    });
    expect(calls).toContainEqual({
      type: "setTransform",
      args: [2, 0, 0, 2, 20, 40],
    });
  });

  test("viewportContext 应保持原生 context accessor 的合法 receiver", () => {
    const calls = [];
    class StyledFakeObject extends BasicObject {
      constructor() {
        super(new Vector(10, 20), 301, 1);
        this.boundingBox = new RectangleRange(0, 0, 10, 10);
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
    const monitor = {
      zoom: 2,
      origin: new Vector(5, 10),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
    };
    const aom = {
      layerOrder: [createLayer(1, [301])],
      activeObjectIndex: new Map([[301, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(monitor, aom);

    expect(() => renderer.render()).not.toThrow();
    expect(calls).toContainEqual({ type: "fillStyle", value: "#ff0000" });
    expect(calls).toContainEqual({
      type: "setTransform",
      args: [2, 0, 0, 2, 10, 20],
    });
  });

  test("应按 layer.inactiveGraph 拓扑序先绘制同层非活动对象，再绘制活动对象", () => {
    const calls = [];
    const inactiveLower = new FakeObject(11, new Vector(0, 0), calls);
    const inactiveUpper = new FakeObject(12, new Vector(5, 5), calls);
    const active = new FakeObject(13, new Vector(10, 10), calls);
    const ctx = createContext(calls);
    const inactiveGraph = DirectedGraph.parse([
      [11, [12]],
      [12, []],
    ]);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
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

    const renderer = new LiveRenderer(monitor, aom);
    const drawables = renderer.render();

    expect(drawables).toEqual([inactiveLower, inactiveUpper, active]);
    expect(calls.filter((entry) => entry.type === "render")).toEqual([
      { type: "render", id: 11 },
      { type: "render", id: 12 },
      { type: "render", id: 13 },
    ]);
  });

  test("未落入 layerOrder 的活动对象应走 activeObjects 回退路径", () => {
    const calls = [];
    const object = new FakeObject(21, new Vector(15, 25), calls);
    const ctx = createContext(calls);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
    };
    const aom = {
      layerOrder: [createLayer(4, [])],
      activeObjectIndex: new Map([[21, object]]),
      activeObjects: new Set([object]),
    };

    const renderer = new LiveRenderer(monitor, aom);
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
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
    };
    const renderer = new LiveRenderer(monitor, undefined);
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

  test("collectLayerDrawables 应保持同层 inactive 在前、active 在后", () => {
    const calls = [];
    const inactive = new FakeObject(41, new Vector(0, 0), calls);
    const active = new FakeObject(42, new Vector(10, 10), calls);
    const inactiveGraph = DirectedGraph.parse([[41, []]]);
    const layer = createLayer(8, [42], inactiveGraph);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
    };
    const aom = {
      activeObjectIndex: new Map([[42, active]]),
      findBoardObjectInstance(objectId) {
        return new Map([[41, inactive]]).get(objectId);
      },
    };
    const renderer = new LiveRenderer(monitor, aom);

    const drawables = renderer.collectLayerDrawables(layer, new Set());

    expect(drawables).toEqual([inactive, active]);
  });

  test("render 传入 dirtyRects 时应只清理并重绘命中的对象", () => {
    const calls = [];
    const leftObject = new FakeObject(51, new Vector(0, 0), calls);
    const rightObject = new FakeObject(52, new Vector(100, 0), calls);
    const ctx = createContext(calls);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
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
    const renderer = new LiveRenderer(monitor, aom);

    const drawables = renderer.render([
      { left: -2, top: -2, width: 20, height: 20, right: 18, bottom: 18 },
    ]);

    expect(drawables).toEqual([leftObject, rightObject]);
    expect(calls.filter((entry) => entry.type === "clearRect")).toEqual([
      { type: "clearRect", args: [-2, -2, 20, 20] },
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
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
    };
    const renderer = new LiveRenderer(monitor, undefined);

    renderer.clearDirtyRects([new RectangleRange(10.2, 20.4, 5.1, 6.2)]);

    expect(calls).toContainEqual({
      type: "clearRect",
      args: [10, 20, 6, 7],
    });
  });

  test("invalidateObjects 应同时失效对象变更前后的屏幕范围", () => {
    const calls = [];
    const invalidateCalls = [];
    const object = new FakeObject(61, new Vector(0, 0), calls);
    const ctx = createContext(calls);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return ctx;
      },
      renderScheduler: {
        invalidate(rect) {
          invalidateCalls.push(rect);
        },
      },
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
    const renderer = new LiveRenderer(monitor, aom);

    renderer.render();
    object.position = new Vector(100, 0);

    renderer.invalidateObjects([object]);

    expect(invalidateCalls).toEqual([
      new RectangleRange(100, 0, 10, 10),
      new RectangleRange(0, 0, 10, 10),
    ]);
  });

  test("captureObjectSnapshot 应在未经历上一帧 render 时保留旧几何范围", () => {
    const calls = [];
    const invalidateCalls = [];
    const object = new FakeObject(62, new Vector(0, 0), calls);
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
      renderScheduler: {
        invalidate(rect) {
          invalidateCalls.push(rect);
        },
      },
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
    const renderer = new LiveRenderer(monitor, aom);

    renderer.captureObjectSnapshot([object]);
    object.position = new Vector(100, 0);
    renderer.invalidateObjects([object]);

    expect(invalidateCalls).toEqual([
      new RectangleRange(100, 0, 10, 10),
      new RectangleRange(0, 0, 10, 10),
    ]);
  });

  test("getObjectScreenRect 应应用对象级渲染 padding", () => {
    const calls = [];
    const object = new FakeObject(71, new Vector(0, 0), calls);
    object.getRenderPadding = () => 2;
    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
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
    const renderer = new LiveRenderer(monitor, aom);

    expect(renderer.getObjectScreenRect(object)).toEqual(
      new RectangleRange(-2, -2, 14, 14),
    );
  });

  test("真实对象应根据 property 动态提供渲染 padding", () => {
    const circle = new CircleObject(new Vector(0, 0), 81, 1, 10);
    const stroke = new StrokeObject(new Vector(0, 0), 82, 1);
    const text = new TextObject(new Vector(0, 0), 83, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(10, 0)]);

    expect(circle.getRenderPadding()).toBe(1.5);
    expect(stroke.getRenderPadding()).toBe(0.5);
    expect(text.getRenderPadding()).toBe(0.5);

    circle.setProperty({ strokeWidth: 6 });
    stroke.setProperty({ width: 4 });
    text.setProperty({ strokeWidth: 2 });

    expect(circle.getRenderPadding()).toBe(3);
    expect(stroke.getRenderPadding()).toBe(2);
    expect(text.getRenderPadding()).toBe(1);
  });

  test("PathRange 对象的屏幕矩形应包含额外的抗锯齿安全留白", () => {
    const calls = [];
    const stroke = new StrokeObject(new Vector(10, 20), 84, 1);
    stroke.setPathPoints([new Vector(0, 0), new Vector(0, 12)]);

    const monitor = {
      zoom: 1,
      origin: new Vector(0, 0),
      liveCanvas: { width: 320, height: 240 },
      getContext() {
        return createContext(calls);
      },
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
    const renderer = new LiveRenderer(monitor, aom);

    expect(renderer.getObjectScreenRect(stroke)).toEqual(
      new RectangleRange(8.5, 18.5, 3, 15),
    );
  });
});
