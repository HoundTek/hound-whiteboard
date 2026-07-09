/**
 * @file 构建 TUI 应用（Ink 5）
 * @description 独立进程，通过 TCP 接收 JSON 消息，用 Ink 渲染分屏布局。
 *              主动退出模式：不依赖 waitUntilExit，确保终端始终恢复。
 * @module scripts/build/tui-app
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text } from 'ink';
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
let gErrorLogs = [];

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

const STATUS = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed' };

const STATUS_ICONS = {
  [STATUS.PENDING]: '\u25CB',
  [STATUS.RUNNING]: '\u25CF',
  [STATUS.DONE]: '\u2713',
  [STATUS.FAILED]: '\u2717',
};

const STATUS_COLORS = {
  [STATUS.PENDING]: 'grey',
  [STATUS.RUNNING]: 'cyan',
  [STATUS.DONE]: 'green',
  [STATUS.FAILED]: 'red',
};

// ============================================================
//  Line truncation
// ============================================================

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * 去除 ANSI 转义序列
 * @param {string} str - 原始字符串
 * @returns {string} 纯文本
 */
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
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
 * 将字符串截断到指定可视宽度，超出尾部加 …
 * @param {string} str - 原始字符串（可含 ANSI）
 * @param {number} maxWidth - 最大可视列宽
 * @returns {string} 截断后的纯文本
 */
function truncateToWidth(str, maxWidth) {
  if (maxWidth <= 0) return '';
  const clean = stripAnsi(str);
  if (visualWidth(clean) <= maxWidth) return clean;

  let w = 0;
  let cutIdx = 0;
  for (let i = 0; i < clean.length; i++) {
    const cw = isWideChar(clean.codePointAt(i)) ? 2 : 1;
    if (w + cw > maxWidth - 1) break; // -1 留给 …
    w += cw;
    cutIdx = i + 1;
  }
  return clean.slice(0, cutIdx) + '\u2026';
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

function buildSummary() {
  let text = '\n';
  let failed = false;
  for (const t of gTasks) {
    switch (t.status) {
      case STATUS.DONE:
        text += `\x1b[32m  ✓  ${t.name}  ${formatElapsed(t.elapsed)}\x1b[0m\n`;
        break;
      case STATUS.FAILED:
        text += `\x1b[31m  ✗  ${t.name}  FAILED\x1b[0m\n`;
        failed = true;
        break;
      case STATUS.RUNNING:
        text += `\x1b[33m  ●  ${t.name}  (interrupted)\x1b[0m\n`;
        break;
      default:
        text += `\x1b[90m  ○  ${t.name}\x1b[0m\n`;
    }
  }
  if (!gExitOk) failed = true;

  if (failed && gErrorLogs.length > 0) {
    text += '\n\x1b[90m── error output ──\x1b[0m\n';
    text += gErrorLogs.join('\n') + '\n';
    text += '\x1b[90m── end ──\x1b[0m\n';
  }

  text += '\n' + (failed ? '\x1b[31mBuild FAILED\x1b[0m' : '\x1b[32mBuild SUCCESS\x1b[0m') + '\n';
  return { text, failed };
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

  // 强制恢复终端
  process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l');

  // 写摘要
  const { text } = buildSummary();
  process.stdout.write(text);

  // 同步退出
  setImmediate(() => process.exit(code));
}

// ============================================================
//  Components
// ============================================================

function TaskRow({ task, liveElapsed }) {
  const icon = STATUS_ICONS[task.status] || task.status;
  const color = STATUS_COLORS[task.status] || 'white';

  /** 运行中显示实时计时，完成后显示精确耗时 */
  const elapsedText = task.status === STATUS.RUNNING && liveElapsed != null
    ? formatElapsed(liveElapsed)
    : task.elapsed != null && task.status === STATUS.DONE
      ? formatElapsed(task.elapsed)
      : null;

  return React.createElement(
    Box,
    null,
    React.createElement(Text, { color }, `  ${icon}  ${task.name}`),
    elapsedText != null
      && React.createElement(Text, { color: task.status === STATUS.RUNNING ? 'cyan' : 'grey' }, `  ${elapsedText}`),
    task.status === STATUS.FAILED && React.createElement(Text, { color: 'red' }, '  FAILED'),
  );
}

function App({ port }) {
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [exiting, setExiting] = useState(false);
  const [tick, setTick] = useState(0);
  const tasksRef = useRef(tasks);
  /** @type {{ current: number[] }} 每个任务 index 的运行起始时间戳 */
  const runningSinceRef = useRef([]);

  tasksRef.current = tasks;

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

  function handleMsg(msg) {
    switch (msg.type) {
      case 'init':
        gFirstErrorLine = -1;
        setTasks(
          (msg.tasks || []).map((name) =>
            typeof name === 'string' ? { name, status: STATUS.PENDING } : name
          )
        );
        setLogs([]);
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
            if (msg.status === STATUS.RUNNING) {
              runningSinceRef.current[msg.index] = Date.now();
            }
          }
          return next;
        });
        break;

      case 'log':
        if (msg.text != null) {
          setLogs((prev) => {
            const next = [...prev.slice(-500), msg.text];
            // 跟踪首次报错行
            if (gFirstErrorLine < 0 && isErrorLine(msg.text)) {
              gFirstErrorLine = next.length - 1;
            }
            return next;
          });
        }
        break;

      case 'exit':
        gTasks = [...tasksRef.current];
        gExitOk = msg.ok !== false;
        setExiting(true);
        if (gExitOk) {
          // 成功：清空日志，只输出摘要
          gErrorLogs = [];
          setLogs([]);
          setTimeout(() => safeExit(0), 50);
        } else {
          // 失败：保留从首次报错开始的日志
          setLogs((prev) => {
            const sliced = gFirstErrorLine >= 0 ? prev.slice(gFirstErrorLine) : prev.slice(-30);
            gErrorLogs = sliced;
            return sliced;
          });
          // 留 500ms 给用户看到错误输出
          setTimeout(() => safeExit(1), 500);
        }
        break;
    }
  }

  if (exiting) {
    return null;
  }

  const done = tasks.filter((t) => t.status === STATUS.DONE).length;
  const failed = tasks.filter((t) => t.status === STATUS.FAILED).length;
  const total = tasks.length;

  return React.createElement(
    Box,
    { flexDirection: 'column', height: '100%', paddingTop: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(
        Text,
        { backgroundColor: 'cyan', color: 'black', bold: true },
        ` Build  [${done}/${total}] ` + (failed > 0 ? ` ${failed} failed ` : '')
      ),
    ),
    React.createElement(Box, { height: 1 }),
    React.createElement(
      Box,
      { flexDirection: 'column' },
      ...tasks.map((t, i) => {
        const liveElapsed = t.status === STATUS.RUNNING && runningSinceRef.current[i] != null
          ? Date.now() - runningSinceRef.current[i]
          : null;
        return React.createElement(TaskRow, { key: i, task: t, liveElapsed });
      }),
    ),
    React.createElement(Box, { height: 1 }),
    // 输出矩形：只显示最后 15 行，精确截断防止溢出
    logs.length > 0 && (() => {
      const columns = process.stdout.columns || 80;
      const maxLogWidth = Math.max(20, columns - 4); // border + padding ≈ 4 列
      return React.createElement(
        Box,
        { flexGrow: 1, flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', overflow: 'hidden' },
        ...logs.slice(-15).map((line, i) =>
          React.createElement(Text, { key: i }, truncateToWidth(line, maxLogWidth))
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
