/**
 * @jest-environment node
 */

import { Board } from "../../../core/ui-thread/components/orchestration/board.js";
import { Viewport } from "../../../core/ui-thread/components/orchestration/viewport.js";
import { createCoreWorkerRuntime } from "../../../core/engine/core-worker.js";
import {
  createNoopCanvas,
  installNoopOffscreenCanvas,
} from "../../../core/test-support/noop-canvas.js";
import { Vector } from "../../../core/engine/utils/math.js";
import {
  configureWhiteboardDemo,
  DEMO_PRIMARY_STROKE_COLOR,
  mountPrimaryStrokeTool,
} from "../whiteboard-demo.js";

/**
 * 回环消息端点
 * @class
 */
class LoopbackMessageEndpoint {
  /**
   * 已发送消息列表
   * @type {Array<Object>}
   */
  postedMessages;

  /**
   * 消息监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners;

  /**
   * 对端端点
   * @type {LoopbackMessageEndpoint | null}
   */
  peer;

  /**
   * @constructor
   */
  constructor() {
    this.postedMessages = [];
    this.listeners = new Map();
    this.peer = null;
  }

  /**
   * 注册消息监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   * @returns {void}
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
   * @returns {void}
   */
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * 发送消息到对端
   * @param {Object} message - 消息体
   * @param {Transferable[]} [transferList=[]] - transferList
   * @returns {void}
   */
  postMessage(message, transferList = []) {
    this.postedMessages.push(message);
    this.peer?.emit(message, transferList);
  }

  /**
   * 注入一条来自对端的消息
   * @param {Object} message - 消息体
   * @returns {void}
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

/**
 * 创建一对回环 Worker 端点
 * @returns {{ uiEndpoint: LoopbackMessageEndpoint, workerHost: LoopbackMessageEndpoint }} 端点对
 */
function createLoopbackWorkerPair() {
  const uiEndpoint = new LoopbackMessageEndpoint();
  const workerHost = new LoopbackMessageEndpoint();
  uiEndpoint.peer = workerHost;
  workerHost.peer = uiEndpoint;
  return { uiEndpoint, workerHost };
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
    callbacks.clear();

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
      canvas.tabIndex = -1;
      canvas.focus = () => {};
      canvas.addEventListener = () => {};
      canvas.removeEventListener = () => {};
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

/**
 * 连续冲刷若干轮微任务队列
 * @param {number} [count=6] - 冲刷轮数
 * @returns {Promise<void>}
 */
async function flushMicrotasks(_count = 6) {
  await new Promise((r) => setTimeout(r, 0));
}

describe("whiteboard demo worker mode", () => {
  /**
   * OffscreenCanvas 恢复函数
   * @type {Function | null}
   */
  let restoreOffscreenCanvas = null;

  beforeEach(() => {
    restoreOffscreenCanvas = installNoopOffscreenCanvas();
  });

  afterEach(() => {
    restoreOffscreenCanvas?.();
    restoreOffscreenCanvas = null;
  });

  test("demo 配置在 Worker mode 下应能创建并提交红色笔画", async () => {
    const restoreAnimationFrame = installMockAnimationFrame();
    const restoreDocument = installMockDocument();
    const { uiEndpoint, workerHost } = createLoopbackWorkerPair();
    const board = new Board({ width: 800, height: 600 });
    let runtime = null;
    let viewport = null;

    try {
      const enablePromise = board.enableWorkerMode(uiEndpoint);
      runtime = createCoreWorkerRuntime(workerHost).start();
      await enablePromise;

      const rootElement = document.createElement("div");
      viewport = board.createViewport(
        rootElement,
        { width: 800, height: 600 },
        "main",
      );
      await flushMicrotasks();

      expect(viewport).toBeInstanceOf(Viewport);

      const { primaryStrokeTool } = configureWhiteboardDemo(board, viewport);
      mountPrimaryStrokeTool(viewport, primaryStrokeTool);

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(10, 20),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(20, 30),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "end",
            context: {
              buttons: 0,
              button: 0,
            },
          },
        ],
      });
      await flushMicrotasks();

      expect(primaryStrokeTool._entry).toBeDefined();
      expect(primaryStrokeTool._entry.id).toBe(1);

      // object 在 commit 前不在 Worker 侧
      const summaries = await board.getBoardApi().queryObjects([1]);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: 1,
        isActive: false,
        position: { x: 10, y: 20 },
        property: {
          color: DEMO_PRIMARY_STROKE_COLOR,
          width: 2,
        },
        data: {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      });
    } finally {
      viewport?.destroy?.();
      board.getBoardApi()?.destroy?.();
      runtime?.stop?.();
      restoreDocument();
      restoreAnimationFrame();
    }
  });

  test("demo 配置在 Worker mode 下应支持 chooser → modifier 修改已有对象", async () => {
    const restoreAnimationFrame = installMockAnimationFrame();
    const restoreDocument = installMockDocument();
    const { uiEndpoint, workerHost } = createLoopbackWorkerPair();
    const board = new Board({ width: 800, height: 600 });
    let runtime = null;
    let viewport = null;

    try {
      const enablePromise = board.enableWorkerMode(uiEndpoint);
      runtime = createCoreWorkerRuntime(workerHost).start();
      await enablePromise;

      const rootElement = document.createElement("div");
      viewport = board.createViewport(
        rootElement,
        { width: 800, height: 600 },
        "main",
      );
      await flushMicrotasks();

      const { primaryStrokeTool } = configureWhiteboardDemo(board, viewport);
      mountPrimaryStrokeTool(viewport, primaryStrokeTool);

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(10, 20),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(20, 30),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "end",
            context: {
              buttons: 0,
              button: 0,
            },
          },
        ],
      });
      await flushMicrotasks();

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(10, 20),
              buttons: 2,
              button: 2,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(20, 30),
              buttons: 2,
              button: 2,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "end",
            context: {
              buttons: 0,
              button: 2,
            },
          },
        ],
      });
      await flushMicrotasks();

      expect(
        viewport.devicesDAG.getNode("/main/workflows/secondary-chooser")?.state,
      ).toMatchObject({
        phase: "second",
        activeChild: "second",
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(15, 25),
              buttons: 2,
              button: 2,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(25, 30),
              buttons: 2,
              button: 2,
            },
          },
        ],
      });
      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "end",
            context: {
              buttons: 0,
              button: 2,
            },
          },
        ],
      });
      await flushMicrotasks();

      await expect(board.getBoardApi().queryObjects([1])).resolves.toEqual([
        expect.objectContaining({
          id: 1,
          position: { x: 20, y: 25 },
        }),
      ]);
    } finally {
      viewport?.destroy?.();
      board.getBoardApi()?.destroy?.();
      runtime?.stop?.();
      restoreDocument();
      restoreAnimationFrame();
    }
  });
});
