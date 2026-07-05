/**
 * @jest-environment node
 */

import { createCoreWorkerRuntime } from "../../core-worker.js";
import { installNoopOffscreenCanvas } from "../test-support/noop-canvas.js";

/**
 * 测试用假 Worker 宿主
 * @class
 */
class FakeWorkerHost {
  /**
   * @constructor
   */
  constructor() {
    this.postedMessages = [];
    this.postedTransfers = [];
    this.listeners = new Map();
  }

  /**
   * 已发送消息列表
   * @type {Array<Object>}
   */
  postedMessages;

  /**
   * 事件监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners;

  /**
   * 已发送消息的 transferList 列表
   * @type {Array<Transferable[]>}
   */
  postedTransfers;

  /**
   * 注册事件监听器
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
   * 取消事件监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   * @returns {void}
   */
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * 发送消息
   * @param {Object} message - 消息体
   * @returns {void}
   */
  postMessage(message, transferList = []) {
    this.postedMessages.push(message);
    this.postedTransfers.push(transferList);
  }

  /**
   * 向 runtime 注入一条消息
   * @param {Object} message - 消息体
   * @returns {void}
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

describe("core-worker", () => {
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

  test("runtime.start 应发送 ready 消息", () => {
    const host = new FakeWorkerHost();
    const runtime = createCoreWorkerRuntime(host);

    runtime.start();

    expect(host.postedMessages[0]).toEqual({ type: "ready" });
    runtime.stop();
  });

  test("应能通过 rpc 创建 BoardCore 并创建对象", async () => {
    const host = new FakeWorkerHost();
    const runtime = createCoreWorkerRuntime(host).start();

    host.emit({
      type: "rpc",
      msgId: "create-board",
      method: "createBoard",
      params: { width: 10, height: 10 },
    });
    await Promise.resolve();

    expect(host.postedMessages).toContainEqual({
      type: "rpc-response",
      msgId: "create-board",
      result: { ok: true },
    });

    host.emit({
      type: "rpc",
      msgId: "create-object",
      method: "createObject",
      params: {
        type: "CircleObject",
        props: {
          id: 8,
          position: { x: 2, y: 3 },
          data: { radius: 0 },
        },
      },
    });
    await Promise.resolve();

    expect(host.postedMessages).toContainEqual({
      type: "rpc-response",
      msgId: "create-object",
      result: 8,
    });

    host.emit({
      type: "rpc",
      msgId: "query-objects",
      method: "queryObjects",
      params: { ids: [8] },
    });
    await Promise.resolve();

    expect(host.postedMessages).toContainEqual(
      expect.objectContaining({
        type: "rpc-response",
        msgId: "query-objects",
        result: [
          expect.objectContaining({
            id: 8,
            type: "CircleObject",
            isActive: true,
            position: { x: 2, y: 3 },
          }),
        ],
      }),
    );

    runtime.stop();
  });

  test("应能创建 MonitorCore 并通过 render flush 输出 render-frame", async () => {
    const host = new FakeWorkerHost();
    const runtime = createCoreWorkerRuntime(host).start();

    host.emit({
      type: "rpc",
      msgId: "create-board",
      method: "createBoard",
      params: { width: 800, height: 600 },
    });
    await Promise.resolve();

    host.emit({
      type: "rpc",
      msgId: "create-monitor",
      method: "createMonitor",
      params: {
        options: {
          monitorId: "main",
          width: 400,
          height: 300,
        },
      },
    });
    await Promise.resolve();

    expect(host.postedMessages).toContainEqual({
      type: "rpc-response",
      msgId: "create-monitor",
      result: undefined,
    });

    host.emit({
      type: "viewport-change",
      monitorId: "main",
      origin: { x: 10, y: 20 },
      zoom: 1.5,
      viewportSize: { width: 400, height: 300 },
    });
    host.emit({
      type: "request-render-flush",
      monitorId: "main",
    });
    await Promise.resolve();

    const renderFrameIndex = host.postedMessages.findIndex(
      (message) => message?.type === "render-frame",
    );

    expect(renderFrameIndex).toBeGreaterThanOrEqual(0);
    expect(host.postedMessages[renderFrameIndex]).toEqual(
      expect.objectContaining({
        type: "render-frame",
        monitorId: "main",
        frameId: 1,
        liveBitmap: expect.any(Object),
      }),
    );
    expect(host.postedTransfers[renderFrameIndex]).toHaveLength(1);

    runtime.stop();
  });

  test("force viewport-change 在视口参数未变化时仍应触发新帧", async () => {
    const host = new FakeWorkerHost();
    const runtime = createCoreWorkerRuntime(host).start();

    host.emit({
      type: "rpc",
      msgId: "create-board",
      method: "createBoard",
      params: { width: 800, height: 600 },
    });
    await Promise.resolve();

    host.emit({
      type: "rpc",
      msgId: "create-monitor",
      method: "createMonitor",
      params: {
        options: {
          monitorId: "main",
          width: 400,
          height: 300,
        },
      },
    });
    await Promise.resolve();

    host.emit({
      type: "viewport-change",
      monitorId: "main",
      origin: { x: 10, y: 20 },
      zoom: 1.5,
      viewportSize: { width: 400, height: 300 },
    });
    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    host.emit({
      type: "viewport-change",
      monitorId: "main",
      origin: { x: 10, y: 20 },
      zoom: 1.5,
      force: true,
    });
    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    const renderFrames = host.postedMessages.filter(
      (message) => message?.type === "render-frame",
    );

    expect(renderFrames).toHaveLength(2);
    expect(renderFrames[1]).toEqual(
      expect.objectContaining({
        type: "render-frame",
        monitorId: "main",
        frameId: 2,
      }),
    );

    runtime.stop();
  });

  test("modifyObject / appendListItem / replaceListItem RPC 应触发 live 渲染失效", async () => {
    const host = new FakeWorkerHost();
    const runtime = createCoreWorkerRuntime(host).start();

    host.emit({
      type: "rpc",
      msgId: "create-board",
      method: "createBoard",
      params: { width: 800, height: 600 },
    });
    await Promise.resolve();

    host.emit({
      type: "rpc",
      msgId: "create-monitor",
      method: "createMonitor",
      params: {
        options: { monitorId: "main", width: 400, height: 300 },
      },
    });
    await Promise.resolve();

    // 创建对象并产生初始帧
    host.emit({
      type: "rpc",
      msgId: "create-object",
      method: "createObject",
      params: {
        type: "CircleObject",
        props: { id: 100, position: { x: 10, y: 20 }, data: { radius: 5 } },
      },
    });
    await Promise.resolve();

    host.emit({
      type: "viewport-change",
      monitorId: "main",
      origin: { x: 0, y: 0 },
      zoom: 1,
      viewportSize: { width: 400, height: 300 },
      force: true,
    });
    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    expect(
      host.postedMessages.filter((m) => m?.type === "render-frame"),
    ).toHaveLength(1);

    // modifyObject 应让下一帧变为 dirty
    host.emit({
      type: "rpc",
      msgId: "modify-obj",
      method: "modifyObject",
      params: {
        objectId: 100,
        patch: { position: { x: 30, y: 40 } },
      },
    });
    await Promise.resolve();

    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    const renderFrames = host.postedMessages.filter(
      (m) => m?.type === "render-frame",
    );
    expect(renderFrames).toHaveLength(2);
    expect(renderFrames[1]).toEqual(
      expect.objectContaining({ type: "render-frame", frameId: 2 }),
    );

    // appendListItem 也应触发新帧
    host.emit({
      type: "rpc",
      msgId: "append-pt",
      method: "appendListItem",
      params: { objectId: 100, key: "points", items: [{ x: 1, y: 2 }] },
    });
    await Promise.resolve();

    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    expect(
      host.postedMessages.filter((m) => m?.type === "render-frame"),
    ).toHaveLength(3);

    // replaceListItem 也应触发新帧
    host.emit({
      type: "rpc",
      msgId: "replace-pt",
      method: "replaceListItem",
      params: { objectId: 100, key: "points", index: 0, item: { x: 5, y: 6 } },
    });
    await Promise.resolve();

    host.emit({ type: "request-render-flush", monitorId: "main" });
    await Promise.resolve();

    expect(
      host.postedMessages.filter((m) => m?.type === "render-frame"),
    ).toHaveLength(4);

    runtime.stop();
  });
});
