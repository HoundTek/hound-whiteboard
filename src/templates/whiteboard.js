/**
 * @file whiteboard demo 浏览器入口
 * @description 初始化 whiteboard demo 页面，装配 board/viewport/worker、demo 配置与 DOM 适配器。
 * @module templates/whiteboard
 * @author Zhou Chenyu
 */

import { Vector } from "../core/utils/math.js";
import { Board } from "../core/ui/components/orchestration/board.js";
import { createConsolePrinter, logBus } from "../utils/log/index.js";
import {
  configureWhiteboardDemo,
  mountToolSwitcher,
} from "./demo/whiteboard-demo.js";
import { DemoLog } from "./demo/log.js";
import { ViewportTool } from "./demo/viewport-tool.js";
import {
  attachKeyboardAdapter,
  attachPointerAdapter,
  attachResizeAdapter,
  attachToolbarAdapter,
  attachWheelAdapter,
} from "./demo/dom-adapters.js";

// Demo 独立入口，需要手动注册控制台输出器
createConsolePrinter(logBus, { timestamps: true });

/**
 * 启动 whiteboard demo 页面
 * @returns {Promise<void>}
 */
async function bootstrapWhiteboard() {
  const board = new Board();
  board.width = 800;
  board.height = 600;

  const appLeft = document.getElementById("app-left");
  const foregroundLayer = document.getElementById("app-foreground-layer");
  if (!appLeft || !foregroundLayer) {
    throw new Error("whiteboard demo root elements not found.");
  }

  const worker = new Worker(
    new URL("../core/worker/core-worker.js", import.meta.url),
    { type: "module" },
  );

  try {
    await board.enableWorkerMode(worker);
  } catch (error) {
    worker.terminate?.();
    throw error;
  }

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

  const toolbar = attachToolbarAdapter(board, viewport);
  if (toolbar) {
    mountToolSwitcher(board, viewport, {
      tools: toolbar.tools,
      defaultTool: toolbar.defaultTool,
      primaryStrokeTool: demoResults.primaryStrokeTool,
      onToolChange: toolbar.onToolChange,
    });
  }

  attachPointerAdapter(viewport, board, demoLog);
  attachKeyboardAdapter(viewport, board, demoLog);
  attachResizeAdapter(viewport, appLeft);
  attachWheelAdapter(viewport, board, appLeft);

  viewport.canvas.focus();
}

void bootstrapWhiteboard().catch((error) => {
  console.error("[whiteboard] Failed to bootstrap whiteboard demo:", error);
});
