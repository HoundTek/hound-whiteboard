/**
 * @file whiteboard demo 浏览器入口
 * @description 初始化 whiteboard demo 页面，通过 Worker 与 BoardCore 通信。
 * @module templates/whiteboard
 * @author Zhou Chenyu
 */

import { Vector } from "../core/utils/math.js";
import { Board } from "../core/ui/components/orchestration/board.js";
import { Logger } from "../utils/log/logger.js";
import { logBus } from "../utils/log/log-bus.js";
import { createConsolePrinter } from "../utils/log/console-printer.js";
import {
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
} from "./demo/whiteboard-demo.js";
import { ViewportTool } from "./demo/viewport-tool.js";

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

  const worker = new Worker(new URL("../core/worker/core-worker.js", import.meta.url), {
    type: "module",
  });

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

  const demoLog = new Logger("Demo", "INFO", logBus);

  /**
   * 输出 demo 状态日志
   * @param {string} label - 日志标签
   * @param {*} [payload] - 附加载荷
   * @returns {void}
   */
  const logDemoStatus = (label, payload) => {
    if (payload === undefined) {
      demoLog.info(label);
      return;
    }

    demoLog.info(label, payload);
  };

  const viewportTool = new ViewportTool({
    onViewportChange(targetViewport) {
      logDemoStatus("视口状态", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
    onFlush(targetViewport) {
      logDemoStatus("视口全屏刷新", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
  });

  logDemoStatus("运行模式", "Worker");
  logDemoStatus("左键工具", "红色笔画对象");
  logDemoStatus("右键工具", "矩形框选 -> 修改对象");
  logDemoStatus("空格工具", "随机圆对象");
  logDemoStatus("视口快捷键", "方向键平移，+/- 缩放，R 全屏刷新");
  configureWhiteboardDemo(board, viewport, {
    viewportTool,
  });

  const resizeViewport = () => {
    const width = appLeft.clientWidth;
    const height = window.innerHeight;
    viewport.rootElement.style.width = `${width}px`;
    viewport.rootElement.style.height = `${height}px`;
    viewport.resizeRenderLayers(width, height);
  };

  resizeViewport();

  const emitMousePacket = (event) => {
    const signals = [];

    if (event.type === "mousedown") {
      event.preventDefault();
      if (event.button === 0) {
        logDemoStatus("当前输入", "左键红笔");
      } else if (event.button === 2) {
        logDemoStatus("当前输入", "右键选择-修改");
      } else {
        logDemoStatus("当前输入", "鼠标输入");
      }
    }

    if (
      event.type === "mousedown" ||
      event.type === "mousemove" ||
      event.type === "mouseup"
    ) {
      const worldPosition = viewport.screenToWorld(
        new Vector(event.clientX, event.clientY),
      );
      if (!worldPosition) return;

      const baseContext = {
        value: worldPosition,
        button: event.button,
        buttons: event.buttons,
        domEvent: event.type,
        ctrlKey: Boolean(event.ctrlKey),
        shiftKey: Boolean(event.shiftKey),
        altKey: Boolean(event.altKey),
        metaKey: Boolean(event.metaKey),
      };

      signals.push({ type: "position", context: baseContext });
    }

    if (event.type === "mouseup") {
      signals.push({
        type: "end",
        context: {
          button: event.button,
          buttons: event.buttons,
          domEvent: event.type,
        },
      });
    }

    if (event.type === "mouseleave") {
      signals.push({
        type: "end",
        context: {
          buttons: event.buttons,
          domEvent: event.type,
        },
      });
    }

    if (signals.length === 0) return;

    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/mouse`,
      signals,
    });
  };

  const emitWindowMouseUpPacket = (event) => {
    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/mouse`,
      signals: [
        {
          type: "end",
          context: {
            button: event.button,
            buttons: event.buttons,
            domEvent: event.type,
          },
        },
      ],
    });
  };

  viewport.canvas.addEventListener("mousedown", emitMousePacket);
  viewport.canvas.addEventListener("mousemove", emitMousePacket);
  viewport.canvas.addEventListener("mouseup", emitMousePacket);
  window.addEventListener("mouseup", emitWindowMouseUpPacket);
  viewport.canvas.addEventListener("mouseleave", emitMousePacket);
  viewport.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  viewport.canvas.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });
  viewport.canvas.addEventListener("selectstart", (event) => {
    event.preventDefault();
  });

  const keyboardInputCodes = new Set(DEMO_KEYBOARD_INPUT_CODES);

  const shouldHandleKeyboardEvent = (event) => {
    if (event.metaKey || event.ctrlKey) {
      return false;
    }

    return keyboardInputCodes.has(event.code);
  };

  const emitKeyboardPacket = (event) => {
    if (!shouldHandleKeyboardEvent(event)) return;

    event.preventDefault();
    if (event.type === "keydown") {
      if (event.code === "Space") {
        logDemoStatus("当前输入", "空格随机圆");
      } else if (
        event.code === "ArrowUp" ||
        event.code === "ArrowDown" ||
        event.code === "ArrowLeft" ||
        event.code === "ArrowRight" ||
        event.code === "Equal" ||
        event.code === "Minus" ||
        event.code === "NumpadAdd" ||
        event.code === "NumpadSubtract" ||
        event.code === "KeyR"
      ) {
        logDemoStatus("当前输入", `viewport ${event.code}`);
      } else if (
        event.code === "KeyC" ||
        event.code === "KeyO" ||
        event.code === "KeyM" ||
        event.code === "KeyB" ||
        event.code.startsWith("Digit")
      ) {
        logDemoStatus("当前输入", `debug ${event.code}`);
      } else if (event.code === "Enter") {
        logDemoStatus("当前输入", "handoff Enter");
      } else if (event.code === "Escape") {
        logDemoStatus("当前输入", "handoff Escape");
      } else {
        logDemoStatus("当前输入", `WASD ${event.code}`);
      }
    }

    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/keyboard`,
      signals: [
        {
          type: event.type,
          context: {
            key: event.key,
            code: event.code,
            repeat: Boolean(event.repeat),
            ctrlKey: Boolean(event.ctrlKey),
            shiftKey: Boolean(event.shiftKey),
            altKey: Boolean(event.altKey),
            metaKey: Boolean(event.metaKey),
            domEvent: event.type,
          },
        },
      ],
    });
  };

  const emitKeyboardCancelPacket = () => {
    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/keyboard`,
      signals: [{ type: "end", context: { domEvent: "blur" } }],
    });
  };

  viewport.canvas.addEventListener("mousedown", () => {
    viewport.canvas.focus();
  });
  viewport.canvas.addEventListener("keydown", emitKeyboardPacket);
  viewport.canvas.addEventListener("keyup", emitKeyboardPacket);
  viewport.canvas.addEventListener("blur", emitKeyboardCancelPacket);
  window.addEventListener("resize", resizeViewport);

  viewport.canvas.focus();
}

void bootstrapWhiteboard().catch((error) => {
  console.error("[whiteboard] Failed to bootstrap whiteboard demo:", error);
});
