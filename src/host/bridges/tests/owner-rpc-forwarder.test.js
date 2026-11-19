/**
 * @file owner RPC 转发器测试
 * @description 验证 Tauri 事件到 worker 请求、worker 响应到 Rust command 的往返与卸接。
 * @module host/bridges/tests/owner-rpc-forwarder.test
 * @author Zhou Chenyu
 */

import { attachOwnerRpcForwarder } from "../owner-rpc-forwarder.js";

/**
 * 测试用 worker 端点
 * @class
 */
class FakeEndpoint {
  /**
   * 已发送消息
   * @type {Object[]}
   */
  postedMessages = [];

  /**
   * 事件监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners = new Map();

  /**
   * 注册监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   * @returns {void}
   */
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  /**
   * 注销监听器
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
   * 向端点注入 worker 消息
   * @param {Object} message - 消息体
   * @returns {void}
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

describe("owner RPC 转发器", () => {
  test("Tauri 事件转给 worker，worker 响应回传 Rust", async () => {
    const endpoint = new FakeEndpoint();
    const invokes = [];
    let eventHandler = null;
    let unlistenCalled = false;
    const detach = attachOwnerRpcForwarder(endpoint, {
      listen: async (event, handler) => {
        expect(event).toBe("owner-rpc-request");
        eventHandler = handler;
        return () => {
          unlistenCalled = true;
        };
      },
      invoke: async (command, args) => {
        invokes.push({ command, args });
        return undefined;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventHandler({
      payload: { requestId: "r1", route: "addObject", params: { a: 1 } },
    });
    expect(endpoint.postedMessages).toEqual([
      {
        type: "owner-rpc-request",
        requestId: "r1",
        route: "addObject",
        params: { a: 1 },
      },
    ]);

    endpoint.emit({
      type: "owner-rpc-response",
      requestId: "r1",
      ok: true,
      result: "demo/1",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invokes).toEqual([
      {
        command: "owner_rpc_respond",
        args: {
          requestId: "r1",
          ok: true,
          result: "demo/1",
          error: undefined,
        },
      },
    ]);

    detach();
    expect(unlistenCalled).toBe(true);
    expect(endpoint.listeners.get("message")?.size ?? 0).toBe(0);
  });

  test("非 Tauri 环境挂接为空操作", () => {
    const endpoint = new FakeEndpoint();
    const detach = attachOwnerRpcForwarder(endpoint, { listen: null });
    expect(() => detach()).not.toThrow();
    expect(endpoint.listeners.size).toBe(0);
  });
});
