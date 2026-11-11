/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";
import { ViewportRenderer } from "../viewport-renderer.js";
import { DirectedGraph } from "../../../kernel/utils/directed-graph.js";
import { Vector, Matrix } from "../../../kernel/utils/math.js";
import { BasicObject } from "../../../kernel/objects/basic-obj.js";
import { CircleObject } from "../../../kernel/objects/graph/circle.js";
import { RectangleRange } from "../../../kernel/range/rectangle.js";
import { PathRange } from "../../../kernel/range/path.js";
import { Layer } from "../../../kernel/board/active-object-manager.js";
import { installNoopOffscreenCanvas } from "../../../test-support/noop-canvas.js";
import { OBJECT_DRAW_STRATEGIES } from "../object-draw-strategies.js";

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
}

// 为测试假对象注册绘制策略（验证插件机制：新对象类型经注册接入渲染管线）
OBJECT_DRAW_STRATEGIES.set(FakeRectObject, (ctx, object) => {
  object.renderCalls.push([object.id, ctx.__label ?? "unknown"]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, object.position.x, object.position.y);
  ctx.fillRect?.(0, 0, 10, 10);
  ctx.restore();
});
OBJECT_DRAW_STRATEGIES.set(FakePathObject, () => {});

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
    ...(options.withWorldRect
      ? {
          getViewportWorldRect() {
            return new RectangleRange(
              viewport.origin.x,
              viewport.origin.y,
              800,
              600,
            );
          },
        }
      : {}),
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

  test("collectStaticDrawables 解析对象时不扫描已载区块", () => {
    // 每次读取区块 id 都记一笔：按区块重建候选集合的写法会让计数随区块数膨胀
    let idReads = 0;
    const chunks = [];
    for (let index = 0; index < 200; index++) {
      const graph = new DirectedGraph();
      graph.addNodeUnsafe(index + 1);
      chunks.push({
        get id() {
          idReads++;
          return index + 1;
        },
        objectManager: { staticGraph: graph },
      });
    }

    const objectMap = new Map();
    for (let index = 0; index < 200; index++) {
      objectMap.set(
        index + 1,
        new FakeRectObject(index + 1, new Vector(0, 0), []),
      );
    }

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

    const renderer = new ViewportRenderer(
      {
        board: {
          getObjectById(objectId) {
            return objectMap.get(objectId);
          },
          activeObjectManager: aom,
        },
        chunkLoader: {
          getLoadedChunks() {
            return chunks;
          },
        },
        origin: new Vector(0, 0),
        zoom: 1,
        chunkWidth: 800,
        chunkHeight: 600,
      },
      aom,
      { canvas: createCanvas(800, 600, createContext("output", [])) },
    );

    expect(renderer.collectStaticDrawables()).toHaveLength(200);
    expect(idReads).toBe(0);
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

  test("几何暂时不可解析的 AOM 对象在非空脏区下仍应绘制", () => {
    const renderCalls = [];
    const active = new FakeRectObject(1, new Vector(20, 20), renderCalls);
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      activeObjects: [active],
      outputCanvas,
    });
    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;
    renderer.flush();
    renderCalls.length = 0;

    // 模拟 teardown 中间态：世界范围暂时解析不出来，但上一帧已经画过它
    active.rich.boundingBox = undefined;
    active.getRange = () => undefined;

    // 上一帧的 drawnRects 会进入脏区并被清除，本帧若被剔除就会白帧
    renderer.invalidateActiveObjects([active]);
    renderer.flush([new RectangleRange(0, 0, 100, 100)]);

    expect(renderCalls).toContainEqual([1, "output"]);
  });

  test("预览坐标：静态对象按预览位置渲染且不改数据，end 清除后归位", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const staticObject = new FakeRectObject("1", new Vector(0, 0), renderCalls);
    const outputCtx = createContext("output", ctxCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({
      staticObjects: [staticObject],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    const cacheCtx = createContext("cache", ctxCalls);
    renderer.getStaticCache().getContext = jest.fn(() => cacheCtx);

    // 远程手势预览：对象本体按预览位置画（渲染视图），数据不变
    renderer.setPreviewPosition("1", { x: 30, y: 40 });
    renderer.invalidateCachedObjects();
    renderer.flush();
    expect(staticObject.position.serialize()).toEqual({ x: 0, y: 0 });
    const previewTransform = ctxCalls
      .filter((call) => call[0] === "cache" && call[1] === "setTransform")
      .at(-1);
    expect(previewTransform).toEqual(["cache", "setTransform", 1, 0, 0, 1, 30, 40]);

    // 清除预览（手势终点）：渲染回到数据位置
    renderer.clearPreviewPosition("1");
    renderer.invalidateCachedObjects();
    renderer.flush();
    const restoredTransform = ctxCalls
      .filter((call) => call[0] === "cache" && call[1] === "setTransform")
      .at(-1);
    expect(restoredTransform).toEqual(["cache", "setTransform", 1, 0, 0, 1, 0, 0]);
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
    // 范围各向外扩 2 像素抗锯齿余量
    expect(dirtyRects[0]).toEqual(new RectangleRange(18, 28, 14, 14));
    expect(dirtyRects[1]).toEqual(new RectangleRange(-2, -2, 14, 14));
  });

  test("对象进出静态层时缓存走全量重建", () => {
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

    // 对象进出 AOM 属静态层成员变化：局部重建漏失效会让缓存留下过期像素，
    // 因此该路径必须全量重建（这是引入局部重建之前的等价行为）
    renderer.invalidateCachedObjects([objectInstance]);
    renderer.flush();

    expect(ctxCalls).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
  });

  /**
   * 建立带两个静态对象的可测渲染环境
   * @param {Vector[]} positions - 各对象位置
   * @returns {{renderer: ViewportRenderer, objects: FakeRectObject[], cacheCtx: Object, ctxCalls: Array<any>, renderCalls: Array<any>}}
   */
  function createCacheScenario(positions) {
    const renderCalls = [];
    const ctxCalls = [];
    const objects = positions.map(
      (position, index) =>
        new FakeRectObject(index + 1, position, renderCalls),
    );
    const outputCanvas = createCanvas(800, 600, createContext("output", []));
    const { viewport, aom } = createViewportContext({
      staticObjects: objects,
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
    renderCalls.length = 0;
    return { renderer, objects, cacheCtx, ctxCalls, renderCalls };
  }

  test("成员变化触发全量重建时按层叠顺序重绘全部静态对象", () => {
    const { renderer, objects, ctxCalls, renderCalls } = createCacheScenario([
      new Vector(20, 20),
      new Vector(500, 400),
    ]);

    renderer.invalidateCachedObjects([objects[0]]);
    renderer.flush();

    // 全量重建下两个静态对象都按层叠顺序重绘
    const cacheDraws = renderCalls.filter(([, label]) => label === "cache");
    expect(cacheDraws).toEqual([
      [1, "cache"],
      [2, "cache"],
    ]);
    expect(ctxCalls).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
  });

  test("脏区覆盖多个对象时按层叠顺序全部重绘", () => {
    const { renderer, objects, ctxCalls, renderCalls } = createCacheScenario([
      new Vector(20, 20),
      new Vector(24, 24),
    ]);

    // 两个对象都在同一脏区内，层叠顺序要求两者都重画，而不是只画变化的那个
    renderer.invalidateCachedObjects([objects[0], objects[1]]);
    renderer.flush();

    const cacheDraws = renderCalls.filter(([, label]) => label === "cache");
    expect(cacheDraws).toEqual([
      [1, "cache"],
      [2, "cache"],
    ]);
  });

  test("对象移走后旧位置区域被清理", () => {
    const { renderer, objects, ctxCalls } = createCacheScenario([
      new Vector(20, 20),
    ]);

    renderer.invalidateCachedObjects([objects[0]], {
      previousWorldRects: new Map([[1, new RectangleRange(300, 300, 10, 10)]]),
    });
    renderer.flush();

    // 成员变化改走全量重建：旧位置与新位置一并被清掉，不会原地留残影
    const cleared = ctxCalls.filter(
      (call) => call[0] === "cache" && call[1] === "clearRect",
    );
    expect(cleared).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
  });

  test("脏区面积达到视口阈值时退化为全量重建", () => {
    const { renderer, objects, ctxCalls, renderCalls } = createCacheScenario([
      new Vector(20, 20),
      new Vector(500, 400),
    ]);

    // 覆盖整视口的对象失效，脏区面积远超 40% 阈值
    objects[0].rich.boundingBox = new RectangleRange(0, 0, 800, 600);
    renderer.invalidateCachedObjects([objects[0]]);
    renderer.flush();

    expect(ctxCalls).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
    const cacheDraws = renderCalls.filter(([, label]) => label === "cache");
    expect(cacheDraws).toHaveLength(2);
  });

  test("无脏区的缓存失效退化为全量重建", () => {
    const { renderer, ctxCalls, renderCalls } = createCacheScenario([
      new Vector(20, 20),
    ]);

    // 不提交任何脏区，直接标脏缓存，模拟尺寸变化等无对应脏区的失效
    renderer.invalidateCachedObjects();
    renderer.flush();

    expect(ctxCalls).toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
    expect(renderCalls.filter(([, label]) => label === "cache")).toHaveLength(1);
  });

  test("预览坐标不影响剔除用的屏幕矩形", () => {
    const { renderer, objects, ctxCalls, renderCalls } = createCacheScenario([
      new Vector(20, 20),
      new Vector(500, 400),
    ]);

    // 预览把对象挪到远处，但数据坐标仍在原处；脏区按数据坐标计算
    renderer.setPreviewPosition(1, new Vector(600, 500));
    renderer.invalidateCachedObjects([objects[0]]);
    renderer.flush();

    // 预览只影响绘制位置，剔除与失效仍按数据坐标计算
    expect(objects[0].position.x).toBe(20);
    expect(objects[0].position.y).toBe(20);
    expect(renderCalls.filter(([, label]) => label === "cache").length).toBeGreaterThan(0);
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

  test("AOM 对象位移后应脏区清空 + 裁剪 AOM 绘制", () => {
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

    // 脏区清空/拷贝 + 裁剪 AOM 对象绘制（两对象均与脏区相交，均渲染）
    expect(renderCalls).toEqual([
      [1, "output"],
      [2, "output"],
    ]);
    // 脏区清空：不应是全视口清空
    expect(ctxCalls).not.toContainEqual(["output", "clearRect", 0, 0, 800, 600]);
    // 脏区拷贝或全量拷贝均应进行
    expect(ctxCalls.some((call) => call[0] === "output" && call[1] === "drawImage")).toBe(true);
    // AOM 对象按脏区裁剪渲染
    expect(ctxCalls.some((call) => call[0] === "output" && call[1] === "clip")).toBe(true);
  });

  test("远离脏区的 AOM 对象应被跳过不渲染", () => {
    const renderCalls = [];
    const ctxCalls = [];
    const leftObject = new FakeRectObject(1, new Vector(0, 0), renderCalls);
    const farObject = new FakeRectObject(2, new Vector(500, 0), renderCalls);
    const outputCtx = createContext("output", ctxCalls);
    const outputCanvas = createCanvas(800, 600, outputCtx);
    const { viewport, aom } = createViewportContext({
      activeObjects: [leftObject, farObject],
      outputCanvas,
    });

    const renderer = new ViewportRenderer(viewport, aom, {
      canvas: outputCanvas,
    });
    renderer._scheduler.scheduleFrame = () => 0;

    renderer.flush();
    renderCalls.length = 0;
    ctxCalls.length = 0;

    renderer.captureObjectSnapshot([leftObject]);
    leftObject.position = new Vector(1, 0);
    renderer.invalidateActiveObjects([leftObject]);
    renderer._scheduler.flush();

    // 仅 leftObject 与脏区相交并渲染，farObject 被跳过
    expect(renderCalls).toEqual([[1, "output"]]);
  });

  test("active 圆 + 提交上层笔画时，圆应在脏区清空 + 裁剪 AOM 中单次渲染", () => {
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

    // 脏区清空/拷贝 + 裁剪 AOM 绘制
    // 圆只渲染一次（输出层）
    expect(
      renderCalls.filter((call) => call[0] === 1 && call[1] === "output"),
    ).toHaveLength(1);
    // 圆未进入静态缓存（仍被 AOM 过滤，不会重复渲染）
    expect(
      renderCalls.filter((call) => call[0] === 1 && call[1] === "cache"),
    ).toHaveLength(0);
    // 脏区清空：不应是全视口清空
    expect(ctxCalls).not.toContainEqual(["output", "clearRect", 0, 0, 800, 600]);
    // 脏区拷贝或全量拷贝均应进行
    expect(ctxCalls.some((call) => call[0] === "output" && call[1] === "drawImage")).toBe(true);
    // AOM 对象按脏区裁剪渲染
    expect(ctxCalls.some((call) => call[0] === "output" && call[1] === "clip")).toBe(true);
  });

  test("getObjectScreenRect 应为对象补足栅格化 padding", () => {
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

    // 所有对象类型都补同一份抗锯齿留白
    expect(screenRect).toEqual(new RectangleRange(-6, -6, 32, 12));
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

  describe("清除覆盖不变量（drawnRects）", () => {
    /**
     * 提取输出层的 clearRect 记录
     * @param {Array<any>} ctxCalls - 上下文调用记录
     * @returns {Array<{ left: number, top: number, right: number, bottom: number }>}
     */
    function getClearRects(ctxCalls) {
      return ctxCalls
        .filter((call) => call[0] === "output" && call[1] === "clearRect")
        .map((call) => ({
          left: call[2],
          top: call[3],
          right: call[2] + call[4],
          bottom: call[3] + call[5],
        }));
    }

    /**
     * 断言指定区域被某一清除矩形完整覆盖
     * @param {Array<any>} ctxCalls - 上下文调用记录
     * @param {{ left: number, top: number, width: number, height: number }} region - 待覆盖区域
     */
    function expectRegionCleared(ctxCalls, region) {
      const { left, top, width, height } = region;
      const covered = getClearRects(ctxCalls).some(
        (rect) =>
          rect.left <= left &&
          rect.top <= top &&
          rect.right >= left + width &&
          rect.bottom >= top + height,
      );
      expect(covered).toBe(true);
    }

    test("上一帧实际绘制的 clip 区域应被下一帧清除集完整覆盖", () => {
      const renderCalls = [];
      const ctxCalls = [];
      const objectInstance = new FakeRectObject(1, new Vector(0, 0), renderCalls);
      const outputCtx = createContext("output", ctxCalls);
      const outputCanvas = createCanvas(800, 600, outputCtx);
      const { viewport, aom } = createViewportContext({
        activeObjects: [objectInstance],
        outputCanvas,
      });

      const renderer = new ViewportRenderer(viewport, aom, {
        canvas: outputCanvas,
      });
      renderer._scheduler.scheduleFrame = () => 0;

      renderer.flush();
      ctxCalls.length = 0;

      // 帧 1：对象移动，同时注入一个远大于对象范围的脏区，
      // 使对象的绘制 clip 超出自身 screenRect（模拟留白不足时的溢出绘制）
      objectInstance.position = new Vector(20, 0);
      renderer.invalidateActiveObjects([objectInstance]);
      renderer._scheduler.invalidate(new RectangleRange(-50, 0, 100, 10));
      renderer._scheduler.flush();

      const clipRects = ctxCalls
        .filter((call) => call[0] === "output" && call[1] === "rect")
        .map((call) => ({
          left: call[2],
          top: call[3],
          width: call[4],
          height: call[5],
        }));
      expect(clipRects.length).toBeGreaterThan(0);
      ctxCalls.length = 0;

      // 帧 2：对象再次移动并失效，下一帧清除集必须覆盖帧 1 的全部 clip 区域
      objectInstance.position = new Vector(100, 0);
      renderer.invalidateActiveObjects([objectInstance]);
      renderer._scheduler.flush();

      for (const clipRect of clipRects) {
        expectRegionCleared(ctxCalls, clipRect);
      }
    });

    test("被跳过的对象应继承上一次实际绘制区域", () => {
      const renderCalls = [];
      const ctxCalls = [];
      const objectA = new FakeRectObject(1, new Vector(0, 0), renderCalls);
      const objectB = new FakeRectObject(2, new Vector(200, 0), renderCalls);
      const outputCtx = createContext("output", ctxCalls);
      const outputCanvas = createCanvas(800, 600, outputCtx);
      const { viewport, aom } = createViewportContext({
        activeObjects: [objectA, objectB],
        outputCanvas,
      });

      const renderer = new ViewportRenderer(viewport, aom, {
        canvas: outputCanvas,
      });
      renderer._scheduler.scheduleFrame = () => 0;

      renderer.flush();
      ctxCalls.length = 0;

      // 帧 1：A 移动并在大脏区中绘制（clip 超出自身范围），B 不相交被跳过
      objectA.position = new Vector(20, 0);
      renderer.invalidateActiveObjects([objectA]);
      renderer._scheduler.invalidate(new RectangleRange(15, 0, 30, 10));
      renderer._scheduler.flush();

      // 帧 2：仅 B 失效（远离 A），A 被跳过，应继承帧 1 的实际绘制区域
      objectB.position = new Vector(400, 0);
      renderer.invalidateActiveObjects([objectB]);
      renderer._scheduler.flush();
      ctxCalls.length = 0;

      // 帧 3：A 移动并失效，清除集必须覆盖帧 1 继承下来的实际绘制区域
      objectA.position = new Vector(300, 0);
      renderer.invalidateActiveObjects([objectA]);
      renderer._scheduler.flush();

      expectRegionCleared(ctxCalls, { left: 15, top: 0, width: 30, height: 10 });
    });

    test("invalidateCachedObjects 应并入对象离开 AOM 前的实际绘制区域", () => {
      const renderCalls = [];
      const ctxCalls = [];
      const objectInstance = new FakeRectObject(1, new Vector(0, 0), renderCalls);
      const outputCtx = createContext("output", ctxCalls);
      const outputCanvas = createCanvas(800, 600, outputCtx);
      const { viewport, aom } = createViewportContext({
        activeObjects: [objectInstance],
        outputCanvas,
      });

      const renderer = new ViewportRenderer(viewport, aom, {
        canvas: outputCanvas,
      });
      renderer._scheduler.scheduleFrame = () => 0;

      renderer.flush();

      // 对象在大脏区中绘制，drawnRects 超出自身 screenRect
      objectInstance.position = new Vector(20, 0);
      renderer.invalidateActiveObjects([objectInstance]);
      renderer._scheduler.invalidate(new RectangleRange(15, 0, 30, 10));
      renderer._scheduler.flush();

      const dirtyRects = renderer.invalidateCachedObjects([objectInstance]);
      const covered = dirtyRects.some(
        (rect) =>
          rect.left <= 15 &&
          rect.top <= 0 &&
          rect.left + rect.width >= 45 &&
          rect.top + rect.height >= 10,
      );
      expect(covered).toBe(true);
    });
  });

  describe("世界空间 tile 缓存", () => {
    /**
     * 建立启用 tile 的渲染环境
     * @param {Vector[]} positions - 各对象位置
     * @returns {{renderer: ViewportRenderer, viewport: Object, objects: FakeRectObject[], chunk: Object, ctxCalls: Array<any>}}
     */
    function createTileScenario(positions) {
      const renderCalls = [];
      const ctxCalls = [];
      const objects = positions.map(
        (position, index) =>
          new FakeRectObject(index + 1, position, renderCalls),
      );
      const outputCalls = [];
      const outputCanvas = createCanvas(
        800,
        600,
        createContext("output", outputCalls),
      );
      const { viewport, aom, chunk } = createViewportContext({
        staticObjects: objects,
        outputCanvas,
        withWorldRect: true,
      });
      // 固定 tile 边长，让网格算术与视口尺寸解耦（自适应策略由独立用例覆盖）
      const renderer = new ViewportRenderer(viewport, aom, {
        canvas: outputCanvas,
        tileSize: 512,
      });
      renderer._scheduler.scheduleFrame = () => 0;
      const cacheCtx = createContext("cache", ctxCalls);
      renderer.getStaticCache().getContext = jest.fn(() => cacheCtx);
      renderer.flush();
      const initialOutputCalls = [...outputCalls];
      outputCalls.length = 0;
      ctxCalls.length = 0;
      return {
        renderer,
        viewport,
        objects,
        chunk,
        ctxCalls,
        outputCalls,
        initialOutputCalls,
      };
    }

    test("tile 边长与视口尺寸解耦，缓存字节随视口面积而非块边长增长", () => {
      /**
       * 建一个指定视口尺寸的渲染器
       * @param {number} width - 视口宽
       * @param {number} height - 视口高
       * @param {number} [devicePixelRatio] - 设备倍率
       * @returns {{ tileSize: number, tileCount: number, bytes: number }}
       */
      const inspect = (width, height, devicePixelRatio = 1) => {
        const outputCanvas = createCanvas(
          width,
          height,
          createContext("probe", []),
        );
        const { viewport, aom } = createViewportContext({
          staticObjects: [],
          outputCanvas,
          withWorldRect: true,
          viewportSize: { width, height },
        });
        const renderer = new ViewportRenderer(viewport, aom, {
          canvas: outputCanvas,
          devicePixelRatio,
        });
        renderer._scheduler.scheduleFrame = () => 0;
        renderer.flush();
        return renderer.getTileDebugInfo();
      };

      // 边长固定：大视口不再推到 2048，避免单块位图与覆盖面积一起膨胀
      expect(inspect(900, 700).tileSize).toBe(256);
      expect(inspect(1920, 1080).tileSize).toBe(256);

      // 规格里 900x700 在倍率 2 下曾占 96MB，现在必须压到一个视口面积量级
      const highDpi = inspect(900, 700, 2);
      expect(highDpi.bytes).toBeLessThanOrEqual(28 * 1024 * 1024);

      // 每块位图 = (边长 × 倍率)²，字节数必须与块数一致
      expect(highDpi.bytes).toBe(
        highDpi.tileCount * (256 * 2) * (256 * 2) * 4,
      );
    });

    test("首次 flush 重建覆盖范围内的 tile 并合成可见 tile", () => {
      const { renderer, initialOutputCalls } = createTileScenario([
        new Vector(20, 20),
        new Vector(700, 500),
      ]);

      const info = renderer.getTileDebugInfo();
      // 缓存范围为视口外扩 25%：世界 (-200,-150) 到 (1000,750)，覆盖 3×3 块
      expect(info.enabled).toBe(true);
      expect(info.tileCount).toBe(9);
      expect(info.rebuildCount).toBe(9);
      expect(info.dirtyCount).toBe(0);

      // 视口 800×600 内只有 2×2 块需要合成，且直接画进输出而非缓存画布
      const composites = initialOutputCalls.filter(
        (call) => call[0] === "output" && call[1] === "drawImage",
      );
      expect(composites).toHaveLength(4);
    });

    test("平移且区块集合不变时不重绘任何 tile，只重新合成", () => {
      const { renderer, viewport, chunk, outputCalls } = createTileScenario([
        new Vector(20, 20),
      ]);
      const before = renderer.getTileDebugInfo().rebuildCount;

      viewport.origin = new Vector(10, 10);
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { origin: { x: 0, y: 0 }, zoom: 1 },
      });
      renderer.flush();

      expect(renderer.getTileDebugInfo().rebuildCount).toBe(before);
      expect(renderer.getTileDebugInfo().dirtyCount).toBe(0);
      expect(
        outputCalls.some(
          (call) => call[0] === "output" && call[1] === "drawImage",
        ),
      ).toBe(true);
    });

    test("对象进出 AOM 时只重建其范围覆盖的 tile", () => {
      const { renderer, objects } = createTileScenario([
        new Vector(20, 20),
        new Vector(700, 500),
      ]);
      const before = renderer.getTileDebugInfo().rebuildCount;

      renderer.invalidateCachedObjects([objects[0]]);
      renderer.flush();

      // 局部失效依赖「着墨范围 ⊆ 包围盒 ⊕ 留白」这条不变式（draw-bounds 测试守住）
      expect(renderer.getTileDebugInfo().rebuildCount).toBe(before + 1);
    });

    test("对象移动时旧范围覆盖的 tile 也要标脏", () => {
      const { renderer, objects } = createTileScenario([new Vector(20, 20)]);
      const before = renderer.getTileDebugInfo().rebuildCount;

      // 旧范围在另一块 tile 上：只标当前范围会把它留成残留像素
      renderer.invalidateCachedObjects([objects[0]], {
        previousWorldRects: new Map([
          [objects[0].id, new RectangleRange(600, 400, 10, 10)],
        ]),
      });
      renderer.flush();

      expect(renderer.getTileDebugInfo().rebuildCount).toBe(before + 2);
    });

    test("新加载的区块只重建其覆盖的 tile", () => {
      const { renderer, chunk } = createTileScenario([new Vector(20, 20)]);
      const before = renderer.getTileDebugInfo().rebuildCount;

      const loaded = { id: 2, x: 1, y: 0, objectManager: chunk.objectManager };
      renderer.invalidateChunks([chunk, loaded], [chunk]);
      renderer.flush();

      // 新区块世界范围 (800,0,800,600)，已分配的 tile 中只有 (1,0) 与 (1,1) 相交
      expect(renderer.getTileDebugInfo().rebuildCount).toBe(before + 2);
    });

    test("同一视口下没有内容变化时不重绘任何 tile", () => {
      const { renderer, chunk } = createTileScenario([new Vector(20, 20)]);

      renderer.invalidateChunks([chunk], [chunk]);
      renderer.flush();

      expect(renderer.getTileDebugInfo().rebuildCount).toBe(9);
      expect(renderer.getTileDebugInfo().dirtyCount).toBe(0);
    });

    test("提交后输出只合成与脏区相交的 tile", () => {
      const { renderer, objects, outputCalls } = createTileScenario([
        new Vector(20, 20),
        new Vector(700, 500),
      ]);

      renderer.invalidateCachedObjects([objects[0]]);
      // 显式传入脏区，对应生产中输出调度器合并后的 flush
      renderer.flush([new RectangleRange(20, 20, 10, 10)]);

      const composites = outputCalls.filter(
        (call) => call[0] === "output" && call[1] === "drawImage",
      );
      // 对象在 (20,20)，脏区只与 tile (0,0) 相交，另一块区域不应重画
      expect(composites).toHaveLength(1);
    });

    test("对象进出 AOM 时只清理对象覆盖的一小块", () => {
      const previousCanvas = globalThis.OffscreenCanvas;
      const tileClears = [];
      // 替换 tile 画布实现，直接记录每块 tile 上的清理尺寸
      globalThis.OffscreenCanvas = class {
        constructor(width, height) {
          this.width = width;
          this.height = height;
        }

        getContext() {
          return {
            save() {},
            restore() {},
            setTransform() {},
            beginPath() {},
            rect() {},
            clip() {},
            drawImage() {},
            fillRect() {},
            clearRect: (...args) => tileClears.push(args),
          };
        }
      };

      try {
        const { renderer, objects } = createTileScenario([
          new Vector(20, 20),
          new Vector(700, 500),
        ]);
        tileClears.length = 0;

        renderer.invalidateCachedObjects([objects[0]]);
        renderer.flush();

        expect(tileClears.length).toBeGreaterThan(0);
        // 只清理对象范围加留白的那一小块，其余像素保持不动
        for (const [, , width, height] of tileClears) {
          expect(width).toBeLessThanOrEqual(16);
          expect(height).toBeLessThanOrEqual(16);
        }
      } finally {
        globalThis.OffscreenCanvas = previousCanvas;
      }
    });

    test("缩放变更时用上一帧缩放合成，不重建 tile", () => {
      const { renderer, viewport, chunk, outputCalls } = createTileScenario([
        new Vector(20, 20),
      ]);
      outputCalls.length = 0;
      const rebuildsBefore = renderer.getTileDebugInfo().rebuildCount;

      // 连续手势的典型单步：1.2 倍
      viewport.zoom = 1.2;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
      });
      renderer.flush([new RectangleRange(0, 0, 800, 600)]);

      expect(renderer.getTileDebugInfo().rebuildCount).toBe(rebuildsBefore);
      const draws = outputCalls.filter(
        (call) => call[0] === "output" && call[1] === "drawImage",
      );
      // 快照按 1.2 倍拉伸后合成一次，而不是逐对象重绘
      expect(draws).toHaveLength(1);
      // 记录格式为 [label, method, image, offsetX, offsetY, width, height]
      expect(draws[0][5]).toBeCloseTo(800 * 1.2);
      expect(draws[0][6]).toBeCloseTo(600 * 1.2);
    });

    test("手势结束时立即提交预览并重建", () => {
      const { renderer, viewport, chunk, ctxCalls } = createTileScenario([
        new Vector(20, 20),
      ]);

      // 进入预览
      viewport.zoom = 1.2;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
      });
      renderer.flush([new RectangleRange(0, 0, 800, 600)]);
      ctxCalls.length = 0;

      // 输入侧显式收尾：不等空闲定时器，立刻换成清晰帧
      const rebuildsBefore = renderer.getTileDebugInfo().rebuildCount;
      expect(renderer.commitZoomPreview()).toBe(true);
      renderer.flush([]);

      // 提交后整片 tile 按新倍率重建，而不是继续用拉伸的上一帧
      expect(renderer.getTileDebugInfo().zoom).toBeCloseTo(1.2, 6);
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(
        rebuildsBefore,
      );
      // 重复调用不应触发多余重建
      expect(renderer.commitZoomPreview()).toBe(false);
    });

    test("离散缩放跳变不进入预览", () => {
      const { renderer, viewport, chunk, ctxCalls } = createTileScenario([
        new Vector(20, 20),
      ]);
      ctxCalls.length = 0;

      // 按键一次缩放一倍属于离散跳变，预览只会让用户看到一帧发糊的画面
      const rebuildsBefore = renderer.getTileDebugInfo().rebuildCount;
      viewport.zoom = 2;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
      });
      renderer.flush([]);

      // 直接按新档位重建 tile，不经过预览
      expect(renderer.getTileDebugInfo().level).toBe(-1);
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(
        rebuildsBefore,
      );
    });

    test("缩小不进入预览，直接重建缓存", () => {
      const { renderer, viewport, chunk, ctxCalls } = createTileScenario([
        new Vector(20, 20),
      ]);
      ctxCalls.length = 0;

      // 缩小会露出快照未覆盖的区域，留白比重新光栅化更刺眼
      const rebuildsBefore = renderer.getTileDebugInfo().rebuildCount;
      viewport.zoom = 0.5;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
      });
      renderer.flush([]);

      expect(renderer.getTileDebugInfo().level).toBe(1);
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(
        rebuildsBefore,
      );
    });

    test("累计拉伸超过两倍时退出预览改为重建", () => {
      const { renderer, viewport, chunk, ctxCalls } = createTileScenario([
        new Vector(20, 20),
      ]);

      // 连续小步放大，逐步累积到超过两倍
      ctxCalls.length = 0;
      let previousZoom = 1;
      for (const nextZoom of [1.2, 1.44, 1.728]) {
        viewport.zoom = nextZoom;
        renderer.invalidateChunks([chunk], [chunk], {
          previousViewportState: { zoom: previousZoom, origin: { x: 0, y: 0 } },
        });
        renderer.flush([new RectangleRange(0, 0, 800, 600)]);
        previousZoom = nextZoom;
      }
      // 前置断言：累计 1.728 倍仍在阈值内，预览期间不得重建缓存
      expect(ctxCalls).not.toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);
      ctxCalls.length = 0;

      // 相对快照累积到 2.07 倍，超出阈值，退出预览并重建
      const rebuildsBefore = renderer.getTileDebugInfo().rebuildCount;
      viewport.zoom = 2.0736;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: previousZoom, origin: { x: 0, y: 0 } },
      });
      renderer.flush([]);

      // 超出模糊阈值后按新倍率重建 tile
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(
        rebuildsBefore,
      );
    });

    test("缩放停止后重建一帧清晰内容", () => {
      jest.useFakeTimers();
      try {
        const { renderer, viewport, chunk, ctxCalls } = createTileScenario([
          new Vector(20, 20),
        ]);
        viewport.zoom = 1.2;
        renderer.invalidateChunks([chunk], [chunk], {
          previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
        });
        renderer.flush([new RectangleRange(0, 0, 800, 600)]);

        ctxCalls.length = 0;
        jest.advanceTimersByTime(200);

        // 定时器必须提交预览并让输出重新绘制，否则画面停留在拉伸预览上
        expect(renderer._scheduler.framePending).toBe(true);
        // 预览已被提交，再提交一次应返回 false
        expect(renderer.commitZoomPreview()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    test("预览期间静态内容变化立即退出预览", () => {
      const { renderer, viewport, chunk, objects, ctxCalls } = createTileScenario([
        new Vector(20, 20),
      ]);
      viewport.zoom = 1.2;
      ctxCalls.length = 0;
      renderer.invalidateChunks([chunk], [chunk], {
        previousViewportState: { zoom: 1, origin: { x: 0, y: 0 } },
      });
      renderer.flush([new RectangleRange(0, 0, 800, 600)]);
      // 前置断言：预览期间不得重建缓存
      expect(ctxCalls).not.toContainEqual(["cache", "clearRect", 0, 0, 800, 600]);

      ctxCalls.length = 0;
      renderer.invalidateCachedObjects([objects[0]]);
      renderer.flush([new RectangleRange(20, 20, 10, 10)]);

      // 退出预览后按对象范围标记脏块并重建
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(0);
      expect(renderer.getTileDebugInfo().zoom).toBeCloseTo(1.2, 6);
    });

    test("选中对象在移动提交后仍由输出层绘制", () => {
      const renderCalls = [];
      const outputCalls = [];
      const active = new FakeRectObject(1, new Vector(20, 20), renderCalls);
      const outputCanvas = createCanvas(
        800,
        600,
        createContext("output", outputCalls),
      );
      const { viewport, aom } = createViewportContext({
        activeObjects: [active],
        outputCanvas,
        withWorldRect: true,
      });
      const renderer = new ViewportRenderer(viewport, aom, {
        canvas: outputCanvas,
      });
      renderer._scheduler.scheduleFrame = () => 0;
      renderer.flush();
      renderCalls.length = 0;

      // 移动提交：对象仍选中（在 AOM 中），不进 tile，只能由输出层现画
      active.position.x = 300;
      active.position.y = 200;
      renderer.invalidateCachedObjects([active], {
        previousWorldRects: new Map([[1, new RectangleRange(20, 20, 10, 10)]]),
      });
      renderer.invalidateActiveObjects([active]);
      renderer.flush();

      expect(renderCalls.filter(([, label]) => label === "output")).toEqual([
        [1, "output"],
      ]);
    });

    test("缩放档位非 1 时同样使用 tile，层级随缩放取档", () => {
      const { renderer, viewport, objects } = createTileScenario([
        new Vector(20, 20),
      ]);

      viewport.zoom = 2;
      renderer.invalidateCachedObjects([objects[0]]);
      renderer.flush();

      const info = renderer.getTileDebugInfo();
      expect(info.enabled).toBe(true);
      // 2 倍缩放对应层级 -1，一块 tile 覆盖 128 世界单位
      expect(info.level).toBe(-1);
      expect(info.tileSize).toBe(512);
    });
  });
});
