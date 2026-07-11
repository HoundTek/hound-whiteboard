/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";
import { ViewportRenderer } from "../viewport-renderer.js";
import { DirectedGraph } from "../../../../utils/directed-graph.js";
import { Vector } from "../../../../utils/math.js";
import { BasicObject } from "../../../../shared/objects/basic-obj.js";
import { RectangleRange } from "../../../../shared/range/rectangle.js";
import { PathRange } from "../../../../shared/range/path.js";
import { Layer } from "../../orchestration/active-object-manager.js";
import { installNoopOffscreenCanvas } from "../../../../test-support/noop-canvas.js";

/**
 * 假矩形对象
 * @class
 */
class FakeRectObject extends BasicObject {
  /**
   * @param {number} id - 对象 id
   * @param {Vector} position - 位置
   * @param {Array<[number, string]>} renderCalls - 渲染记录
   */
  constructor(id, position, renderCalls) {
    super(id, position);
    this.renderCalls = renderCalls;
    this.rich.boundingBox = new RectangleRange(0, 0, 10, 10);
  }

  /**
   * 渲染对象
   * @param {CanvasRenderingContext2D & { __label?: string }} ctx - 画布上下文
   */
  render(ctx) {
    this.renderCalls.push([this.id, ctx.__label ?? "unknown"]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, this.position.x, this.position.y);
    ctx.fillRect?.(0, 0, 10, 10);
    ctx.restore();
  }
}

/**
 * 假路径对象
 * @class
 */
class FakePathObject extends BasicObject {
  /**
   * @param {number} id - 对象 id
   * @param {Vector} position - 位置
   */
  constructor(id, position) {
    super(id, position, { width: 4 });
  }

  /**
   * 获取主判定范围
   * @returns {PathRange}
   */
  getRange() {
    return new PathRange([new Vector(0, 0), new Vector(10, 0)]);
  }

  /**
   * 渲染对象
   */
  render() { }
}

/**
 * 创建记录型上下文
 * @param {string} label - 上下文标签
 * @param {Array<any>} calls - 调用记录
 * @returns {CanvasRenderingContext2D & { __label: string }}
 */
function createContext(label, calls) {
  return {
    __label: label,
    save() {
      calls.push([label, "save"]);
    },
    restore() {
      calls.push([label, "restore"]);
    },
    setTransform(...args) {
      calls.push([label, "setTransform", ...args]);
    },
    clearRect(...args) {
      calls.push([label, "clearRect", ...args]);
    },
    beginPath() {
      calls.push([label, "beginPath"]);
    },
    rect(...args) {
      calls.push([label, "rect", ...args]);
    },
    clip() {
      calls.push([label, "clip"]);
    },
    fillRect(...args) {
      calls.push([label, "fillRect", ...args]);
    },
    drawImage(...args) {
      calls.push([label, "drawImage", ...args]);
    },
  };
}

/**
 * 创建测试用 canvas
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {CanvasRenderingContext2D} context - 上下文
 * @returns {HTMLCanvasElement}
 */
function createCanvas(width, height, context) {
  return {
    width,
    height,
    getContext() {
      return context;
    },
  };
}

/**
 * 创建区块静态图
 * @param {number[]} objectIds - 对象 id 集合
 * @returns {DirectedGraph}
 */
function createStaticGraph(objectIds) {
  const graph = new DirectedGraph();
  for (const objectId of objectIds) {
    graph.addNodeUnsafe(objectId);
  }
  return graph;
}

/**
 * 创建测试视口
 * @param {{
 *   staticObjects?: BasicObject[],
 *   activeObjects?: BasicObject[],
 *   layers?: Layer[],
 *   outputCanvas?: HTMLCanvasElement,
 * }} [options={}]
 * @returns {{ viewport: Object, aom: Object, chunk: Object }}
 */
function createViewportContext(options = {}) {
  const staticObjects = options.staticObjects ?? [];
  const activeObjects = options.activeObjects ?? [];
  const allObjects = [...staticObjects, ...activeObjects];
  const objectMap = new Map(allObjects.map((obj) => [obj.id, obj]));
  const activeIds = new Set(activeObjects.map((obj) => obj.id));

  const defaultLayer = new Layer(1);
  for (const objectInstance of activeObjects) {
    defaultLayer.activeObjects.add(objectInstance.id);
  }

  const aom = {
    has(objectId) {
      return activeIds.has(objectId);
    },
    activeObjects: new Set(activeObjects),
    activeObjectIndex: new Map(activeObjects.map((obj) => [obj.id, obj])),
    layerOrder: options.layers ?? [defaultLayer],
    findBoardObjectInstance(objectId) {
      return objectMap.get(objectId);
    },
    getObjectWorldRange(objectInstance) {
      return objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);
    },
  };

  const staticGraph = createStaticGraph(allObjects.map((obj) => obj.id));
  const chunk = {
    id: 1,
    x: 0,
    y: 0,
    objectManager: {
      staticGraph,
    },
  };

  const viewport = {
    board: {
      getObjectById(objectId) {
        return objectMap.get(objectId);
      },
      getChunkById(chunkId) {
        return chunkId === 1 ? chunk : undefined;
      },
      activeObjectManager: aom,
    },
    chunkLoader: {
      getLoadedChunks() {
        return [chunk];
      },
    },
    origin: new Vector(0, 0),
    zoom: 1,
    chunkWidth: 800,
    chunkHeight: 600,
    getViewportScreenRect() {
      return new RectangleRange(0, 0, 800, 600);
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

  return {
    viewport,
    aom,
    chunk,
  };
}

describe("ViewportRenderer", () => {
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

  test("构造后应初始化 scheduler、输出 canvas 和静态缓存", () => {
    const outputCalls = [];
    const outputCtx = createContext("output", outputCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({ outputCanvas });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });

    expect(renderer._scheduler).toBeDefined();
    expect(renderer.canvas).toBe(outputCanvas);
    expect(renderer.outputCanvas).toBe(outputCanvas);
    expect(renderer.getStaticCache()).toBeDefined();
    expect(renderer.getStaticCache().width).toBe(800);
    expect(renderer.getStaticCache().height).toBe(600);
  });

  test("collectStaticDrawables 应正确合并多 chunk 静态图并保持拓扑顺序", () => {
    const renderCalls = [];
    const object1 = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const object2 = new FakeRectObject(2, new Vector(10, 0), renderCalls);
    const object3 = new FakeRectObject(3, new Vector(20, 0), renderCalls);
    const objectMap = new Map([
      [1, object1],
      [2, object2],
      [3, object3],
    ]);

    const graph1 = new DirectedGraph();
    graph1.addNodeUnsafe(1);
    graph1.addNodeUnsafe(2);
    graph1.addEdgeUnsafe(1, 2);

    const graph2 = new DirectedGraph();
    graph2.addNodeUnsafe(2);
    graph2.addNodeUnsafe(3);
    graph2.addEdgeUnsafe(2, 3);

    const chunk1 = { id: 1, x: 0, y: 0, objectManager: { staticGraph: graph1 } };
    const chunk2 = { id: 2, x: 1, y: 0, objectManager: { staticGraph: graph2 } };

    const aom = {
      has() {
        return false;
      },
      findBoardObjectInstance(objectId) {
        return objectMap.get(objectId);
      },
      activeObjects: new Set(),
      activeObjectIndex: new Map(),
      layerOrder: [],
    };

    const viewport = {
      board: {
        getObjectById(objectId) {
          return objectMap.get(objectId);
        },
        getChunkById(chunkId) {
          return chunkId === 1 ? chunk1 : chunkId === 2 ? chunk2 : undefined;
        },
        activeObjectManager: aom,
      },
      chunkLoader: {
        getLoadedChunks() {
          return [chunk1, chunk2];
        },
      },
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 800,
      chunkHeight: 600,
      getViewportScreenRect() {
        return new RectangleRange(0, 0, 800, 600);
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

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: createCanvas(800, 600, createContext("output", [])),
    });

    expect(renderer.collectStaticDrawables().map((obj) => obj.id)).toEqual([
      1, 2, 3,
    ]);
  });

  test("collectActiveDrawables 应按 layerOrder / inactive 语义收集 AOM 对象", () => {
    const calls = [];
    const object1 = new FakeRectObject(1, new Vector(0, 0), calls);
    const object2 = new FakeRectObject(2, new Vector(10, 0), calls);
    const object3 = new FakeRectObject(3, new Vector(20, 0), calls);

    const inactiveGraph = new DirectedGraph();
    inactiveGraph.addNodeUnsafe(2);

    const layer1 = new Layer(1);
    layer1.activeObjects.add(1);
    layer1.inactiveGraph = inactiveGraph;

    const layer2 = new Layer(2);
    layer2.active = false;
    layer2.activeObjects.add(3);

    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      activeObjects: [object1, object2, object3],
      layers: [layer1, layer2],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });

    const drawables = renderer.collectActiveDrawables();
    expect(drawables.map((obj) => obj.id)).toEqual([1, 2, 3]);
  });

  test("flush 应先更新缓存，再拷贝到输出并仅叠画 AOM 对象", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const staticObject = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const activeObject = new FakeRectObject(2, new Vector(20, 0), renderCalls);

    const outputCtx = createContext("output", ctxCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({
      staticObjects: [staticObject],
      activeObjects: [activeObject],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });

    const cacheCtx = createContext("cache", ctxCalls);
    renderer.getStaticCache().getContext = jest.fn(() => cacheCtx);

    renderer.flush();

    expect(renderCalls).toEqual([
      [1, "cache"],
      [2, "output"],
    ]);
    expect(ctxCalls.some((call) => call[0] === "output" && call[1] === "drawImage")).toBe(true);
  });

  test("invalidateCachedObjects 应返回当前/旧范围对应的屏幕脏区", () => {
    const renderCalls = [];
    const objectInstance = new FakeRectObject(1, new Vector(20, 30), renderCalls);
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      staticObjects: [objectInstance],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    const previousWorldRects = new Map([
      [1, new RectangleRange(0, 0, 10, 10)],
    ]);

    const dirtyRects = renderer.invalidateCachedObjects([objectInstance], {
      previousWorldRects,
    });

    expect(dirtyRects).toHaveLength(2);
    expect(dirtyRects[0]).toEqual(new RectangleRange(20, 30, 10, 10));
    expect(dirtyRects[1]).toEqual(new RectangleRange(0, 0, 10, 10));
  });

  test("invalidateCachedObjects 应触发全量缓存重绘", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const objectInstance = new FakeRectObject(
      1,
      new Vector(20.5, 30.5),
      renderCalls,
    );
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      staticObjects: [objectInstance],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    const cacheCtx = createContext("cache", ctxCalls);
    renderer.getStaticCache().getContext = jest.fn(() => cacheCtx);

    renderer.flush();
    ctxCalls.length = 0;

    renderer.invalidateCachedObjects([objectInstance]);
    renderer.flush();

    // 脏区优化已临时移除，改为全量缓存清空 + 全量对象重绘
    expect(ctxCalls).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
  });

  test("invalidateActiveObjects 应同时提交当前/快照/上一帧范围", () => {
    const renderCalls = [];
    const objectInstance = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      activeObjects: [objectInstance],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    renderer.flush();
    renderer.captureObjectSnapshot([objectInstance]);
    objectInstance.position = new Vector(20, 0);

    renderer.invalidateActiveObjects([objectInstance]);

    // invalidateActiveObjects 直接调用 #outputScheduler.invalidate，
    // 验证输出调度器收集了 3 个脏区（当前范围 + 快照 + 上一帧）
    expect(renderer._scheduler.dirtyRects).toHaveLength(3);
  });

  test("AOM 对象位移后应全量重绘输出帧", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const lowerObject = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const upperObject = new FakeRectObject(2, new Vector(5, 0), renderCalls);
    const outputCtx = createContext("output", ctxCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({
      activeObjects: [lowerObject, upperObject],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    renderer.flush();
    renderCalls.length = 0;
    ctxCalls.length = 0;

    renderer.captureObjectSnapshot([upperObject]);
    upperObject.position = new Vector(20, 0);
    renderer.invalidateActiveObjects([upperObject]);
    renderer._scheduler.flush();

    // 脏区优化已临时移除，全量清空 + 全量 drawImage + 全量绘制 AOM 对象
    expect(renderCalls).toEqual([
      [1, "output"],
      [2, "output"],
    ]);
    expect(ctxCalls).toContainEqual(["output", "clearRect", 0, 0, 800, 600]);
    expect(ctxCalls).toContainEqual(["output", "drawImage", expect.any(Object), 0, 0]);
  });

  test("active 圆 + 提交上层笔画时，圆应在全量重绘中单次渲染", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const circleObj = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    circleObj.rich.boundingBox = new RectangleRange(0, 0, 100, 100);
    const strokeObj = new FakeRectObject(2, new Vector(10, 10), renderCalls);
    strokeObj.rich.boundingBox = new RectangleRange(0, 0, 80, 80);
    const outputCtx = createContext("output", ctxCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({
      staticObjects: [strokeObj],
      activeObjects: [circleObj],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    renderer.flush();
    renderCalls.length = 0;
    ctxCalls.length = 0;

    // 模拟笔画提交：触发缓存和输出层刷新
    renderer.invalidateCachedObjects([strokeObj]);
    renderer._scheduler.flush();

    // 脏区优化已临时移除，全量重绘
    // 圆只渲染一次（输出层）
    expect(
      renderCalls.filter((call) => call[0] === 1 && call[1] === "output"),
    ).toHaveLength(1);
    // 圆未进入静态缓存（仍被 AOM 过滤，不会重复渲染）
    expect(
      renderCalls.filter((call) => call[0] === 1 && call[1] === "cache"),
    ).toHaveLength(0);
    // 全量清空输出 canvas
    expect(ctxCalls).toContainEqual(["output", "clearRect", 0, 0, 800, 600]);
  });

  test("getObjectScreenRect 应为 PathRange 额外补足栅格化 padding", () => {
    const objectInstance = new FakePathObject(1, new Vector(0, 0));
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({ outputCanvas });
    viewport.zoom = 2;
    viewport.worldRectToScreenRect = function worldRectToScreenRect(rect) {
      return new RectangleRange(
        rect.left * this.zoom,
        rect.top * this.zoom,
        rect.width * this.zoom,
        rect.height * this.zoom,
      );
    };
    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });

    const screenRect = renderer.getObjectScreenRect(objectInstance);

    expect(screenRect).toEqual(new RectangleRange(-5, -5, 30, 10));
  });

  test("invalidateChunks 应提交新旧区块对应的屏幕脏区", () => {
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({ outputCanvas });
    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    const invalidateSpy = jest.spyOn(renderer, "invalidate");
    const previousChunk = { id: 1, x: 0, y: 0 };
    const nextChunk = { id: 2, x: 1, y: 0 };

    renderer.invalidateChunks([nextChunk], [previousChunk]);

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  test("resize 应同时调整输出 canvas 与静态缓存尺寸", () => {
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({ outputCanvas });
    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });

    const resized = renderer.resize(1024, 768);

    expect(resized).toBe(true);
    expect(renderer.canvas.width).toBe(1024);
    expect(renderer.canvas.height).toBe(768);
    expect(renderer.getStaticCache().width).toBe(1024);
    expect(renderer.getStaticCache().height).toBe(768);
  });

  test("flush 在 receiver-sensitive context 下不应抛出 Illegal invocation", () => {
    const renderCalls = [];
    const staticObject = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const activeObject = new FakeRectObject(2, new Vector(20, 0), renderCalls);

    function createReceiverSensitiveContext(label) {
      const ctx = {
        __label: label,
        save() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        restore() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        setTransform() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        clearRect() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        beginPath() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        rect() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        clip() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        fillRect() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
        drawImage() {
          if (this !== ctx) throw new TypeError("Illegal invocation");
        },
      };
      return ctx;
    }

    const outputCanvas = createCanvas(
      800,
      600,
      createReceiverSensitiveContext("output"),
    );
    const { viewport, aom } = createViewportContext({
      staticObjects: [staticObject],
      activeObjects: [activeObject],
      outputCanvas,
    });
    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer.getStaticCache().getContext = jest.fn(() =>
      createReceiverSensitiveContext("cache"),
    );

    expect(() => renderer.flush()).not.toThrow();
  });

  test("renderStaticCacheToCanvas 应将缓存内容绘制到目标 canvas", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const staticObject = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const targetCtx = createContext("target", ctxCalls);
    const targetCanvas = createCanvas(800, 600, targetCtx);
    const { viewport, aom } = createViewportContext({
      staticObjects: [staticObject],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    const cacheCtx = createContext("cache", ctxCalls);
    renderer.getStaticCache().getContext = jest.fn(() => cacheCtx);

    renderer.renderStaticCacheToCanvas(targetCanvas, [new RectangleRange(0, 0, 20, 20)]);

    expect(ctxCalls.some((call) => call[0] === "target" && call[1] === "drawImage")).toBe(true);
  });
});
