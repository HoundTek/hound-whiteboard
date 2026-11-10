/**
 * @file Worker RPC 性能测试
 * @description
 * 测量 BoardApiRpc 单条/批量 RPC 的往返延迟与吞吐量。
 * 端点带结构化克隆与异步投递，模拟真实 worker 边界的传输成本。
 * @module benchmarks/worker-rpc
 */

import { createCoreWorkerRuntime } from "../src/host/core-worker.js";
import { BoardApiRpc } from "../src/host/bridges/board-api-rpc.js";
import { installNoopOffscreenCanvas } from "../src/test-support/noop-canvas.js";
import { printHeader, printFooter, benchmarkAsync } from "./helpers.js";

/**
 * 带真实边界成本的端点
 * @description
 * 真实 worker 边界的成本由两部分构成：消息的结构化克隆与异步投递。
 * 同步回环两者都测不到，会让 RPC 延迟看起来远低于实际。
 * Node 下没有可转移的 ImageBitmap，因此 render-frame 消息不做克隆，
 * 其余消息一律先 clone 再异步投递。
 */
class BoundaryEndpoint {
  constructor() {
    this.postedMessages = [];
    this.listeners = new Map();
    this.peer = null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message, transferList) {
    this.postedMessages.push(message);
    // 位图无法在 Node 中结构化克隆，模拟时跳过；其余消息计入克隆成本
    const payload =
      message?.type === "render-frame" ? message : structuredClone(message);
    setImmediate(() => this.peer?.emit(payload, transferList));
  }

  emit(message, transferList) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message, transferList });
    }
  }
}

async function main() {
  const restoreOffscreenCanvas = installNoopOffscreenCanvas();
  const ui = new BoundaryEndpoint();
  const worker = new BoundaryEndpoint();
  let runtime;

  try {
    ui.peer = worker;
    worker.peer = ui;

    const api = new BoardApiRpc(ui);
    runtime = createCoreWorkerRuntime(worker).start();
    await api.waitUntilReady(1000);
    await api.createBoard({ width: 800, height: 600 });
    await api.createObject("CircleObject", {
      id: "bench-1",
      position: { x: 400, y: 300 },
      data: { radius: 20 },
    });
    await api.createObject("CircleObject", {
      id: "bench-2",
      position: { x: 500, y: 400 },
      data: { radius: 30 },
    });

    printHeader("Worker RPC 性能测试");

    const ROUNDS = 5;

    // modifyObject 走微任务级批处理，调用后立即返回，不等 worker 应用。
    // 单测它只能得到入队成本，因此另测一条含真实投递的屏障版本。
    await benchmarkAsync(
      "modifyObject 入队（批处理，不等响应）",
      5000,
      ROUNDS,
      async () => {
        await api.modifyObject("bench-1", { position: { x: 400, y: 300 } });
      },
    );

    await benchmarkAsync(
      "modifyObject 入队并等待 worker 应用",
      2000,
      ROUNDS,
      async () => {
        await api.modifyObject("bench-1", { position: { x: 400, y: 300 } });
        // queryObjects 会真正往返，作为应用完成的屏障
        await api.queryObjects(["bench-1"]);
      },
    );

    await benchmarkAsync(
      "modifyObjects 往返（2 条）",
      5000,
      ROUNDS,
      async () => {
        await api.modifyObjects([
          { objectId: "bench-1", patch: { position: { x: 400, y: 300 } } },
          { objectId: "bench-2", patch: { position: { x: 500, y: 400 } } },
        ]);
      },
    );

    await benchmarkAsync(
      "appendListItem 入队（批处理，不等响应）",
      5000,
      ROUNDS,
      async () => {
        await api.appendListItem("bench-1", "points", [{ x: 400, y: 300 }]);
      },
    );

    await benchmarkAsync("queryObjects 往返（2 个 id）", 5000, ROUNDS, async () => {
      await api.queryObjects(["bench-1", "bench-2"]);
    });

    await benchmarkAsync(
      "commitObjects 往返（2 个对象）",
      2000,
      ROUNDS,
      async () => {
        await api.commitObjects(["bench-1", "bench-2"]);
      },
    );

    let objectSeq = 0;
    await benchmarkAsync("createObject 往返", 500, ROUNDS, async () => {
      objectSeq++;
      await api.createObject("CircleObject", {
        id: `bench-created-${objectSeq}`,
        position: { x: 400, y: 300 },
        data: { radius: 20 },
      });
    });

    printFooter();

    api.destroy?.();
    runtime.stop?.();
    restoreOffscreenCanvas?.();
  } catch (error) {
    console.error("\n❌ Worker RPC 测试失败:", error.message);
    runtime?.stop?.();
    restoreOffscreenCanvas?.();
    process.exit(1);
  }
}

main();
