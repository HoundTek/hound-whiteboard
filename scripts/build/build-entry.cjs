/**
 * @file 构建入口
 * @description 命令映射 → 声明式任务依赖解析 → TUI/回退执行。
 * @module scripts/build
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { run, runCmdInherit, loadTaskRegistry, resolveTaskGraph, executeTasks, ROOT_DIR } = require('./task-runner.cjs');

const TUI_PATH = path.join(__dirname, 'tui-app', 'index.mjs');

// ============================================================
//  命令 → 目标任务 ID 映射
// ============================================================

const ALL_PLATFORMS = ['desktop', 'mac', 'win', 'linux', 'android', 'ios'];
const ALL_ICON_TASKS = ALL_PLATFORMS.map((p) => 'icon:' + p);

/**
 * 给定命令和平台，返回需要解析执行的目标任务 ID 列表
 */
const COMMAND_TASKS = {
  icon: Object.fromEntries([
    ...ALL_PLATFORMS.map((p) => [p, ['icon:' + p]]),
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
  },
  ship: {
    desktop: ['test', 'build:desktop'],
    mac: ['test', 'build:mac'],
    'mac-universal': ['test', 'build:mac-universal'],
    win: ['test', 'build:win'],
    linux: ['test', 'build:linux'],
    android: ['test', 'build:android'],
    ios: ['test', 'build:ios'],
  },
};

/** dev 命令在依赖任务完成后还需要 spawn tauri dev */
const DEV_SETUP_TASKS = {
  desktop: ['deps', 'icon:desktop'],
  mac: ['deps', 'icon:mac'],
  win: ['deps', 'icon:win'],
  linux: ['deps', 'icon:linux'],
  android: ['deps', 'android:init', 'icon:android', 'icon:desktop'],
  ios: ['deps', 'icon:ios', 'icon:desktop'],
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
  mac: 'tauri build',
  'mac-universal': 'tauri build --target universal-apple-darwin',
  win: 'tauri build',
  linux: 'tauri build',
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
 * 启动 TUI 子进程
 * @returns {Promise<void>}
 */
function startTui() {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const server = net.createServer((sock) => {
      if (resolved) return;
      resolved = true;
      tuiSock = sock;
      sock.setNoDelay(true);
      sock.on('error', () => {});
      resolve();
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      tuiChild = spawn('node', [TUI_PATH, String(port)], {
        cwd: ROOT_DIR,
        stdio: ['inherit', 'inherit', 'inherit'],
      });

      tuiChild.on('error', (err) => {
        if (!resolved) { resolved = true; reject(err); }
      });

      tuiChild.on('exit', (code) => {
        tuiSock = null;
        if (!resolved) {
          resolved = true;
          reject(new Error('TUI exited with code ' + code));
        }
      });
    });

    server.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('TUI connection timeout')); }
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
    onInit(tasks) {
      sendTui({ type: 'init', tasks });
    },
    onStatus(index, status, elapsed) {
      sendTui({ type: 'status', index, status, elapsed });
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
//  编排：TUI → 回退
// ============================================================

/**
 * 尝试用 TUI 执行目标任务，失败则回退内联
 * @param {string[]} targetIds
 * @returns {Promise<boolean>}
 */
async function runWithTuiOrFallback(targetIds) {
  if (!process.stdout.isTTY) {
    const { ok, errors } = await run(targetIds, 'inline');
    if (errors.length > 0) {
      console.error('Errors:', errors.join(', '));
      return false;
    }
    return ok;
  }

  // 尝试启动 TUI
  try { await startTui(); } catch (_) {
    const { ok, errors } = await run(targetIds, 'inline');
    if (errors.length > 0) console.error('Errors:', errors.join(', '));
    return ok;
  }

  if (!isTuiAlive()) {
    const { ok, errors } = await run(targetIds, 'inline');
    if (errors.length > 0) console.error('Errors:', errors.join(', '));
    return ok;
  }

  const tuiAdapter = createTuiAdapter();
  const registry = loadTaskRegistry();
  const { ordered, errors } = resolveTaskGraph(targetIds, registry);

  if (errors.length > 0) {
    console.error('Errors:', errors.join(', '));
    return false;
  }

  const ok = await executeTasks(ordered, 'tui', tuiAdapter);
  await waitTuiExit();
  return ok;
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
