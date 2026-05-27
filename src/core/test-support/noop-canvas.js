/**
 * @file 测试用空实现 canvas/context
 * @description 提供单元测试中使用的空 canvas/context 接口实现。
 * @module core/test-support/noop-canvas
 * @author Zhou Chenyu
 */

/**
 * 创建一个空实现的 CanvasRenderingContext2D 对象
 * @returns {CanvasRenderingContext2D}
 */
function createNoopCanvasContext2D() {
  return {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    fillRect() {},
    strokeRect() {},
    arc() {},
    fillText() {},
    measureText() {
      return { width: 0 };
    },
  };
}

/**
 * 创建一个空实现的 HTMLCanvasElement 对象
 * @param {{width?: number, height?: number, id?: string, context?: CanvasRenderingContext2D}} [options={}] - 画布选项
 * @returns {HTMLCanvasElement}
 */
function createNoopCanvas(options = {}) {
  const context = options.context ?? createNoopCanvasContext2D();
  const canvas = {
    width: Number.isFinite(options.width) ? options.width : 800,
    height: Number.isFinite(options.height) ? options.height : 600,
    id: options.id ?? "",
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: canvas.width,
        height: canvas.height,
      };
    },
    getContext() {
      return context;
    },
  };

  return canvas;
}

export { createNoopCanvas, createNoopCanvasContext2D };
