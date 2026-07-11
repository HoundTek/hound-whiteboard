/**
 * @file 构建入口
 * @description 命令映射 → 声明式任务依赖解析 → TUI/回退执行。
 * @module scripts/build
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { runCmdInherit, loadTaskRegistry, resolveTaskGraph, executeTasks, ROOT_DIR } = require('./task-runner.cjs');

const TUI_PATH = path.join(__dirname, 'tui-app', 'index.mjs');

// ============================================================
//  命令 → 目标任务 ID 映射
// ============================================================

const ALL_PLATFORMS = ['desktop', 'mac', 'win', 'linux', 'android', 'ios', 'desktop-platforms', 'mobile', 'all'];
const ICON_PLATFORMS = ['desktop', 'mac', 'win', 'linux', 'android', 'ios', 'common'];
/**
 * 图标命令只需指定 copy 任务（generate 通过依赖自动触发）
 */
const ALL_ICON_TASKS = ICON_PLATFORMS.map((p) => 'icon:copy:' + p);

/**
 * 给定命令和平台，返回需要解析执行的目标任务 ID 列表
 */
const COMMAND_TASKS = {
  icon: Object.fromEntries([
    ...ICON_PLATFORMS.map((p) => [p, ['icon:copy:' + p]]),
    ['all', ALL_ICON_TASKS],
  ]),
  build: {
    desktop: ['build:desktop'],
    mac: ['build:mac'],
    'mac-universal': ['build:mac-universal'],
    win: ['build:win'],
    linux: ['build:linux'],
    android: ['build:android'],
    ios: ['build:ios'],
    'desktop-platforms': ['build:desktop-platforms'],
    mobile: ['build:mobile'],
    all: ['build:all'],
  },
  ship: {
    desktop: ['test', 'build:desktop'],
    mac: ['test', 'build:mac'],
    'mac-universal': ['test', 'build:mac-universal'],
    win: ['test', 'build:win'],
    linux: ['test', 'build:linux'],
    android: ['test', 'build:android'],
    ios: ['test', 'build:ios'],
    'desktop-platforms': ['test', 'build:desktop-platforms'],
    mobile: ['test', 'build:mobile'],
    all: ['test', 'build:all'],
  },
};

/** dev 命令在依赖任务完成后还需要 spawn tauri dev */
const DEV_SETUP_TASKS = {
  desktop: ['deps', 'icon:copy:desktop'],
  mac: ['deps', 'icon:copy:mac'],
  win: ['deps', 'icon:copy:win'],
  linux: ['deps', 'icon:copy:linux'],
  android: ['deps', 'android:init', 'icon:copy:android', 'icon:copy:common'],
  ios: ['deps', 'icon:copy:ios', 'icon:copy:common'],
};

/** dev 命令的长运行进程 */
const DEV_CMD = {
  desktop: 'tauri dev',
  mac: 'tauri dev',
  win: 'tauri dev',
  linux: 'tauri dev',
  android: 'tauri android dev',
  ios: 'tauri ios dev',
};

/** build-quick 命令的构建命令 */
const BUILD_QUICK_CMD = {
  desktop: 'tauri build',
  mac: 'tauri build --bundles dmg app',
  'mac-universal': 'tauri build --target universal-apple-darwin',
  win: 'tauri build --bundles nsis msi',
  linux: 'tauri build --bundles deb appimage rpm',
  android: 'tauri android build',
  ios: 'tauri ios build',
};

// ============================================================
//  TUI (TCP → Ink process)
// ============================================================

let tuiSock = null;
let tuiChild = null;

/** @returns {boolean} */
function isTuiAlive() {
  return tuiSock && !tuiSock.destroyed && tuiChild && !tuiChild.killed;
}

/**
 * 启动 TUI 子进程，失败时重试最多 3 次
 * @returns {Promise<void>}
 */
function startTui() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let retries = 0;
    const MAX_RETRIES = 3;

    function tryStart() {
      if (resolved) return;

      const server = net.createServer((sock) => {
        if (resolved) return;
        resolved = true;
        tuiSock = sock;
        sock.setNoDelay(true);
        sock.on('error', () => {});
        resolve();
      });

      server.on('error', (err) => {
        server.close();
        if (resolved) return;
        if (++retries < MAX_RETRIES) {
          setTimeout(tryStart, 500);
          return;
        }
        resolved = true;
        reject(err);
      });

      server.listen(0, '127.0.0.1', () => {
        if (resolved) return;
        const port = server.address().port;
        tuiChild = spawn(process.execPath, [TUI_PATH, String(port)], {
          cwd: ROOT_DIR,
          stdio: ['inherit', 'inherit', 'inherit'],
        });

        tuiChild.on('error', (err) => {
          if (resolved) return;
          server.close();
          if (++retries < MAX_RETRIES) {
            setTimeout(tryStart, 500);
            return;
          }
          resolved = true;
          reject(err);
        });

        tuiChild.on('exit', (code) => {
          tuiSock = null;
          if (resolved) return;
          server.close();
          if (++retries < MAX_RETRIES) {
            setTimeout(tryStart, 500);
            return;
          }
          resolved = true;
          reject(new Error('TUI exited with code ' + code));
        });
      });
    }

    tryStart();

    setTimeout(() => {
      if (resolved) return;
      if (++retries < MAX_RETRIES) {
        tryStart();
        return;
      }
      resolved = true;
      reject(new Error('TUI connection timeout'));
    }, 10000);
  });
}

/** @param {object} msg */
function sendTui(msg) {
  if (!tuiSock || tuiSock.destroyed) return;
  try { tuiSock.write(JSON.stringify(msg) + '\n'); } catch (_) {}
}

/** @returns {Promise<void>} */
async function waitTuiExit() {
  if (tuiChild) {
    return new Promise((resolve) => { tuiChild.on('exit', resolve); });
  }
}

// ============================================================
//  TUI 回调适配器
// ============================================================

/**
 * 创建适配 task-runner 回调接口的 TUI 适配器
 * @returns {{ onInit, onStatus, onLog, onExit }}
 */
function createTuiAdapter() {
  return {
    onInit(payload) {
      sendTui({ type: 'init', ...payload });
    },
    onStatus(index, status, elapsed, extra) {
      sendTui({ type: 'status', index, status, elapsed, ...(extra || {}) });
    },
    onLog(text) {
      sendTui({ type: 'log', text });
    },
    onExit(ok) {
      sendTui({ type: 'exit', ok });
    },
  };
}

// ============================================================
//  结果收集器 — 汇总任务状态和日志，供最终文本输出
// ============================================================

/**
 * 创建收集回调，同时转发到目标回调（如有）
 * @param {RunCallbacks} [target] - 转发目标（TUI 适配器），为 null 即仅收集
 * @returns {{ cb: RunCallbacks, getSummary: () => object }}
 */
function createCollector(target) {
  let tasks = [];
  let statuses = [];
  let rows = [];
  let allLogs = [];
  let exitOk = false;

  return {
    cb: {
      onInit(payload) {
        tasks = payload.tasks || [];
        rows = payload.rows || [];
        statuses = tasks.map(() => ({ status: 'pending', elapsed: null }));
        if (target) target.onInit(payload);
      },
      onStatus(index, status, elapsed, extra) {
        if (index < statuses.length) {
          statuses[index] = { status, elapsed: elapsed || null };
        }
        if (target) target.onStatus(index, status, elapsed, extra);
      },
      onLog(text) {
        allLogs.push(text);
        if (target) target.onLog(text);
      },
      onExit(ok) {
        exitOk = ok;
        if (target) target.onExit(ok);
      },
    },
    getSummary() {
      return { tasks, statuses, rows, allLogs, exitOk };
    },
  };
}

/**
 * 打印构建结果摘要（与 TUI 结算画面格式一致，日志面板展开）
 * @param {{ tasks, statuses, rows, allLogs, exitOk }} summary
 */
function printSummary(summary) {
  // noop
}

// ============================================================
//  编排：TUI → 回退
// ============================================================

/**
 * 尝试用 TUI 执行目标任务，失败则回退内联
 * @param {string[]} targetIds
 * @returns {Promise<boolean>}
 */
async function runWithTuiOrFallback(targetIds) {
  if (!process.stdout.isTTY) {
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb);
    printSummary(collector.getSummary());
    return ok;
  }

  // 尝试启动 TUI
  try { await startTui(); } catch (_) {
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb);
    printSummary(collector.getSummary());
    return ok;
  }

  if (!isTuiAlive()) {
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb);
    printSummary(collector.getSummary());
    return ok;
  }

  const tuiAdapter = createTuiAdapter();
  const collector = createCollector(tuiAdapter);
  const ok = await executeResolved(targetIds, 'tui', collector.cb);
  await waitTuiExit();
  // 等待 TUI 的 stdout 缓冲区完全刷新，避免 printSummary 输出交叠
  await new Promise((r) => setTimeout(r, 200));
  printSummary(collector.getSummary());
  return ok;
}

/**
 * 解析 + 执行（公共流程）
 * @param {string[]} targetIds
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} cb
 * @returns {Promise<boolean>}
 */
async function executeResolved(targetIds, mode, cb) {
  const registry = loadTaskRegistry();
  const { ordered, errors } = resolveTaskGraph(targetIds, registry);

  if (errors.length > 0) {
    console.error('Errors:', errors.join(', '));
    return false;
  }

  return executeTasks(ordered, mode, cb);
}

// ============================================================
//  Help
// ============================================================

function showHelp() {
  console.log('Commands:');
  console.log('  dev [platform]          - Start development server');
  console.log('  build [platform]        - Build for specified platform');
  console.log('  build-quick [platform]  - Build only (skip deps/icons)');
  console.log('  ship [platform]         - Run tests + build for platform');
  console.log('  icon [platform|all]     - Generate icons');
  console.log();
  console.log('Platforms:');
  console.log('  desktop, win, mac, mac-universal, linux, android, ios');
}

// ============================================================
//  Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const platform = args[1] || 'desktop';

  if (!command || ['help', '--help', '-h'].includes(command)) {
    showHelp();
    return;
  }

  // ---- icon ----
  if (command === 'icon') {
    const mapping = COMMAND_TASKS.icon[platform];
    if (!mapping) {
      console.error('Unknown icon platform:', platform);
      console.error('Available:', Object.keys(COMMAND_TASKS.icon).join(', '));
      process.exit(1);
    }
    const ok = await runWithTuiOrFallback(mapping);
    process.exit(ok ? 0 : 1);
    return;
  }

  // ---- dev ----
  if (command === 'dev') {
    const setupTasks = DEV_SETUP_TASKS[platform];
    if (!setupTasks) {
      console.error('Unknown platform:', platform);
      console.error('Available:', Object.keys(DEV_SETUP_TASKS).join(', '));
      process.exit(1);
    }
    const ok = await runWithTuiOrFallback(setupTasks);
    if (!ok) { process.exit(1); return; }

    // 依赖任务完成后，spawn 长期运行的 tauri dev
    await runCmdInherit(DEV_CMD[platform]);
    return;
  }

  // ---- build-quick ----
  if (command === 'build-quick') {
    const cmd = BUILD_QUICK_CMD[platform];
    if (!cmd) {
      console.error('Unknown platform:', platform);
      console.error('Available:', Object.keys(BUILD_QUICK_CMD).join(', '));
      process.exit(1);
    }
    const ok = await runCmdInherit(cmd);
    process.exit(ok ? 0 : 1);
    return;
  }

  // ---- build / ship ----
  if (command === 'build' || command === 'ship') {
    const mapping = COMMAND_TASKS[command][platform];
    if (!mapping) {
      console.error('Unknown platform:', platform);
      console.error('Available:', Object.keys(COMMAND_TASKS[command]).join(', '));
      process.exit(1);
    }
    const ok = await runWithTuiOrFallback(mapping);
    process.exit(ok ? 0 : 1);
    return;
  }

  console.error('Unknown command:', command);
  showHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
