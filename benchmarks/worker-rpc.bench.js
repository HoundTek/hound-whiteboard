/**
 * @file Worker RPC 性能测试
 * @description 测量 BoardApiRpc 单条/批量 RPC 的往返延迟与吞吐量。
 * @module benchmarks/worker-rpc
 */

import { createCoreWorkerRuntime } from "../src/core-worker.js";
import { BoardApiRpc } from "../src/core/bridges/board-api.js";
import { installNoopOffscreenCanvas } from "../src/core/test-support/noop-canvas.js";
import { printHeader, printFooter, benchmarkAsync } from "./helpers.js";

class LoopbackEndpoint {
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

  postMessage(message) {
    this.postedMessages.push(message);
    this.peer?.emit(message);
  }

  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

async function main() {
  const restoreOffscreenCanvas = installNoopOffscreenCanvas();
  const ui = new LoopbackEndpoint();
  const worker = new LoopbackEndpoint();
  let runtime;

  try {
    ui.peer = worker;
    worker.peer = ui;

    const api = new BoardApiRpc(ui);
    runtime = createCoreWorkerRuntime(worker).start();
    await api.waitUntilReady(1000);
    await api.createBoard({ width: 800, height: 600 });
    await api.createObject("CircleObject", {
      id: 1,
      position: { x: 400, y: 300 },
      data: { radius: 20 },
    });
    await api.createObject("CircleObject", {
      id: 2,
      position: { x: 500, y: 400 },
      data: { radius: 30 },
    });

    printHeader("Worker RPC 性能测试");

    const ROUNDS = 5;

    await benchmarkAsync(
      "modifyObject RPC 单条往返",
      5000,
      ROUNDS,
      async () => {
        await api.modifyObject(1, { position: { x: 400, y: 300 } });
      },
    );

    await benchmarkAsync(
      "modifyObjects 批量（2 条）",
      5000,
      ROUNDS,
      async () => {
        await api.modifyObjects([
          { objectId: 1, patch: { position: { x: 400, y: 300 } } },
          { objectId: 2, patch: { position: { x: 500, y: 400 } } },
        ]);
      },
    );

    await benchmarkAsync(
      "appendListItem RPC 单条往返",
      5000,
      ROUNDS,
      async () => {
        await api.appendListItem(1, "points", [{ x: 400, y: 300 }]);
      },
    );

    await benchmarkAsync("queryObjects（2 个 id）", 5000, ROUNDS, async () => {
      await api.queryObjects([1, 2]);
    });

    await benchmarkAsync(
      "commitObjects（2 个对象）",
      2000,
      ROUNDS,
      async () => {
        await api.commitObjects([1, 2]);
      },
    );

    let objectId = 10000;
    await benchmarkAsync("创建 CircleObject", 500, ROUNDS, async () => {
      objectId++;
      await api.createObject("CircleObject", {
        id: objectId,
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
