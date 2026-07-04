import { createSubDAG } from "../../../devices-dag/index.js";
import { Vector } from "../../../utils/math.js";
import { createPrefixNodeHandler } from "../../../prefixs/index.js";
import { createWorkerBoardContext } from "../../../test-support/worker-mode-fixtures.js";

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

describe("MonitorProxy", () => {
  test("mountSubDAG 应自动补上 monitorId 后挂载设备", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "alpha",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      const reportSubDAG = createReportSubDAG();

      const mountedNodes = monitor.mountSubDAG("", reportSubDAG);
      const packets = monitor.devicesDAG.dispatch({
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
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "beta",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      const reportSubDAG = createReportSubDAG();
      const mountedNodes = monitor.mountSubDAG("debugger", reportSubDAG);

      expect(mountedNodes.map((node) => node.path)).toEqual([
        "/beta/debugger",
        "/beta/debugger/report",
      ]);
    } finally {
      cleanup();
    }
  });

  test("screenToChunk 应按二维区块坐标映射命中对应区块", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "gamma",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      expect(monitor.screenToWorld(new Vector(400, 300))).toEqual(
        new Vector(400, 300),
      );

      expect(monitor.worldToChunk(new Vector(400, 300))).toEqual({
        chunkId: 1,
        x: 400,
        y: 300,
      });

      expect(monitor.screenToChunk(new Vector(400, 300))).toEqual({
        chunkId: 1,
        x: 400,
        y: 300,
      });

      expect(monitor.screenToChunk(new Vector(1000, 300))).toEqual({
        chunkId: 2,
        x: 200,
        y: 300,
      });

      expect(monitor.screenToChunk(new Vector(1200, 750))).toEqual({
        chunkId: 3,
        x: 400,
        y: 150,
      });

      expect(monitor.screenToChunk(new Vector(-200, 150))).toEqual({
        chunkId: 6,
        x: 600,
        y: 150,
      });

      monitor.zoom = 2;
      monitor.origin = new Vector(100, 50);

      expect(monitor.screenToChunk(new Vector(400, 250))).toEqual({
        chunkId: 1,
        x: 300,
        y: 175,
      });
    } finally {
      cleanup();
    }
  });

  test("构造后应初始化 uiRenderer 与 canvas 引用", async () => {
    const { monitor, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      monitorId: "delta",
      monitorWidth: 800,
      monitorHeight: 600,
    });

    try {
      expect(monitor.uiRenderer).toBeDefined();
      expect(monitor.uiRenderer._scheduler).toBeDefined();
      expect(monitor.canvas).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
