/**
 * @file 构建 TUI 应用（Ink 5）
 * @description 独立进程，通过 TCP 接收 JSON 消息，用 Ink 渲染分屏布局。
 *              主动退出模式：不依赖 waitUntilExit，确保终端始终恢复。
 * @module scripts/build/tui-app
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useStdin } from 'ink';
import net from 'net';

const IPC_PORT = parseInt(process.argv[2], 10);
if (!IPC_PORT) {
  process.stderr.write('Usage: node tui-app/index.mjs <port>\n');
  process.exit(1);
}

// ============================================================
//  Module-level state
// ============================================================

let gTasks = [];
let gExitOk = false;
let gRenderInstance = null;
let gExiting = false;
let gFirstErrorLine = -1;
let gFirstErrorSourceIdx = -1;
let gErrorLogs = [];
/** @type {{lineIdx: number, col: number}|null} 选择锚点（按下位置） */
let gSelAnchor = null;
/** @type {{lineIdx: number, col: number}|null} 选择焦点（拖拽当前位置） */
let gSelFocus = null;

// ============================================================
//  Error detection
// ============================================================

const ERROR_RE = /(?:error|fail|fatal|ENOENT|ECONNREFUSED|EACCES)/i;

function isErrorLine(line) {
  return ERROR_RE.test(line);
}

// ============================================================
//  Constants
// ============================================================

const STATUS = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed', SKIPPED: 'skipped' };

const STATUS_ICONS = {
  [STATUS.PENDING]: '\u25CB',
  [STATUS.RUNNING]: '\u25CF',
  [STATUS.DONE]: '\u2713',
  [STATUS.FAILED]: '\u2717',
  [STATUS.SKIPPED]: '\u00D7',
};

const STATUS_COLORS = {
  [STATUS.PENDING]: 'grey',
  [STATUS.RUNNING]: 'cyan',
  [STATUS.DONE]: 'green',
  [STATUS.FAILED]: 'red',
  [STATUS.SKIPPED]: 'grey',
};

// ============================================================
//  Line truncation
// ============================================================

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * 去除 ANSI 转义序列和 OSC 超链接等控制序列
 * @param {string} str - 原始字符串
 * @returns {string} 纯文本
 */
function stripAnsi(str) {
  return str.replace(OSC_RE, '').replace(ANSI_RE, '');
}

/**
 * 判断字符是否为宽字符（CJK、表情等占 2 列）
 * @param {number} cp - Unicode code point
 * @returns {boolean}
 */
function isWideChar(cp) {
  return (cp >= 0x1100 && cp <= 0x115F)   // Hangul Jamo
      || (cp >= 0x2E80 && cp <= 0xA4CF)   // CJK Radicals..Yi
      || (cp >= 0xAC00 && cp <= 0xD7A3)   // Hangul Syllables
      || (cp >= 0xF900 && cp <= 0xFAFF)   // CJK Compatibility Ideographs
      || (cp >= 0xFE10 && cp <= 0xFE19)   // Vertical forms
      || (cp >= 0xFE30 && cp <= 0xFE6F)   // CJK Compatibility Forms
      || (cp >= 0xFF01 && cp <= 0xFF60)   // Fullwidth Forms
      || (cp >= 0xFFE0 && cp <= 0xFFE6)   // Fullwidth Signs
      || (cp >= 0x1F300 && cp <= 0x1F64F) // Emoticons
      || (cp >= 0x1F900 && cp <= 0x1F9FF) // Supplemental Symbols
      || (cp >= 0x20000 && cp <= 0x2FFFD) // CJK Extension B+
      || (cp >= 0x30000 && cp <= 0x3FFFD); // CJK Extension G+
}

/**
 * 计算字符串的可视列宽（CJK 占 2 列）
 * @param {string} str - 纯文本（无 ANSI）
 * @returns {number} 可视列数
 */
function visualWidth(str) {
  let w = 0;
  for (const ch of str) {
    w += isWideChar(ch.codePointAt(0)) ? 2 : 1;
  }
  return w;
}

/**
 * 将字符串截断到指定可视宽度，保留 ANSI 转义序列，超出尾部加 …
 * @param {string} str - 原始字符串（可含 ANSI）
 * @param {number} maxWidth - 最大可视列宽
 * @returns {string} 截断后的字符串（保留 ANSI）
 */
function truncateToWidth(str, maxWidth) {
  if (maxWidth <= 0) return '';

  // 解析为段落：ANSI 序列 vs 普通文本
  const segments = [];
  let lastEnd = 0;
  let match;
  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(str)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ ansi: false, text: str.slice(lastEnd, match.index) });
    }
    segments.push({ ansi: true, text: match[0] });
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < str.length) {
    segments.push({ ansi: false, text: str.slice(lastEnd) });
  }
  if (segments.length === 0) return '';

  // 计算总可视宽度
  let totalWidth = 0;
  for (const seg of segments) {
    if (!seg.ansi) totalWidth += visualWidth(seg.text);
  }
  if (totalWidth <= maxWidth) return str;

  // 需截断：逐字符推进，保留 ANSI
  let result = '';
  let w = 0;
  for (const seg of segments) {
    if (seg.ansi) {
      result += seg.text;
      continue;
    }
    for (const ch of seg.text) {
      const cw = isWideChar(ch.codePointAt(0)) ? 2 : 1;
      if (w + cw > maxWidth - 1) {
        return result + '\x1b[0m\u2026';
      }
      w += cw;
      result += ch;
    }
  }
  return result + '\u2026';
}

/**
 * 从字符串开头取指定可视宽度的字符
 * @param {string} str - 输入字符串
 * @param {number} maxW - 最大可视宽度
 * @returns {{ line: string, rest: string }} 截取的行和剩余部分
 */
function takeVisualChars(str, maxW) {
  const chars = [...str];
  let w = 0;
  let i = 0;
  for (; i < chars.length; i++) {
    const cw = isWideChar(chars[i].codePointAt(0)) ? 2 : 1;
    if (w + cw > maxW) break;
    w += cw;
  }
  return { line: chars.slice(0, i).join(''), rest: chars.slice(i).join('') };
}

/**
 * 将单行日志折行到指定宽度，续行使用悬挂缩进
 * @param {string} str - 单行日志（可含前导 "\x1b[NNm●\x1b[0m " 颜色标记）
 * @param {number} maxWidth - 最大列宽
 * @param {number} indentWidth - 续行缩进宽度（默认 2，匹配 "● " 宽度）
 * @returns {string[]} 折行后的显示行数组
 */
function wrapLine(str, maxWidth, indentWidth = 2) {
  // 检测前导 ● 标记（颜色 ANSI + ● + 复位 + 空格）
  const bulletMatch = str.match(/^(\x1b\[\d+m\u25cf\x1b\[0m) /);
  let content;
  let bulletPrefix = '';
  if (bulletMatch) {
    bulletPrefix = bulletMatch[1] + ' ';
    content = str.slice(bulletMatch[0].length);
  } else {
    content = str;
  }

  const firstWidth = bulletMatch ? maxWidth - 2 : maxWidth; // "● " 占用 2 可视列
  const contWidth = maxWidth - indentWidth;
  const indent = ' '.repeat(indentWidth);
  const lines = [];

  // 首行
  const { line: firstLine, rest: afterFirst } = takeVisualChars(content, firstWidth);
  lines.push(bulletPrefix + firstLine);

  // 续行
  let remaining = afterFirst;
  while (remaining.length > 0) {
    const trimmed = remaining.replace(/^\s+/, ''); // 折行处去除前导空白
    if (trimmed.length === 0) break;
    const { line, rest } = takeVisualChars(trimmed, contWidth);
    lines.push(indent + line);
    remaining = rest;
  }

  return lines;
}

// ============================================================
//  Text selection
// ============================================================

/**
 * 检测显示行的前缀偏移（圆点提示 ● 或悬挂缩进），选择/高亮时应跳过
 * @param {string} plain - 去除 ANSI 后的纯文本行
 * @returns {number} 应跳过的可视列数
 */
function getPrefixSkip(plain) {
  // 首行：● 前缀（颜色标记已在 stripAnsi 后变为 "\u25cf "）
  if (plain.startsWith('\u25cf ')) return 2;
  // 续行：两个空格悬挂缩进（排除分页指示行 "  — N-M / Total —"）
  if (/^  [^ \u2014]/.test(plain)) return 2;
  return 0;
}

/**
 * 在行内对指定可视列范围施加反色高亮，自动跳过装饰性前缀
 * @param {string} line - 显示行（可含 ANSI 前缀）
 * @param {number} startCol - 起始可视列（0-based）
 * @param {number} endCol - 结束可视列（0-based，Infinity 表示行尾）
 * @returns {string} 带反色高亮的行
 */
function highlightRange(line, startCol, endCol) {
  const plain = stripAnsi(line);
  const prefixSkip = getPrefixSkip(plain);
  startCol = Math.max(startCol, prefixSkip);
  if (startCol >= endCol) return line;

  const totalWidth = visualWidth(plain);
  if (startCol >= totalWidth) return line;

  const effEnd = endCol === Infinity || !isFinite(endCol) ? totalWidth : Math.min(endCol, totalWidth);
  if (startCol >= effEnd) return line;

  // 解析为 ANSI 段落
  const segments = [];
  let lastEnd = 0;
  let match;
  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(line)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ ansi: false, text: line.slice(lastEnd, match.index) });
    }
    segments.push({ ansi: true, text: match[0] });
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < line.length) {
    segments.push({ ansi: false, text: line.slice(lastEnd) });
  }

  let result = '';
  let visualCol = 0;

  for (const seg of segments) {
    if (seg.ansi) {
      result += seg.text;
      continue;
    }
    for (const ch of seg.text) {
      if (visualCol === startCol) {
        result += '\x1b[7m';
      }
      const cw = isWideChar(ch.codePointAt(0)) ? 2 : 1;
      visualCol += cw;
      result += ch;
      if (visualCol === effEnd) {
        result += '\x1b[0m';
      }
    }
  }

  // 若高亮延伸到行尾则关闭
  if (visualCol > startCol && visualCol <= effEnd) {
    result += '\x1b[0m';
  }

  return result;
}

/**
 * 获取某显示行在选择中的高亮范围
 * @param {number} lineIdx - 显示行索引
 * @param {{lineIdx: number, col: number}|null} anchor - 锚点
 * @param {{lineIdx: number, col: number}|null} focus - 焦点
 * @returns {{startCol: number, endCol: number}|null} 高亮列范围或 null
 */
function getLineHighlight(lineIdx, anchor, focus) {
  if (!anchor || !focus) return null;

  const l1 = anchor.lineIdx, c1 = anchor.col;
  const l2 = focus.lineIdx, c2 = focus.col;

  if (l1 === l2) {
    if (lineIdx !== l1) return null;
    return { startCol: Math.min(c1, c2), endCol: Math.max(c1, c2) };
  }

  const startLine = Math.min(l1, l2);
  const endLine = Math.max(l1, l2);

  if (lineIdx < startLine || lineIdx > endLine) return null;

  if (lineIdx === startLine) {
    return { startCol: l1 < l2 ? c1 : c2, endCol: Infinity };
  }
  if (lineIdx === endLine) {
    return { startCol: 0, endCol: l1 > l2 ? c1 : c2 };
  }
  return { startCol: 0, endCol: Infinity };
}

/**
 * 提取选中文本（纯文本，不含 ANSI）
 * @param {string[]} logs - 日志显示行数组
 * @param {{lineIdx: number, col: number}} anchor - 锚点
 * @param {{lineIdx: number, col: number}} focus - 焦点
 * @returns {string} 选中文本
 */
function getSelectedText(logs, anchor, focus) {
  if (!anchor || !focus) return '';

  const l1 = anchor.lineIdx, c1 = anchor.col;
  const l2 = focus.lineIdx, c2 = focus.col;

  const startLine = Math.min(l1, l2);
  const endLine = Math.max(l1, l2);

  let startCol, endCol;
  if (l1 < l2) { startCol = c1; endCol = c2; }
  else if (l1 > l2) { startCol = c2; endCol = c1; }
  else { startCol = Math.min(c1, c2); endCol = Math.max(c1, c2); }

  const result = [];
  for (let i = startLine; i <= endLine; i++) {
    if (i < 0 || i >= logs.length) continue;
    const plain = stripAnsi(logs[i]);
    const totalW = visualWidth(plain);
    // 跳过装饰性前缀（圆点提示/悬挂缩进）
    const prefixSkip = getPrefixSkip(plain);

    const s = i === startLine ? Math.max(prefixSkip, Math.min(startCol, totalW)) : prefixSkip;
    const e = i === endLine ? Math.min(endCol, totalW) : totalW;

    if (s >= e) { result.push(''); continue; }

    const { rest: fromStart } = takeVisualChars(plain, s);
    const { line: selected } = takeVisualChars(fromStart, e - s);
    result.push(selected);
  }

  return result.join('\n');
}

/**
 * 通过 OSC 52 将文本写入系统剪贴板
 * @param {string} text - 要复制的文本
 */
function copyOsc52(text) {
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

// ============================================================
//  Formatting
// ============================================================

function formatElapsed(ms) {
  if (ms == null || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

/**
 * 安全退出：确保终端复位
 */
function safeExit(code) {
  if (gExiting) return;
  gExiting = true;

  // 停止 React 渲染
  if (gRenderInstance) {
    try { gRenderInstance.unmount(); } catch (_) {}
    try { gRenderInstance.clear(); } catch (_) {}
  }

  // 清空 alternate screen 残留 → 恢复终端 → 立即退出（不用 setImmediate，避免事件循环刷写 Ink 残留帧）
  process.stdout.write('\x1b[2J\x1b[H\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1006l');
  process.exitCode = code;
  process.exit(code);
}

// ============================================================
//  Components
// ============================================================

function TaskRow({ task, liveElapsed, prefix }) {
  const icon = STATUS_ICONS[task.status] || task.status;
  const color = task.status === STATUS.PENDING
    ? 'grey'
    : (task.color || STATUS_COLORS[task.status] || 'white');

  const elapsedText = task.status === STATUS.RUNNING && liveElapsed != null
    ? formatElapsed(liveElapsed)
    : task.elapsed != null && task.status === STATUS.DONE
      ? formatElapsed(task.elapsed)
      : null;

  return React.createElement(
    Box,
    null,
    prefix != null && React.createElement(Text, { color: 'grey' }, prefix),
    React.createElement(Text, { color }, `  ${icon}  ${task.name}`),
    elapsedText != null
      && React.createElement(Text, { color: task.status === STATUS.RUNNING ? color : 'grey' }, `  ${elapsedText}`),
    task.status === STATUS.FAILED && React.createElement(Text, { color: 'red' }, '  FAILED'),
  );
}

function App({ port }) {
  const [tasks, setTasks] = useState([]);
  /** @type {[import('react').Dispatch<Array<{ name: string, color: string, indices: number[], prefix: string }>>]} */
  const [rows, setRows] = useState([]);
  /** @type {[{ logs: string[], scrollOffset: number }, Function]} 合并状态确保原子更新，避免日志行与偏移分帧导致抖动 */
  const [logState, setLogState] = useState({ logs: [], scrollOffset: 0 });
  const [exiting, setExiting] = useState(false);
  const [tick, setTick] = useState(0);
  /** 文本选择状态（React 状态驱动重渲染，同时同步到 gSelAnchor/gSelFocus 供非 React 上下文读取） */
  const [selAnchor, setSelAnchor] = useState(null);
  const [selFocus, setSelFocus] = useState(null);
  /** Ink 内部事件发射器，用于统一接收 stdin 输入（避免 data/readable 流模式冲突） */
  const { internal_eventEmitter } = useStdin();
  const scrollOffsetRef = useRef(0);
  const tasksRef = useRef(tasks);
  /** @type {{ current: number[] }} 每个任务 index 的运行起始时间戳 */
  const runningSinceRef = useRef([]);
  const logsRef = useRef([]);
  /** 源日志行引用（折行前），用于终端 resize 时重新折行 */
  const sourceLogsRef = useRef([]);
  /** 日志面板的屏幕 Y 坐标范围（1-based，含边框），用于判断滚轮是否在面板内 */
  const logPanelYStart = useRef(1);
  const logPanelYEnd = useRef(1);
  /** 渲染函数计算的日志可见行数，供键盘/鼠标处理器使用，确保 maxOffset 一致 */
  const logVisibleRef = useRef(20);

  tasksRef.current = tasks;
  scrollOffsetRef.current = logState.scrollOffset;
  logsRef.current = logState.logs;
  gSelAnchor = selAnchor;
  gSelFocus = selFocus;

  // 100ms 定时器驱动运行中计时器刷新
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let buf = '';
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.setEncoding('utf8');

    sock.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        try { handleMsg(JSON.parse(l)); } catch (_) { /* skip */ }
      }
    });

    sock.on('end', () => {
      if (buf.trim()) {
        try { handleMsg(JSON.parse(buf)); } catch (_) { /* skip */ }
      }
      gTasks = [...tasksRef.current];
      gExitOk = false;
      safeExit(0);
    });

    sock.on('error', () => {
      gTasks = [...tasksRef.current];
      gExitOk = false;
      safeExit(0);
    });

    return () => {
      try { sock.destroy(); } catch (_) { /* ok */ }
    };
  }, []);

  // 键盘滚动 / 结算页退出 / 选择清除
  useInput((_input, key) => {
    if (exiting) {
      safeExit(gExitOk ? 0 : 1);
      return;
    }
    // Escape 清除文本选择
    if (key.escape) {
      if (selAnchor || selFocus) {
        setSelAnchor(null);
        setSelFocus(null);
      }
      return;
    }
    const total = logState.logs.length;
    if (total === 0) return;
    const visible = logVisibleRef.current;
    const maxOffset = Math.max(0, total - visible);
    if (key.upArrow) {
      setLogState((prev) => ({ ...prev, scrollOffset: Math.min(maxOffset, prev.scrollOffset + 1) }));
    } else if (key.downArrow) {
      setLogState((prev) => ({ ...prev, scrollOffset: Math.max(0, prev.scrollOffset - 1) }));
    } else if (key.pageUp) {
      setLogState((prev) => ({ ...prev, scrollOffset: Math.min(maxOffset, prev.scrollOffset + visible) }));
    } else if (key.pageDown) {
      setLogState((prev) => ({ ...prev, scrollOffset: Math.max(0, prev.scrollOffset - visible) }));
    } else if (key.home) {
      setLogState((prev) => ({ ...prev, scrollOffset: maxOffset }));
    } else if (key.end) {
      setLogState((prev) => ({ ...prev, scrollOffset: 0 }));
    }
  });

  // 鼠标滚轮 + 文本选择（通过 Ink internal_eventEmitter 统一接收，避免 data/readable 流模式冲突）
  useEffect(() => {
    // 启用鼠标追踪：1000(按钮事件) + 1002(拖拽移动) + 1006(SGR 扩展格式)
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');

    const onMouse = (chunk) => {
      const str = chunk.toString();
      // SGR 鼠标事件: \x1b[<Pb;Px;PyM (按下) 或 \x1b[<Pb;Px;Pym (释放)
      const m = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (!m) return;
      const btn = parseInt(m[1], 10);
      const px = parseInt(m[2], 10);
      const py = parseInt(m[3], 10);
      const isPress = m[4] === 'M';

      // 滚轮事件
      if (btn === 64 || btn === 65) {
        if (py < logPanelYStart.current || py > logPanelYEnd.current) return;
        const total = logsRef.current.length;
        if (total === 0) return;
        const visible = logVisibleRef.current;
        const maxOffset = Math.max(0, total - visible);
        const step = 3;
        if (btn === 64) {
          setLogState((prev) => ({ ...prev, scrollOffset: Math.min(maxOffset, prev.scrollOffset + step) }));
        } else if (btn === 65) {
          setLogState((prev) => ({ ...prev, scrollOffset: Math.max(0, prev.scrollOffset - step) }));
        }
        return;
      }

      // 文本选择：左键按下 (0) / 拖拽移动 (32) / 左键释放 (0m)
      if (btn === 0 && isPress) {
        const visible = logVisibleRef.current;
        const total = logsRef.current.length;
        // 点击在日志面板外 → 清除选择
        if (py < logPanelYStart.current + 1 || py > logPanelYStart.current + visible || total === 0) {
          setSelAnchor(null);
          setSelFocus(null);
          return;
        }
        const clampedOffset = Math.min(scrollOffsetRef.current, Math.max(0, total - visible));
        const start = total - visible - clampedOffset;
        const lineIdx = start + (py - logPanelYStart.current - 1);
        if (lineIdx < 0 || lineIdx >= total) return;
        const col = Math.max(0, px - 1); // 1-based → 0-based，减去左边框
        const anchor = { lineIdx, col };
        setSelAnchor(anchor);
        setSelFocus(anchor);
        gSelAnchor = anchor;
        gSelFocus = anchor;
      } else if (btn === 32) {
        // 拖拽移动：扩展选择（需要已有锚点；允许越界，自动钳制到首/末行）
        if (!gSelAnchor) return;
        const visible = logVisibleRef.current;
        const total = logsRef.current.length;
        const clampedOffset = Math.min(scrollOffsetRef.current, Math.max(0, total - visible));
        const start = total - visible - clampedOffset;
        const rawLineIdx = start + (py - logPanelYStart.current - 1);
        const lineIdx = Math.max(0, Math.min(total - 1, rawLineIdx));
        const col = Math.max(0, px - 1);
        const focus = { lineIdx, col };
        setSelFocus(focus);
        gSelFocus = focus;
      } else if (btn === 0 && !isPress) {
        // 左键释放：完成选择并复制到剪贴板
        if (!gSelAnchor) return;
        const text = getSelectedText(logsRef.current, gSelAnchor, gSelFocus);
        if (text.length > 0) {
          copyOsc52(text);
        }
      }
    };

    internal_eventEmitter.on('input', onMouse);
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
      internal_eventEmitter.removeListener('input', onMouse);
    };
  }, []);

  // 终端 resize：重新折行并保持滚动位置
  useEffect(() => {
    const onResize = () => {
      const srcLines = sourceLogsRef.current;
      if (srcLines.length === 0) return;
      const newMaxWidth = Math.max(20, (process.stdout.columns || 80) - 4);
      const newLogs = [];
      for (const src of srcLines) {
        newLogs.push(...wrapLine(src, newMaxWidth, 2));
      }
      const prevLogs = logsRef.current;
      const prevOffset = scrollOffsetRef.current;
      const prevVisible = logVisibleRef.current;
      const newTotal = newLogs.length;
      const newVisible = Math.max(5, Math.min(prevVisible, (process.stdout.rows || 24) - 8));
      // 按比例保持滚动位置：以第一条可见显示行为基准
      let newOffset;
      if (prevLogs.length > 0 && prevOffset === 0) {
        // 已在底部（跟底），保持跟底
        newOffset = 0;
      } else if (prevLogs.length > 0 && prevVisible > 0) {
        const prevTopIdx = prevLogs.length - prevVisible - prevOffset;
        // 按比例映射：prevTopIdx / prevLogs.length ≈ newTopIdx / newTotal
        const ratio = Math.max(0, Math.min(1, prevTopIdx / Math.max(1, prevLogs.length)));
        const newTopIdx = Math.round(ratio * newTotal);
        newOffset = Math.max(0, newTotal - newVisible - newTopIdx);
      } else {
        newOffset = 0;
      }
      // 跟踪首次报错行（显示行索引）
      gFirstErrorLine = -1;
      for (let i = 0; i < newLogs.length; i++) {
        if (isErrorLine(newLogs[i])) {
          gFirstErrorLine = i;
          break;
        }
      }
      setLogState({ logs: newLogs, scrollOffset: newOffset });
    };
    process.stdout.on('resize', onResize);
    return () => { process.stdout.removeListener('resize', onResize); };
  }, []);

  function handleMsg(msg) {
    switch (msg.type) {
      case 'init':
        gFirstErrorLine = -1;
        gFirstErrorSourceIdx = -1;
        sourceLogsRef.current = [];
        setSelAnchor(null);
        setSelFocus(null);
        setTasks(
          (msg.tasks || []).map((item) =>
            typeof item === 'string'
              ? { name: item, status: STATUS.PENDING }
              : { ...item, status: item.status || STATUS.PENDING },
          ),
        );
        setRows(msg.rows || []);
        setLogState({ logs: [], scrollOffset: 0 });
        break;

      case 'status':
        setTasks((prev) => {
          const next = [...prev];
          if (msg.index < next.length) {
            next[msg.index] = {
              ...next[msg.index],
              status: msg.status || STATUS.PENDING,
              elapsed: msg.elapsed,
            };
            if (msg.color != null) {
              next[msg.index].color = msg.color;
            }
            if (msg.status === STATUS.RUNNING) {
              runningSinceRef.current[msg.index] = Date.now();
            }
          }
          return next;
        });
        break;

      case 'log':
        if (msg.text != null) {
          // 保留前导 ● 颜色标记，剥离其余 ANSI（如 cargo warning 着色）
          const bulletMatch = msg.text.match(/^(\x1b\[\d+m\u25cf\x1b\[0m) /);
          const plain = bulletMatch
            ? bulletMatch[1] + ' ' + stripAnsi(msg.text.slice(bulletMatch[0].length))
            : stripAnsi(msg.text);
          // 折行后存储：每条显示行独立，scrollOffset 与显示行一一对应
          const maxLogWidth = Math.max(20, (process.stdout.columns || 80) - 4);
          const wrapped = wrapLine(plain, maxLogWidth, 2);
          // 存储源行（折行前），用于 resize 时重新折行
          sourceLogsRef.current.push(plain);
          if (sourceLogsRef.current.length > 2000) {
            sourceLogsRef.current.shift();
            if (gFirstErrorSourceIdx >= 0) gFirstErrorSourceIdx--;
          }
          if (gFirstErrorSourceIdx < 0 && isErrorLine(plain)) {
            gFirstErrorSourceIdx = sourceLogsRef.current.length - 1;
          }
          // 合并更新：logs 和 scrollOffset 原子变更，避免分帧渲染导致内容跳动
          setLogState((prev) => {
            const next = [...prev.logs.slice(-2000), ...wrapped];
            // 跟踪首次报错行（显示行索引）
            if (gFirstErrorLine < 0 && isErrorLine(plain)) {
              gFirstErrorLine = next.length - 1;
            }
            const newOffset = gSelAnchor
              ? prev.scrollOffset + wrapped.length  // 选择中：维持视觉位置，禁止自动跟底
              : (prev.scrollOffset > 0 ? prev.scrollOffset + wrapped.length : 0);
            return { logs: next, scrollOffset: newOffset };
          });
        }
        break;

      case 'exit':
        gTasks = [...tasksRef.current];
        gExitOk = msg.ok !== false;
        setSelAnchor(null);
        setSelFocus(null);
        // 失败时截取报错相关日志
        if (!gExitOk) {
          const sliced = gFirstErrorLine >= 0 ? logsRef.current.slice(gFirstErrorLine) : logsRef.current.slice(-30);
          gErrorLogs = sliced;
          setLogState({ logs: sliced, scrollOffset: 0 });
        } else {
          setLogState(prev => ({ ...prev, logs: [] }));
        }
        setExiting(true);
        break;
    }
  }

  if (exiting) {
    // 结算页面：全量任务终态 + 结果横幅 + 错误日志
    const failed = tasks.filter((t) => t.status === STATUS.FAILED).length;
    const done = tasks.filter((t) => t.status === STATUS.DONE).length;
    const skipped = tasks.filter((t) => t.status === STATUS.SKIPPED).length;
    const ok = failed === 0;

    // 结算页展开全部任务（不限折叠）
    const allRows = rows.length > 0 ? rows : tasks.map((t, i) => ({ name: t.name, color: t.color, indices: [i], prefix: '', depth: 0 }));

    return React.createElement(
      Box,
      { flexDirection: 'column', height: '100%', paddingTop: 1 },
      // 结果横幅
      React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          { backgroundColor: ok ? 'green' : 'red', color: 'white', bold: true },
          ok ? '  BUILD SUCCEEDED  ' : '  BUILD FAILED  ',
        ),
      ),
      // 统计行
      React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          { color: 'grey' },
          `  ${done} done  ${failed} failed  ${skipped} skipped  ${tasks.length} total`,
        ),
      ),
      React.createElement(Box, { height: 1 }),
      // 错误日志（仅失败时）
      !ok && logs.length > 0 && (() => {
        const usedByTasks = allRows.length;
        const visible = Math.max(5, (process.stdout.rows || 24) - usedByTasks - 10);
        logVisibleRef.current = visible;
        const total = logs.length;
        logPanelYStart.current = 4;
        logPanelYEnd.current = 4 + 2 + visible + (total > visible ? 1 : 0);
        const clampedOffset = Math.min(scrollOffset, Math.max(0, total - visible));
        const start = total - visible - clampedOffset;
        const end = total - clampedOffset;
        const windowLines = logs.slice(Math.max(0, start), end);
        return React.createElement(
          Box,
          { flexGrow: 1, flexDirection: 'column', borderStyle: 'round', borderColor: 'red', overflow: 'hidden' },
          ...windowLines.map((line, i) => {
            const lineIdx = start + i;
            const hl = getLineHighlight(lineIdx, selAnchor, selFocus);
            return React.createElement(Text, { key: lineIdx }, hl ? highlightRange(line, hl.startCol, hl.endCol) : line);
          }),
          total > visible && React.createElement(
            Text,
            { color: 'grey' },
            `  \u2014 ${start + 1}-${end} / ${total} \u2014`,
          ),
        );
      })(),
      React.createElement(Box, { height: 1 }),
      // 退出提示
      React.createElement(
        Box,
        null,
        React.createElement(Text, { color: 'grey' }, '  Press any key to exit'),
      ),
      React.createElement(Box, { flexGrow: 1 }),
      // 任务终态列表（底部）
      React.createElement(
        Box,
        { flexDirection: 'column' },
        ...allRows.map((row, ri) => {
          if (row.indices.length === 1) {
            const i = row.indices[0];
            const t = tasks[i] || { status: STATUS.PENDING };
            return React.createElement(TaskRow, { key: `sr${ri}`, task: t, prefix: row.prefix || null });
          }
          // 多索引链：每步显示各自状态着色，使用调色板色
           const members = row.indices.map((i) => tasks[i] || { status: STATUS.PENDING, elapsed: null });
           const stepNodes = [];
           for (let s = 0; s < members.length; s++) {
             const m = members[s];
             const ic = STATUS_ICONS[m.status] || m.status;
             const sc = m.status === STATUS.PENDING ? 'grey' : (m.color || STATUS_COLORS[m.status] || 'white');
             if (s > 0) {
               stepNodes.push(React.createElement(Text, { key: `sar${ri}_${s}`, color: 'grey' }, ' \u2192 '));
             }
             stepNodes.push(React.createElement(Text, { key: `sic${ri}_${s}`, color: sc }, ic));
             stepNodes.push(React.createElement(Text, { key: `snm${ri}_${s}`, color: sc }, ` ${m.name}`));
           }
           return React.createElement(
             Box,
             { key: `sr${ri}` },
             row.prefix != null && React.createElement(Text, { color: 'grey' }, row.prefix),
             React.createElement(Text, null, '  '),
             ...stepNodes,
           );
        }),
      ),
    );
  }

  const done = tasks.filter((t) => t.status === STATUS.DONE).length;
  const failed = tasks.filter((t) => t.status === STATUS.FAILED).length;
  const skipped = tasks.filter((t) => t.status === STATUS.SKIPPED).length;
  const total = tasks.length;

  const { logs, scrollOffset } = logState;

  // 为每行构造 getLiveElapsed
  const getLiveElapsed = (ri) => {
    if (runningSinceRef.current[ri] != null)
      return Date.now() - runningSinceRef.current[ri];
    return null;
  };

  // 过滤：收起已完成节点。兄弟节点全部完成后一起消失。
  const visibleRows = (() => {
    const src = rows.length > 0 ? rows : tasks.map((t, i) => ({ name: t.name, color: t.color, indices: [i], prefix: '', depth: 0 }));
    const n = src.length;
    const allDone = src.map((row) =>
      row.indices.every((idx) => {
        const s = tasks[idx]?.status;
        return s === STATUS.DONE || s === STATUS.SKIPPED;
      }),
    );

    // 找每行的父节点（最近的上方更浅行）
    const parent = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      for (let p = i - 1; p >= 0; p--) {
        if (src[p].depth < src[i].depth) { parent[i] = p; break; }
      }
    }

    // 按 (parent, depth) 分组兄弟
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const key = `${parent[i]}:${src[i].depth}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }

    // Pass 1: 自底向上，已完成节点若有可见子孙则保留
    const vis = new Array(n).fill(false);
    for (let i = n - 1; i >= 0; i--) {
      if (!allDone[i]) { vis[i] = true; continue; }
      for (let j = i + 1; j < n && src[j].depth > src[i].depth; j++) {
        if (vis[j]) { vis[i] = true; break; }
      }
    }

    // Pass 2: 兄弟统合 — 任一兄弟可见则全组可见
    for (const indices of groups.values()) {
      if (indices.some((i) => vis[i])) {
        for (const i of indices) vis[i] = true;
      }
    }

    return src.filter((_, i) => vis[i]);
  })();

  return React.createElement(
    Box,
    { flexDirection: 'column', height: '100%', paddingTop: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(
        Text,
        { backgroundColor: 'cyan', color: 'black', bold: true },
        ` Build  [${done}/${total}] ` + (failed > 0 ? ` ${failed} failed ` : '') + (skipped > 0 ? ` ${skipped} skipped ` : '')
      ),
    ),
    React.createElement(Box, { height: 1 }),
    React.createElement(
      Box,
      { flexDirection: 'column' },
      ...visibleRows.map((row, ri) => {
        if (row.indices.length === 1) {
          const i = row.indices[0];
          const t = tasks[i] || { status: STATUS.PENDING };
          const liveElapsed = t.status === STATUS.RUNNING && runningSinceRef.current[i] != null
            ? Date.now() - runningSinceRef.current[i]
            : null;
          return React.createElement(TaskRow, { key: `r${ri}`, task: t, liveElapsed, prefix: row.prefix || null });
        }
        // 多索引链：每步显示各自状态着色
        const members = row.indices.map((i) => tasks[i] || { status: STATUS.PENDING, elapsed: null });
        const hasRunning = members.some((m) => m.status === STATUS.RUNNING);
        const allTerminal = members.every((m) => m.status === STATUS.DONE || m.status === STATUS.SKIPPED);
        let chainLive = null;
        if (hasRunning) {
          const runningIdx = row.indices.find((i) => tasks[i]?.status === STATUS.RUNNING);
          if (runningIdx != null) chainLive = getLiveElapsed(runningIdx);
        }
        // 构建每步着色元素：前缀 → [icon name] → [icon name] ...
         // 每步用其调色板色（与日志 ● 颜色一致），pending 用 grey
         const stepNodes = [];
         for (let s = 0; s < members.length; s++) {
           const m = members[s];
           const ic = STATUS_ICONS[m.status] || m.status;
           const sc = m.status === STATUS.PENDING ? 'grey' : (m.color || STATUS_COLORS[m.status] || 'white');
           if (s > 0) {
             stepNodes.push(React.createElement(Text, { key: `ar${ri}_${s}`, color: 'grey' }, ' \u2192 '));
           }
           stepNodes.push(React.createElement(Text, { key: `ic${ri}_${s}`, color: sc }, ic));
           stepNodes.push(React.createElement(Text, { key: `nm${ri}_${s}`, color: sc }, ` ${m.name}`));
         }
         let chainElapsed = null;
         if (allTerminal) {
           chainElapsed = Math.max(...members.map((m) => m.elapsed || 0));
         } else if (chainLive != null) {
           chainElapsed = chainLive;
         }
         return React.createElement(
           Box,
           { key: `r${ri}` },
           row.prefix != null && React.createElement(Text, { color: 'grey' }, row.prefix),
           React.createElement(Text, null, '  '),
           ...stepNodes,
           chainElapsed != null && React.createElement(Text, { color: 'grey' }, `  ${formatElapsed(chainElapsed)}`),
         );
      }),
    ),
    React.createElement(Box, { height: 1 }),
    // 可滚动日志面板
    logs.length > 0 && (() => {
      // 可用行数：终端高度 - 头部(1) - 间距(1) - 任务区(visibleRows) - 间距(1) - 边框(2) - 指示器(1)
      const usedByTasks = visibleRows.length;
      const visible = Math.max(5, (process.stdout.rows || 24) - usedByTasks - 8);
      logVisibleRef.current = visible;
      const total = logs.length;
      // 计算日志面板在屏幕上的 Y 坐标范围（1-based），用于滚轮区域判断
      logPanelYStart.current = 4 + usedByTasks;
      logPanelYEnd.current = logPanelYStart.current + 2 + visible + (total > visible ? 1 : 0);
      const clampedOffset = Math.min(scrollOffset, Math.max(0, total - visible));
      const start = total - visible - clampedOffset;
      const end = total - clampedOffset;
      const windowLines = logs.slice(Math.max(0, start), end);
      return React.createElement(
        Box,
        { flexGrow: 1, flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', overflow: 'hidden' },
        ...windowLines.map((line, i) => {
          const lineIdx = start + i;
          const hl = getLineHighlight(lineIdx, selAnchor, selFocus);
          return React.createElement(Text, { key: lineIdx }, hl ? highlightRange(line, hl.startCol, hl.endCol) : line);
        }),
        total > visible && React.createElement(
          Text,
          { color: 'grey' },
          `  \u2014 ${start + 1}-${end} / ${total} \u2014`,
        ),
      );
    })(),
  );
}

// ============================================================
//  Error boundary
// ============================================================

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) {
    process.stderr.write('TUI Error: ' + error.message + '\n' + error.stack + '\n');
    safeExit(1);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ============================================================
//  Render
// ============================================================

process.on('uncaughtException', (err) => {
  process.stderr.write('TUI Fatal: ' + err.message + '\n' + err.stack + '\n');
  safeExit(1);
});

process.on('unhandledRejection', (err) => {
  process.stderr.write('TUI Rejection: ' + (err && err.message || err) + '\n');
  safeExit(1);
});

gRenderInstance = render(
  React.createElement(ErrorBoundary, null, React.createElement(App, { port: IPC_PORT })),
  { patchConsole: false }
);
