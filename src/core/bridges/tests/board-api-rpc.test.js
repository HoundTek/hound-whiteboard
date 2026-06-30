import { jest } from "@jest/globals";

import { BoardApiRpc } from "../board-api.js";

/**
 * 测试用假 RPC 端点
 * @class
 */
class FakeRpcEndpoint {
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
   * 向端点注入一条消息
   * @param {Object} message - 要注入的消息
   * @returns {void}
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

describe("BoardApiRpc", () => {
  test("waitUntilReady 应在收到 ready 消息后 resolve", async () => {
    const endpoint = new FakeRpcEndpoint();
    const boardApi = new BoardApiRpc(endpoint);

    const readyPromise = boardApi.waitUntilReady();
    endpoint.emit({ type: "ready" });

    await expect(readyPromise).resolves.toBeUndefined();
    expect(boardApi.isReady()).toBe(true);

    boardApi.destroy();
  });

  test("createObject 应发送 rpc 请求并在收到 rpc-response 后 resolve", async () => {
    const endpoint = new FakeRpcEndpoint();
    const boardApi = new BoardApiRpc(endpoint);

    const createPromise = boardApi.createObject("StrokeObject", {
      id: 7,
      position: { x: 1, y: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });

    expect(endpoint.postedMessages).toHaveLength(1);
    expect(endpoint.postedMessages[0]).toEqual(
      expect.objectContaining({
        type: "rpc",
        method: "createObject",
        params: {
          type: "StrokeObject",
          props: {
            id: 7,
            position: { x: 1, y: 2 },
            data: { points: [{ x: 0, y: 0 }] },
          },
        },
      }),
    );

    endpoint.emit({
      type: "rpc-response",
      msgId: endpoint.postedMessages[0].msgId,
      result: 7,
    });

    await expect(createPromise).resolves.toBe(7);

    boardApi.destroy();
  });

  test("destroy 应拒绝所有 pending 请求", async () => {
    const endpoint = new FakeRpcEndpoint();
    const boardApi = new BoardApiRpc(endpoint);

    const queryPromise = boardApi.queryObjects([1, 2, 3]);
    boardApi.destroy();

    await expect(queryPromise).rejects.toThrow("BoardApiRpc destroyed.");
  });
});
