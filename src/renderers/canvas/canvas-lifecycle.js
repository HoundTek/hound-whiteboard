/**
 * @file 画布生命周期管理器
 * @description 提供画布引用、尺寸管理、渲染调度器初始化的通用组合基类。
 * @module canvas/canvas-lifecycle
 * @author Zhou Chenyu
 */

import { RenderScheduler } from "./render-scheduler.js";

/**
 * 将画布尺寸归一化为非负整数
 * @description
 * canvas 的 width / height 属性是无符号长整型，赋值小数会被截断。
 * 若用原始小数参与“尺寸是否变化”的比较，比较永远不成立，
 * 每次同步都会重新赋值并因此重置（清空）画布内容。
 * @param {number} size - 原始尺寸
 * @returns {number} 可用于比较与赋值的整数尺寸
 */
function normalizeCanvasSize(size) {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.round(size);
}

/**
 * 归一化设备像素倍率
 * @description 限制在 [1, 8] 内，避免异常 DPR 分配出超大位图。
 * @param {number} [ratio] - 原始倍率
 * @returns {number} 可用的倍率
 */
function normalizeDeviceScale(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(8, Math.max(1, ratio));
}

/**
 * 画布生命周期管理器
 * @description
 * 封装渲染器所需的画布引用持有、尺寸变更、失效请求与调度器生命周期的通用逻辑。
 * 不涉及具体绘制逻辑（对象渲染 / overlay 绘制），子类通过组合或继承复用。
 * @class
 * @author Zhou Chenyu
 */
class CanvasHost {
  /**
   * 绑定的视口
   * @type {import("../../kernel/types/types.js").ViewportLike}
   */
  viewport;

  /**
   * 目标渲染层画布
   * @type {HTMLCanvasElement | null}
   * @protected
   */
  _canvas;

  /**
   * 渲染调度器
   * @type {RenderScheduler | null}
   * @protected
   */
  _scheduler;

  /**
   * 位图像素相对 CSS 像素的倍率
   * @description
   * 高分屏下位图尺寸应为 CSS 尺寸的 DPR 倍，否则浏览器会把整块画布放大，
   * 笔画边缘发虚、细节丢失。所有绘制坐标仍以 CSS 像素表达，
   * 由上下文上的 `setTransform` 统一乘上本倍率。
   * @type {number}
   * @protected
   */
  _deviceScale;

  /**
   * @param {import("../../kernel/types/types.js").ViewportLike} viewport - 目标视口
   * @param {{ canvas?: HTMLCanvasElement | null }} [options={}] - 初始化选项
   */
  constructor(viewport, options = {}) {
    this.viewport = viewport;
    this._canvas = options.canvas ?? null;
    this._deviceScale = normalizeDeviceScale(options.devicePixelRatio);
    this._scheduler = null;
  }

  /**
   * 目标渲染层画布
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this._canvas;
  }

  /**
   * 获取目标渲染层的 2D 上下文
   * @returns {CanvasRenderingContext2D | null}
   * @protected
   */
  _getContext() {
    return this._canvas?.getContext?.("2d") ?? null;
  }

  /**
   * 初始化渲染调度器
   * @description 子类在完成自身构造后调用，确保 merge 策略和 flushHandler 已就位。
   * @param {(dirtyRects: any[]) => any[]} mergeDirtyRects - 脏区合并函数
   * @param {(dirtyRects: any[]) => any} flushHandler - 刷新执行函数
   * @protected
   */
  _initScheduler(mergeDirtyRects, flushHandler) {
    this._scheduler = new RenderScheduler({
      mergeDirtyRects,
      flushHandler,
    });
  }

  /**
   * 提交一次失效请求
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    if (!this._scheduler) return false;
    return this._scheduler.invalidate(rect);
  }

  /**
   * 失效整个视口
   */
  invalidateViewport() {
    const viewportRect = this.viewport?.getViewportScreenRect?.();
    if (viewportRect?.width > 0 && viewportRect?.height > 0) {
      this.invalidate(viewportRect);
    }
  }

  /**
   * 调整画布尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @returns {boolean} 是否发生了尺寸变化
   */
  resize(width, height) {
    const canvas = this._canvas;
    if (!canvas) return false;
    // 入参是 CSS 尺寸，位图按设备倍率放大；尺寸未变时返回 false 以免重置画布内容
    const nextWidth = normalizeCanvasSize(
      normalizeCanvasSize(width) * this._deviceScale,
    );
    const nextHeight = normalizeCanvasSize(
      normalizeCanvasSize(height) * this._deviceScale,
    );
    if (canvas.width === nextWidth && canvas.height === nextHeight)
      return false;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    return true;
  }

  /**
   * 设置设备像素倍率
   * @description 倍率变化后需再调一次 resize 才会按新倍率换算位图尺寸。
   * @param {number} devicePixelRatio - 新倍率
   * @returns {void}
   */
  setDevicePixelRatio(devicePixelRatio) {
    this._deviceScale = normalizeDeviceScale(devicePixelRatio);
  }

  /**
   * 当前设备像素倍率
   * @type {number}
   */
  get deviceScale() {
    return this._deviceScale;
  }
}

export { CanvasHost, normalizeCanvasSize, normalizeDeviceScale };
