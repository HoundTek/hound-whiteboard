/**
 * @jest-environment node
 */

import { Board } from "../../../ui/components/orchestration/board.js";
import { Viewport } from "../../../ui/components/orchestration/viewport.js";
import { createCoreWorkerRuntime } from "../../../host/core-worker.js";
import {
  createNoopCanvas,
  installNoopOffscreenCanvas,
} from "../../../test-support/noop-canvas.js";
import { Vector } from "../../../kernel/utils/math.js";
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
      canvas.appendChild = () => { };
      canvas.tabIndex = -1;
      canvas.focus = () => { };
      canvas.addEventListener = () => { };
      canvas.removeEventListener = () => { };
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
      expect(primaryStrokeTool._entry.id).toBe("1");

      // object 在 commit 前不在 Worker 侧
      const summaries = await board.getBoardApi().queryObjectDetails(["1"]);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: "1",
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

      await expect(board.getBoardApi().queryObjects(["1"])).resolves.toEqual([
        expect.objectContaining({
          id: "1",
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

  test("按住右键时多次左键长按应各自提交独立笔画，且不干扰右键框选", async () => {
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

      const { primaryStrokeTool, secondarySelectionTool } =
        configureWhiteboardDemo(board, viewport);
      mountPrimaryStrokeTool(viewport, primaryStrokeTool);

      /**
       * 构造 position 信号
       * @param {number} x - x 坐标
       * @param {number} y - y 坐标
       * @param {Object} extras - 附加上下文（button/buttons）
       * @returns {Object}
       */
      const pos = (x, y, extras) => ({
        type: "position",
        context: { value: new Vector(x, y), ...extras },
      });

      /**
       * 构造 end 信号
       * @param {number} button - 松开的按钮
       * @param {number} buttons - 松开后仍按住的按钮位掩码
       * @returns {Object}
       */
      const end = (button, buttons) => ({
        type: "end",
        context: { button, buttons },
      });

      /**
       * 向鼠标设备分发信号
       * @param {Array<Object>} signals - 信号列表
       * @returns {void}
       */
      const emit = (signals) =>
        board.signalsEventBus.emit("input", { to: "/main/mouse", signals });

      // 右键按下并拖动（开始框选，全程按住）
      emit([pos(1, 1, { button: 2, buttons: 2 })]);
      emit([pos(5, 5, { button: 2, buttons: 2 })]);

      // 第一笔：左键按下 → 拖动 → 松开（右键仍按住）
      emit([pos(10, 10, { button: 0, buttons: 3 })]);
      emit([pos(20, 20, { button: 0, buttons: 3 })]);
      emit([end(0, 2)]);
      await flushMicrotasks();

      // 第二笔：再次左键按下 → 拖动 → 松开
      emit([pos(50, 50, { button: 0, buttons: 3 })]);
      emit([pos(60, 60, { button: 0, buttons: 3 })]);
      emit([end(0, 2)]);
      await flushMicrotasks();

      // 两次左键应各自提交独立笔画对象
      const strokes = await board.getBoardApi().queryObjects(["1", "2"]);
      expect(strokes).toHaveLength(2);
      expect(strokes[0]).toMatchObject({
        id: "1",
        isActive: false,
        position: { x: 10, y: 10 },
      });
      expect(strokes[1]).toMatchObject({
        id: "2",
        isActive: false,
        position: { x: 50, y: 50 },
      });

      // 右键框选手势未被左键的 end 提前终结：继续拖动并松右键后，
      // 框选矩形应覆盖完整轨迹 (1,1)→(70,70)，同时选中两笔
      emit([pos(70, 70, { button: 2, buttons: 2 })]);
      emit([end(2, 0)]);
      await flushMicrotasks();

      expect(secondarySelectionTool._selectedObjects).toHaveLength(2);
      expect(
        viewport.devicesDAG.getNode("/main/workflows/secondary-chooser")
          ?.state,
      ).toMatchObject({ phase: "second" });
    } finally {
      viewport?.destroy?.();
      board.getBoardApi()?.destroy?.();
      runtime?.stop?.();
      restoreDocument();
      restoreAnimationFrame();
    }
  });
});
