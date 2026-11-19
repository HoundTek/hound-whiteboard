/**
 * @file Core Worker 运行时测试
 * @author Zhou Chenyu
 */

import { CoreWorkerRuntime } from "../core-worker.js";

/**
 * 测试用假 Worker 宿主
 * @class
 */
class FakeWorkerHost {
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
   * @constructor
   */
  constructor() {
    this.postedMessages = [];
    this.listeners = new Map();
  }

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
   * 注销事件监听器
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
   * 向宿主注入一条消息
   * @param {Object} message - 要注入的消息
   * @returns {void}
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

/**
 * 创建已启动的 runtime 与宿主
 * @returns {{ host: FakeWorkerHost, runtime: CoreWorkerRuntime }} 测试运行时
 */
function createStartedRuntime() {
  const host = new FakeWorkerHost();
  const runtime = new CoreWorkerRuntime(host);
  runtime.start();
  return { host, runtime };
}

/**
 * 向宿主发送 createBoard 请求并等待响应
 * @param {FakeWorkerHost} host - 假宿主
 * @returns {Promise<void>}
 *
 * @description
 * createBoard 已改异步（持久化装配），须等 rpc-response 落地再发后续消息。
 */
async function emitCreateBoard(host) {
  host.emit({
    type: "rpc",
    msgId: "create-board",
    method: "createBoard",
    params: { width: 800, height: 600 },
  });
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const responded = host.postedMessages.some(
      (m) => m.type === "rpc-response" && m.msgId === "create-board",
    );
    if (responded) return;
  }
  throw new Error("createBoard 超时");
}

describe("CoreWorkerRuntime 批处理错误回执", () => {
  test("单条目失败应回传 rpc-batch-error，其余条目正常执行", async () => {
    const { host, runtime } = createStartedRuntime();
    try {
      await emitCreateBoard(host);

      host.emit({
        type: "rpc-batch",
        batchId: 7,
        items: [
          {
            method: "createObject",
            type: "StrokeObject",
            props: {
              id: "s1",
              position: { x: 0, y: 0 },
              property: { width: 2 },
              data: {
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            },
          },
          { method: "modifyObject", objectId: "missing", patch: { data: {} } },
          { method: "unknownMethod", foo: 1 },
        ],
      });

      let batchError;
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        batchError = host.postedMessages.find(
          (message) => message.type === "rpc-batch-error",
        );
        if (batchError) break;
      }
      expect(batchError).toBeDefined();
      expect(batchError.batchId).toBe(7);
      expect(batchError.errors).toHaveLength(2);
      expect(batchError.errors[0]).toMatchObject({
        index: 1,
        method: "modifyObject",
        code: "INTERNAL_ERROR",
      });
      expect(batchError.errors[1]).toMatchObject({
        index: 2,
        method: "unknownMethod",
        code: "INTERNAL_ERROR",
      });

      // 失败条目不影响成功条目生效
      host.emit({
        type: "rpc",
        msgId: "query-1",
        method: "queryObjects",
        params: { ids: ["s1"] },
      });
      let queryResponse;
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        queryResponse = host.postedMessages.find(
          (message) =>
            message.type === "rpc-response" && message.msgId === "query-1",
        );
        if (queryResponse) break;
      }
      expect(queryResponse).toBeDefined();
      expect(queryResponse.result).toHaveLength(1);
      expect(queryResponse.result[0].id).toBe("s1");
    } finally {
      runtime.stop();
    }
  });

  test("全部条目成功时不回传 rpc-batch-error", async () => {
    const { host, runtime } = createStartedRuntime();
    try {
      await emitCreateBoard(host);

      host.emit({
        type: "rpc-batch",
        batchId: 1,
        items: [
          {
            method: "createObject",
            type: "StrokeObject",
            props: {
              id: "s1",
              position: { x: 0, y: 0 },
              data: {
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            },
          },
          { method: "commitObjects", objectIds: ["s1"] },
        ],
      });

      const batchError = host.postedMessages.find(
        (message) => message.type === "rpc-batch-error",
      );
      expect(batchError).toBeUndefined();
    } finally {
      runtime.stop();
    }
  });
});
