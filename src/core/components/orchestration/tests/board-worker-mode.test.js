/**
 * @jest-environment node
 */

import { createNoopCanvas } from "../../../test-support/noop-canvas.js";
import { Board } from "../board.js";
import { MonitorProxy } from "../monitor-proxy.js";

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

    if (message?.type === "rpc" && message?.method === "createBoard") {
      this.emit({
        type: "rpc-response",
        msgId: message.msgId,
        result: { ok: true },
      });
    }
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
 * @returns {Function} 恢复函数
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

  return () => {
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
  };
}

/**
 * 安装测试用 document mock
 * @returns {Function} 恢复函数
 */
function installMockDocument() {
  const previousDocument = globalThis.document;

  /**
   * 创建简化 DOM 元素
   * @param {string} tagName - 标签名
   * @returns {Object}
   */
  function createMockElement(tagName) {
    if (tagName === "canvas") {
      const canvas = createNoopCanvas();
      canvas.className = "";
      canvas.style = {};
      canvas.appendChild = () => {};
      return canvas;
    }

    return {
      tagName,
      id: "",
      className: "",
      style: {},
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
  }

  globalThis.document = {
    createElement(tagName) {
      return createMockElement(tagName);
    },
  };

  return () => {
    if (previousDocument === undefined) {
      delete globalThis.document;
      return;
    }
    globalThis.document = previousDocument;
  };
}

describe("Board worker mode", () => {
  test("enableWorkerMode 后 createMonitor 应返回 MonitorProxy 并发送 createMonitor RPC", async () => {
    const restoreAnimationFrame = installMockAnimationFrame();
    const restoreDocument = installMockDocument();
    const board = new Board({ width: 800, height: 600 });
    const worker = new FakeWorkerEndpoint();
    let monitor = null;

    try {
      const enablePromise = board.enableWorkerMode(worker);
      worker.emit({ type: "ready" });
      await enablePromise;

      const rootElement = document.createElement("div");
      monitor = board.createMonitor(
        rootElement,
        { width: 400, height: 300 },
        "main",
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(monitor).toBeInstanceOf(MonitorProxy);
      expect(worker.postedMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "rpc",
            method: "createBoard",
            params: {
              width: 800,
              height: 600,
              rootPath: undefined,
            },
          }),
          expect.objectContaining({
            type: "rpc",
            method: "createMonitor",
            params: {
              options: {
                monitorId: "main",
                width: 400,
                height: 300,
              },
            },
          }),
        ]),
      );

      const createMonitorRequest = worker.postedMessages.find(
        (message) =>
          message?.type === "rpc" && message?.method === "createMonitor",
      );
      worker.emit({
        type: "rpc-response",
        msgId: createMonitorRequest?.msgId,
        result: undefined,
      });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      monitor?.destroy?.();
      board.getBoardApi()?.destroy?.();
      restoreDocument();
      restoreAnimationFrame();
    }
  });
});
