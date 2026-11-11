/**
 * @jest-environment node
 */

/**
 * @file tile 网格换算测试
 * @description 断言相邻 tile 共用同一条整数边界、层级嵌套精确、原点吸附不引入错位。
 * @module canvas/tile-grid-test
 * @author Zhou Chenyu
 */

import {
  TILE_SCREEN_SIZE,
  levelForZoom,
  tileWorldSize,
  tileScreenSizeDevice,
  quantizeOriginToDevicePixel,
  tileDeviceRect,
  tileRangeForWorldRect,
  tileWorldRect,
  tileBoundaryDevice,
  tileContentOrigin,
  tileLocalDevice,
} from "../tile-grid.js";

/**
 * 覆盖常见与极端缩放
 * @type {number[]}
 */
const ZOOMS = [0.05, 0.07, 0.1, 0.25, 0.333, 0.5, 0.75, 0.999, 1, 1.001, 1.4, 1.999, 2, 2.5, 5, 7.3, 16, 32];

/**
 * 覆盖设备倍率
 * @type {number[]}
 */
const RATIOS = [1, 1.5, 2, 3];

describe("tile 层级", () => {
  test("层级让屏幕边长落在基准与两倍基准之间", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      for (const ratio of RATIOS) {
        const size = tileScreenSizeDevice(level, zoom, ratio);
        expect({
          zoom,
          ratio,
          inBand:
            size >= TILE_SCREEN_SIZE * ratio - 1e-9 &&
            size < TILE_SCREEN_SIZE * ratio * 2 + 1e-9,
        }).toEqual({ zoom, ratio, inBand: true });
      }
    }
  });

  test("层级只取整数，放大缩小各一档时世界边长翻倍或减半", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      expect(Number.isInteger(level)).toBe(true);
      expect(tileWorldSize(level + 1)).toBe(tileWorldSize(level) * 2);
      expect(tileWorldSize(level)).toBeGreaterThan(0);
    }
  });

  test("两倍缩放的层级恰好低一档，四块子格拼成一个父格", () => {
    for (const zoom of [0.1, 0.5, 1, 2, 8]) {
      const parentLevel = levelForZoom(zoom);
      const childLevel = levelForZoom(zoom * 2);
      expect(childLevel).toBe(parentLevel - 1);
      for (const [ix, iy] of [
        [0, 0],
        [1, 0],
        [-1, 1],
        [3, -2],
      ]) {
        const parent = tileWorldRect(ix, iy, parentLevel);
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const child = tileWorldRect(ix * 2 + dx, iy * 2 + dy, childLevel);
          expect(child.width * 2).toBe(parent.width);
          expect(child.left).toBeGreaterThanOrEqual(parent.left);
          expect(child.left + child.width).toBeLessThanOrEqual(
            parent.left + parent.width,
          );
          expect(child.top).toBeGreaterThanOrEqual(parent.top);
          expect(child.top + child.height).toBeLessThanOrEqual(
            parent.top + parent.height,
          );
        }
      }
    }
  });
});

describe("tile 屏幕矩形取整", () => {
  test("相邻块共用同一条边界，既无缝隙也不重叠", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      for (const ratio of RATIOS) {
        const size = tileScreenSizeDevice(level, zoom, ratio);
        for (const originDeviceX of [0, 13, -7, 123456]) {
          const origin = { x: originDeviceX, y: originDeviceX * 0.7 };
          for (let index = -6; index <= 6; index++) {
            const current = tileDeviceRect(index, 0, size, origin);
            const next = tileDeviceRect(index + 1, 0, size, origin);
            expect(current.left + current.width).toBe(next.left);
            expect(current.width).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  test("块宽与块内容与视口原点无关，平移只改变整数偏移", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      for (const ratio of RATIOS) {
        const size = tileScreenSizeDevice(level, zoom, ratio);
        const a = tileDeviceRect(3, -2, size, { x: 0, y: 0 });
        const b = tileDeviceRect(3, -2, size, { x: 128, y: -64 });
        // 宽度不变，位置正好按整数设备像素平移
        expect(b.width).toBe(a.width);
        expect(b.height).toBe(a.height);
        expect(a.left - b.left).toBe(128);
        expect(a.top - b.top).toBe(-64);
      }
    }
  });

  test("原点吸附到整数设备像素，误差不超过半个设备像素", () => {
    for (const zoom of ZOOMS) {
      for (const ratio of RATIOS) {
        for (const originX of [0, 0.123, -5.987, 1234.5678]) {
          const quantized = quantizeOriginToDevicePixel(
            { x: originX, y: originX * 3 },
            zoom,
            ratio,
          );
          const deviceX = quantized.x * zoom * ratio;
          const deviceY = quantized.y * zoom * ratio;
          expect(Math.abs(deviceX - Math.round(deviceX))).toBeLessThan(1e-9);
          expect(Math.abs(deviceY - Math.round(deviceY))).toBeLessThan(1e-9);
          expect(Math.abs(deviceX - originX * zoom * ratio)).toBeLessThanOrEqual(
            0.5 + 1e-9,
          );
        }
      }
    }
  });

  test("吸附后的原点在同一缩放下按整数设备像素平移", () => {
    const zoom = 0.37;
    const ratio = 2;
    const unit = zoom * ratio;
    const start = quantizeOriginToDevicePixel({ x: 10, y: 20 }, zoom, ratio);
    const moved = quantizeOriginToDevicePixel(
      { x: 10 + 7 / unit, y: 20 + 3 / unit },
      zoom,
      ratio,
    );
    expect((moved.x - start.x) * unit).toBeCloseTo(7, 9);
    expect((moved.y - start.y) * unit).toBeCloseTo(3, 9);
  });
});

describe("tile 内容对齐", () => {
  test("同一世界点在相邻两块上的局部坐标相差正好一个块宽", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      for (const ratio of RATIOS) {
        const size = tileScreenSizeDevice(level, zoom, ratio);
        const first = tileDeviceRect(7, 0, size);
        const second = tileDeviceRect(8, 0, size);
        const worldX = tileWorldRect(8, 0, level).left;
        const localFirst = tileLocalDevice(
          worldX,
          tileBoundaryDevice(7, size),
          zoom,
          ratio,
        );
        const localSecond = tileLocalDevice(
          worldX,
          tileBoundaryDevice(8, size),
          zoom,
          ratio,
        );
        expect(first.left + first.width).toBe(second.left);
        // 同一世界点在相邻两块上的局部坐标相差正好一个块宽，说明两块用的是同一套世界变换
        expect(localFirst - localSecond).toBeCloseTo(first.width, 9);
        // 块边界处的世界点落在块边缘半个像素之内，裁剪不会产生缝
        expect(Math.abs(localFirst - first.width)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  test("任意世界点只落在唯一一块 tile 的局部范围内", () => {
    for (const zoom of ZOOMS) {
      const level = levelForZoom(zoom);
      for (const ratio of RATIOS) {
        const size = tileScreenSizeDevice(level, zoom, ratio);
        const worldSize = tileWorldSize(level);
        for (let step = 0; step < 40; step++) {
          const worldX = worldSize * (step / 7 - 2) + 0.123;
          const owners = [];
          for (let index = -8; index <= 8; index++) {
            const local = tileLocalDevice(
              worldX,
              tileBoundaryDevice(index, size),
              zoom,
              ratio,
            );
            const width =
              tileBoundaryDevice(index + 1, size) -
              tileBoundaryDevice(index, size);
            if (local >= 0 && local < width) owners.push(index);
          }
          expect({ zoom, ratio, step, owners: owners.length }).toEqual({
            zoom,
            ratio,
            step,
            owners: 1,
          });
        }
      }
    }
  });

  test("内容原点把边界换算回世界坐标", () => {
    const zoom = 0.37;
    const ratio = 2;
    const boundary = -171;
    const origin = tileContentOrigin(boundary, zoom, ratio);
    const effective = origin * zoom * ratio;
    expect(effective).toBeCloseTo(boundary, 9);
  });
});

describe("世界矩形到块序号", () => {
  test("恰好落在分界线上的右边界不多算一块", () => {
    const level = 0;
    const size = tileWorldSize(level);
    const range = tileRangeForWorldRect(
      { left: 0, top: 0, right: size, bottom: size },
      level,
    );
    expect(range).toEqual({ minIx: 0, minIy: 0, maxIx: 0, maxIy: 0 });
  });

  test("跨负坐标时按向下取整归属", () => {
    const level = 0;
    const range = tileRangeForWorldRect(
      { left: -1, top: -1, right: 1, bottom: 1 },
      level,
    );
    expect(range).toEqual({ minIx: -1, minIy: -1, maxIx: 0, maxIy: 0 });
  });
});
