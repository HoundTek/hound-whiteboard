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

  function createCanvas(width, height, contextResolver) {
    return {
      width,
      height,
      getContext() {
        return contextResolver();
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
    const lower = new StrokeObject(11, new Vector(0, 0));
    lower.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const upper = new StrokeObject(12, new Vector(0, 0));
    upper.setPathPoints([new Vector(0, 1), new Vector(5, 1)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([
      [11, [12]],
      [12, []],
    ]);

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([lower, upper]),
      chunkLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });
    const drawables = renderer.render();

    expect(drawables).toEqual([lower, upper]);
    expect(calls).toContainEqual(["clearRect", 0, 0, 320, 240]);
  });

  test("viewportContext 应保持原生 context accessor 的合法 receiver", () => {
    const calls = [];
    const object = new StrokeObject(111, new Vector(0, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([[111, []]]);

    const canvas = createCanvas(320, 240, () =>
      createReceiverSensitiveContext(calls),
    );
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([object]),
      chunkLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(() => renderer.render()).not.toThrow();
    expect(calls).toContainEqual(["strokeStyle", "#000000"]);
  });

  test("应按多区块合并后的全局静态图拓扑序渲染静态对象", () => {
    const calls = [];
    const lower = new StrokeObject(41, new Vector(0, 0));
    lower.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const upper = new StrokeObject(42, new Vector(20, 0));
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

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([lower, upper]),
      chunkLoader: {
        getLoadedChunks() {
          return [rightChunk, leftChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(renderer.render()).toEqual([lower, upper]);
  });

  test("应能从覆盖区块回查 owner chunk 的静态对象实例", () => {
    const calls = [];
    const object = new StrokeObject(21, new Vector(0, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const ownerChunk = Chunk.fromId(1);
    ownerChunk.objectManager = new ChunkObjectManager(1);
    ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[21, []]]);

    const coveredChunk = Chunk.fromId(2);
    coveredChunk.objectManager = new ChunkObjectManager(2);
    coveredChunk.objectManager.staticGraph = DirectedGraph.parse([[21, []]]);

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([object]),
      chunkLoader: {
        getLoadedChunks() {
          return [coveredChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(renderer.render()).toEqual([object]);
  });

  test("同一静态对象跨多个已加载覆盖区块时应只绘制一次", () => {
    const calls = [];
    const object = new StrokeObject(51, new Vector(0, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const ownerChunk = Chunk.fromId(1);
    ownerChunk.objectManager = new ChunkObjectManager(1);
    ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[51, []]]);

    const coveredChunk = Chunk.fromId(2);
    coveredChunk.objectManager = new ChunkObjectManager(2);
    coveredChunk.objectManager.staticGraph = DirectedGraph.parse([[51, []]]);

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([object]),
      chunkLoader: {
        getLoadedChunks() {
          return [coveredChunk, ownerChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(renderer.render()).toEqual([object]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
    ]);
  });

  test("render(dirtyRects) 应只清理并重绘命中脏区的静态对象", () => {
    const calls = [];
    const leftObject = new StrokeObject(31, new Vector(0, 0));
    leftObject.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const rightObject = new StrokeObject(32, new Vector(100, 0));
    rightObject.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([
      [31, []],
      [32, []],
    ]);

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 800,
      chunkHeight: 600,
      board: createBoardWithObjects([leftObject, rightObject]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      chunkLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

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
    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
    };
    const renderer = new BaseRenderer(monitor, { canvas });

    renderer.clearDirtyRects([new RectangleRange(10.2, 20.4, 5.1, 6.2)]);

    expect(calls).toContainEqual(["clearRect", 10, 20, 6, 7]);
  });

  test("render(dirtyRects) 应把对象级渲染留白计入静态层局部重绘命中判断", () => {
    const calls = [];
    const object = new StrokeObject(33, new Vector(0, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    object.getRenderPadding = () => 2;

    const chunk = Chunk.fromId(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse([[33, []]]);

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 2,
      chunkWidth: 800,
      chunkHeight: 600,
      board: createBoardWithObjects([object]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      chunkLoader: {
        getLoadedChunks() {
          return [chunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    renderer.render([new RectangleRange(-4, -4, 1, 1)]);

    expect(calls).toContainEqual(["clearRect", -4, -4, 1, 1]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
    ]);
  });

  test("多区块局部重绘时也应保持全局静态图拓扑序", () => {
    const calls = [];
    const lower = new StrokeObject(61, new Vector(0, 0));
    lower.setPathPoints([new Vector(0, 0), new Vector(8, 0)]);
    const upper = new StrokeObject(62, new Vector(0, 0));
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

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 800,
      chunkHeight: 600,
      board: createBoardWithObjects([lower, upper]),
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
      chunkLoader: {
        getLoadedChunks() {
          return [rightChunk, leftChunk];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    renderer.render([new RectangleRange(-2, -2, 20, 10)]);

    expect(calls).toContainEqual(["clearRect", -2, -2, 20, 10]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 2],
    ]);
  });

  test("三个已加载区块形成链式依赖时应按全局拓扑序渲染", () => {
    const calls = [];
    const first = new StrokeObject(71, new Vector(0, 0));
    first.setPathPoints([new Vector(0, 0), new Vector(6, 0)]);
    const second = new StrokeObject(72, new Vector(20, 0));
    second.setPathPoints([new Vector(0, 1), new Vector(6, 1)]);
    const third = new StrokeObject(73, new Vector(40, 0));
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

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([first, second, third]),
      chunkLoader: {
        getLoadedChunks() {
          return [chunk3, chunk2, chunk1];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(renderer.render()).toEqual([first, second, third]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 1],
      ["moveTo", 0, 2],
    ]);
  });

  test("不同区块提供同一批对象的不同边信息时应合并成稳定全局顺序", () => {
    const calls = [];
    const first = new StrokeObject(81, new Vector(0, 0));
    first.setPathPoints([new Vector(0, 0), new Vector(6, 0)]);
    const second = new StrokeObject(82, new Vector(20, 0));
    second.setPathPoints([new Vector(0, 1), new Vector(6, 1)]);
    const third = new StrokeObject(83, new Vector(40, 0));
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

    const canvas = createCanvas(320, 240, () => createContext(calls));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      board: createBoardWithObjects([first, second, third]),
      chunkLoader: {
        getLoadedChunks() {
          return [chunk3, chunk2, chunk1];
        },
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });

    expect(renderer.render()).toEqual([first, second, third]);
    expect(calls.filter((entry) => entry[0] === "moveTo")).toEqual([
      ["moveTo", 0, 0],
      ["moveTo", 0, 1],
      ["moveTo", 0, 2],
    ]);
  });

  test("invalidateChunks 应把当前区块与旧区块都提交给调度器", () => {
    const currentChunk = Chunk.fromId(2);
    const previousChunk = Chunk.fromId(1);

    const canvas = createCanvas(320, 240, () => ({
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
      beginPath() {},
      rect() {},
      clip() {},
    }));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      chunkWidth: 10,
      chunkHeight: 10,
      board: {},
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });
    const invalidateSpy = jest
      .spyOn(renderer, "invalidate")
      .mockImplementation(() => false);

    renderer.invalidateChunks([currentChunk], [previousChunk]);

    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(10, 0, 10, 10),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 10, 10),
    );
  });

  test("invalidateObjects 应同时失效对象当前范围与旧世界范围", () => {
    const object = new StrokeObject(91, new Vector(100, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const canvas = createCanvas(1, 1, () => ({
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
    }));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });
    const invalidateSpy = jest
      .spyOn(renderer, "invalidate")
      .mockImplementation(() => false);
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
    expect(invalidateSpy).toHaveBeenNthCalledWith(
      1,
      new RectangleRange(98.5, -1.5, 8, 3),
    );
    expect(invalidateSpy).toHaveBeenNthCalledWith(
      2,
      new RectangleRange(-1.5, -1.5, 8, 3),
    );
  });

  test("invalidateObjects 应将原始脏区逐一提交给调度器，由调度器统一合并", () => {
    const object = new StrokeObject(92, new Vector(1, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(5, 0)]);
    const canvas = createCanvas(1, 1, () => ({
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
    }));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });
    const invalidateSpy = jest
      .spyOn(renderer, "invalidate")
      .mockImplementation(() => false);
    const oldWorldRect = RectangleRange.from(
      object.getRange().withPosition(new Vector(0, 0)),
    );

    const dirtyRects = renderer.invalidateObjects([object], {
      previousWorldRects: new Map([[92, oldWorldRect]]),
    });

    expect(dirtyRects).toEqual([
      new RectangleRange(-0.5, -1.5, 8, 3),
      new RectangleRange(-1.5, -1.5, 8, 3),
    ]);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenNthCalledWith(
      1,
      new RectangleRange(-0.5, -1.5, 8, 3),
    );
    expect(invalidateSpy).toHaveBeenNthCalledWith(
      2,
      new RectangleRange(-1.5, -1.5, 8, 3),
    );
  });

  test("PathRange 对象的静态层失效矩形应包含额外的抗锯齿安全留白", () => {
    const object = new StrokeObject(93, new Vector(0, 0));
    object.setPathPoints([new Vector(0, 0), new Vector(0, 10)]);
    const canvas = createCanvas(1, 1, () => ({
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
    }));
    const monitor = {
      origin: new Vector(0, 0),
      zoom: 1,
      worldRectToScreenRect(rect) {
        return RectangleRange.from(rect);
      },
    };

    const renderer = new BaseRenderer(monitor, { canvas });
    const invalidateSpy = jest
      .spyOn(renderer, "invalidate")
      .mockImplementation(() => false);
    const dirtyRects = renderer.invalidateObjects([object]);

    expect(dirtyRects).toEqual([new RectangleRange(-1.5, -1.5, 3, 13)]);
    expect(invalidateSpy).toHaveBeenCalledWith(
      new RectangleRange(-1.5, -1.5, 3, 13),
    );
  });
});
