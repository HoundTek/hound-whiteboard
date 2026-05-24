/**
 * @file 测试用空实现 canvas/context
 * @module core/test-support/noop-canvas
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
