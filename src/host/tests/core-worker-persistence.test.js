/**
 * @file Core Worker 持久化接线测试
 * @description 验证 worker 持久化装配：GUI 直接落盘、owner claim 生命周期、重开恢复与 owner RPC 分发。
 * @module host/tests/core-worker-persistence.test
 * @author Zhou Chenyu
 */

import { CoreWorkerRuntime } from "../core-worker.js";
import { createMemoryDriver } from "../../io/driver/memory.js";

/**
 * 测试用假 Worker 宿主（io-invoke 由内存驱动模拟的"Rust 侧"应答）
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
 * 创建内存文件系统模拟的 Rust command 处理器
 * @param {{ failStartOwnerRpc?: boolean }} [options={}] - 选项
 * @returns {{ handler: (command: string, args: Object) => Promise<*>, driver: Object, calls: string[] }} 处理器、驱动与调用记录
 */
function createMemoryCommandHandler({ failStartOwnerRpc = false } = {}) {
  const driver = createMemoryDriver({ rootId: "mem" });
  const calls = [];
  const handler = async (command, args) => {
    calls.push(command);
    switch (command) {
      case "safe_io_register_root":
        // Rust 侧返回纯字符串 root_id（与真实 command 行为一致）
        return "mem";
      case "safe_io_unregister_root":
        return true;
      case "safe_io_fs_read":
        return driver.read(args.rootId, args.relPath);
      case "safe_io_fs_write":
        return driver.write(args.rootId, args.relPath, args.content);
      case "safe_io_fs_ls":
        return driver.ls(args.rootId, args.relPath);
      case "safe_io_fs_stat":
        return driver.stat(args.rootId, args.relPath);
      case "safe_io_fs_exists":
        return driver.exists(args.rootId, args.relPath);
      case "safe_io_fs_rm":
        return driver.rm(args.rootId, args.relPath);
      case "safe_io_fs_mv":
        return driver.mv(args.rootId, args.srcRel, args.destRel);
      case "safe_io_fs_mkdir":
        return driver.mkdir(args.rootId, args.relPath);
      case "start_owner_rpc":
        if (failStartOwnerRpc) {
          throw new Error("owner RPC 启动失败");
        }
        return {
          ownerId: "test-owner",
          host: "127.0.0.1",
          port: 1,
          token: "test-token",
        };
      case "stop_owner_rpc":
        return true;
      default:
        throw new Error(`unknown command ${command}`);
    }
  };
  return { handler, driver, calls };
}

/** RPC 消息序号 */
let msgSeq = 0;

/**
 * 泵送一条 io-invoke 消息
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @returns {Promise<void>}
 */
async function pumpIoOnce(host, handler) {
  for (const message of host.postedMessages) {
    if (message.type !== "io-invoke" || message.__handled) continue;
    message.__handled = true;
    try {
      const result = await handler(message.command, message.args);
      host.emit({ type: "io-response", msgId: message.msgId, ok: true, result });
    } catch (error) {
      host.emit({
        type: "io-response",
        msgId: message.msgId,
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  }
}

/**
 * 发送 RPC 并等待响应（期间泵送全部 io-invoke 转发）
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @param {string} method - RPC 方法名
 * @param {Object} [params] - RPC 参数
 * @returns {Promise<*>} RPC 结果
 */
async function rpcCall(host, handler, method, params = {}) {
  const msgId = `t-${++msgSeq}`;
  host.emit({ type: "rpc", msgId, method, params });
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pumpIoOnce(host, handler);
    const response = host.postedMessages.find(
      (m) => m.type === "rpc-response" && m.msgId === msgId,
    );
    if (response) {
      if (response.error) throw new Error(response.error.message);
      return response.result;
    }
  }
  throw new Error(`rpc ${method} 超时`);
}

/**
 * 发送 owner RPC 请求并等待响应
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @param {string} requestId - 请求 id
 * @param {string} route - route 名
 * @param {Object} [params] - 参数
 * @param {string} [source] - 调用方 source
 * @returns {Promise<Object>} worker 响应
 */
async function ownerRpcCall(
  host,
  handler,
  requestId,
  route,
  params = {},
  source,
) {
  host.emit({ type: "owner-rpc-request", requestId, route, params, source });
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pumpIoOnce(host, handler);
    const response = host.postedMessages.find(
      (m) => m.type === "owner-rpc-response" && m.requestId === requestId,
    );
    if (response) return response;
  }
  throw new Error(`owner rpc ${route} 超时`);
}

/**
 * 泵送 worker 的 io-invoke 转发直到排空（journaler 微任务合批的落盘由此完成）
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @returns {Promise<void>}
 */
async function pumpIo(host, handler) {
  for (let i = 0; i < 50; i++) {
    const before = host.postedMessages.filter((m) => m.type === "io-invoke" && !m.__handled).length;
    await pumpIoOnce(host, handler);
    if (before === 0) return;
  }
}

/**
 * 轮询等待条件成立
 * @param {Function} probe - 探测函数
 * @param {number} [timeoutMs=2000] - 超时毫秒数
 * @returns {Promise<boolean>} 是否成立
 */
async function waitFor(probe, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * 销毁 runtime 并泵送其 io-invoke（stop_owner_rpc）
 * @param {CoreWorkerRuntime} runtime - 运行时
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @returns {Promise<void>}
 */
async function destroyRuntime(runtime, host, handler) {
  let settled = false;
  const done = runtime.destroyBoard().finally(() => {
    settled = true;
  });
  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pumpIoOnce(host, handler);
  }
  await done;
}

/**
 * 创建一笔静态笔画
 * @param {FakeWorkerHost} host - 假宿主
 * @param {Function} handler - Rust command 处理器
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStroke(host, handler, id) {
  await rpcCall(host, handler, "createObject", {
    type: "StrokeObject",
    props: {
      id,
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    },
  });
  await rpcCall(host, handler, "commitObjects", { objectIds: [id] });
}

/**
 * 装配持久化模式的 runtime
 * @param {{ failStartOwnerRpc?: boolean }} [options={}] - 选项
 * @returns {Promise<Object>} 测试上下文
 */
async function setup(options = {}) {
  const host = new FakeWorkerHost();
  const runtime = new CoreWorkerRuntime(host);
  runtime.start();
  const { handler, driver, calls } = createMemoryCommandHandler(options);
  await rpcCall(host, handler, "createBoard", {
    width: 800,
    height: 600,
    rootPath: "/boards/demo",
    source: "demo",
  });
  return { host, runtime, handler, driver, calls };
}

describe("CoreWorker 持久化接线", () => {
  test("rootPath 有效时 GUI 直接落盘并 claim owner RPC", async () => {
    const { host, runtime, handler, driver, calls } = await setup();
    try {
      await createStroke(host, handler, "demo/1");
      const landed = await waitFor(async () => {
        await pumpIoOnce(host, handler);
        return (await driver.read("mem", "objects/demo%2F1.json")) !== null;
      });
      expect(landed).toBe(true);
      await pumpIo(host, handler);

      const metaLanded = await waitFor(async () => {
        await pumpIoOnce(host, handler);
        return (await driver.read("mem", "meta/demo.json")) !== null;
      });
      expect(metaLanded).toBe(true);

      const obj = await driver.read("mem", "objects/demo%2F1.json");
      const seg = await driver.read("mem", "hit/demo/seg-000000.jsonl");
      const meta = await driver.read("mem", "meta/demo.json");
      expect(obj).toContain('"demo/1"');
      expect(seg).toContain('"demo/op-1"');
      expect(typeof meta).toBe("string");
      expect(calls).toContain("start_owner_rpc");
    } finally {
      await destroyRuntime(runtime, host, handler);
    }
    expect(calls).toContain("stop_owner_rpc");
  });

  test("重开后从盘恢复对象", async () => {
    const first = await setup();
    await createStroke(first.host, first.handler, "demo/1");
    await pumpIo(first.host, first.handler);
    await destroyRuntime(first.runtime, first.host, first.handler);

    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    try {
      await rpcCall(host, first.handler, "createBoard", {
        width: 800,
        height: 600,
        rootPath: "/boards/demo",
        source: "demo",
      });
      const list = await rpcCall(host, first.handler, "queryObjectList");
      expect(list.objects.map((obj) => obj.id)).toContain("demo/1");
    } finally {
      await destroyRuntime(runtime, host, first.handler);
    }
  });

  test("owner RPC 请求经 worker 分发，写路由在响应前 flush", async () => {
    const { host, handler, runtime, driver } = await setup();
    try {
      const response = await ownerRpcCall(host, handler, "r1", "addObject", {
        type: "StrokeObject",
        props: {
          id: "demo/2",
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        },
      });
      expect(response.ok).toBe(true);
      expect(typeof response.result).toBe("string");
      const obj = await driver.read(
        "mem",
        `objects/${encodeURIComponent(response.result)}.json`,
      );
      expect(obj).toContain(response.result);

      const unknown = await ownerRpcCall(host, handler, "r2", "nope");
      expect(unknown.ok).toBe(false);
      expect(unknown.error).toContain("未知 route");
    } finally {
      await destroyRuntime(runtime, host, handler);
    }
  });

  test("owner RPC 按请求 source 执行并保留 per-source 撤销", async () => {
    const { host, handler, runtime } = await setup();
    try {
      const ownerObjectId = await rpcCall(host, handler, "addObject", {
        type: "StrokeObject",
        props: {
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        },
      });
      expect(ownerObjectId).toMatch(/^demo\//);

      const cliAdd = await ownerRpcCall(
        host,
        handler,
        "r1",
        "addObject",
        {
          type: "StrokeObject",
          props: {
            position: { x: 20, y: 0 },
            property: { width: 2 },
            data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
          },
        },
        "cli-1",
      );
      expect(cliAdd.ok).toBe(true);
      expect(cliAdd.result).toMatch(/^cli-1\//);

      const ops = await ownerRpcCall(
        host,
        handler,
        "r2",
        "queryOperations",
        {},
        "cli-1",
      );
      expect(ops.ok).toBe(true);
      expect(ops.result.some((record) => record.source === "cli-1")).toBe(true);

      const undo = await ownerRpcCall(host, handler, "r3", "undo", {}, "cli-1");
      expect(undo.ok).toBe(true);
      const list = await ownerRpcCall(
        host,
        handler,
        "r4",
        "queryObjectList",
        {},
        "cli-1",
      );
      const ids = list.result.objects.map((obj) => obj.id);
      expect(ids).toContain(ownerObjectId);
      expect(ids).not.toContain(cliAdd.result);
    } finally {
      await destroyRuntime(runtime, host, handler);
    }
  });

  test("owner RPC 启动失败时不降级开板", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    const { handler } = createMemoryCommandHandler({ failStartOwnerRpc: true });
    await expect(
      rpcCall(host, handler, "createBoard", {
        width: 800,
        height: 600,
        rootPath: "/boards/fail",
        source: "demo",
      }),
    ).rejects.toThrow("owner RPC 启动失败");
  });

  test("rootPath 缺省保持内存模式（无 io 转发）", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    const { handler } = createMemoryCommandHandler();

    await rpcCall(host, handler, "createBoard", { width: 800, height: 600 });
    await createStroke(host, handler, "demo/1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const ioInvokes = host.postedMessages.filter((m) => m.type === "io-invoke");
    expect(ioInvokes).toHaveLength(0);
  });
});
