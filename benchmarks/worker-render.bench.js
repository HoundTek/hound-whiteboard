/**
 * @file Worker 渲染帧性能测试
 * @description 测量 MonitorCore flushRenderFrame() 在不同对象规模下的耗时。
 * @module benchmarks/worker-render
 */

import { BoardCore } from "../src/core/components/orchestration/board-core.js";
import { MonitorCore } from "../src/core/components/orchestration/monitor-core.js";
import { deserialize } from "../src/core/objects/object-deserializer.js";
import { installNoopOffscreenCanvas } from "../src/core/test-support/noop-canvas.js";
import { printHeader, printFooter, benchmarkSync } from "./helpers.js";

function main() {
  const restoreOffscreenCanvas = installNoopOffscreenCanvas();

  try {
    const boardCore = new BoardCore({ width: 800, height: 600 });
    const renderFrames = [];
    const monitor = new MonitorCore({
      boardCore,
      monitorId: "bench",
      width: 800,
      height: 600,
      postRenderFrame(message, transferList) {
        renderFrames.push({ message, transferList });
      },
    });

    monitor.onViewportChange({
      origin: { x: 0, y: 0 },
      zoom: 1,
      viewportSize: { width: 800, height: 600 },
    });

    /**
     * 批量创建对象并提交到静态图
     * @param {number} count - 对象数量
     * @param {number} startId - 起始 id
     */
    function createObjects(count, startId) {
      for (let i = 0; i < count; i++) {
        const obj = deserialize({
          type: "CircleObject",
          id: startId + i,
          position: { x: Math.random() * 800, y: Math.random() * 600 },
          transform: { a: 1, b: 0, c: 0, d: 1 },
          property: { color: "#ff0000", width: 2 },
          data: { radius: 20 + Math.random() * 30 },
        });
        boardCore.registerObjectInstance(obj);
        boardCore.activeObjectManager.add(new Set([obj]));
        boardCore.activeObjectManager.apply(new Set([obj]));
      }
    }

    /**
     * 运行一圈 flushRenderFrame 并清理产生的帧
     * @returns {void}
     */
    function runFlush() {
      monitor.markFrameDirty?.();
      const flushed = monitor.flushRenderFrame();
      if (flushed) {
        renderFrames.length = 0;
      }
    }

    printHeader("Worker Render 性能测试");

    const ROUNDS = 5;

    createObjects(50, 1);
    benchmarkSync("flushRenderFrame（50 对象）", 5000, ROUNDS, runFlush);

    createObjects(50, 100);
    benchmarkSync("flushRenderFrame（100 对象）", 5000, ROUNDS, runFlush);

    createObjects(200, 200);
    benchmarkSync("flushRenderFrame（300 对象）", 5000, ROUNDS, runFlush);

    printFooter();

    for (const { message } of renderFrames) {
      message?.baseBitmap?.close?.();
      message?.liveBitmap?.close?.();
    }
    monitor.destroy();
    restoreOffscreenCanvas?.();
  } catch (error) {
    console.error("\n❌ Worker Render 测试失败:", error.message);
    restoreOffscreenCanvas?.();
    process.exit(1);
  }
}

main();
