import { jest } from "@jest/globals";
import { BaseRenderer } from "../base-renderer.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { Chunk } from "../../chunk/chunk.js";
import { ChunkObjectManager } from "../../chunk/chunk-object-manager.js";
import { RectangleRange } from "../../../range/index.js";

describe("BaseRenderer", () => {
  function createBoardWithObjects(objects = []) {
    const objectMap = new Map(
      objects.map((objectInstance) => [objectInstance.id, objectInstance]),
    );

    return {
      getObjectById(objectId) {
        return objectMap.get(objectId);
      },
      activeObjectManager: {
        findBoardObjectInstance(objectId) {
          return objectMap.get(objectId);
        },
      },
    };
  }

  function createContext(calls) {
    return {
      save() {
        calls.push(["save"]);
      },
      restore() {
        calls.push(["restore"]);
      },
      setTransform(...args) {
        calls.push(["setTransform", ...args]);
      },
      clearRect(...args) {
        calls.push(["clearRect", ...args]);
      },
      beginPath() {
        calls.push(["beginPath"]);
      },
      rect(...args) {
        calls.push(["rect", ...args]);
      },
      clip() {
        calls.push(["clip"]);
      },
      moveTo(...args) {
        calls.push(["moveTo", ...args]);
      },
      lineTo(...args) {
        calls.push(["lineTo", ...args]);
      },
      stroke() {
        calls.push(["stroke"]);
      },
      set lineCap(value) {
        calls.push(["lineCap", value]);
      },
      set lineJoin(value) {
        calls.push(["lineJoin", value]);
      },
      set lineWidth(value) {
        calls.push(["lineWidth", value]);
      },
      set strokeStyle(value) {
        calls.push(["strokeStyle", value]);
      },
    };
  }

  function createReceiverSensitiveContext(calls) {
    const ctx = {
      save() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["save"]);
      },
      restore() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["restore"]);
      },
      setTransform(...args) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["setTransform", ...args]);
      },
      clearRect(...args) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["clearRect", ...args]);
      },
      beginPath() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["beginPath"]);
      },
      rect(...args) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["rect", ...args]);
      },
      clip() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["clip"]);
      },
      moveTo(...args) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["moveTo", ...args]);
      },
      lineTo(...args) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["lineTo", ...args]);
      },
      stroke() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["stroke"]);
      },
    };

    Object.defineProperty(ctx, "strokeStyle", {
      configurable: true,
      enumerable: true,
      get() {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        return "#000000";
      },
      set(value) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["strokeStyle", value]);
      },
    });
    Object.defineProperty(ctx, "lineJoin", {
      configurable: true,
      enumerable: true,
      set(value) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["lineJoin", value]);
      },
    });
    Object.defineProperty(ctx, "lineCap", {
      configurable: true,
      enumerable: true,
      set(value) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["lineCap", value]);
      },
    });
    Object.defineProperty(ctx, "globalCompositeOperation", {
      configurable: true,
      enumerable: true,
      set(value) {
        if (this !== ctx) throw new TypeError("Illegal invocation");
        calls.push(["globalCompositeOperation", value]);
      },
    });

    return ctx;
  }

  test("应按已加载区块的静态图拓扑序渲染静态对象", () => {
    const calls = [];
    const lower = new StrokeObject(new Vector(0, 0), 11, 1);
    lower.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const upper = new StrokeObject(new Vector(0, 0), 12, 1);
    upper.setPathPoints([new Vector(0, 1), new Vector(5, 1)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([
      [11, [12]],
      [12, []],
    ]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([lower, upper]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);
    const drawables = renderer.render();

    expect(drawables).toEqual([lower, upper]);
    expect(calls).toContainEqual(["clearRect", 0, 0, 320, 240]);
  });

  test("viewportContext 应保持原生 context accessor 的合法 receiver", () => {
    const calls = [];
    const object = new StrokeObject(new Vector(0, 0), 111, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([[111, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([object]),
      getContext(layer) {
        return layer === "base" ? createReceiverSensitiveContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(() => renderer.render()).not.toThrow();
    expect(calls).toContainEqual(["strokeStyle", "#000000"]);
  });

  test("应按多区块合并后的全局静态图拓扑序渲染静态对象", () => {
    const calls = [];
    const lower = new StrokeObject(new Vector(0, 0), 41, 1);
    lower.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const upper = new StrokeObject(new Vector(20, 0), 42, 1);
    upper.setPathPoints([new Vector(0, 1), new Vector(5, 1)]);

    const leftChunk = Chunk.fromId(1);
    leftChunk.objectManager = new ChunkObjectManager(1);
    leftChunk.objectManager.staticGraph = DirectedGraph.parse([
      [41, [42]],
      [42, []],
    ]);

    const rightChunk = Chunk.fromId(2);
    rightChunk.objectManager = new ChunkObjectManager(2);
    rightChunk.objectManager.staticGraph = DirectedGraph.parse([[42, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([lower, upper]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [rightChunk, leftChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(renderer.render()).toEqual([lower, upper]);
  });

  test("应能从覆盖区块回查 owner chunk 的静态对象实例", () => {
    const calls = [];
    const object = new StrokeObject(new Vector(0, 0), 21, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const ownerChunk = Chunk.fromId(1);
    ownerChunk.objectManager = new ChunkObjectManager(1);
    ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[21, []]]);

    const coveredChunk = Chunk.fromId(2);
    coveredChunk.objectManager = new ChunkObjectManager(2);
    coveredChunk.objectManager.staticGraph = DirectedGraph.parse([[21, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([object]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [coveredChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(renderer.render()).toEqual([object]);
  });

  test("同一静态对象跨多个已加载覆盖区块时应只绘制一次", () => {
    const calls = [];
    const object = new StrokeObject(new Vector(0, 0), 51, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const ownerChunk = Chunk.fromId(1);
    ownerChunk.objectManager = new ChunkObjectManager(1);
    ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[51, []]]);

    const coveredChunk = Chunk.fromId(2);
    coveredChunk.objectManager = new ChunkObjectManager(2);
    coveredChunk.objectManager.staticGraph = DirectedGraph.parse([[51, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([object]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [coveredChunk, ownerChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(renderer.render()).toEqual([object]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
    ]);
  });

  test("render(dirtyRects) 应只清理并重绘命中脏区的静态对象", () => {
    const calls = [];
    const leftObject = new StrokeObject(new Vector(0, 0), 31, 1);
    leftObject.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const rightObject = new StrokeObject(new Vector(100, 0), 32, 1);
    rightObject.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([
      [31, []],
      [32, []],
    ]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 800,
      chunkHeight: 600,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([leftObject, rightObject]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    renderer.render([new RectangleRange(-1, -1, 20, 20)]);

    expect(calls).toContainEqual(["clearRect", -1, -1, 20, 20]);
    expect(calls).toContainEqual(["rect", -1, -1, 20, 20]);
    expect(calls).toContainEqual(["clip"]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
    ]);
  });

  test("clearDirtyRects 应把浮点脏区向外扩张到整像素清理矩形", () => {
    const calls = [];
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
    };
    const renderer = new BaseRenderer(monitor);

    renderer.clearDirtyRects([new RectangleRange(10.2, 20.4, 5.1, 6.2)]);

    expect(calls).toContainEqual(["clearRect", 10, 20, 6, 7]);
  });

  test("render(dirtyRects) 应把对象级渲染留白计入静态层局部重绘命中判断", () => {
    const calls = [];
    const object = new StrokeObject(new Vector(0, 0), 33, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    object.getRenderPadding = () => 2;

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([[33, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 2,
      chunkWidth: 800,
      chunkHeight: 600,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([object]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    renderer.render([new RectangleRange(-4, -4, 1, 1)]);

    expect(calls).toContainEqual(["clearRect", -4, -4, 1, 1]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
    ]);
  });

  test("多区块局部重绘时也应保持全局静态图拓扑序", () => {
    const calls = [];
    const lower = new StrokeObject(new Vector(0, 0), 61, 1);
    lower.setPathPoints([new Vector(0, 0), new Vector(8, 0)]);
    const upper = new StrokeObject(new Vector(0, 0), 62, 1);
    upper.setPathPoints([new Vector(0, 2), new Vector(8, 2)]);

    const leftChunk = Chunk.fromId(1);
    leftChunk.objectManager = new ChunkObjectManager(1);
    leftChunk.objectManager.staticGraph = DirectedGraph.parse([
      [61, [62]],
      [62, []],
    ]);

    const rightChunk = Chunk.fromId(2);
    rightChunk.objectManager = new ChunkObjectManager(2);
    rightChunk.objectManager.staticGraph = DirectedGraph.parse([[62, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 800,
      chunkHeight: 600,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([lower, upper]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [rightChunk, leftChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    renderer.render([new RectangleRange(-2, -2, 20, 10)]);

    expect(calls).toContainEqual(["clearRect", -2, -2, 20, 10]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 2],
    ]);
  });

  test("三个已加载区块形成链式依赖时应按全局拓扑序渲染", () => {
    const calls = [];
    const first = new StrokeObject(new Vector(0, 0), 71, 1);
    first.setPathPoints([new Vector(0, 0), new Vector(6, 0)]);
    const second = new StrokeObject(new Vector(20, 0), 72, 1);
    second.setPathPoints([new Vector(0, 1), new Vector(6, 1)]);
    const third = new StrokeObject(new Vector(40, 0), 73, 1);
    third.setPathPoints([new Vector(0, 2), new Vector(6, 2)]);

    const chunk1 = Chunk.fromId(1);
    chunk1.objectManager = new ChunkObjectManager(1);
    chunk1.objectManager.staticGraph = DirectedGraph.parse([
      [71, [72]],
      [72, []],
    ]);

    const chunk2 = Chunk.fromId(2);
    chunk2.objectManager = new ChunkObjectManager(2);
    chunk2.objectManager.staticGraph = DirectedGraph.parse([
      [72, [73]],
      [73, []],
    ]);

    const chunk3 = Chunk.fromId(3);
    chunk3.objectManager = new ChunkObjectManager(3);
    chunk3.objectManager.staticGraph = DirectedGraph.parse([[73, []]]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([first, second, third]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk3, chunk2, chunk1];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(renderer.render()).toEqual([first, second, third]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 1],
      ["moveTo", 0, 2],
    ]);
  });

  test("不同区块提供同一批对象的不同边信息时应合并成稳定全局顺序", () => {
    const calls = [];
    const first = new StrokeObject(new Vector(0, 0), 81, 1);
    first.setPathPoints([new Vector(0, 0), new Vector(6, 0)]);
    const second = new StrokeObject(new Vector(20, 0), 82, 1);
    second.setPathPoints([new Vector(0, 1), new Vector(6, 1)]);
    const third = new StrokeObject(new Vector(40, 0), 83, 1);
    third.setPathPoints([new Vector(0, 2), new Vector(6, 2)]);

    const chunk1 = Chunk.fromId(1);
    chunk1.objectManager = new ChunkObjectManager(1);
    chunk1.objectManager.staticGraph = DirectedGraph.parse([
      [81, [82]],
      [82, []],
    ]);

    const chunk2 = Chunk.fromId(2);
    chunk2.objectManager = new ChunkObjectManager(2);
    chunk2.objectManager.staticGraph = DirectedGraph.parse([
      [81, [83]],
      [83, []],
    ]);

    const chunk3 = Chunk.fromId(3);
    chunk3.objectManager = new ChunkObjectManager(3);
    chunk3.objectManager.staticGraph = DirectedGraph.parse([
      [82, [83]],
      [83, []],
    ]);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseCanvas: { width: 320, height: 240 },
      board: createBoardWithObjects([first, second, third]),
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      chunkBlockLoader: {
        getLoadedChunks() {
          return [chunk3, chunk2, chunk1];
        },
      },
    };

    const renderer = new BaseRenderer(monitor);

    expect(renderer.render()).toEqual([first, second, third]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 1],
      ["moveTo", 0, 2],
    ]);
  });

  test("invalidateChunks 应把当前区块与旧区块都送入 baseRenderScheduler", () => {
    const calls = [];
    const currentChunk = Chunk.fromId(2);
    const previousChunk = Chunk.fromId(1);

    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 10,
      chunkHeight: 10,
      board: {},
      baseCanvas: { width: 320, height: 240 },
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      getContext(layer) {
        return layer === "base" ? createContext(calls) : null;
      },
      baseRenderScheduler: {
        invalidate: jest.fn(),
      },
    };

    const renderer = new BaseRenderer(monitor);
    renderer.invalidateChunks([currentChunk], [previousChunk]);

    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenCalledWith(
      new RectangleRange(10, 0, 10, 10),
    );
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 10, 10),
    );
  });

  test("invalidateObjects 应同时失效对象当前范围与旧世界范围", () => {
    const object = new StrokeObject(new Vector(100, 0), 91, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseRenderScheduler: {
        invalidate: jest.fn(),
      },
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor);
    const oldWorldRect = RectangleRange.from(
      object.getRange().withPosition(new Vector(0, 0)),
    );

    const dirtyRects = renderer.invalidateObjects([object], {
      previousWorldRects: new Map([[91, oldWorldRect]]),
    });

    expect(dirtyRects).toEqual([
      new RectangleRange(98.5, -1.5, 8, 3),
      new RectangleRange(-1.5, -1.5, 8, 3),
    ]);
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenNthCalledWith(
      1,
      new RectangleRange(98.5, -1.5, 8, 3),
    );
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenNthCalledWith(
      2,
      new RectangleRange(-1.5, -1.5, 8, 3),
    );
  });

  test("invalidateObjects 应将原始脏区逐一提交给调度器，由调度器统一合并", () => {
    const object = new StrokeObject(new Vector(1, 0), 92, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseRenderScheduler: {
        invalidate: jest.fn(),
      },
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor);
    const oldWorldRect = RectangleRange.from(
      object.getRange().withPosition(new Vector(0, 0)),
    );

    const dirtyRects = renderer.invalidateObjects([object], {
      previousWorldRects: new Map([[92, oldWorldRect]]),
    });

    // 不再预合并：current 和 previous 各自单独提交给调度器，
    // 合并由 RenderScheduler.flush 统一完成。
    expect(dirtyRects).toEqual([
      new RectangleRange(-0.5, -1.5, 8, 3),
      new RectangleRange(-1.5, -1.5, 8, 3),
    ]);
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenCalledTimes(2);
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenNthCalledWith(
      1,
      new RectangleRange(-0.5, -1.5, 8, 3),
    );
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenNthCalledWith(
      2,
      new RectangleRange(-1.5, -1.5, 8, 3),
    );
  });

  test("PathRange 对象的静态层失效矩形应包含额外的抗锯齿安全留白", () => {
    const object = new StrokeObject(new Vector(0, 0), 93, 1);
    object.setPathPoints([new Vector(0, 0), new Vector(0, 10)]);
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      baseRenderScheduler: {
        invalidate: jest.fn(),
      },
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor);
    const dirtyRects = renderer.invalidateObjects([object]);

    expect(dirtyRects).toEqual([new RectangleRange(-1.5, -1.5, 3, 13)]);
    expect(monitor.baseRenderScheduler.invalidate).toHaveBeenCalledWith(
      new RectangleRange(-1.5, -1.5, 3, 13),
    );
  });
});
