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
    ellipse() {},
    drawImage() {},
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

/**
 * 创建一个空实现的 ImageBitmap 对象
 * @param {{ width?: number, height?: number }} [options={}] - 位图选项
 * @returns {ImageBitmap}
 */
function createNoopImageBitmap(options = {}) {
  const imageBitmap = {
    width: Number.isFinite(options.width) ? options.width : 0,
    height: Number.isFinite(options.height) ? options.height : 0,
    closed: false,
    close() {
      imageBitmap.closed = true;
    },
  };

  return imageBitmap;
}

/**
 * 创建一个空实现的 OffscreenCanvas 对象
 * @param {{width?: number, height?: number, context?: CanvasRenderingContext2D}} [options={}] - 画布选项
 * @returns {OffscreenCanvas}
 */
function createNoopOffscreenCanvas(options = {}) {
  const context = options.context ?? createNoopCanvasContext2D();
  const canvas = {
    width: Number.isFinite(options.width) ? options.width : 800,
    height: Number.isFinite(options.height) ? options.height : 600,
    getContext() {
      return context;
    },
    transferToImageBitmap() {
      return createNoopImageBitmap({
        width: canvas.width,
        height: canvas.height,
      });
    },
  };

  return canvas;
}

/**
 * 为测试环境安装空实现 OffscreenCanvas 构造器
 * @param {Record<string, any>} [globalObject=globalThis] - 目标全局对象
 * @returns {Function} 用于恢复先前 OffscreenCanvas 的清理函数
 */
function installNoopOffscreenCanvas(globalObject = globalThis) {
  const previousOffscreenCanvas = globalObject?.OffscreenCanvas;

  /**
   * 测试用 OffscreenCanvas 构造器
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @returns {OffscreenCanvas}
   */
  function NoopOffscreenCanvas(width, height) {
    return createNoopOffscreenCanvas({ width, height });
  }

  globalObject.OffscreenCanvas = NoopOffscreenCanvas;

  return () => {
    if (previousOffscreenCanvas === undefined) {
      delete globalObject.OffscreenCanvas;
      return;
    }
    globalObject.OffscreenCanvas = previousOffscreenCanvas;
  };
}

export {
  createNoopCanvas,
  createNoopCanvasContext2D,
  createNoopImageBitmap,
  createNoopOffscreenCanvas,
  installNoopOffscreenCanvas,
};
