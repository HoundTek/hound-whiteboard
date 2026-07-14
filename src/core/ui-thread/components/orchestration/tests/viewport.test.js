/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";

import { DevicesDAG } from "../../../devices-dag/index.js";
import {
  createNoopCanvas,
  createNoopCanvasContext2D,
  createNoopImageBitmap,
} from "../../../../test-support/noop-canvas.js";
import { Viewport } from "../viewport.js";

/**
 * 测试用假 Worker 端点
 * @class
 */
class FakeWorkerEndpoint {
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
   * 监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners;

  /**
   * 注册消息监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   */
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
  }

  /**
   * 注销消息监听器
   * @param {string} type - 事件类型
   * @param {Function} handler - 监听器
   */
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * 发送消息
   * @param {Object} message - 消息体
   */
  postMessage(message) {
    this.postedMessages.push(message);
  }

  /**
   * 注入一条来自 Worker 的消息
   * @param {Object} message - 消息体
   */
  emit(message) {
    for (const handler of this.listeners.get("message") ?? []) {
      handler({ data: message });
    }
  }
}

/**
 * 安装测试用 requestAnimationFrame mock
 * @returns {{ flushNextFrame: () => void, restore: () => void }}
 */
function installMockAnimationFrame() {
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let nextId = 1;

  globalThis.requestAnimationFrame = (callback) => {
    const rafId = nextId;
    nextId += 1;
    callbacks.set(rafId, callback);
    return rafId;
  };
  globalThis.cancelAnimationFrame = (rafId) => {
    callbacks.delete(rafId);
  };

  return {
    flushNextFrame() {
      const firstEntry = callbacks.entries().next().value;
      if (!firstEntry) return;
      const [rafId, callback] = firstEntry;
      callbacks.delete(rafId);
      callback(0);
    },
    restore() {
      if (previousRequestAnimationFrame === undefined) {
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      }

      if (previousCancelAnimationFrame === undefined) {
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
      }
    },
  };
}

describe("Viewport (constructor unit)", () => {
  test("startWorkerSync 应发送初始 viewport-change 消息", () => {
    const { flushNextFrame, restore } = installMockAnimationFrame();
    const worker = new FakeWorkerEndpoint();
    const canvas = createNoopCanvas();
    const uiCanvas = createNoopCanvas();
    const board = {
      width: 800,
      height: 600,
      devicesDAG: new DevicesDAG(),
      getBoardApi() {
        return null;
      },
    };

    try {
      const viewport = new Viewport(
        {
          rootElement: {},
          canvas,
          uiCanvas,
          worker,
        },
        board,
        { width: 800, height: 600 },
        "main",
      );

      viewport.startWorkerSync();
      flushNextFrame();

      expect(worker.postedMessages[0]).toEqual({
        type: "viewport-change",
        viewportId: "main",
        origin: { x: 0, y: 0 },
        zoom: 1,
        viewportSize: { width: 800, height: 600 },
        force: true,
      });

      viewport.destroy();
    } finally {
      restore();
    }
  });

  test("onRenderFrame 应将合成位图绘制到 canvas 并关闭位图", () => {
    const { restore } = installMockAnimationFrame();
    const context = {
      ...createNoopCanvasContext2D(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    const worker = new FakeWorkerEndpoint();
    const canvas = createNoopCanvas({ context });
    const uiCanvas = createNoopCanvas();
    const board = {
      width: 800,
      height: 600,
      devicesDAG: new DevicesDAG(),
      getBoardApi() {
        return null;
      },
    };

    try {
      const viewport = new Viewport(
        {
          rootElement: {},
          canvas,
          uiCanvas,
          worker,
        },
        board,
        { width: 800, height: 600 },
        "main",
      );
      const invalidateViewportSpy = jest.spyOn(
        viewport.uiRenderer,
        "invalidateViewport",
      );
      const liveBitmap = createNoopImageBitmap({ width: 800, height: 600 });

      viewport.onRenderFrame({
        viewportId: "main",
        liveBitmap,
      });

      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(context.drawImage).toHaveBeenCalledWith(liveBitmap, 0, 0);
      expect(liveBitmap.closed).toBe(true);
      expect(invalidateViewportSpy).toHaveBeenCalledTimes(1);

      viewport.destroy();
    } finally {
      restore();
    }
  });
});

import { createSubDAG } from "../../../devices-dag/index.js";
import { Vector } from "../../../../engine/utils/math.js";
import { createPrefixNodeHandler } from "../../../devices-dag/prefixes/index.js";
import { createWorkerBoardContext } from "../../../../test-support/worker-mode-fixtures.js";

const REPORT_SIGNAL_TYPE = "debug-report";

function createReportSubDAG() {
  let lastReceivedAt = "/";
  let lastOriginalTo = "/";

  const builder = createSubDAG("/debugger");
  const root = builder
    .node()
    .prefix(
      createPrefixNodeHandler({
        initialState: { entryIndex: -1 },
        handle(signalPacket, prefixContext = {}) {
          const sigs = Array.isArray(signalPacket.signals)
            ? signalPacket.signals
            : [];
          lastReceivedAt = prefixContext.path ?? "/";
          lastOriginalTo = signalPacket.to ?? "/";
          prefixContext.patchState({
            entryIndex: (prefixContext.getState().entryIndex ?? -1) + 1,
          });
          return prefixContext.routeToChild("report", sigs);
        },
      }),
      { prefixKind: "debug", routePolicy: "inspect" },
    )
    .defaultRoute("report");

  const report = builder.node().handler((signalPacket, context = {}) => ({
    to: "",
    signals: [
      {
        type: REPORT_SIGNAL_TYPE,
        context: {
          index: 0,
          receivedAt: lastReceivedAt,
          originalTo: lastOriginalTo,
          signalCount: Array.isArray(signalPacket.signals)
            ? signalPacket.signals.length
            : 0,
        },
      },
    ],
  }));

  builder.edge("report", root, report);

  return builder.build();
}

describe("Viewport (integration)", () => {
  test("mountSubDAG 应自动补上 viewportId 后挂载设备", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "alpha",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const reportSubDAG = createReportSubDAG();

      const mountedNodes = viewport.inputScope.mountDevice("", reportSubDAG);
      const packets = viewport.devicesDAG.dispatch({
        to: "/alpha/debugger",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      });

      expect(mountedNodes.map((node) => node.path)).toEqual([
        "/alpha/debugger",
        "/alpha/debugger/report",
      ]);
      expect(packets.packets).toEqual([
        {
          to: "",
          signals: [
            {
              type: REPORT_SIGNAL_TYPE,
              context: {
                index: 0,
                receivedAt: "/alpha/debugger",
                originalTo: "/alpha/debugger",
                signalCount: 1,
              },
            },
          ],
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test("mountSubDAG 应规整不带前导斜杠的相对路径", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "beta",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const reportSubDAG = createReportSubDAG();
      const mountedNodes = viewport.inputScope.mountDevice(
        "debugger",
        reportSubDAG,
      );

      expect(mountedNodes.map((node) => node.path)).toEqual([
        "/beta/debugger",
        "/beta/debugger/report",
      ]);
    } finally {
      cleanup();
    }
  });

  test("screenToChunk 应按二维区块坐标映射命中对应区块", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "gamma",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      expect(viewport.screenToWorld(new Vector(400, 300))).toEqual(
        new Vector(400, 300),
      );

      expect(viewport.worldToChunk(new Vector(400, 300))).toEqual({
        chunkId: 1,
        x: 400,
        y: 300,
      });

      expect(viewport.screenToChunk(new Vector(400, 300))).toEqual({
        chunkId: 1,
        x: 400,
        y: 300,
      });

      expect(viewport.screenToChunk(new Vector(1000, 300))).toEqual({
        chunkId: 2,
        x: 200,
        y: 300,
      });

      expect(viewport.screenToChunk(new Vector(1200, 750))).toEqual({
        chunkId: 3,
        x: 400,
        y: 150,
      });

      expect(viewport.screenToChunk(new Vector(-200, 150))).toEqual({
        chunkId: 6,
        x: 600,
        y: 150,
      });

      viewport.zoom = 2;
      viewport.origin = new Vector(100, 50);

      expect(viewport.screenToChunk(new Vector(400, 250))).toEqual({
        chunkId: 1,
        x: 300,
        y: 175,
      });
    } finally {
      cleanup();
    }
  });

  test("构造后应初始化 uiRenderer 与 canvas 引用", async () => {
    const { viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "delta",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      expect(viewport.uiRenderer).toBeDefined();
      expect(viewport.uiRenderer._scheduler).toBeDefined();
      expect(viewport.canvas).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
