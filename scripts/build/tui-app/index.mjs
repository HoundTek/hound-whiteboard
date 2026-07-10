/**
 * @file 构建 TUI 应用（Ink 5）
 * @description 独立进程，通过 TCP 接收 JSON 消息，用 Ink 渲染分屏布局。
 *              主动退出模式：不依赖 waitUntilExit，确保终端始终恢复。
 * @module scripts/build/tui-app
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput } from 'ink';
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
  const [logs, setLogs] = useState([]);
  const [exiting, setExiting] = useState(false);
  const [tick, setTick] = useState(0);
  /** 日志滚动偏移：0 = 底部，正数 = 向上滚动的行数 */
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);
  const tasksRef = useRef(tasks);
  /** @type {{ current: number[] }} 每个任务 index 的运行起始时间戳 */
  const runningSinceRef = useRef([]);
  const logsRef = useRef([]);
  /** 日志面板的屏幕 Y 坐标范围（1-based，含边框），用于判断滚轮是否在面板内 */
  const logPanelYStart = useRef(1);
  const logPanelYEnd = useRef(1);

  tasksRef.current = tasks;
  scrollOffsetRef.current = scrollOffset;
  logsRef.current = logs;

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

  // 键盘滚动 / 结算页退出
  useInput((_input, key) => {
    if (exiting) {
      safeExit(gExitOk ? 0 : 1);
      return;
    }
    const total = logs.length;
    if (total === 0) return;
    // 粗略估算可见行数（终端高度 - 头部 - 任务区 - 边框）
    const visible = Math.max(5, (process.stdout.rows || 24) - 14);
    const maxOffset = Math.max(0, total - visible);
    if (key.upArrow) {
      setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.pageUp) {
      setScrollOffset((prev) => Math.min(maxOffset, prev + visible));
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - visible));
    } else if (key.home) {
      setScrollOffset(maxOffset);
    } else if (key.end) {
      setScrollOffset(0);
    }
  });

  // 鼠标滚轮滚动
  useEffect(() => {
    process.stdout.write('\x1b[?1000h\x1b[?1006h');

    const onData = (chunk) => {
      const str = chunk.toString();
      // SGR 鼠标事件: \x1b[<Pb;Px;PyM
      const m = str.match(/\x1b\[<(64|65);(\d+);(\d+)M/);
      if (!m) return;
      const py = parseInt(m[3], 10);
      // 仅当日志面板存在且鼠标在其范围内时处理滚轮
      if (py < logPanelYStart.current || py > logPanelYEnd.current) return;
      const total = logsRef.current.length;
      if (total === 0) return;
      const visible = Math.max(5, (process.stdout.rows || 24) - 14);
      const maxOffset = Math.max(0, total - visible);
      const btn = parseInt(m[1], 10);
      const step = 3; // 滚轮每次 3 行
      if (btn === 64) {
        setScrollOffset((prev) => Math.min(maxOffset, prev + step));
      } else if (btn === 65) {
        setScrollOffset((prev) => Math.max(0, prev - step));
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1006l');
      process.stdin.off('data', onData);
    };
  }, []);

  function handleMsg(msg) {
    switch (msg.type) {
      case 'init':
        gFirstErrorLine = -1;
        setTasks(
          (msg.tasks || []).map((item) =>
            typeof item === 'string'
              ? { name: item, status: STATUS.PENDING }
              : { ...item, status: item.status || STATUS.PENDING },
          ),
        );
        setRows(msg.rows || []);
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
          setLogs((prev) => {
            const next = [...prev.slice(-500), plain];
            // 跟踪首次报错行
            if (gFirstErrorLine < 0 && isErrorLine(plain)) {
              gFirstErrorLine = next.length - 1;
            }
            return next;
          });
          // 自动跟随：在底部则保持底部，已上滚则维持相对位置
          setScrollOffset((prev) => prev > 0 ? prev + 1 : 0);
        }
        break;

      case 'exit':
        gTasks = [...tasksRef.current];
        gExitOk = msg.ok !== false;
        // 失败时截取报错相关日志
        if (!gExitOk) {
          const sliced = gFirstErrorLine >= 0 ? logsRef.current.slice(gFirstErrorLine) : logsRef.current.slice(-30);
          gErrorLogs = sliced;
          setLogs(sliced);
          setScrollOffset(0);
        } else {
          setLogs([]);
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
        const columns = process.stdout.columns || 80;
        const maxLogWidth = Math.max(20, columns - 4);
        const usedByTasks = allRows.length;
        const visible = Math.max(5, (process.stdout.rows || 24) - usedByTasks - 10);
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
          ...windowLines.map((line, i) =>
            React.createElement(Text, { key: start + i }, truncateToWidth(line, maxLogWidth))
          ),
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
      const columns = process.stdout.columns || 80;
      const maxLogWidth = Math.max(20, columns - 4);
      // 可用行数：终端高度 - 头部(1) - 间距(1) - 任务区(visibleRows) - 间距(1) - 边框(2) - 指示器(1)
      const usedByTasks = visibleRows.length;
      const visible = Math.max(5, (process.stdout.rows || 24) - usedByTasks - 8);
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
        ...windowLines.map((line, i) =>
          React.createElement(Text, { key: start + i }, truncateToWidth(line, maxLogWidth))
        ),
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
