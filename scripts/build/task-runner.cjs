/**
 * @file 任务运行器
 * @description 加载任务注册表、解析依赖图（拓扑排序）、按序执行任务。
 *              支持 TUI 模式和回退内联模式。
 * @module scripts/build/task-runner
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(__dirname, 'tasks');

// ============================================================
//  加载
// ============================================================

/**
 * 递归收集 tasks/ 下所有 .cjs 文件
 * @param {string} dir
 * @returns {string[]}
 */
function collectTaskFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTaskFiles(full));
    } else if (entry.name.endsWith('.cjs')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 加载所有任务定义，构建注册表
 * @returns {Map<string, { id: string, description: string, dependsOn: string[], run: { cmd?: string, fn?: () => boolean } }>}
 */
function loadTaskRegistry() {
  const registry = new Map();
  const files = collectTaskFiles(TASKS_DIR);

  for (const file of files) {
    const def = require(file);

    if (!def || !def.id) {
      console.warn('Task file missing id:', path.relative(ROOT_DIR, file));
      continue;
    }
    if (registry.has(def.id)) {
      console.warn('Duplicate task id:', def.id);
      continue;
    }

    registry.set(def.id, {
      id: def.id,
      description: def.description || def.id,
      dependsOn: def.dependsOn || [],
      run: def.run || {},
    });
  }

  return registry;
}

// ============================================================
//  依赖解析
// ============================================================

/**
 * 解析目标任务的完整依赖图，返回拓扑排序后的执行列表
 * @param {string[]} targetIds - 目标任务 ID 列表
 * @param {Map} registry - 任务注册表
 * @returns {{ ordered: Array, errors: string[] }}
 */
function resolveTaskGraph(targetIds, registry) {
  const errors = [];

  // 验证所有目标存在
  for (const id of targetIds) {
    if (!registry.has(id)) {
      errors.push('Unknown task: ' + id);
    }
  }
  if (errors.length > 0) return { ordered: [], errors };

  // BFS 收集所有需要的任务（包含传递依赖）
  const needed = new Set();
  const queue = [...targetIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (needed.has(id)) continue;
    needed.add(id);

    const task = registry.get(id);
    if (!task) {
      errors.push('Unknown dependency: ' + id);
      continue;
    }
    for (const dep of task.dependsOn) {
      queue.push(dep);
    }
  }
  if (errors.length > 0) return { ordered: [], errors };

  // Kahn 拓扑排序
  const inDegree = new Map();
  const graph = new Map();

  for (const id of needed) {
    inDegree.set(id, 0);
    graph.set(id, []);
  }

  for (const id of needed) {
    const task = registry.get(id);
    for (const dep of task.dependsOn) {
      if (needed.has(dep)) {
        graph.get(dep).push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }
  }

  const ordered = [];
  const zeroQueue = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) zeroQueue.push(id);
  }

  while (zeroQueue.length > 0) {
    const id = zeroQueue.shift();
    ordered.push(registry.get(id));

    for (const next of graph.get(id)) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) zeroQueue.push(next);
    }
  }

  if (ordered.length !== needed.size) {
    errors.push('Circular dependency detected');
    return { ordered: [], errors };
  }

  return { ordered, errors: [] };
}

// ============================================================
//  执行
// ============================================================

/**
 * 执行回调接口
 * @typedef {object} RunCallbacks
 * @property {(tasks: Array) => void} onInit
 * @property {(index: number, status: string, elapsed?: number) => void} onStatus
 * @property {(text: string) => void} onLog
 * @property {(ok: boolean) => void} onExit
 */

/**
 * 静默执行 shell 命令（TUI 模式：捕获输出通过 onLog 发送）
 * @param {string} cmd - shell 命令
 * @param {RunCallbacks} cb
 * @returns {Promise<boolean>}
 */
function runCmdSilent(cmd, cb) {
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
        if (l.trim()) cb.onLog(l);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      if (buf.trim()) cb.onLog(buf.trimEnd());
      resolve(code === 0);
    });
    child.on('error', () => resolve(false));
  });
}

/**
 * inherit stdio 执行命令（回退模式）
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
 * 按序执行已解析的任务列表
 * @param {Array} taskList - 拓扑排序后的任务定义数组
 * @param {'tui'|'inline'} mode - 执行模式
 * @param {RunCallbacks} [tuiCallbacks] - TUI 模式回调（mode='tui' 时必传）
 * @returns {Promise<boolean>} 是否全部成功
 */
async function executeTasks(taskList, mode, tuiCallbacks) {
  const cb = mode === 'tui' ? tuiCallbacks : null;

  if (cb) {
    cb.onInit(taskList.map((t) => t.description));
  }

  let allOk = true;

  for (let i = 0; i < taskList.length; i++) {
    const task = taskList[i];
    const start = Date.now();

    if (cb) cb.onStatus(i, 'running');

    let ok;

    if (task.run.fn) {
      // 同步函数
      try { ok = task.run.fn() !== false; } catch (_) { ok = false; }
      if (cb) await new Promise((r) => setImmediate(r));
    } else if (task.run.cmd) {
      // shell 命令
      ok = mode === 'tui'
        ? await runCmdSilent(task.run.cmd, cb)
        : await runCmdInherit(task.run.cmd);
    } else {
      // 无 run 定义，视为空操作成功
      ok = true;
    }

    const elapsed = Date.now() - start;

    if (ok) {
      if (cb) cb.onStatus(i, 'done', elapsed);
    } else {
      if (cb) cb.onStatus(i, 'failed', elapsed);
      allOk = false;
      break;
    }
  }

  if (cb) cb.onExit(allOk);
  return allOk;
}

// ============================================================
//  便捷入口
// ============================================================

/**
 * 加载注册表 → 解析依赖 → 执行
 * @param {string[]} targetIds - 目标任务 ID
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [tuiCallbacks]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function run(targetIds, mode, tuiCallbacks) {
  const registry = loadTaskRegistry();
  const { ordered, errors } = resolveTaskGraph(targetIds, registry);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const ok = await executeTasks(ordered, mode, tuiCallbacks);
  return { ok, errors: [] };
}

module.exports = {
  loadTaskRegistry,
  resolveTaskGraph,
  executeTasks,
  run,
  runCmdInherit,
  ROOT_DIR,
};
