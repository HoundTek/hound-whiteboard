/**
 * @file 任务运行器
 * @description 加载任务注册表、解析依赖图（拓扑排序）、按序执行任务。
 *              支持 TUI 模式和回退内联模式。
 *              基于统一 TaskDAG + ConflictSet 架构。
 * @module scripts/build/task-runner
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(__dirname, 'tasks');

// ============================================================
//  TaskDAG — 有向无环依赖图
// ============================================================

/**
 * 任务有向无环图。
 * 封装节点关系、依赖计数、就绪集、路径检测、拓扑排序。
 *
 * 每个节点的 TypeScript 形态：
 *   { task: object, index: number,
 *     parents: Set<string>, children: Set<string>,
 *     remainingDeps: number, conflicts: Set<string> }
 */
class TaskDAG {
  /**
   * @param {Array<object>} taskList - 拓扑排序后的任务列表（顺序仅作初始 index 参考）
   */
  constructor(taskList) {
    /** @type {Map<string, { task: object, index: number, parents: Set<string>, children: Set<string>, remainingDeps: number, conflicts: Set<string> }>} */
    this.nodes = new Map();

    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      const node = {
        task: t,
        index: i,
        parents: new Set(),
        children: new Set(),
        remainingDeps: 0,
        conflicts: new Set(t.conflicts || []),
      };
      this.nodes.set(t.id, node);
    }

    // 连线：t.dependsOn[d] ⇒ d → t
    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      const node = this.nodes.get(t.id);
      for (const depId of t.dependsOn) {
        if (this.nodes.has(depId)) {
          node.parents.add(depId);
          node.remainingDeps++;
          this.nodes.get(depId).children.add(t.id);
        }
      }
    }
  }

  /**
   * 获取就绪任务 ID 集合（remainingDeps === 0）
   * @returns {Set<string>}
   */
  getReady() {
    const ready = new Set();
    for (const [id, node] of this.nodes) {
      if (node.remainingDeps === 0) ready.add(id);
    }
    return ready;
  }

  /**
   * 标记节点完成，递减所有后继的 remainingDeps
   * @param {string} id - 已完成的任务 ID
   * @returns {string[]} 被解封的后继任务 ID
   */
  onDone(id) {
    const node = this.nodes.get(id);
    const unblocked = [];
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      child.remainingDeps--;
      if (child.remainingDeps === 0) unblocked.push(childId);
    }
    return unblocked;
  }

  /**
   * DFS 检查 from 是否能到达 to
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  hasPath(from, to) {
    if (from === to) return true;
    const visited = new Set();
    const stack = [from];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === to) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of this.nodes.get(node).children) {
        stack.push(next);
      }
    }
    return false;
  }

  /**
   * 在两个无路径的冲突节点间插入串行边 a → b
   * @param {string} a - 先执行的任务 ID
   * @param {string} b - 后执行的任务 ID
   */
  addEdge(a, b) {
    if (this.hasPath(a, b) || this.hasPath(b, a)) return;
    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    nodeA.children.add(b);
    nodeB.parents.add(a);
    nodeB.remainingDeps++;
  }

  /**
   * Kahn 拓扑排序，按传递依赖计数降序出队
   * @returns {{ ordered: Array<object>, cyclic: boolean }}
   */
  topologicalSort() {
    const inDegree = new Map();
    const graph = new Map();
    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.remainingDeps); // 副本，用于排序
      graph.set(id, [...node.children]);
    }

    // 传递依赖计数（BFS）
    const reachableCount = new Map();
    for (const id of this.nodes.keys()) {
      const visited = new Set();
      const q = [id];
      while (q.length > 0) {
        const cur = q.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const next of graph.get(cur)) q.push(next);
      }
      reachableCount.set(id, visited.size);
    }

    const ordered = [];
    const zeroQueue = [];

    for (const [id, deg] of inDegree) {
      if (deg === 0) zeroQueue.push(id);
    }

    while (zeroQueue.length > 0) {
      zeroQueue.sort((a, b) => {
        const rc = reachableCount.get(b) - reachableCount.get(a);
        if (rc !== 0) return rc;
        return a.localeCompare(b);
      });
      const id = zeroQueue.shift();
      ordered.push(this.nodes.get(id).task);

      for (const next of graph.get(id)) {
        const newDeg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) zeroQueue.push(next);
      }
    }

    return { ordered, cyclic: ordered.length !== this.nodes.size };
  }
}

// ============================================================
//  ConflictSet — 资源冲突锁
// ============================================================

/**
 * 资源冲突锁集合。
 * 管理共享资源的互斥：正在使用某资源时，其他需要同资源的任务必须等待。
 */
class ConflictSet {
  constructor() {
    /** @type {Set<string>} 当前被占用的资源名 */
    this.active = new Set();
  }

  /**
   * 尝试获取冲突锁。无冲突返回 true，否则 false。
   * @param {{ conflicts: Set<string> }} node - DAG 节点
   * @returns {boolean}
   */
  tryAcquire(node) {
    for (const res of node.conflicts) {
      if (this.active.has(res)) return false;
    }
    for (const res of node.conflicts) {
      this.active.add(res);
    }
    return true;
  }

  /**
   * 释放节点的全部冲突锁
   * @param {{ conflicts: Set<string> }} node - DAG 节点
   */
  release(node) {
    for (const res of node.conflicts) {
      this.active.delete(res);
    }
  }
}

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
 * @returns {Map<string, { id: string, description: string, dependsOn: string[], conflicts: string[], retry?: number, run: { cmd?: string, fn?: () => boolean } }>}
 */
function loadTaskRegistry() {
  const registry = new Map();
  const files = collectTaskFiles(TASKS_DIR);

  for (const file of files) {
    const exported = require(file);
    const defs = Array.isArray(exported) ? exported : [exported];

    for (const def of defs) {
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
        conflicts: def.conflicts || [],
        retry: def.retry,
        run: def.run || {},
      });
    }
  }

  return registry;
}

// ============================================================
//  依赖解析
// ============================================================

/**
 * 解析目标任务的完整依赖图，返回拓扑排序后的执行列表。
 * 使用 TaskDAG 统一管理：BFS 收集 → 构建 DAG → 冲突边 → 拓扑排序。
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

  // 构建 DAG
  const taskList = [];
  for (const id of needed) taskList.push(registry.get(id));
  const dag = new TaskDAG(taskList);

  // 冲突边插入：共享资源的任务间若无路径，自动加串行边
  const conflictGroups = new Map();
  for (const id of needed) {
    const task = registry.get(id);
    for (const res of (task.conflicts || [])) {
      if (!conflictGroups.has(res)) conflictGroups.set(res, new Set());
      conflictGroups.get(res).add(id);
    }
  }

  for (const ids of conflictGroups.values()) {
    if (ids.size < 2) continue;
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        dag.addEdge(arr[i], arr[j]);
      }
    }
  }

  // 拓扑排序
  const { ordered, cyclic } = dag.topologicalSort();

  if (cyclic) {
    errors.push('Circular dependency detected');
    return { ordered: [], errors };
  }

  return { ordered, errors: [] };
}

// ============================================================
//  依赖树
// ============================================================

/**
 * 构建倒置依赖树：从根任务（无被依赖者）向下展开 dependsOn。
 * 线性链（唯一父子）折叠为 "A → B" 单行。共享依赖在多个分支各出现一次。
 * @param {Array<object>} taskList - 拓扑排序后的任务列表
 * @returns {Array<{ name: string, color: string, indices: number[], prefix: string }>}
 */
function buildTaskTree(taskList) {
  const taskMap = new Map();
  for (const t of taskList) taskMap.set(t.id, t);

  const dag = new TaskDAG(taskList);

  // 找根：没有被任何其他任务依赖的任务
  const hasDependent = new Set();
  for (const t of taskList) {
    for (const depId of t.dependsOn) hasDependent.add(depId);
  }
  const roots = taskList.filter((t) => !hasDependent.has(t.id));

  /** @type {Array<{ name: string, color: string, indices: number[], prefix: string }>} */
  const rows = [];

  /**
   * 沿 dependsOn 方向收集线性链：当前节点有唯一依赖，且该依赖有唯一被依赖者。
   * @param {string} startId
   * @returns {string[]} 链成员 ID 列表（含 startId）
   */
  function collectChain(startId) {
    const members = [startId];
    let cur = startId;
    while (true) {
      const node = dag.nodes.get(cur);
      if (node.parents.size !== 1) break;
      const parentId = [...node.parents][0];
      const parent = dag.nodes.get(parentId);
      if (parent.children.size !== 1) break;
      members.push(parentId);
      cur = parentId;
    }
    // 反转：使链按执行顺序排列（先执行的在前）
    members.reverse();
    return members;
  }

  /**
   * 递归渲染节点（含链折叠）
   * @param {string} taskId
   * @param {string} prefix - 累积缩进
   * @param {number} depth - 当前深度
   */
  function renderNode(taskId, prefix, depth) {
    const task = taskMap.get(taskId);
    if (!task) return;

    // 收集从此节点开始的线性链
    const chainIds = collectChain(taskId);
    const chainNodes = chainIds.map((id) => dag.nodes.get(id));
    const indices = chainNodes.map((n) => n.index);
    const name = chainIds.length === 1
      ? taskMap.get(chainIds[0]).description
      : chainIds.map((id) => taskMap.get(id).description).join(' \u2192 ');
    const color = COLOR_PALETTE[indices[0] % COLOR_PALETTE.length];

    rows.push({ name, color, indices, prefix, depth });

    // 展开链首节点（执行顺序最先）的依赖
    const rootId = chainIds[0];
    const rootTask = taskMap.get(rootId);
    const deps = rootTask.dependsOn || [];
    const childPrefix = prefix + '  ';
    for (let i = 0; i < deps.length; i++) {
      renderNode(deps[i], childPrefix, depth + 1);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    renderNode(roots[i].id, '', 0);
  }

  return rows;
}

// ============================================================
//  执行
// ============================================================

/** 最大并行任务数 */
const MAX_CONCURRENT = 4;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/** 重试基础延迟（ms），指数退避：delay * 2^(attempt-1) */
const RETRY_BASE_DELAY = 1000;

/** 并行任务颜色调色板（TUI 命名色 → ANSI 转义码），14 色确保区分 */
const COLOR_PALETTE = [
  'cyan', 'yellow', 'magenta', 'blue', 'green', 'red', 'white',
  'cyanBright', 'yellowBright', 'magentaBright', 'blueBright', 'greenBright', 'redBright', 'whiteBright',
];
const COLOR_ANSI = {
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  cyanBright: '\x1b[96m',
  yellowBright: '\x1b[93m',
  magentaBright: '\x1b[95m',
  blueBright: '\x1b[94m',
  greenBright: '\x1b[92m',
  redBright: '\x1b[91m',
  whiteBright: '\x1b[97m',
};

/**
 * 执行回调接口
 * @typedef {object} RunCallbacks
 * @property {(payload: { tasks: Array<{ name: string, color: string }>, rows: Array<{ name: string, color: string, indices: number[], prefix: string }> } | string[]) => void} onInit
 * @property {(index: number, status: string, elapsed?: number, extra?: object) => void} onStatus
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
 * 执行单个任务（含自动重试）
 * 失败时按指数退避重试，最多 retry 次（默认 3）。
 * 重试信息通过 onLog 输出到 TUI 日志面板。
 * @param {object} task - 任务定义
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [cb]
 * @returns {Promise<boolean>}
 */
async function executeOneTask(task, mode, cb) {
  const maxRetries = task.retry != null ? task.retry : DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt - 1), 30000);
      if (cb) {
        cb.onLog(`[retry] ${task.description}: attempt ${attempt}/${maxRetries}, waiting ${delayMs / 1000}s...`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    let ok;
    if (task.run.fn) {
      try { ok = task.run.fn() !== false; } catch (_) { ok = false; }
    } else if (task.run.cmd) {
      ok = mode === 'tui'
        ? await runCmdSilent(task.run.cmd, cb)
        : await runCmdInherit(task.run.cmd);
    } else {
      ok = true;
    }

    if (ok) return true;

    if (cb && attempt < maxRetries) {
      cb.onLog(`[retry] ${task.description}: failed, will retry (${maxRetries - attempt} left)`);
    }
  }

  return false;
}

/**
 * 串行执行（inline 模式用）
 * @param {Array} taskList
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [cb]
 * @returns {Promise<boolean>}
 */
async function executeTasksSequential(taskList, mode, cb) {
  if (cb) {
    const flatTasks = taskList.map((t, i) => ({ name: t.description, color: COLOR_PALETTE[i % COLOR_PALETTE.length] }));
    cb.onInit({ tasks: flatTasks, rows: buildTaskTree(taskList) });
  }

  let allOk = true;

  for (let i = 0; i < taskList.length; i++) {
    const task = taskList[i];
    const start = Date.now();

    if (cb) cb.onStatus(i, 'running');
    const ok = await executeOneTask(task, mode, cb);
    const elapsed = Date.now() - start;

    if (ok) {
      if (cb) cb.onStatus(i, 'done', elapsed);
    } else {
      if (cb) cb.onStatus(i, 'failed', elapsed);
      allOk = false;
      // 标记剩余任务为 skipped
      for (let j = i + 1; j < taskList.length; j++) {
        if (cb) cb.onStatus(j, 'skipped');
      }
      break;
    }
  }

  if (cb) cb.onExit(allOk);
  return allOk;
}

/**
 * 并行执行（TUI 模式用）。
 * 基于 TaskDAG 依赖调度 + ConflictSet 冲突锁：
 *   依赖满足 → 无冲突锁 → 有空闲槽位 → 立即执行。
 * @param {Array} taskList - 拓扑排序后的任务定义数组
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} cb - TUI 回调
 * @returns {Promise<boolean>}
 */
async function executeTasksParallel(taskList, mode, cb) {
  cb.onInit({
    tasks: taskList.map((t, i) => ({ name: t.description, color: COLOR_PALETTE[i % COLOR_PALETTE.length] })),
    rows: buildTaskTree(taskList),
  });

  const dag = new TaskDAG(taskList);
  const conflicts = new ConflictSet();

  const ready = dag.getReady();
  /** @type {Set<string>} 已到达终态（done 或 failed）的任务 ID */
  const completed = new Set();
  const running = new Map();
  let allOk = true;

  let resolveDone;
  const donePromise = new Promise((r) => { resolveDone = r; });

  /**
   * 为任务创建带颜色标记的回调包装，日志行以彩色 ● 为前缀
   * @param {string} colorName - 颜色名
   * @returns {RunCallbacks}
   */
  function makeColoredCb(colorName) {
    const ansi = COLOR_ANSI[colorName] || '';
    return {
      onLog: (text) => cb.onLog(`${ansi}\u25cf\x1b[0m ${text}`),
      onStatus: (i, s, e, extra) => cb.onStatus(i, s, e, extra),
      onInit: cb.onInit,
      onExit: cb.onExit,
    };
  }

  /**
   * 尝试调度：从 ready 集合中取出可执行的任务并启动。
   * 单任务失败不中止全局 —— 仅阻断其子孙，独立分支继续执行。
   */
  function trySchedule() {
    for (const id of [...ready]) {
      if (running.size >= MAX_CONCURRENT) break;

      const node = dag.nodes.get(id);
      if (!conflicts.tryAcquire(node)) continue;

      ready.delete(id);
      const task = node.task;
      const index = node.index;
      const colorName = COLOR_PALETTE[index % COLOR_PALETTE.length];

      cb.onStatus(index, 'running');

      const taskCb = makeColoredCb(colorName);
      const start = Date.now();

      const promise = executeOneTask(task, mode, taskCb).then((ok) => {
        const elapsed = Date.now() - start;
        running.delete(id);
        conflicts.release(node);
        completed.add(id);

        if (ok) {
          cb.onStatus(index, 'done', elapsed);
          // 解锁子孙，失败的子孙不会被添加（没有 onDone → remainingDeps 保持 >0）
          for (const uid of dag.onDone(id)) ready.add(uid);
        } else {
          cb.onStatus(index, 'failed', elapsed);
          allOk = false;
          // 不调用 onDone：子孙 remainingDeps 保持 >0，永不可达
        }

        trySchedule();
      });

      running.set(id, promise);
    }

    // 终止条件：无就绪任务且无运行中任务
    if (ready.size === 0 && running.size === 0) {
      // 标记不可达任务为 skipped
      for (const node of dag.nodes.values()) {
        if (!completed.has(node.task.id)) {
          cb.onStatus(node.index, 'skipped');
        }
      }
      cb.onExit(allOk);
      resolveDone();
    }
  }

  trySchedule();
  await donePromise;

  return allOk;
}

/**
 * 按序执行已解析的任务列表（TUI 模式并行、回退模式串行）
 * @param {Array} taskList - 拓扑排序后的任务定义数组
 * @param {'tui'|'inline'} mode - 执行模式
 * @param {RunCallbacks} [tuiCallbacks] - TUI 模式回调
 * @returns {Promise<boolean>} 是否全部成功
 */
async function executeTasks(taskList, mode, tuiCallbacks) {
  if (mode === 'tui' && tuiCallbacks) {
    return executeTasksParallel(taskList, mode, tuiCallbacks);
  }
  return executeTasksSequential(taskList, mode, tuiCallbacks || null);
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
