# 构建脚本系统

本文档描述 `scripts/` 下构建系统的架构、任务定义规范与扩展方式。

## 目录结构

```
scripts/
├── build/
│   ├── build-entry.cjs         # 命令入口：路由 → 目标任务 ID → 委托 task-runner
│   ├── task-runner.cjs         # 核心引擎：加载、依赖解析（拓扑排序）、执行
│   ├── tasks/                  # 声明式任务定义（18 个）
│   │   ├── deps.cjs            #   id: deps
│   │   ├── run-tests.cjs       #   id: test
│   │   ├── icon-*.cjs          #   id: icon:{platform}  ×6
│   │   ├── android-*.cjs       #   id: android:init / android:signing
│   │   ├── ios-init.cjs        #   id: ios:init
│   │   └── build-*.cjs         #   id: build:{platform}  ×7
│   ├── gen-icons.cjs           # 图标生成工具（被 icon:* 任务调用）
│   ├── clean.cjs               # 清理构建产物
│   ├── copy-keystore.cjs       # Android 签名密钥复制（独立脚本）
│   ├── icon-config.json        # 图标平台配置
│   └── tui-app/
│       └── index.mjs           # Ink 5 分屏 TUI 渲染进程
└── ci/
    ├── check-doc-links.mjs     # 文档链接有效性检查
    └── check-module-paths.mjs  # @module 路径一致性检查
```

## 架构分层

```
package.json scripts
      │
      ▼
build-entry.cjs          ← 命令路由（icon / dev / build / build-quick / ship）
      │
      ▼
task-runner.cjs          ← 加载注册表 → 解析依赖图 → 拓扑排序 → 执行
      │
      ├── tasks/*.cjs    ← 声明式任务定义（id / description / dependsOn / run）
      │
      └── tui-app/       ← TUI 模式：TCP JSON → Ink 5 渲染
```

### 设计原则

- **声明式依赖**：每个任务只描述"依赖谁"，不关心"被谁依赖"。执行顺序由拓扑排序自动推导。
- **命令与任务分离**：`build-entry.cjs` 只做命令→目标任务 ID 的映射，不包含任务定义。
- **TUI 可插拔**：`task-runner.cjs` 通过回调接口适配 TUI / 回退内联两种模式，不耦合 Ink。

## 任务定义规范

每个 `scripts/build/tasks/{name}.cjs` 文件必须导出：

```javascript
/**
 * @file 简短描述
 * @description 一句话职责说明，以句号结尾。
 * @module scripts/build/tasks/{name}
 */

module.exports = {
  /** 唯一标识，冒号分隔命名空间，如 'icon:win'、'build:android' */
  id: 'task:id',

  /** TUI 中显示的任务名称 */
  description: 'Human-readable name',

  /** 依赖的任务 ID 列表，无依赖时传 [] */
  dependsOn: ['other:id'],

  /** 冲突资源名列表，共享同一资源的任务会被自动串行化 */
  conflicts: ['resource:gen-icons'],

  /** 执行体，二选一 */
  run: { cmd: 'shell command' }   // shell 命令
    | { fn: someFunction }        // 同步函数，返回 boolean
};
```

### `run` 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `cmd` | `string` | shell 命令，在项目根目录执行。TUI 模式静默捕获输出，回退模式 inherit stdio |
| `fn` | `() => boolean` | 同步函数，返回 `false` 表示失败。典型用例：`android:signing` 的文件修改逻辑 |

## 依赖图

```
┌─────┐  ┌──────┐
│deps │  │ test  │
└──┬──┘  └──┬───┘
   │        │         (ship 命令组合 test + build)
   │   ┌────┴──────────┬──────────┐
   │   │               │          │
   ▼   ▼               ▼          ▼
┌──────────┐  ┌────────────┐  ┌─────────┐
│android:  │  │ios:init    │  │icon:    │
│init      │  │            │  │desktop  │
└────┬─────┘  └────────────┘  │mac      │
     │                        │win      │
     ▼                        │linux    │
┌──────────┐                  │android  │
│android:  │                  │ios      │
│signing   │                  └────┬─────┘
└────┬─────┘                       │
     │         ┌───────────────────┤
     │         │                   │
     ▼         ▼                   ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│build:    │ │build:    │ │build:    │
│android   │ │desktop   │ │mac       │
└──────────┘ │win       │ │mac-uni.. │
             │linux     │ │ios       │
             └──────────┘ └──────────┘
```

### 拓扑排序示例

```
build:android 的解析结果（6 步）：
  1. deps
  2. android:init
  3. icon:android
  4. icon:desktop
  5. android:signing        ← 依赖 android:init
  6. build:android          ← 依赖以上全部

ship:win 的解析结果（4 步）：
  1. deps
  2. icon:win
  3. test
  4. build:win              ← 依赖 deps + icon:win
```

## 命令映射

所有命令通过 `build-entry.cjs` 的 `COMMAND_TASKS` / `DEV_SETUP_TASKS` 映射到目标任务 ID。

| 命令 | 平台 | 目标任务 ID |
|------|------|-------------|
| `icon` | `desktop` | `['icon:desktop']` |
| | `all` | 全部 6 个 `icon:*` |
| `dev` | `desktop` | `['deps', 'icon:desktop']` → spawn `tauri dev` |
| | `android` | `['deps', 'android:init', 'icon:android', 'icon:desktop']` → spawn `tauri android dev` |
| `build` | `win` | `['build:win']` (自动解析依赖) |
| `build-quick` | `win` | 直接 `tauri build`（不经依赖图） |
| `ship` | `mac` | `['test', 'build:mac']` (自动解析依赖) |

### dev 命令特殊性

`dev` 命令分两阶段：
1. **依赖任务阶段**：通过 task-runner 执行 `DEV_SETUP_TASKS`，TUI 中显示进度
2. **长期运行阶段**：TUI 退出后，以 `inherit stdio` spawn `tauri dev`（或 `tauri android dev`）

### build-quick 命令

跳过依赖图，直接执行 Tauri 构建命令。适用于依赖和图标都已就绪时的快速迭代。

## TUI 系统

### 架构

```
build-entry.cjs                   tui-app/index.mjs
     │                                    │
     ├─ startTui() ── TCP server ────────┤ net.createConnection()
     │      │               │             │
     │      └─ spawn node ──┘             │
     │                                    │
     ├─ onInit(tasks) ──────── JSON ────►│ setTasks()
     ├─ onStatus(i, s, ms) ─── JSON ────►│ setTasks(update)
     ├─ onLog(text) ────────── JSON ────►│ setLogs(append)
     └─ onExit(ok) ─────────── JSON ────►│ safeExit()
```

### 消息协议

通过换行分隔的 JSON 消息通信（TCP localhost 动态端口）。

| type | 方向 | payload | 说明 |
|------|------|---------|------|
| `init` | → TUI | `{ tasks: string[] }` | 初始化任务列表（描述数组） |
| `status` | → TUI | `{ index, status, elapsed? }` | 更新任务状态：running/done/failed |
| `log` | → TUI | `{ text }` | 追加构建日志行 |
| `exit` | → TUI | `{ ok }` | 通知退出，TUI 渲染摘要后自行退出 |

### 回退模式

当 `stdout` 不是 TTY 时（如 CI 环境），自动回退到内联 ANSI 进度输出，不启动 Ink 子进程。

## task-runner.cjs API

```javascript
const {
  loadTaskRegistry,    // () => Map<id, task>
  resolveTaskGraph,    // (targetIds, registry) => { ordered, errors }
  executeTasks,        // (ordered, mode, callbacks?) => Promise<boolean>
  run,                 // (targetIds, mode, callbacks?) => Promise<{ ok, errors }>
  runCmdInherit,       // (cmd) => Promise<boolean>
} = require('./task-runner.cjs');
```

### 回调接口

```typescript
interface RunCallbacks {
  onInit(tasks: string[]): void;
  onStatus(index: number, status: 'running'|'done'|'failed', elapsed?: number): void;
  onLog(text: string): void;
  onExit(ok: boolean): void;
}
```

### 循环依赖检测

拓扑排序完成后检查 `ordered.length !== needed.size`，若不等则报告 `Circular dependency detected`。

### 冲突锁

当多个任务操作同一资源（临时文件、CLI 进程、目录）时，声明 `conflicts` 可防止它们在未来并行化时同时运行。

- `conflicts` 数组中的值为资源标识符（推荐 `resource:` 前缀）
- `resolveTaskGraph` 检测共享冲突资源的任务对，若无依赖路径则自动插入串行边
- 已有依赖路径的冲突对（如一方的 `dependsOn` 已覆盖另一方）不做修改

```
示例：6 个 icon:* 任务均声明 conflicts: ['resource:gen-icons']
→ 拓扑排序时自动串行化，确保 gen-icons.cjs 不被并发调用
```

### 添加新任务

1. 在 `scripts/build/tasks/` 下创建 `{name}.cjs`
2. 按规范导出 `{ id, description, dependsOn, conflicts, run }`
3. 如果新任务需要被某个命令触发，在 `build-entry.cjs` 的 `COMMAND_TASKS` 中添加映射

无需修改 `task-runner.cjs`——它会自动扫描 `tasks/` 目录加载。

### 示例：添加代码检查任务

```javascript
// scripts/build/tasks/lint.cjs
module.exports = {
  id: 'lint',
  description: 'Lint source code',
  dependsOn: [],
  run: { cmd: 'yarn ci-check' },
};
```

然后在 `build-entry.cjs` 中将 `lint` 加入需要它的命令映射：
```javascript
ship: {
  win: ['lint', 'test', 'build:win'],
},
```

## 其他脚本

### clean.cjs

清理构建产物。目标：`target`（Rust）、`gen`（移动端）、`icons`、`temp`。

### gen-icons.cjs

图标生成工具。调用 `tauri icon` → 从临时目录按白名单拷贝。被 `icon:*` 任务通过 `node gen-icons.cjs {platform}` 调用。

### copy-keystore.cjs

独立脚本，从 `keys/keystore.properties` 复制到 `src-tauri/gen/android/`。注意：`android:signing` 任务内联了此逻辑并有额外 `build.gradle.kts` 修改，不再调用此脚本。

### CI 检查

| 脚本 | 检查内容 |
|------|---------|
| `check-doc-links.mjs` | 扫描 `src/core/**/*.md`，验证 `.md` 相对链接目标存在 |
| `check-module-paths.mjs` | 扫描 `src/core/**/*.js`，验证 `@module` 与实际路径一致 |
