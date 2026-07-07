import { RectangleRange } from "../../range/rectangle.js";
import {
  createRectangleDirtyRectMerger,
  RenderScheduler,
  mergeRectangleDirtyRects,
} from "../render-scheduler.js";

describe("RenderScheduler", () => {
  test("invalidate 应将多次脏区请求合并到单次调度", () => {
    const scheduledCallbacks = [];
    const flushed = [];
    const scheduler = new RenderScheduler({
      scheduleFrame(callback) {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
      flushHandler(dirtyRects) {
        flushed.push(dirtyRects);
      },
    });

    expect(scheduler.invalidate({ id: 1 })).toBe(true);
    expect(scheduler.invalidate({ id: 2 })).toBe(false);
    expect(scheduledCallbacks).toHaveLength(1);

    scheduledCallbacks[0](0);

    expect(flushed).toEqual([[{ id: 1 }, { id: 2 }]]);
    expect(scheduler.framePending).toBe(false);
    expect(scheduler.dirtyRects).toEqual([]);
  });

  test("flush 应先合并脏区再调用处理器", () => {
    const flushed = [];
    const scheduler = new RenderScheduler({
      mergeDirtyRects(dirtyRects) {
        return [{ count: dirtyRects.length }];
      },
      flushHandler(dirtyRects) {
        flushed.push(dirtyRects);
        return dirtyRects.length;
      },
    });

    scheduler.invalidate({ id: 1 });
    scheduler.invalidate({ id: 2 });
    const result = scheduler.flush();

    expect(result).toBe(1);
    expect(flushed).toEqual([[{ count: 2 }]]);
  });

  test("默认应合并重叠或相接的矩形脏区", () => {
    const flushed = [];
    const scheduler = new RenderScheduler({
      flushHandler(dirtyRects) {
        flushed.push(dirtyRects);
      },
    });

    scheduler.invalidate(new RectangleRange(0, 0, 10, 10));
    scheduler.invalidate(new RectangleRange(8, 0, 10, 10));
    scheduler.invalidate(new RectangleRange(18, 0, 2, 10));
    scheduler.flush();

    expect(flushed).toEqual([[new RectangleRange(0, 0, 20, 10)]]);
  });

  test("默认应在额外扫描面积可控时合并近邻矩形脏区", () => {
    const flushed = [];
    const scheduler = new RenderScheduler({
      flushHandler(dirtyRects) {
        flushed.push(dirtyRects);
      },
    });

    scheduler.invalidate(new RectangleRange(0, 0, 10, 10));
    scheduler.invalidate(new RectangleRange(14, 0, 10, 10));
    scheduler.flush();

    expect(flushed).toEqual([[new RectangleRange(0, 0, 24, 10)]]);
  });

  test("默认不应把额外扫描面积过大的远距矩形粗暴合并", () => {
    expect(
      mergeRectangleDirtyRects([
        new RectangleRange(0, 0, 10, 10),
        new RectangleRange(40, 0, 10, 10),
      ]),
    ).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(40, 0, 10, 10),
    ]);
  });

  test("可配置聚合器应在达到视口覆盖阈值时退化为整视口", () => {
    const mergeDirtyRects = createRectangleDirtyRectMerger({
      getViewportRect: () => new RectangleRange(0, 0, 100, 100),
      viewportCoverageRatio: 0.7,
    });

    expect(mergeDirtyRects([new RectangleRange(0, 0, 90, 80)])).toEqual([
      new RectangleRange(0, 0, 100, 100),
    ]);
  });

  test("可配置聚合器应在达到 chunk 覆盖阈值时退化为整 chunk", () => {
    const mergeDirtyRects = createRectangleDirtyRectMerger({
      getCanonicalRectsForRect: () => [new RectangleRange(0, 0, 50, 50)],
      canonicalRectCoverageRatio: 0.5,
    });

    expect(mergeDirtyRects([new RectangleRange(0, 0, 40, 40)])).toEqual([
      new RectangleRange(0, 0, 50, 50),
    ]);
  });

  test("可配置聚合器应支持通过 getThresholds 动态提供成组阈值", () => {
    let axisNearGap = 8;
    const mergeDirtyRects = createRectangleDirtyRectMerger({
      getThresholds: () => ({
        axisNearGap,
        diagonalNearGap: 4,
        maxExtraArea: 256,
        maxGrowthRatio: 1.35,
      }),
    });

    expect(
      mergeDirtyRects([
        new RectangleRange(0, 0, 10, 10),
        new RectangleRange(22, 0, 10, 10),
      ]),
    ).toEqual([
      new RectangleRange(0, 0, 10, 10),
      new RectangleRange(22, 0, 10, 10),
    ]);

    axisNearGap = 12;

    expect(
      mergeDirtyRects([
        new RectangleRange(0, 0, 10, 10),
        new RectangleRange(22, 0, 10, 10),
      ]),
    ).toEqual([new RectangleRange(0, 0, 32, 10)]);
  });
});