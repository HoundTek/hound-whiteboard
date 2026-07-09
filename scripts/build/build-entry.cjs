/**
 * @file 构建入口
 * @description 内联 + TCP 分屏 TUI 构建编排。inner TUI 时用 TCP 驱动独立 ANSI 进程，
 *              stdout 不是 TTY 时回退到内联进度输出。
 * @module scripts/build
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TUI_PATH = path.join(__dirname, 'tui-app', 'index.mjs');

const PLATFORMS = {
  desktop: {
    iconCmd: 'yarn icon:desktop',
    buildCmd: 'tauri build',
  },
  win: {
    iconCmd: 'yarn icon:win',
    buildCmd: 'tauri build --bundles nsis msi',
  },
  mac: {
    iconCmd: 'yarn icon:mac',
    buildCmd: 'tauri build --bundles dmg app',
  },
  'mac-universal': {
    iconCmd: 'yarn icon:mac',
    buildCmd: 'tauri build --target universal-apple-darwin',
  },
  linux: {
    iconCmd: 'yarn icon:linux',
    buildCmd: 'tauri build --bundles deb appimage rpm',
  },
  android: {
    iconCmd: 'yarn icon:android && yarn icon:desktop',
    initCmd: 'yarn init:android',
    buildCmd: 'tauri android build',
  },
  ios: {
    iconCmd: 'yarn icon:ios && yarn icon:desktop',
    buildCmd: 'tauri ios build',
  },
};

// ============================================================
//  Formatting
// ============================================================

function formatElapsed(ms) {
  if (ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

// ============================================================
//  TUI (TCP → Ink process)
// ============================================================

let tuiSock = null;
let tuiChild = null;

function isTuiAlive() {
  return tuiSock && !tuiSock.destroyed && tuiChild && !tuiChild.killed;
}

/**
 * 启动 TUI 子进程，建立 TCP 连接
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

/**
 * 向 TUI 发送 JSON 消息
 * @param {object} msg
 */
function sendTui(msg) {
  if (!tuiSock || tuiSock.destroyed) return;
  try {
    tuiSock.write(JSON.stringify(msg) + '\n');
  } catch (_) { /* socket may be closed */ }
}

/**
 * 初始化 TUI 任务列表
 * @param {string[]} taskNames
 */
function initTui(taskNames) {
  sendTui({ type: 'init', tasks: taskNames });
}

/**
 * 更新任务状态
 * @param {number} index
 * @param {string} status
 * @param {number} [elapsed]
 */
function statusTui(index, status, elapsed) {
  sendTui({ type: 'status', index, status, elapsed });
}

/**
 * 追加日志行
 * @param {string} text
 */
function logTui(text) {
  sendTui({ type: 'log', text });
}

/**
 * 等待 TUI 退出
 */
async function waitTuiExit() {
  if (tuiChild) {
    return new Promise((resolve) => {
      tuiChild.on('exit', resolve);
    });
  }
}

// ============================================================
//  Task execution
// ============================================================

/**
 * 静默执行 shell 命令，捕获输出通过 TUI 日志显示
 * @param {string} cmd
 * @returns {Promise<boolean>}
 */
function runCmdSilent(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const onData = (text) => {
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (l.trim()) logTui(l);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      if (buf.trim()) logTui(buf.trimEnd());
      resolve(code === 0);
    });
    child.on('error', () => resolve(false));
  });
}

/**
 * 用 inherit stdio 执行命令（用于 TUI 退出后的长期运行进程，如 tauri dev）
 * @param {string} cmd
 * @returns {Promise<boolean>}
 */
function runCmdInherit(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * 通过 TUI 执行一组任务（任务间发送 update 消息）
 * @param {string[]} taskNames
 * @param {{ cmd?: string, fn?: () => boolean }[]} taskDefs
 * @returns {Promise<boolean>}
 */
async function runTasksWithTui(taskNames, taskDefs) {
  initTui(taskNames);

  let allOk = true;

  for (let i = 0; i < taskDefs.length; i++) {
    const td = taskDefs[i];
    const start = Date.now();

    statusTui(i, 'running');

    let ok;
    if (td.fn) {
      try { ok = td.fn() !== false; } catch (_) { ok = false; }
      // sync fn: give TUI a tick to render
      await new Promise(r => setImmediate(r));
    } else {
      ok = await runCmdSilent(td.cmd);
    }

    const elapsed = Date.now() - start;

    if (ok) {
      statusTui(i, 'done', elapsed);
    } else {
      statusTui(i, 'failed', elapsed);
      allOk = false;
      break;
    }
  }

  return allOk;
}

// ============================================================
//  Fallback: inline progress (no TTY)
// ============================================================

const ICON_RUN = '\x1b[36m●\x1b[0m';
const ICON_OK = '\x1b[32m✓\x1b[0m';
const ICON_FAIL = '\x1b[31m✗\x1b[0m';

/**
 * 执行一组任务，内联打印进度（无 TUI 时回退）
 * @param {string[]} taskNames
 * @param {{ cmd?: string, fn?: () => boolean }[]} taskDefs
 * @param {string} title
 * @returns {Promise<boolean>}
 */
async function runTasksInline(taskNames, taskDefs, title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  for (const n of taskNames) console.log(`  ○  ${n}`);
  console.log('');

  let allOk = true;

  for (let i = 0; i < taskDefs.length; i++) {
    const td = taskDefs[i];
    const start = Date.now();

    process.stdout.write(`\x1b[1A\x1b[2K  ${ICON_RUN} ${taskNames[i]}...\n`);

    let ok;
    if (td.fn) {
      try { ok = td.fn() !== false; } catch (_) { ok = false; }
    } else {
      ok = await runCmdInherit(td.cmd);
    }

    const elapsed = Date.now() - start;

    if (ok) {
      process.stdout.write(`\x1b[1A\x1b[2K  ${ICON_OK} ${taskNames[i]}  ${formatElapsed(elapsed)}\n`);
    } else {
      process.stdout.write(`\x1b[1A\x1b[2K  ${ICON_FAIL} ${taskNames[i]}  FAILED  ${formatElapsed(elapsed)}\n`);
      allOk = false;
      break;
    }
  }

  console.log(`\n${allOk ? '\x1b[32mSUCCESS\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
  console.log('─'.repeat(60));
  return allOk;
}

// ============================================================
//  Task definitions
// ============================================================

function devSetupTasks(platform, config) {
  const tasks = [];
  tasks.push({ name: 'Install dependencies', cmd: 'yarn deps' });
  if (platform === 'android') {
    tasks.push({ name: 'Initialize Android', cmd: config.initCmd });
  }
  tasks.push({ name: 'Generate icons', cmd: config.iconCmd });
  return tasks;
}

function buildTasks(command, platform, config) {
  const tasks = [];

  if (command === 'ship') {
    tasks.push({ name: 'Run tests', cmd: 'yarn test' });
  }

  tasks.push({ name: 'Install dependencies', cmd: 'yarn deps' });

  if (platform === 'android') {
    tasks.push({ name: 'Initialize Android', cmd: config.initCmd });
    tasks.push({ name: 'Configure signing', fn: configureAndroidSigning });
  }

  tasks.push({ name: 'Generate icons', cmd: config.iconCmd });
  tasks.push({ name: `Build ${platform}`, cmd: config.buildCmd });

  return tasks;
}

// ============================================================
//  Android signing
// ============================================================

function configureAndroidSigning() {
  const keystoreSrc = path.join(ROOT_DIR, 'keys', 'keystore.properties');
  const keystoreDest = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'keystore.properties');
  const buildGradlePath = path.join(ROOT_DIR, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts');

  if (fs.existsSync(keystoreSrc)) {
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true });
    fs.copyFileSync(keystoreSrc, keystoreDest);
  } else {
    console.warn('Warning: keystore.properties not found in keys/');
    return false;
  }

  if (!fs.existsSync(buildGradlePath)) {
    console.warn('Warning: build.gradle.kts not found');
    return false;
  }

  let content = fs.readFileSync(buildGradlePath, 'utf-8');
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  content = content.replace(/\r\n/g, '\n');

  if (!content.includes('import java.io.FileInputStream')) {
    content = content.replace('import java.util.Properties', 'import java.util.Properties\nimport java.io.FileInputStream');
  }

  if (!content.includes('keystoreProperties')) {
    const tauriPropsEndIndex = content.indexOf('}\n\nandroid');
    if (tauriPropsEndIndex !== -1) {
      const insertPos = tauriPropsEndIndex + 1;
      content = content.slice(0, insertPos) +
        '\n\nval keystoreProperties = Properties().apply {\n    val propFile = rootProject.file("keystore.properties")\n    if (propFile.exists()) {\n        propFile.inputStream().use { load(it) }\n    }\n}\n' +
        content.slice(insertPos);
    }
  }

  if (!content.includes('signingConfigs')) {
    content = content.replace(
      'buildTypes {\n',
      'signingConfigs {\n        create("release") {\n            keyAlias = keystoreProperties.getProperty("keyAlias", "")\n            keyPassword = keystoreProperties.getProperty("keyPassword", "")\n            storeFile = if (keystoreProperties.getProperty("storeFile").isNullOrEmpty()) null else file(keystoreProperties.getProperty("storeFile"))\n            storePassword = keystoreProperties.getProperty("storePassword", "")\n        }\n    }\n    buildTypes {\n'
    );
  }

  if (!content.includes('signingConfig = signingConfigs.getByName("release")')) {
    content = content.replace(
      'getByName("release") {\n            isMinifyEnabled = true',
      'getByName("release") {\n            isMinifyEnabled = true\n            signingConfig = signingConfigs.getByName("release")'
    );
  }

  if (nl === '\r\n') {
    content = content.replace(/\n/g, '\r\n');
  }

  fs.writeFileSync(buildGradlePath, content);
  return true;
}

// ============================================================
//  Orchestrator: try TUI, fallback to inline
// ============================================================

/**
 * 尝试用 TUI 执行任务，失败则回退内联
 * @param {string[]} taskNames
 * @param {{ name: string, cmd?: string, fn?: () => boolean }[]} taskDefs
 * @param {string} title
 * @returns {Promise<boolean>}
 */
async function runTasksOrFallback(taskNames, taskDefs, title) {
  if (!process.stdout.isTTY) {
    return runTasksInline(taskNames, taskDefs, title);
  }

  // 尝试启动 TUI
  try {
    await startTui();
  } catch (_) {
    return runTasksInline(taskNames, taskDefs, title);
  }

  // 确认 TUI 仍然存活
  if (!isTuiAlive()) {
    return runTasksInline(taskNames, taskDefs, title);
  }

  // 通过 TUI 执行
  const ok = await runTasksWithTui(taskNames, taskDefs);
  sendTui({ type: 'exit', ok });
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

  if (!PLATFORMS[platform] && command !== 'help') {
    console.error('Unknown platform:', platform);
    console.error('Available:', Object.keys(PLATFORMS).join(', '));
    process.exit(1);
  }

  const config = PLATFORMS[platform];

  // icon
  if (command === 'icon') {
    if (process.stdout.isTTY) {
      const iconScript = path.join(__dirname, 'gen-icons.cjs');
      const ok = await runTasksOrFallback(
        [`Generate icons: ${platform}`],
        [{ cmd: `node "${iconScript}" ${platform}` }],
        'Icons'
      );
      process.exit(ok ? 0 : 1);
    } else {
      const iconScript = path.join(__dirname, 'gen-icons.cjs');
      const result = spawnSync('node', [iconScript, platform], {
        cwd: ROOT_DIR, stdio: 'inherit',
      });
      process.exit(result.status || 0);
    }
    return;
  }

  // dev
  if (command === 'dev') {
    const tasks = devSetupTasks(platform, config);
    const ok = await runTasksOrFallback(
      tasks.map(t => t.name),
      tasks,
      'Dev ' + platform
    );
    if (!ok) { process.exit(1); return; }

    const devCmd = platform === 'android' ? 'tauri android dev'
      : platform === 'ios' ? 'tauri ios dev'
      : 'tauri dev';
    await runCmdInherit(devCmd);
    return;
  }

  // build-quick
  if (command === 'build-quick') {
    const tasks = [{ name: `Build ${platform}`, cmd: config.buildCmd }];
    const ok = await runTasksOrFallback(
      tasks.map(t => t.name),
      tasks,
      'Build ' + platform
    );
    process.exit(ok ? 0 : 1);
    return;
  }

  // build / ship
  if (command === 'build' || command === 'ship') {
    const tasks = buildTasks(command, platform, config);
    const title = command === 'ship' ? 'Ship ' + platform : 'Build ' + platform;
    const ok = await runTasksOrFallback(
      tasks.map(t => t.name),
      tasks,
      title
    );
    process.exit(ok ? 0 : 1);
    return;
  }

  console.error('Unknown command:', command);
  showHelp();
  process.exit(1);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
