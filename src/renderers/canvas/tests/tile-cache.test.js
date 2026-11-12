/**
 * @jest-environment node
 */

/**
 * @file 世界空间 tile 缓存测试
 * @description 验证 tile 覆盖范围、失效标记与逐出的边界行为。
 * @module canvas/tile-cache-test
 * @author Zhou Chenyu
 */

import { TileStore } from "../tile-cache.js";
import { RectangleRange } from "../../../kernel/range/rectangle.js";

/**
 * 创建记录型画布工厂
 * @returns {{ createCanvas: Function, canvases: Array<Object> }}
 */
function createCanvasFactory() {
  const canvases = [];
  return {
    canvases,
    createCanvas(width, height) {
      const canvas = { width, height };
      canvases.push(canvas);
      return canvas;
    },
  };
}

/**
 * 创建被测存储
 * @param {number} [tileSize=512] - tile 边长
 * @returns {{ store: TileStore, canvases: Array<Object> }}
 */
function createStore(tileSize = 512) {
  const factory = createCanvasFactory();
  return {
    store: new TileStore({ tileSize, createCanvas: factory.createCanvas }),
    canvases: factory.canvases,
  };
}

describe("TileStore#rangeForWorldRect", () => {
  test("覆盖范围按世界坐标对齐，与视口位置无关", () => {
    const { store } = createStore();

    expect(store.rangeForWorldRect(new RectangleRange(0, 0, 800, 600))).toEqual(
      {
        minTx: 0,
        minTy: 0,
        maxTx: 1,
        maxTy: 1,
      },
    );
  });

  test("负坐标向负方向取整", () => {
    const { store } = createStore();

    expect(
      store.rangeForWorldRect(new RectangleRange(-200, -150, 1200, 900)),
    ).toEqual({ minTx: -1, minTy: -1, maxTx: 1, maxTy: 1 });
  });

  test("右边界恰好落在 tile 分界线上不多算一块", () => {
    const { store } = createStore();

    expect(store.rangeForWorldRect(new RectangleRange(0, 0, 512, 512))).toEqual(
      {
        minTx: 0,
        minTy: 0,
        maxTx: 0,
        maxTy: 0,
      },
    );
  });

  test("无效矩形返回 undefined", () => {
    const { store } = createStore();

    expect(store.rangeForWorldRect(null)).toBeUndefined();
  });
});

describe("TileStore#ensure", () => {
  test("新建 tile 一律为脏，重复 ensure 不重复分配", () => {
    const { store, canvases } = createStore();
    const rect = new RectangleRange(0, 0, 800, 600);

    const first = store.ensure(rect);
    const second = store.ensure(rect);

    expect(first).toHaveLength(4);
    expect(second).toHaveLength(4);
    expect(canvases).toHaveLength(4);
    expect(store.countDirty()).toBe(4);
    expect(first.every((tile) => tile.canvas.width === 512)).toBe(true);
  });

  test("ensure 不会清除已有的干净标记", () => {
    const { store } = createStore();
    const rect = new RectangleRange(0, 0, 100, 100);

    const [tile] = store.ensure(rect);
    store.markRebuilt(tile);
    store.ensure(rect);

    expect(store.countDirty()).toBe(0);
    expect(store.rebuildCount).toBe(1);
  });
});

describe("TileStore#markDirtyWorldRect", () => {
  test("只标记与矩形相交的已存在 tile", () => {
    const { store } = createStore();
    const rect = new RectangleRange(0, 0, 100, 100);
    const tiles = store.ensure(rect);
    for (const tile of tiles) store.markRebuilt(tile);

    const marked = store.markDirtyWorldRect(new RectangleRange(10, 10, 20, 20));

    expect(marked).toBe(1);
    expect(store.countDirty()).toBe(1);
    expect(tiles.find((tile) => store.isDirty(tile))?.key).toBe("0:0,0");
  });

  test("跨区域矩形标记所有相交 tile", () => {
    const { store } = createStore();
    const tiles = store.ensure(new RectangleRange(0, 0, 1200, 100));
    for (const tile of tiles) store.markRebuilt(tile);

    store.markDirtyWorldRect(new RectangleRange(0, 0, 1200, 100));

    expect(store.countDirty()).toBe(tiles.length);
  });

  test("整块脏的 tile 不重复计入标记数", () => {
    const { store } = createStore();
    const tiles = store.ensure(new RectangleRange(0, 0, 100, 100));

    // 保证创建的块初始即为整块脏
    expect(store.markDirtyWorldRect(new RectangleRange(0, 0, 100, 100))).toBe(
      0,
    );
    expect(tiles.every((tile) => store.isDirty(tile))).toBe(true);
  });
});

describe("TileStore#evictToBudget", () => {
  /**
   * 建一个字节预算刚好放得下指定块数的存储
   * @param {number} tileCount - 允许的块数
   * @returns {{ store: TileStore, canvases: Array<Object> }}
   */
  function createBudgetStore(tileCount) {
    const factory = createCanvasFactory();
    const store = new TileStore({
      tileSize: 256,
      createCanvas: factory.createCanvas,
      maxBytes: tileCount * 256 * 256 * 4,
    });
    return { store, canvases: factory.canvases };
  }

  test("按最近最少使用逐出，超预算后保留最新访问的块", () => {
    const { store, canvases } = createBudgetStore(2);
    const [first] = store.ensure(new RectangleRange(0, 0, 10, 10));
    const [second] = store.ensure(new RectangleRange(300, 0, 10, 10));

    // 重新访问第一块，它应变成最近使用，逐出时轮到第二块
    store.ensure(new RectangleRange(0, 0, 10, 10));
    store.ensure(new RectangleRange(600, 0, 10, 10));

    // ensure 只分配不逐出，预算在帧末统一收敛
    expect(store.size).toBe(3);
    expect(store.evictToBudget()).toBe(1);
    expect(store.size).toBe(2);
    expect(store.usedBytes).toBe(2 * 256 * 256 * 4);

    // 被逐出的是第二块，再次覆盖它需要重新分配位图
    store.ensure(new RectangleRange(300, 0, 10, 10));
    expect(canvases).toHaveLength(4);
    expect(second).toBeDefined();
  });

  test("预算充足时不逐出", () => {
    const { store } = createBudgetStore(100);
    store.ensure(new RectangleRange(0, 0, 2000, 2000));

    expect(store.size).toBe(64);
    expect(store.evictToBudget()).toBe(0);
    expect(store.size).toBe(64);
  });

  test("逐出后再次 ensure 会重新分配且为脏", () => {
    const { store } = createBudgetStore(1);
    const rect = new RectangleRange(0, 0, 100, 100);
    const [tile] = store.ensure(rect);
    store.markRebuilt(tile);

    store.ensure(new RectangleRange(5000, 5000, 10, 10));
    store.evictToBudget();
    const [recreated] = store.ensure(rect);

    expect(recreated.dirty).toBe(true);
    expect(store.usedBytes).toBe(store.size * 256 * 256 * 4);
  });
});
