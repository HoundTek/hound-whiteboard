/**
 * @file demo 日志与输入分类
 * @description 封装 demo 状态日志输出，并基于 constants 的按键配置派生键盘输入分类与快捷键说明。
 * @module demo/config/log
 * @author Zhou Chenyu
 */

import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";
import {
  CANCEL_KEY,
  DEBUG_KEYS,
  RANDOM_CIRCLE_KEY,
  SUBMIT_KEY,
  TOOL_SWITCH_KEYS,
  VIEWPORT_FLUSH_KEYS,
  VIEWPORT_POSITION_KEYS,
  VIEWPORT_SCALE_KEYS,
  WASD_KEYS,
} from "./constants.js";

/** 视口相关键编码集合（平移 + 缩放 + 刷新） */
const VIEWPORT_KEY_CODES = new Set([
  ...VIEWPORT_POSITION_KEYS.map((k) => k.code),
  ...VIEWPORT_SCALE_KEYS.map((k) => k.code),
  ...VIEWPORT_FLUSH_KEYS,
]);

/** 调试键编码集合 */
const DEBUG_KEY_CODES = new Set(DEBUG_KEYS.map((k) => k.code));

/** WASD 键编码集合 */
const WASD_KEY_CODES = new Set(WASD_KEYS.map((k) => k.code));

/** 数字键切工具键编码集合 */
const TOOL_SWITCH_KEY_CODES = new Set(TOOL_SWITCH_KEYS);

/**
 * 将键盘编码映射为可读的输入标签
 * @description 分类规则与各 workflow 挂载的键配置同源，避免日志与路由各硬编码一份。
 * @param {string} code - 键盘编码
 * @returns {string} 输入标签
 */
function classifyKeyInput(code) {
  if (code === RANDOM_CIRCLE_KEY) return "空格随机圆";
  if (code === SUBMIT_KEY) return "成功提交（handoff + tool-switcher）";
  if (code === CANCEL_KEY) return "取消修改（handoff + tool-switcher）";
  if (TOOL_SWITCH_KEY_CODES.has(code)) return `数字键切换工具 ${code}`;
  if (VIEWPORT_KEY_CODES.has(code)) return `viewport ${code}`;
  if (DEBUG_KEY_CODES.has(code)) return `debug ${code}`;
  if (WASD_KEY_CODES.has(code)) return `WASD ${code}`;
  return `keyboard ${code}`;
}

/**
 * demo 状态日志器
 * @description 统一封装 demo 运行期状态日志，提供带载荷与不带载荷两种输出形式。
 */
class DemoLog {
  /**
   * @param {string} [name="Demo"] - logger 通道名
   * @param {string} [level="INFO"] - logger 级别
   */
  constructor(name = "Demo", level = "INFO") {
    /**
     * 底层 logger 实例
     * @type {Logger}
     */
    this.logger = new Logger(name, level, logBus);
  }

  /**
   * 输出一条状态日志
   * @param {string} label - 日志标签
   * @param {*} [payload] - 附加载荷，省略时只输出标签
   * @returns {void}
   */
  status(label, payload) {
    if (payload === undefined) {
      this.logger.info(label);
      return;
    }
    this.logger.info(label, payload);
  }

  /**
   * 输出键盘输入分类日志
   * @param {string} code - 键盘编码
   * @returns {void}
   */
  logKeyInput(code) {
    this.status("当前输入", classifyKeyInput(code));
  }

  /**
   * 输出指针输入分类日志
   * @param {string} label - 已分类的指针输入标签
   * @returns {void}
   */
  logPointerInput(label) {
    this.status("当前输入", label);
  }

  /**
   * 输出数字键快捷键切工具日志
   * @param {string} toolName - 切换到的工具名
   * @returns {void}
   */
  logToolSwitch(toolName) {
    this.status("切换工具", toolName);
  }
}

/**
 * 格式化快捷键说明文本
 * @description 用于 demo 启动时在日志通道输出快捷键一览，内容与 constants 配置保持一致。
 * @returns {string} 多行快捷键说明
 */
function formatShortcutLegend() {
  return [
    "── 快捷键 ──",
    "左键 : 创建笔画",
    "数字键 1-9 : 切换激活工具（按工具栏顺序）",
    "右键 : 首次拖拽框选对象 → 再次拖拽修改位置",
    "Enter : 提交修改",
    "Escape : 取消修改",
    "Space : 随机圆",
    "W/A/S/D : 移动选中对象（二次拖拽激活后）",
    "方向键 : 平移视口",
    "+/- : 缩放视口",
    "R : 刷新视口",
    "C : 区块加载  |  Shift+C : 区块详情",
    "O : 对象加载  |  Shift+O : 对象详情",
    "M : 视口摘要",
    "B : 白板摘要  |  Shift+B : AOM 分层",
    "T : 设备图    |  Shift+T : 设备图 Mermaid",
    "",
    "── 触摸 ──",
    "触摸拖动 : 多指同时创建笔画（每指独立）",
  ].join("\n");
}

export { classifyKeyInput, DemoLog, formatShortcutLegend };
