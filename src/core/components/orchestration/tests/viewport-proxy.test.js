/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";

import { DevicesDAG } from "../../../devices-dag/index.js";
import {
  createNoopCanvas,
  createNoopCanvasContext2D,
  createNoopImageBitmap,
} from "../../../test-support/noop-canvas.js";
import { ViewportProxy } from "../viewport-proxy.js";

/**
 * 测试用假 Worker 端点
 * @class
 */
class FakeWorkerEndpoint {
  /**
   * @constructor
   */
  constructor() {
    this.postedMessages = [];
    this.listeners = new Map();
  }

  /**
   * 已发送消息列表
   * @type {Array<Object>}
   */
  postedMessages;

  /**
   * 监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners;

  /**
   * 注册消息监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   */
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
  }

  /**
   * 注销消息监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   */
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * 发送消息
   * @param {Object} message - 消息体
   */
  postMessage(message) {
    this.postedMessages.push(message);
  }

  /**
   * 注入一条来自 Worker 的消息
   * @param {Object} message - 消息体
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

/**
 * 安装测试用 requestAnimationFrame mock
 * @returns {{ flushNextFrame: () => void, restore: () => void }}
 */
function installMockAnimationFrame() {
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let nextId = 1;

  globalThis.requestAnimationFrame = (callback) => {
    const rafId = nextId;
    nextId += 1;
    callbacks.set(rafId, callback);
    return rafId;
  };
  globalThis.cancelAnimationFrame = (rafId) => {
    callbacks.delete(rafId);
  };

  return {
    flushNextFrame() {
      const firstEntry = callbacks.entries().next().value;
      if (!firstEntry) return;
      const [rafId, callback] = firstEntry;
      callbacks.delete(rafId);
      callback(0);
    },
    restore() {
      if (previousRequestAnimationFrame === undefined) {
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      }

      if (previousCancelAnimationFrame === undefined) {
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
      }
    },
  };
}

describe("ViewportProxy", () => {
  test("startWorkerSync 应发送初始 viewport-change 消息", () => {
    const { flushNextFrame, restore } = installMockAnimationFrame();
    const worker = new FakeWorkerEndpoint();
    const canvas = createNoopCanvas();
    const uiCanvas = createNoopCanvas();
    const board = {
      width: 800,
      height: 600,
      devicesDAG: new DevicesDAG(),
      getBoardApi() {
        return null;
      },
    };

    try {
      const viewport = new ViewportProxy(
        {
          rootElement: {},
          canvas,
          uiCanvas,
          worker,
        },
        board,
        { width: 800, height: 600 },
        "main",
      );

      viewport.startWorkerSync();
      flushNextFrame();

      expect(worker.postedMessages[0]).toEqual({
        type: "viewport-change",
        viewportId: "main",
        origin: { x: 0, y: 0 },
        zoom: 1,
        viewportSize: { width: 800, height: 600 },
        force: true,
      });

      viewport.destroy();
    } finally {
      restore();
    }
  });

  test("onRenderFrame 应将合成位图绘制到 canvas 并关闭位图", () => {
    const { restore } = installMockAnimationFrame();
    const context = {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    const worker = new FakeWorkerEndpoint();
    const canvas = createNoopCanvas({ context });
    const uiCanvas = createNoopCanvas();
    const board = {
      width: 800,
      height: 600,
      devicesDAG: new DevicesDAG(),
      getBoardApi() {
        return null;
      },
    };

    try {
      const viewport = new ViewportProxy(
        {
          rootElement: {},
          canvas,
          uiCanvas,
          worker,
        },
        board,
        { width: 800, height: 600 },
        "main",
      );
      const invalidateViewportSpy = jest.spyOn(
        viewport.uiRenderer,
        "invalidateViewport",
      );
      const liveBitmap = createNoopImageBitmap({ width: 800, height: 600 });

      viewport.onRenderFrame({
        viewportId: "main",
        liveBitmap,
      });

      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(context.drawImage).toHaveBeenCalledWith(liveBitmap, 0, 0);
      expect(liveBitmap.closed).toBe(true);
      expect(invalidateViewportSpy).toHaveBeenCalledTimes(1);

      viewport.destroy();
    } finally {
      restore();
    }
  });
});
