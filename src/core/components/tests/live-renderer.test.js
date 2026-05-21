import { LiveRenderer } from "../live-renderer.js";
import { Layer } from "../active-object-manager.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { DirectedGraph } from "../../utils/directed-graph.js";
import { Vector } from "../../utils/math.js";

describe("LiveRenderer", () => {
  class FakeObject extends BasicObject {
    constructor(id, position, calls) {
      super(position, id, 1);
      this.calls = calls;
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
});
