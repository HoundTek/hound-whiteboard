/**
 * @file 跨线程 Worker 测试辅助
 * @description 提供 UI ↔ Worker 通信测试所需的回环端点、DOM mock 与白板初始化辅助。
 * @module core/test-support/worker-mode-fixtures
 * @author Zhou Chenyu
 */

import { Board } from "../components/orchestration/board.js";
import { createCoreWorkerRuntime } from "../../core-worker.js";
import { createNoopCanvas, installNoopOffscreenCanvas } from "./noop-canvas.js";

/**
 * 回环消息端点
 * @class
 * @description
 * 在单进程测试中模拟 UI 线程与 Worker 线程之间的 postMessage 通道。
 * 一个端点的 postMessage 会直接投递到对端的 message 监听器。
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

/**
 * 创建跨线程白板测试上下文
 * @param {{
 *   boardWidth?: number,
 *   boardHeight?: number,
 *   viewportId?: string,
 *   viewportWidth?: number,
 *   viewportHeight?: number,
 *   createViewport?: boolean,
 * }} [options={}] - 初始化选项
 * @returns {Promise<{
 *   board: Board,
 *   viewport: import("../components/orchestration/viewport.js").Viewport | null,
 *   runtime: import("../../core-worker.js").CoreWorkerRuntime,
 *   uiEndpoint: LoopbackMessageEndpoint,
 *   workerHost: LoopbackMessageEndpoint,
 *   rootElement: Object,
 *   cleanup: Function,
 * }>} 测试上下文
 */
async function createWorkerBoardContext(options = {}) {
  const restoreOffscreenCanvas = installNoopOffscreenCanvas();
  const restoreAnimationFrame = installMockAnimationFrame();
  const restoreDocument = installMockDocument();
  const { uiEndpoint, workerHost } = createLoopbackWorkerPair();
  const board = new Board({
    width: options.boardWidth ?? 800,
    height: options.boardHeight ?? 600,
  });
  const enablePromise = board.enableWorkerMode(uiEndpoint);
  const runtime = createCoreWorkerRuntime(workerHost).start();
  await enablePromise;

  const rootElement = document.createElement("div");
  const shouldCreateViewport = options.createViewport !== false;
  const viewport = shouldCreateViewport
    ? board.createViewport(
        rootElement,
        {
          width: options.viewportWidth ?? options.boardWidth ?? 800,
          height: options.viewportHeight ?? options.boardHeight ?? 600,
        },
        options.viewportId ?? "main",
      )
    : null;
  await flushMicrotasks();

  /**
   * 释放测试上下文
   * @returns {void}
   */
  function cleanup() {
    viewport?.destroy?.();
    board.getBoardApi()?.destroy?.();
    runtime?.stop?.();
    restoreDocument();
    restoreAnimationFrame();
    restoreOffscreenCanvas();
  }

  return {
    board,
    viewport,
    runtime,
    uiEndpoint,
    workerHost,
    rootElement,
    cleanup,
  };
}

export {
  LoopbackMessageEndpoint,
  createLoopbackWorkerPair,
  installMockAnimationFrame,
  installMockDocument,
  flushMicrotasks,
  createWorkerBoardContext,
};
