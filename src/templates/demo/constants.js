/**
 * @file demo 配置常量
 * @description 集中管理 demo 的工具属性、工具名、workflow 名与键盘按键映射，作为挂载与日志分类的单一事实源。
 * @module templates/demo/constants
 * @author Zhou Chenyu
 */

/** 笔画颜色（鼠标左键与触摸多指笔画共用） */
const DEMO_PRIMARY_STROKE_COLOR = "#ff0000";

/** 圆工具描边颜色 */
const DEMO_CIRCLE_STROKE_COLOR = "#00aa00";

/** 通用描边宽度 */
const DEMO_STROKE_WIDTH = 2;

/** 视口平移步长（zoom=1 时） */
const DEMO_VIEWPORT_POSITION_STEP = 200;

/** 视口缩放因子 */
const DEMO_VIEWPORT_SCALE_FACTOR = 0.5;

/**
 * demo 工具名枚举
 * @readonly
 * @enum {string}
 */
const DEMO_TOOL_NAMES = Object.freeze({
  STROKE: "stroke",
  CIRCLE: "circle",
  SELECT: "select",
});

/**
 * demo workflow 名注册表
 * @readonly
 * @enum {string}
 */
const DEMO_WORKFLOW_NAMES = Object.freeze({
  PRIMARY_STROKE: "primary-stroke",
  SECONDARY_CHOOSER: "secondary-chooser",
  RANDOM_CIRCLE: "create-circle",
  DEBUG: "debug",
  VIEWPORT: "viewport",
  TOUCH_STROKE: "touch-stroke",
  TOOL_SWITCHER: "tool-switcher",
});

/**
 * WASD 位移键配置，同时用于 handoff 边级 prefix 挂载与日志分类
 * @type {ReadonlyArray<{ code: string, vector: { x: number, y: number } }>}
 */
const WASD_KEYS = Object.freeze([
  { code: "KeyW", vector: { x: 0, y: -1 } },
  { code: "KeyA", vector: { x: -1, y: 0 } },
  { code: "KeyS", vector: { x: 0, y: 1 } },
  { code: "KeyD", vector: { x: 1, y: 0 } },
]);

/**
 * 视口平移键配置
 * @type {ReadonlyArray<{ code: string, direction: { x: number, y: number } }>}
 */
const VIEWPORT_POSITION_KEYS = Object.freeze([
  { code: "ArrowUp", direction: { x: 0, y: -1 } },
  { code: "ArrowDown", direction: { x: 0, y: 1 } },
  { code: "ArrowLeft", direction: { x: -1, y: 0 } },
  { code: "ArrowRight", direction: { x: 1, y: 0 } },
]);

/**
 * 视口缩放键配置
 * @type {ReadonlyArray<{ code: string, scale: "in" | "out" }>}
 */
const VIEWPORT_SCALE_KEYS = Object.freeze([
  { code: "Equal", scale: "in" },
  { code: "NumpadAdd", scale: "in" },
  { code: "Minus", scale: "out" },
  { code: "NumpadSubtract", scale: "out" },
]);

/** 视口刷新键编码列表 */
const VIEWPORT_FLUSH_KEYS = Object.freeze(["KeyR"]);

/**
 * 调试键配置，同时用于 debug 边级 prefix 挂载与日志分类
 * @type {ReadonlyArray<{ code: string, type: string | ((signals: object[]) => string | { type: string, context?: Object }), context?: Object }>}
 */
const DEBUG_KEYS = Object.freeze([
  {
    code: "KeyC",
    type: (signals) =>
      signals.some((s) => s?.context?.shiftKey)
        ? "debug:chunkdetails"
        : "debug:chunkload",
  },
  {
    code: "KeyO",
    type: (signals) =>
      signals.some((s) => s?.context?.shiftKey)
        ? "debug:objectdetails"
        : "debug:objectload",
  },
  { code: "KeyM", type: "debug:viewport" },
  {
    code: "KeyB",
    type: (signals) =>
      signals.some((s) => s?.context?.shiftKey)
        ? "debug:aom"
        : "debug:board",
  },
  {
    code: "KeyT",
    type: (signals) =>
      signals.some((s) => s?.context?.shiftKey)
        ? { type: "debug:devices", context: { mode: "mermaid" } }
        : "debug:devices",
  },
]);

/** 触发随机圆的键编码 */
const RANDOM_CIRCLE_KEY = "Space";

/** 提交修改的键编码 */
const SUBMIT_KEY = "Enter";

/** 取消修改的键编码 */
const CANCEL_KEY = "Escape";

/** 所有需要 demo 处理的键盘编码集合，由各键配置派生 */
const DEMO_KEYBOARD_INPUT_CODES = Object.freeze([
  ...new Set([
    RANDOM_CIRCLE_KEY,
    SUBMIT_KEY,
    CANCEL_KEY,
    ...WASD_KEYS.map((k) => k.code),
    ...VIEWPORT_POSITION_KEYS.map((k) => k.code),
    ...VIEWPORT_SCALE_KEYS.map((k) => k.code),
    ...VIEWPORT_FLUSH_KEYS,
    ...DEBUG_KEYS.map((k) => k.code),
  ]),
]);

export {
  CANCEL_KEY,
  DEBUG_KEYS,
  DEMO_CIRCLE_STROKE_COLOR,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
  DEMO_TOOL_NAMES,
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  DEMO_WORKFLOW_NAMES,
  RANDOM_CIRCLE_KEY,
  SUBMIT_KEY,
  VIEWPORT_FLUSH_KEYS,
  VIEWPORT_POSITION_KEYS,
  VIEWPORT_SCALE_KEYS,
  WASD_KEYS,
};
