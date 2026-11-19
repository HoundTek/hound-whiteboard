/**
 * @file Core Worker 持久化接线测试
 * @description 验证 worker 组合根的持久化装配：tauri driver 经主线程转发落地，重开后会话恢复，撤销历史穿越重开。
 * @author Zhou Chenyu
 */

import { CoreWorkerRuntime } from "../core-worker.js";
import { createMemoryDriver } from "../../io/driver/memory.js";
import { startBoardDaemon, readDaemonDescriptor } from "../../cli/board-daemon.js";
import { openBoardSession } from "../../cli/board-session.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
 * @returns {{ handler: (command: string, args: Object) => Promise<*>, driver: Object }} 处理器与底层驱动
 */
function createMemoryCommandHandler() {
  const driver = createMemoryDriver({ rootId: "mem" });
  const handler = async (command, args) => {
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
      case "spawn_board_daemon":
        // 模拟 Rust 幂等探测：mock 盘 .owner.json 里的活 daemon 直接返回
        {
          const text = await driver.read("mem", ".owner.json");
          const claim = JSON.parse(text);
          return {
            name: claim.transport.name,
            port: claim.transport.port,
          };
        }
      default:
        throw new Error(`unknown command ${command}`);
    }
  };
  return { handler, driver };
}

/** RPC 消息序号 */
let msgSeq = 0;

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
 * 泵送 worker 的 io-invoke 转发直到排空（journaler 微任务合批的落盘由此完成）
 * @param {FakeWorkerHost} host - 假宿主
 * @param {(command: string, args: Object) => Promise<*>} handler - Rust command 处理器
 * @returns {Promise<void>}
 */
async function pumpIo(host, handler) {
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    let handledAny = false;
    for (const message of host.postedMessages) {
      if (message.type !== "io-invoke" || message.__handled) continue;
      message.__handled = true;
      handledAny = true;
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
    if (!handledAny) return;
  }
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
 * 装配协作模式的 runtime：真 daemon（持板落盘）+ mock 盘预置 .owner.json（spawn 幂等探测命中，不重复拉起）
 * @returns {{ host: FakeWorkerHost, runtime: CoreWorkerRuntime, handler: Function, driver: Object, daemon: Object, boardDir: string }} 测试上下文
 */
async function setup() {
  const host = new FakeWorkerHost();
  const runtime = new CoreWorkerRuntime(host);
  runtime.start();
  const { handler, driver } = createMemoryCommandHandler();
  // 真 daemon：临时板目录 + startBoardDaemon（协作通道对端，relay 远端与自身流的落盘者）
  const boardDir = mkdtempSync(path.join(tmpdir(), "hwb-worker-collab-"));
  const session = await openBoardSession(boardDir, {
    create: true,
    width: 800,
    height: 600,
  });
  await session.flush();
  await session.close();
  const daemon = await startBoardDaemon({
    name: "worker-test",
    rootPath: boardDir,
    source: "worker-test",
  });
  // mock 盘预置 .owner.json：spawn 幂等探测命中（不触发真实 spawn）
  await driver.write(
    "mem",
    ".owner.json",
    JSON.stringify({
      ownerId: "worker-test-owner",
      pid: process.pid,
      source: "worker-test",
      boardId: null,
      transport: {
        kind: "daemon",
        name: "worker-test",
        host: "127.0.0.1",
        port: daemon.port,
      },
      claimedAt: new Date().toISOString(),
    }),
  );
  await rpcCall(host, handler, "createBoard", {
    width: 800,
    height: 600,
    rootPath: "/boards/demo",
  });
  return { host, runtime, handler, driver, daemon, boardDir };
}

describe("CoreWorker 持久化接线", () => {
  test("rootPath 有效时经协作通道同步 daemon，worker 自写本端流与对象文件（布局 v2）", async () => {
    const { host, handler, driver, daemon } = await setup();
    try {
      await createStroke(host, handler, "demo/1");
      // 协作同步：worker 操作广播 → daemon 应用 + 落盘
      const landed = await waitFor(async () => {
        const s = await openBoardSession(daemon.rootPath, { source: "check" });
        const found = s.api
          .queryObjectList()
          .objects.some((o) => o.id === "demo/1");
        await s.close();
        return found;
      });
      expect(landed).toBe(true);

      // 布局 v2：worker 自己落盘（本端 source 的日志流 + 对象文件，原子写经 mv 就位）
      const landedLocal = await waitFor(async () => {
        await pumpIo(host, handler);
        const seg = await driver.read("mem", "hit/core/seg-000000.jsonl");
        const obj = await driver.read("mem", "objects/demo%2F1.json");
        return typeof seg === "string" && seg.includes('"core/op-1"')
          && typeof obj === "string" && obj.includes('"demo/1"');
      });
      expect(landedLocal).toBe(true);
      // worker 不写 board.json（daemon 单写）
      const metaWrites = host.postedMessages.filter(
        (m) =>
          m.type === "io-invoke" &&
          m.command === "safe_io_fs_mv" &&
          m.args?.destRel === "board.json",
      );
      expect(metaWrites).toHaveLength(0);
    } finally {
      await daemon.close();
      rmSync(daemon.rootPath, { recursive: true, force: true });
    }
  });

  test("重开后经协作同步恢复，撤销穿越重开", async () => {
    const { host, handler, driver, daemon } = await setup();
    try {
      await createStroke(host, handler, "demo/1");
      await waitFor(async () => {
        const s = await openBoardSession(daemon.rootPath, { source: "check" });
        const found = s.api
          .queryObjectList()
          .objects.some((o) => o.id === "demo/1");
        await s.close();
        return found;
      });

      // 排空 io 转发后销毁
      await rpcCall(host, handler, "queryObjects", { ids: ["demo/1"] });
      await rpcCall(host, handler, "destroyBoard");

      // 重开同一板：worker 本地盘为空，经协作通道全量同步恢复
      await rpcCall(host, handler, "createBoard", {
        width: 800,
        height: 600,
        rootPath: "/boards/demo",
      });
      const restored = await waitFor(async () => {
        const objects = await rpcCall(host, handler, "queryObjects", {
          ids: ["demo/1"],
        });
        return objects.length === 1 && objects[0].id === "demo/1";
      });
      expect(restored).toBe(true);

      // 撤销穿越重开：worker undo 广播 → daemon 应用，对象消失
      await rpcCall(host, handler, "undo");
      const undone = await waitFor(async () => {
        const s = await openBoardSession(daemon.rootPath, { source: "check" });
        const found = s.api.queryObjectList().objects.length === 0;
        await s.close();
        return found;
      });
      expect(undone).toBe(true);
    } finally {
      await daemon.close();
      rmSync(daemon.rootPath, { recursive: true, force: true });
    }
    void driver;
  });

  test("daemon 关闭后 worker 继续落盘本端流与 meta 分片（断线不锁编辑）", async () => {
    const { host, handler, driver, daemon } = await setup();
    try {
      await createStroke(host, handler, "demo/1");
      const landed = await waitFor(async () => {
        await pumpIo(host, handler);
        const seg = await driver.read("mem", "hit/core/seg-000000.jsonl");
        return typeof seg === "string" && seg.includes('"core/op-1"');
      });
      expect(landed).toBe(true);

      // 杀死 daemon：worker 不丢编辑能力，继续落自己的分片
      await daemon.close();
      await createStroke(host, handler, "demo/2");
      const landedOffline = await waitFor(async () => {
        await pumpIo(host, handler);
        const seg = await driver.read("mem", "hit/core/seg-000001.jsonl");
        const meta = await driver.read("mem", "meta/core.json");
        return typeof seg === "string" && seg.includes('"core/op-')
          && typeof meta === "string" && meta.includes('"lastTime"');
      });
      expect(landedOffline).toBe(true);
      await rpcCall(host, handler, "destroyBoard");
    } finally {
      rmSync(daemon.rootPath, { recursive: true, force: true });
    }
  });

  test("daemon 拉起失败时降级单机模式开板（盘即兜底）", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    const { handler, driver } = createMemoryCommandHandler();
    // mock 盘无 .owner.json：spawn 幂等探测读不到描述，handler 抛错模拟拉起失败
    const boardDir = mkdtempSync(path.join(tmpdir(), "hwb-worker-standalone-"));
    try {
      await rpcCall(host, handler, "createBoard", {
        width: 800,
        height: 600,
        rootPath: "/boards/standalone",
      });
      await createStroke(host, handler, "demo/1");
      const landed = await waitFor(async () => {
        await pumpIo(host, handler);
        const seg = await driver.read("mem", "hit/core/seg-000000.jsonl");
        const obj = await driver.read("mem", "objects/demo%2F1.json");
        const meta = await driver.read("mem", "meta/core.json");
        return typeof seg === "string" && typeof obj === "string" && typeof meta === "string";
      });
      expect(landed).toBe(true);
      await rpcCall(host, handler, "destroyBoard");
    } finally {
      rmSync(boardDir, { recursive: true, force: true });
    }
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

  test("attach 既有 daemon 时 destroyBoard 不 release（他人 daemon 不误杀）", async () => {
    // setup() 的 mock 盘预置 .owner.json：spawn 前探测命中活 daemon → attach，不记 ownership
    const { host, handler, daemon } = await setup();
    try {
      await rpcCall(host, handler, "destroyBoard");
      await new Promise((resolve) => setTimeout(resolve, 300));
      // 未发 release：daemon 描述保留、进程仍活（创建者引用不归本端）
      expect(await readDaemonDescriptor(daemon.rootPath)).not.toBeNull();
    } finally {
      await daemon.close();
      rmSync(daemon.rootPath, { recursive: true, force: true });
    }
  });

  test("本端 spawn 的 daemon 在 destroyBoard 时自动 release（引用归零自退出）", async () => {
    const host = new FakeWorkerHost();
    const runtime = new CoreWorkerRuntime(host);
    runtime.start();
    const { handler: baseHandler, driver } = createMemoryCommandHandler();
    const boardDir = mkdtempSync(path.join(tmpdir(), "hwb-worker-spawn-"));
    const session = await openBoardSession(boardDir, {
      create: true,
      width: 800,
      height: 600,
    });
    await session.flush();
    await session.close();
    // 模拟 GUI spawn 的 daemon：归零只清理不退出（进程退出会杀掉测试进程）
    const daemon = await startBoardDaemon({
      name: "worker-spawn-test",
      rootPath: boardDir,
      source: "worker-spawn-test",
      exitOnZero: false,
    });
    // mock 盘不预置 .owner.json：spawn 前探测无活 daemon → 记 ownership；
    // spawn 处理器模拟 Rust 就绪（写 owner claim 并返回新实例）
    const handler = async (command, args) => {
      if (command === "spawn_board_daemon") {
        await driver.write(
          "mem",
          ".owner.json",
          JSON.stringify({
            ownerId: "worker-spawn-owner",
            pid: process.pid,
            source: "worker-spawn-test",
            boardId: null,
            transport: {
              kind: "daemon",
              name: daemon.name,
              host: "127.0.0.1",
              port: daemon.port,
            },
            claimedAt: new Date().toISOString(),
          }),
        );
        return { name: daemon.name, port: daemon.port };
      }
      return baseHandler(command, args);
    };
    try {
      await rpcCall(host, handler, "createBoard", {
        width: 800,
        height: 600,
        rootPath: "/boards/spawned",
      });
      // destroy：协作 WS 断开（clientRefs 归零）+ release（ownerRefs 归零）→ daemon 自动关闭
      await rpcCall(host, handler, "destroyBoard");
      const gone = await waitFor(
        async () => (await readDaemonDescriptor(boardDir)) === null,
      );
      expect(gone).toBe(true);
    } finally {
      await daemon.close();
      rmSync(boardDir, { recursive: true, force: true });
    }
  });
});
