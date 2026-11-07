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

    expect(store.rangeForWorldRect(new RectangleRange(0, 0, 800, 600))).toEqual({
      minTx: 0,
      minTy: 0,
      maxTx: 1,
      maxTy: 1,
    });
  });

  test("负坐标向负方向取整", () => {
    const { store } = createStore();

    expect(
      store.rangeForWorldRect(new RectangleRange(-200, -150, 1200, 900)),
    ).toEqual({ minTx: -1, minTy: -1, maxTx: 1, maxTy: 1 });
  });

  test("右边界恰好落在 tile 分界线上不多算一块", () => {
    const { store } = createStore();

    expect(store.rangeForWorldRect(new RectangleRange(0, 0, 512, 512))).toEqual({
      minTx: 0,
      minTy: 0,
      maxTx: 0,
      maxTy: 0,
    });
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
    const tiles = store.ensure(new RectangleRange(0, 0, 1200, 600));
    for (const tile of tiles) store.markRebuilt(tile);

    const marked = store.markDirtyWorldRect(new RectangleRange(20, 20, 10, 10));

    expect(marked).toBe(1);
    expect(store.countDirty()).toBe(1);
    expect(tiles.find((tile) => store.isDirty(tile))?.key).toBe("0,0");
  });

  test("跨区域矩形标记所有相交 tile", () => {
    const { store } = createStore();
    const tiles = store.ensure(new RectangleRange(0, 0, 1200, 600));
    for (const tile of tiles) store.markRebuilt(tile);

    store.markDirtyWorldRect(new RectangleRange(500, 0, 40, 40));

    const dirtyKeys = tiles
      .filter((tile) => store.isDirty(tile))
      .map((tile) => tile.key);
    expect(dirtyKeys.sort()).toEqual(["0,0", "1,0"]);
  });

  test("内容变化记为局部脏区而不是整块重建", () => {
    const { store } = createStore();
    const [tile] = store.ensure(new RectangleRange(0, 0, 100, 100));
    store.markRebuilt(tile);

    store.markDirtyWorldRect(new RectangleRange(20, 20, 10, 10));

    expect(tile.dirty).toBe(false);
    expect(tile.dirtyRects).toHaveLength(1);
    expect(store.isDirty(tile)).toBe(true);

    store.markRebuilt(tile);
    expect(tile.dirtyRects).toHaveLength(0);
    expect(store.isDirty(tile)).toBe(false);
  });

  test("局部脏区数量超过上限时退化为整块重建", () => {
    const { store } = createStore();
    const [tile] = store.ensure(new RectangleRange(0, 0, 100, 100));
    store.markRebuilt(tile);

    for (let i = 0; i < 20; i++) {
      store.markDirtyWorldRect(new RectangleRange(i * 10, 0, 5, 5));
    }

    expect(tile.dirty).toBe(true);
    expect(tile.dirtyRects).toHaveLength(0);
  });

  test("整块脏的 tile 不再累积局部脏区", () => {
    const { store } = createStore();
    const [tile] = store.ensure(new RectangleRange(0, 0, 100, 100));

    store.markDirtyWorldRect(new RectangleRange(20, 20, 10, 10));

    expect(tile.dirty).toBe(true);
    expect(tile.dirtyRects).toHaveLength(0);
  });

  test("未分配的区域不新建 tile", () => {
    const { store, canvases } = createStore();
    store.ensure(new RectangleRange(0, 0, 100, 100));

    store.markDirtyWorldRect(new RectangleRange(5000, 5000, 100, 100));

    expect(canvases).toHaveLength(1);
  });
});

describe("TileStore#evictOutside", () => {
  test("逐出完全不相交的 tile，保留相交的", () => {
    const { store, canvases } = createStore();
    store.ensure(new RectangleRange(0, 0, 2000, 2000));
    expect(store.size).toBe(16);

    const evicted = store.evictOutside(new RectangleRange(0, 0, 100, 100));

    expect(evicted).toBe(15);
    expect(store.size).toBe(1);

    // 保留下来的 tile 不需要重新分配
    store.ensure(new RectangleRange(0, 0, 100, 100));
    expect(canvases).toHaveLength(16);
  });

  test("逐出后再次 ensure 会重新分配且为脏", () => {
    const { store } = createStore();
    const rect = new RectangleRange(0, 0, 100, 100);
    const [tile] = store.ensure(rect);
    store.markRebuilt(tile);

    store.evictOutside(new RectangleRange(5000, 5000, 10, 10));
    const [recreated] = store.ensure(rect);

    expect(store.size).toBe(1);
    expect(recreated.dirty).toBe(true);
  });
});
