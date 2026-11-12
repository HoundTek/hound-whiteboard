/**
 * @file whiteboard demo 浏览器入口
 * @description 初始化 whiteboard demo 页面，装配 board/viewport/worker、demo 配置与 DOM 适配器。
 * @module demo/whiteboard
 * @author Zhou Chenyu
 */

import { Vector } from "../kernel/utils/math.js";
import { Board } from "../ui/components/orchestration/board.js";
import { AwarenessOverlay } from "../ui/components/renderer/awareness-overlay.js";
import { createConsolePrinter, logBus } from "../utils/log/index.js";
import {
  configureWhiteboardDemo,
  mountToolSwitcher,
} from "./config/whiteboard-demo.js";
import { broadcastHitChanged } from "./config/hit-changed-broadcast.js";
import { resolveDeviceSource } from "../utils/device-identity.js";
import { installSyncConsole } from "./config/sync-console.js";
import { enableWorkerWithFallback } from "./config/enable-worker-with-fallback.js";
import { installGracefulShutdown } from "./config/graceful-shutdown.js";
import { DemoLog } from "./config/log.js";
import { ViewportTool } from "./config/viewport-tool.js";
import {
  attachDeleteAdapter,
  attachHistoryAdapter,
  attachKeyboardAdapter,
  attachPointerAdapter,
  attachResizeAdapter,
  attachToolbarAdapter,
  attachWheelAdapter,
} from "./config/dom-adapters.js";

// Demo 独立入口，需要手动注册控制台输出器
createConsolePrinter(logBus, { timestamps: true });

/**
 * 启动 whiteboard demo 页面
 * @returns {Promise<void>}
 */
async function bootstrapWhiteboard() {
  // hwb 控制台命令的 board 惰性引用（install 早于 board 创建，调试命令在用时才取值）
  let boardRef = null;
  installSyncConsole({ getBoard: () => boardRef });
  // demo 板目录：家目录下 hound-whiteboard/demo-board（首次运行自动创建）
  // 同步中继：URL ?relay= 或 localStorage hwb-relay（双开时第二窗口用 localStorage 设不同值）
  // 身份：URL ?source= 或 localStorage hwb-source（同机双开需不同身份）
  // 板副本：URL ?board=（双开时第二窗口用不同路径，各自持久化副本）
  const query = new URLSearchParams(globalThis.location?.search ?? "");
  const storage = globalThis.localStorage;
  const relayUrl =
    query.get("relay") ?? storage?.getItem?.("hwb-relay") ?? undefined;
  const sourceOverride =
    query.get("source") ?? storage?.getItem?.("hwb-source") ?? undefined;
  const boardPath =
    query.get("board") ?? storage?.getItem?.("hwb-board") ?? undefined;
  // 无 Tauri（浏览器 web demo）：无文件系统能力，降级为内存模式 + relay 同步，
  // 落盘由持板 daemon 承担（relay 来源的记录由 daemon 落盘）；?board= 在 web 下随之失效
  const tauriAvailable = Boolean(
    globalThis.__TAURI__?.core?.invoke ?? globalThis.__TAURI_INTERNALS__?.invoke,
  );
  const board = new Board({
    idSource: sourceOverride ?? resolveDeviceSource(),
    rootPath: tauriAvailable
      ? (boardPath ?? "~/hound-whiteboard/demo-board")
      : undefined,
    syncUrl: relayUrl,
    boardId: "demo-board",
  });
  boardRef = board;

  const appLeft = document.getElementById("app-left");
  const foregroundLayer = document.getElementById("app-foreground-layer");
  if (!appLeft || !foregroundLayer) {
    throw new Error("whiteboard demo root elements not found.");
  }

  const worker = await enableWorkerWithFallback(
    board,
    () =>
      new Worker(new URL("../host/core-worker.js", import.meta.url), {
        type: "module",
      }),
    {
      onFallback(error) {
        console.warn(
          `[whiteboard] 持久化开板失败，回退内存模式：${error?.message ?? error}`,
        );
      },
    },
  );

  // 关窗前销毁 BoardCore：回收板 daemon 创建者引用，daemon 无其他引用时随即退出
  await installGracefulShutdown(board.getBoardApi(), { tauriAvailable });

  const viewport = board.createViewport(
    foregroundLayer,
    {
      width: appLeft.clientWidth,
      height: window.innerHeight,
    },
    "viewport",
  );
  viewport.zoom = 1.0;
  viewport.origin = new Vector(0, 0);
  viewport.canvas.tabIndex = 0;

  const demoLog = new DemoLog();

  demoLog.status("运行模式", "Worker");
  demoLog.status(
    "左键工具",
    "工具栏切换：笔画 | 圆 | 选择+修改",
  );
  demoLog.status("右键工具", "矩形框选 -> 修改对象");
  demoLog.status("空格工具", "随机圆对象");
  demoLog.status("视口快捷键", "方向键平移，+/- 缩放，R 全屏刷新");

  const viewportTool = new ViewportTool({
    onViewportChange(targetViewport) {
      demoLog.status("视口状态", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
    onFlush(targetViewport) {
      demoLog.status("视口全屏刷新", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
  });

  const demoResults = configureWhiteboardDemo(board, viewport, { viewportTool });

  // 协作感知装饰：远程命名选择的着色框与来源标签
  const awarenessOverlay = new AwarenessOverlay({
    boardApi: board.getBoardApi(),
    viewport,
  });
  awarenessOverlay.start();

  // 远程文档变化：广播 hit:changed 让工具清理失效选中（幽灵选择）。
  // 远端通知不携带 forcedEndMolIds（对端被强制闭合的分子经 amend 通道的 mol-end 另行到达）；
  // 本地 undo 的 forcedEndMolIds 由 dom-adapters 的 hit:changed 信号携带，勿混淆两条路径。
  viewport.addAwarenessListener((message) => {
    if (message?.awarenessType !== "hit-changed") return;
    broadcastHitChanged(board, viewport.viewportId);
  });

  const toolbar = attachToolbarAdapter(board, viewport);
  if (toolbar) {
    mountToolSwitcher(viewport, {
      tools: toolbar.tools,
      defaultTool: toolbar.defaultTool,
      primaryStrokeTool: demoResults.primaryStrokeTool,
    });
  }

  attachPointerAdapter(viewport, board, demoLog);
  attachKeyboardAdapter(viewport, board, demoLog, toolbar?.tools);
  attachHistoryAdapter(board, viewport);
  attachDeleteAdapter(board, viewport);
  attachResizeAdapter(viewport, appLeft);
  attachWheelAdapter(viewport, board, appLeft);

  viewport.canvas.focus();
}

void bootstrapWhiteboard().catch((error) => {
  console.error("[whiteboard] Failed to bootstrap whiteboard demo:", error);
});
