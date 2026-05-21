/**
 * @file 渲染调度器
 * @module core/components/render-scheduler
 * @author Zhou Chenyu
 */

/**
 * 渲染调度器
 * @description 将多次失效请求合并到单帧 flush 中执行。
 * @class
 * @author Zhou Chenyu
 */
class RenderScheduler {
  /**
   * 是否已有待执行帧
   * @type {boolean}
   */
  framePending;

  /**
   * 当前积累的脏区
   * @type {any[]}
   */
  dirtyRects;

  /**
   * 帧调度函数
   * @type {(callback: FrameRequestCallback) => number | unknown}
   */
  scheduleFrame;

  /**
   * 脏区合并函数
   * @type {(dirtyRects: any[]) => any[]}
   */
  mergeDirtyRects;

  /**
   * flush 时执行的处理器
   * @type {(dirtyRects: any[]) => unknown}
   */
  flushHandler;

  /**
   * @param {{
   *   scheduleFrame?: (callback: FrameRequestCallback) => number | unknown,
   *   mergeDirtyRects?: (dirtyRects: any[]) => any[],
   *   flushHandler?: (dirtyRects: any[]) => unknown,
   * }} [options] - 调度选项
   */
  constructor(options = {}) {
    this.framePending = false;
    this.dirtyRects = [];
    this.scheduleFrame =
      options.scheduleFrame ??
      ((callback) => {
        if (typeof globalThis.requestAnimationFrame === "function") {
          return globalThis.requestAnimationFrame(callback);
        }
        return globalThis.setTimeout(() => callback(Date.now()), 16);
      });
    this.mergeDirtyRects = options.mergeDirtyRects ?? ((dirtyRects) => dirtyRects);
    this.flushHandler = options.flushHandler ?? (() => {});
  }

  /**
   * 设置 flush 处理器
   * @param {(dirtyRects: any[]) => unknown} flushHandler - flush 回调
   */
  setFlushHandler(flushHandler) {
    this.flushHandler = flushHandler ?? (() => {});
  }

  /**
   * 提交一次失效请求
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    if (rect !== undefined) {
      this.dirtyRects.push(rect);
    }

    if (this.framePending) {
      return false;
    }

    this.framePending = true;
    this.scheduleFrame(() => this.flush());
    return true;
  }

  /**
   * 清空积压脏区
   */
  clear() {
    this.dirtyRects.length = 0;
  }

  /**
   * 立即执行一次 flush
   * @returns {unknown}
   */
  flush() {
    const mergedRects = this.mergeDirtyRects([...this.dirtyRects]);
    this.framePending = false;
    this.dirtyRects.length = 0;
    return this.flushHandler(mergedRects);
  }
}

export { RenderScheduler };