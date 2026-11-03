/**
 * @file Core Worker 连接竞态与 daemon 命名测试
 * @description 验证 connect/destroy 竞态下协调器被关闭不泄漏，及 GUI daemon 名按完整路径去重且合法。
 * @module host/tests/core-worker-connect-race.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { isValidDaemonName } from "../../cli/daemon-registry.js";

/**
 * 已创建的 mock 协调器实例（按创建顺序）
 * @type {Object[]}
 */
const coordinatorInstances = [];

jest.unstable_mockModule("../sync/network-coordinator.js", () => ({
  createNetworkCoordinator: () => {
    const instance = {
      closed: false,
      awarenessSent: [],
      _resolveConnect: null,
      connect() {
        return new Promise((resolve) => {
          instance._resolveConnect = resolve;
        });
      },
      async close() {
        instance.closed = true;
      },
      sendAwareness(data) {
        instance.awarenessSent.push(data);
      },
    };
    coordinatorInstances.push(instance);
    return instance;
  },
}));

const { CoreWorkerRuntime, guiDaemonNameFromPath } = await import(
  "../core-worker.js"
);

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
 * 发 RPC 并等待响应
 * @param {FakeWorkerHost} host - 假宿主
 * @param {string} method - 方法名
 * @param {Object} params - 参数
 * @returns {Promise<Object>} 响应结果
 */
async function rpc(host, method, params) {
  const msgId = `rpc-${Math.random().toString(36).slice(2)}`;
  host.emit({ type: "rpc", msgId, method, params });
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = host.postedMessages.find(
      (m) => m.type === "rpc-response" && m.msgId === msgId,
    );
    if (response) {
      if (response.error) throw new Error(response.error);
      return response.result;
    }
  }
  throw new Error(`RPC 超时：${method}`);
}

/**
 * 轮询直至条件满足
 * @param {Function} predicate - 判定函数
 * @param {string} label - 条件描述
 * @returns {Promise<void>}
 */
async function until(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`until 超时：${label}`);
}

describe("CoreWorker connect/destroy 竞态", () => {
  test("connect 未兑现时 destroyBoard，connect 兑现后协调器被关闭且不挂接", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();

    const createBoardPromise = rpc(host, "createBoard", {
      width: 800,
      height: 600,
      source: "worker",
      syncUrl: "ws://127.0.0.1:1",
      boardId: "race-room",
    });
    // 等协调器实例创建且 connect 挂起
    await until(() => coordinatorInstances.length === 1, "协调器已创建");
    const coordinator = coordinatorInstances[0];

    // connect 未兑现时销毁板：字段仍为 null，destroy 无法关闭该协调器
    await rpc(host, "destroyBoard", {});
    expect(coordinator.closed).toBe(false);

    // connect 随后兑现：应被关闭而不是挂接到已销毁的 BoardCore 上
    coordinator._resolveConnect();
    await createBoardPromise;
    expect(coordinator.closed).toBe(true);

    // 未挂接：awareness 消息不应送达该协调器
    host.emit({ type: "awareness-send", data: { kind: "cursor" } });
    expect(coordinator.awarenessSent).toHaveLength(0);
  });

  test("旧板 connect 在新板建立后兑现也不得覆盖新协调器", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    const base = coordinatorInstances.length;
    const oldCreate = rpc(host, "createBoard", {
      width: 800,
      height: 600,
      source: "old",
      syncUrl: "ws://127.0.0.1:1",
      boardId: "old-room",
    });
    await until(() => coordinatorInstances.length === base + 1, "旧协调器已创建");
    const oldOne = coordinatorInstances[base];
    await rpc(host, "destroyBoard", {});

    const newCreate = rpc(host, "createBoard", {
      width: 800,
      height: 600,
      source: "new",
      syncUrl: "ws://127.0.0.1:2",
      boardId: "new-room",
    });
    await until(() => coordinatorInstances.length === base + 2, "新协调器已创建");
    const newOne = coordinatorInstances[base + 1];
    newOne._resolveConnect();
    await newCreate;
    oldOne._resolveConnect();
    await oldCreate;

    expect(oldOne.closed).toBe(true);
    expect(newOne.closed).toBe(false);
    host.emit({ type: "awareness-send", data: { kind: "cursor" } });
    expect(newOne.awarenessSent).toHaveLength(1);
    expect(oldOne.awarenessSent).toHaveLength(0);
    await rpc(host, "destroyBoard", {});
  });
});

describe("调试重连", () => {
  test("debug-request reconnect 关闭旧协调器并重建挂接", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();

    const base = coordinatorInstances.length;
    const createBoardPromise = rpc(host, "createBoard", {
      width: 800,
      height: 600,
      source: "worker",
      syncUrl: "ws://127.0.0.1:1",
      boardId: "race-room",
    });
    await until(() => coordinatorInstances.length === base + 1, "协调器已创建");
    coordinatorInstances[base]._resolveConnect();
    await createBoardPromise;

    host.emit({ type: "debug-request", query: "reconnect" });
    await until(
      () => coordinatorInstances.length === base + 2,
      "协调器已重建",
    );
    const [oldOne, newOne] = coordinatorInstances.slice(base, base + 2);
    expect(oldOne.closed).toBe(true);

    // 新实例 connect 兑现后挂接：awareness 送达新协调器而非旧的
    newOne._resolveConnect();
    await until(() => newOne.closed === false, "新协调器在役");
    host.emit({ type: "awareness-send", data: { kind: "cursor" } });
    await until(() => newOne.awarenessSent.length === 1, "awareness 送达新协调器");
    expect(oldOne.awarenessSent).toHaveLength(0);
  });
});

describe("guiDaemonNameFromPath", () => {
  test("同 basename 不同完整路径派生不同 daemon 名，且名字合法", () => {
    const nameA = `gui-${guiDaemonNameFromPath("/home/user/a/board")}`;
    const nameB = `gui-${guiDaemonNameFromPath("/home/user/b/board")}`;
    expect(nameA).not.toBe(nameB);
    expect(nameA).toMatch(/^gui-board-[0-9a-f]{8}$/);
    expect(isValidDaemonName(nameA)).toBe(true);
    expect(isValidDaemonName(nameB)).toBe(true);
  });

  test("同一路径派生名稳定，特殊字符清洗后仍合法", () => {
    const rootPath = "/data/my boards/白板 v2";
    const name = `gui-${guiDaemonNameFromPath(rootPath)}`;
    expect(name).toBe(`gui-${guiDaemonNameFromPath(rootPath)}`);
    expect(isValidDaemonName(name)).toBe(true);
  });
});
