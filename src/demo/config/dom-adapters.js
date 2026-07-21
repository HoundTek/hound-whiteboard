/**
 * @file demo DOM 事件适配器
 * @description 将指针、键盘、工具栏按钮、窗口尺寸等 DOM 事件翻译为白板输入信号。
 * @module demo/config/dom-adapters
 * @author Zhou Chenyu
 */

import { Vector } from "../../core/engine/utils/math.js";
import {
  DEMO_BUTTON_GROUP_STATE_KEY,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_TOOL_NAMES,
  DEMO_WORKFLOW_NAMES,
  SUBMIT_KEY,
  CANCEL_KEY,
} from "./constants.js";

/**
 * 绑定指针事件适配器
 * @description
 * 使用 Pointer Events 统一处理鼠标、触摸和笔输入；pointerdown 时 setPointerCapture
 * 保证指针离开 canvas 后仍能收到后续事件。鼠标走 mouse 设备，触摸/笔走 touchscreen 设备。
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../core/ui-thread/components/orchestration/board.js").Board} board - 白板实例
 * @param {import("./log.js").DemoLog} demoLog - demo 日志器
 * @returns {() => void} 解绑函数
 */
function attachPointerAdapter(viewport, board, demoLog) {
  const canvas = viewport.canvas;

  /**
   * 统一指针事件处理器
   * @param {PointerEvent} event
   * @returns {void}
   */
  const onPointer = (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const signals = [];

    if (event.type === "pointerdown") {
      canvas.setPointerCapture(event.pointerId);
      logPointerDown(event, demoLog);
    }

    const canvasPos = new Vector(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );

    const baseContext = {
      value: canvasPos,
      pointerId: String(event.pointerId),
      button: event.button,
      buttons: event.buttons,
      pointerType: event.pointerType,
      domEvent: event.type,
      ctrlKey: Boolean(event.ctrlKey),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
      metaKey: Boolean(event.metaKey),
    };

    if (event.type === "pointerdown" || event.type === "pointermove") {
      signals.push({ type: "position", context: { ...baseContext } });
    }
    if (event.type === "pointerup" || event.type === "pointerleave") {
      signals.push({ type: "end", context: { ...baseContext } });
    }
    if (event.type === "pointercancel") {
      signals.push({ type: "cancel", context: { ...baseContext } });
    }

    if (signals.length === 0) return;

    const devicePath =
      event.pointerType === "mouse"
        ? `/${viewport.viewportId}/mouse`
        : `/${viewport.viewportId}/touchscreen`;

    board.signalsEventBus.emit("input", { to: devicePath, signals });
  };

  const onContextmenu = (event) => event.preventDefault();
  const onDragstart = (event) => event.preventDefault();
  const onSelectstart = (event) => event.preventDefault();
  const onFocus = () => canvas.focus();

  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerup", onPointer);
  canvas.addEventListener("pointerleave", onPointer);
  canvas.addEventListener("pointercancel", onPointer);
  canvas.addEventListener("contextmenu", onContextmenu);
  canvas.addEventListener("dragstart", onDragstart);
  canvas.addEventListener("selectstart", onSelectstart);
  canvas.addEventListener("pointerdown", onFocus);

  return () => {
    canvas.removeEventListener("pointerdown", onPointer);
    canvas.removeEventListener("pointermove", onPointer);
    canvas.removeEventListener("pointerup", onPointer);
    canvas.removeEventListener("pointerleave", onPointer);
    canvas.removeEventListener("pointercancel", onPointer);
    canvas.removeEventListener("contextmenu", onContextmenu);
    canvas.removeEventListener("dragstart", onDragstart);
    canvas.removeEventListener("selectstart", onSelectstart);
    canvas.removeEventListener("pointerdown", onFocus);
  };
}

/**
 * 输出 pointerdown 时的输入分类日志
 * @param {PointerEvent} event - 指针事件
 * @param {import("./log.js").DemoLog} demoLog - demo 日志器
 * @returns {void}
 */
function logPointerDown(event, demoLog) {
  if (event.pointerType === "mouse") {
    if (event.button === 0) {
      const activeBtn = document.querySelector(".toolbar-btn.active");
      const toolLabel = activeBtn?.textContent?.trim() ?? "笔画";
      demoLog.logPointerInput(`左键 ${toolLabel}`);
    } else if (event.button === 2) {
      demoLog.logPointerInput("右键选择-修改");
    } else {
      demoLog.logPointerInput("鼠标输入");
    }
    return;
  }
  demoLog.logPointerInput(`触摸指针 ${event.pointerId}`);
}

/**
 * 绑定键盘事件适配器
 * @description
 * 仅处理 demo 关心的键位（见 DEMO_KEYBOARD_INPUT_CODES），跳过含 meta/ctrl 的组合键。
 * Enter/Escape 额外向 tool-switcher 发送 success/cancel，使左键选择工具也能响应确认/取消。
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../core/ui-thread/components/orchestration/board.js").Board} board - 白板实例
 * @param {import("./log.js").DemoLog} demoLog - demo 日志器
 * @returns {() => void} 解绑函数
 */
function attachKeyboardAdapter(viewport, board, demoLog) {
  const canvas = viewport.canvas;
  const keyboardInputCodes = new Set(DEMO_KEYBOARD_INPUT_CODES);

  /**
   * 是否处理该键盘事件
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  const shouldHandle = (event) => {
    if (event.metaKey || event.ctrlKey) return false;
    return keyboardInputCodes.has(event.code);
  };

  /**
   * 键盘事件处理器
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  const onKey = (event) => {
    if (!shouldHandle(event)) return;
    event.preventDefault();
    if (event.type === "keydown") {
      demoLog.logKeyInput(event.code);
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

    // Enter/Escape → 也发一份到 tool-switcher，让当前激活工具（如左键选择 handoff）响应
    if (event.code === SUBMIT_KEY || event.code === CANCEL_KEY) {
      const signalType = event.code === SUBMIT_KEY ? "success" : "cancel";
      board.signalsEventBus.emit("input", {
        to: `/${viewport.viewportId}/workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}`,
        signals: [{ type: signalType, context: {} }],
      });
    }
  };

  /**
   * blur 时向键盘设备发送 end，终结未释放的按键
   * @returns {void}
   */
  const onBlur = () => {
    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/keyboard`,
      signals: [{ type: "end", context: { domEvent: "blur" } }],
    });
  };

  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKey);
  canvas.addEventListener("blur", onBlur);

  return () => {
    canvas.removeEventListener("keydown", onKey);
    canvas.removeEventListener("keyup", onKey);
    canvas.removeEventListener("blur", onBlur);
  };
}

/**
 * 绑定工具栏按钮适配器
 * @description
 * 读取 .toolbar-btn 按钮列表，将 pointerdown 翻译为 button-press 信号发往按钮组设备；
 * 订阅 sharedState 的激活工具键同步 DOM 高亮（订阅后立即应用一次当前值）。
 * 返回工具列表与默认工具名，供 mountToolSwitcher 使用。
 * @param {import("../../core/ui-thread/components/orchestration/board.js").Board} board - 白板实例
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @returns {{ tools: Array<{ name: string }>, defaultTool: string, cleanup: () => void } | null}
 */
function attachToolbarAdapter(board, viewport) {
  const vpId = viewport.viewportId;
  const buttons = document.querySelectorAll(".toolbar-btn");
  if (!buttons.length) return null;

  /** @type {Array<() => void>} */
  const unbinds = [];

  for (const btn of buttons) {
    const toolName = btn.dataset.tool;
    if (!toolName) continue;

    const onPointerDown = (event) => {
      event.preventDefault();
      board.signalsEventBus.emit("input", {
        to: `/${vpId}/toolbar/button-group`,
        signals: [{ type: "button-press", context: { toolName } }],
      });
    };
    btn.addEventListener("pointerdown", onPointerDown);
    unbinds.push(() => btn.removeEventListener("pointerdown", onPointerDown));
  }

  const tools = Array.from(buttons)
    .map((btn) => btn.dataset.tool)
    .filter(Boolean)
    .map((name) => ({ name }));

  const defaultTool = buttons[0]?.dataset.tool ?? DEMO_TOOL_NAMES.STROKE;

  /**
   * 同步 DOM 按钮 active 类
   * @param {string} activeTool - 当前激活工具名
   * @returns {void}
   */
  const applyActiveTool = (activeTool) => {
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === activeTool);
    });
  };

  // 订阅 sharedState 同步高亮；订阅后立即应用一次当前值（无值时用默认工具兜底）
  const unsubscribe = board.sharedState.subscribe(
    DEMO_BUTTON_GROUP_STATE_KEY,
    (activeTool) => applyActiveTool(activeTool ?? defaultTool),
  );
  applyActiveTool(
    board.sharedState.get(DEMO_BUTTON_GROUP_STATE_KEY) ??
    defaultTool,
  );
  unbinds.push(unsubscribe);

  return {
    tools,
    defaultTool,
    cleanup: () => unbinds.forEach((fn) => fn()),
  };
}

/**
 * 绑定滚轮事件适配器
 * @description
 * 监听 #app-left 上的滚轮事件，将滚动偏移转换为视口平移信号（scroll-to-pan）。
 * 支持 Magic Mouse、触控板与鼠标滚轮。使用 passive: false 确保能 preventDefault。
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../core/ui-thread/components/orchestration/board.js").Board} board - 白板实例
 * @param {HTMLElement} appLeft - 左侧容器元素
 * @param {Object} [options={}] - 可选参数
 * @param {number} [options.sensitivity=1] - 滚动敏感度系数（越大平移越快）
 * @returns {() => void} 解绑函数
 */
function attachWheelAdapter(viewport, board, appLeft, options = {}) {
  const sensitivity = options.sensitivity ?? 1;

  // 不同 deltaMode 到像素的转换因子
  const LINE_HEIGHT = 16;
  const PAGE_FACTOR = 0.8;

  /**
   * 将 wheel delta 统一转换为像素值
   * @param {WheelEvent} event
   * @returns {{ x: number, y: number }}
   */
  const deltaToPixels = (event) => {
    let dx = event.deltaX;
    let dy = event.deltaY;
    const mode = event.deltaMode;

    if (mode === 1) {
      // DOM_DELTA_LINE
      dx *= LINE_HEIGHT;
      dy *= LINE_HEIGHT;
    } else if (mode === 2) {
      // DOM_DELTA_PAGE
      dx *= appLeft.clientWidth * PAGE_FACTOR;
      dy *= appLeft.clientHeight * PAGE_FACTOR;
    }

    return { x: dx, y: dy };
  };

  /**
   * 滚轮事件处理器
   * @param {WheelEvent} event
   * @returns {void}
   */
  const onWheel = (event) => {
    event.preventDefault();

    const zoom = viewport.zoom ?? 1;
    const origin = viewport.origin;
    const pixelDelta = deltaToPixels(event);

    const newOrigin = new Vector(
      origin.x + pixelDelta.x * sensitivity / zoom,
      origin.y + pixelDelta.y * sensitivity / zoom,
    );

    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/workflows/${DEMO_WORKFLOW_NAMES.VIEWPORT}`,
      signals: [
        {
          type: "position",
          context: {
            value: newOrigin,
            sourceType: "wheel",
          },
        },
      ],
    });
  };

  appLeft.addEventListener("wheel", onWheel, { passive: false });
  return () => appLeft.removeEventListener("wheel", onWheel);
}

/**
 * 绑定窗口尺寸适配器
 * @description 窗口 resize 时同步视口根元素与各渲染层尺寸。
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {HTMLElement} appLeft - 左侧容器元素
 * @returns {() => void} 解绑函数
 */
function attachResizeAdapter(viewport, appLeft) {
  const resize = () => {
    const width = appLeft.clientWidth;
    const height = window.innerHeight;
    viewport.rootElement.style.width = `${width}px`;
    viewport.rootElement.style.height = `${height}px`;
    viewport.resizeRenderLayers(width, height);
  };

  resize();
  window.addEventListener("resize", resize);
  return () => window.removeEventListener("resize", resize);
}

export {
  attachKeyboardAdapter,
  attachPointerAdapter,
  attachResizeAdapter,
  attachToolbarAdapter,
  attachWheelAdapter,
};
