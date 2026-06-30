/**
 * @jest-environment node
 */

import { createCoreWorkerRuntime } from "../../core-worker.js";

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
  postMessage(message) {
    this.postedMessages.push(message);
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
});
