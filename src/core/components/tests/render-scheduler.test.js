import { RectangleRange } from "../../range/rectangle.js";
import { RenderScheduler } from "../render-scheduler.js";

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
});