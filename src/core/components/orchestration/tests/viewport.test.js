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

describe("ViewportProxy", () => {
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

      const mountedNodes = viewport.mountSubDAG("", reportSubDAG);
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
      const mountedNodes = viewport.mountSubDAG("debugger", reportSubDAG);

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
