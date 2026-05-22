/**
 * @file 渲染调度器
 * @module core/components/render-scheduler
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../range/rectangle.js";
import { intersectsRanges } from "../range/geometry.js";

/**
 * 合并重叠或相接的矩形脏区
 * @param {any[]} dirtyRects - 原始脏区集合
 * @returns {any[]} 合并后的脏区集合
 */
function mergeRectangleDirtyRects(dirtyRects) {
  const mergedRects = [];
  const passthroughRects = [];

  for (const rect of dirtyRects) {
    const normalizedRect = RectangleRange.fromRectLike(rect);
    if (!normalizedRect) {
      passthroughRects.push(rect);
      continue;
    }

    let candidateRect = normalizedRect;
    let mergedIndex = 0;

    while (mergedIndex < mergedRects.length) {
      if (intersectsRanges(mergedRects[mergedIndex], candidateRect)) {
        candidateRect = mergedRects[mergedIndex].union(candidateRect);
        mergedRects.splice(mergedIndex, 1);
        mergedIndex = 0;
        continue;
      }
      mergedIndex++;
    }

    mergedRects.push(candidateRect);
  }

  return [...mergedRects, ...passthroughRects];
}

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
    this.mergeDirtyRects = options.mergeDirtyRects ?? mergeRectangleDirtyRects;
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

export { RenderScheduler, mergeRectangleDirtyRects };