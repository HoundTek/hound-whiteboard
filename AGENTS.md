# Hound Whiteboard

Tauri 2 桌面白板应用。前端 Vanilla JS（无框架），通过 IPC 与 Rust 后端通信。

## 常用命令

```bash
# 开发
yarn dev                        # Tauri 开发模式（热更新，默认桌面端）
yarn dev:win                    # Windows 开发
yarn dev:mac                    # macOS 开发
yarn dev:linux                  # Linux 开发
yarn dev:android                # Android 开发
yarn dev:ios                    # iOS 开发
yarn build                      # 生产构建
yarn build:quick                # 仅构建（跳过依赖安装和图标）

# 测试
yarn test                       # 运行全部测试
npx jest path/to/test.test.js   # 运行单个测试文件
npx jest -t "pattern"           # 按名称过滤

# CI 检查
yarn ci-check                   # 文档链接 + @module 路径一致性检查

# 基准测试
yarn bench                      # 全部基准
yarn bench:io:direct            # I/O 直连基准
yarn bench:io:granularity       # I/O 文件粒度基准

# 协作同步
yarn relay                      # 启动同步中继（默认 8377 端口，仅绑 127.0.0.1；跨设备加 --host 0.0.0.0）
yarn demo:web                   # 启动 demo 静态服务（默认 8000 端口，浏览器双端协作冒烟）

# CLI
yarn cli <命令> [--daemon <名> | --path <板目录>]   # 读写板文件（见 src/cli/docs/cli-document.md）
yarn cli daemon start --name <名> --path <板目录>   # 启动板 daemon（持板 + RPC）
```

运行测试需要 `NODE_OPTIONS='--experimental-vm-modules --localstorage-file=/tmp/jest-localstorage'`（`package.json` 已配好）。

## 项目结构

```
src/
├── kernel/                  # 内核包（零 canvas/DOM：文档 + 操作 + 持久化）
│   ├── objects/             # 对象模型（BasicObject、Stroke、graph/）
│   ├── range/               # 几何
│   ├── chunk/               # 区块（空间分区）
│   ├── board/               # Board 权威状态（BoardCore 静态图 / AOM / render-hooks 缝）
│   ├── hit/                 # 操作日志与时间回溯树
│   ├── store/               # 会话存储（per-source 日志流与 meta 分片、写权仲裁落盘、恢复）
│   ├── api/                 # BoardApi 契约面
│   ├── utils/               # 内核工具（id 池、图、数学）
│   └── types/               # 类型定义
├── renderers/
│   └── canvas/              # canvas 渲染插件（viewport-renderer、绘制策略注册表）
├── host/                    # 组合根 + 通道（core-worker、debug-helper、bridges/、sync/ 协作同步）
├── io/                      # 安全文件操作（core 契约 / driver / adapter）
├── cli/                     # 命令行第二前端（板 daemon 持板，读写经 BoardApi 契约）
├── ui/                      # UI front（Board / Viewport / DevicesDAG / Tools / overlay）
├── utils/                   # 应用级工具（log）
├── docs/                    # 架构文档
├── test-support/            # 测试 mock 支撑
├── tests/                   # 跨包冒烟 / 集成测试
└── demo/                    # 白板 HTML/CSS/JS 入口（桌面与 web 模式）
src-tauri/                   # Rust 后端（Cargo workspace）
benchmarks/                  # 性能基准
dev/                         # 开发期文档与实验（probes/ 为渲染诊断探针，见 dev/probes/README.md）
scripts/                     # CI 检查与 demo 静态服务脚本
└── ci/                      # 文档链接 / @module 路径检查
```

核心模块下有 `docs/{name}-document.md` 和 `tests/` 目录。

## 架构关键概念

- **Tool** — 设备图末端消费型处理器，不转发信号。生命周期：`beginInteraction → handleSignal* → endInteraction → success`
- **信号类型** — `position`（绝对坐标，驱动手势状态机）、`displacement`（相对位移，无状态增量）、`end`、`success`
- **输入路由** — 设备 → DAG → 工具处理器。顺序/互斥组合（handoff、tool-switcher）由 `tools/wrapper/` 下的 wrapper tool 承担（`HandoffWrapperTool` / `ToolSwitcherWrapper`），作为普通 Tool 单节点挂载
- **对象模型** — `BasicObject` 基类，`Stroke`/`graph` 子类
- **AOM 三态术语** — 对象相对 AOM 动态图有三种状态：**活动对象**（被选中、正在操作，位于层的 `activeObjects`）、**非活动（层）对象**（被 pickup 一并纳入 AOM 的层成员，位于层的 `inactiveGraph`）、**不在 AOM 中的对象**（纯静态图，`aom.has(id) === false`）。“非活动对象”仍在 AOM 中，与“不在 AOM 中的对象”不是一回事。成员归属判定：`aom.isActive(id)` 仅活动对象，`aom.has(id)` 覆盖活动与非活动层成员
- **命名选择（choice）** — 活动对象的命名分组：每个活动对象恰好属于一个本地 choice（未命名落匿名桶 `~`）。注册表（`queryChoices`）是权威状态，对象退出活动集时成员关系自动解除；跨端以 `"{source}/{choice}"` 区分同名 choice

## 代码规范

### 文件头（必须）

```javascript
/**
 * @file 简短描述，不加句号
 * @description 一句话职责说明，以句号结尾。
 * @module {kernel|canvas|host|ui|io|cli}/{path/to/module}
 * @author {git config user.name}
 */
```

### JSDoc

描述用中文，类型名/术语保留英文。所有函数、类、字段、常量都必须有 JSDoc。`@description` 必须打句号。

```javascript
// ✅ Good
/**
 * 将修改后的对象提交回静态图
 * @param {Object} modificationContext - 修改上下文
 * @param {Iterable<*>|*} [objects] - 显式传入的对象集合
 * @returns {boolean} 是否成功提交
 */
applyModifiedObjects(modificationContext, objects) { ... }

// ❌ Bad — 没有 JSDoc
applyModifiedObjects(modificationContext, objects) { ... }

// ❌ Bad — 简短描述中添加句号
/**
 * 将修改后的对象提交回静态图。
 */
applyModifiedObjects(modificationContext, objects) { ... }
```

- 私有成员以 `_` 开头，标记 `@private`
- 常量用 `UPPER_SNAKE_CASE`
- **开发期路线编号（Kx/Px/Sx 等阶段代号）不进入代码库**：提交信息、代码注释、文档一律写机制语义本身，路线追踪留在私有计划文档
- 详细规范见 `.agent/skills/comment-writer/SKILL.md`，文档规范见 `.agent/skills/doc-writer/SKILL.md`

## 测试

### 结构

测试文件与源码同级放在 `tests/` 目录。**工具端到端测试放在工具目录下，不要放在 `board-input-flow.test.js`。**

### 关键坑点

1. **`board.width` / `board.height` 必须设置** — 涉及位置→区块解析时，创建 `Viewport` 后必须设 `board.width` / `board.height`，否则 `chunkWidth=0` → `worldToChunk` 返回 null → 对象创建静默失败
2. **DAG dispatch 必须传 `{ board, viewport }` 上下文** — 直接 dispatch 时手动传入；通过 `board.signalsEventBus.emit("input", ...)` 则自动携带
3. **modifier 双通道** — `position`（绝对坐标，手势状态机）和 `displacement`（相对位移，无状态增量）可同帧叠加。displacement 无准入检测，锚点自动同步
4. **断言要验证实际效果** — 验证位置/状态变化，不要只 `.not.toBeNull()`

详见 `.agent/skills/hound-whiteboard-test-patterns/SKILL.md`。

## 边界

- ✅ **始终**：测试放 `tests/` 目录、遵循 JSDoc 格式、运行 `yarn test` 验证
- ⚠️ **先问**：添加新依赖、改 Rust 后端代码、改 Tauri 配置
- 🚫 **绝不**：删除 `.agent/skills/` 下的技能文件、跨文件混放工具测试、绕过 `yarn test` 直接提交

## 项目技能

| 技能                                  | 何时使用                     |
| ------------------------------------- | ---------------------------- |
| `comment-writer`                      | 写 JSDoc / 行内注释 / 文件头 |
| `doc-writer`                          | 写 `docs/` 下的模块文档      |
| `hound-whiteboard-test-patterns`      | 添加/迁移/审查测试           |
| `hound-whiteboard-benchmark-patterns` | 添加/迁移/审查 benchmark     |
| `hound-whiteboard-git-convention`     | 准备提交时加载，确保格式一致 |

## Git 提交

- 在提交前让用户检查并征得同意，如果用户明确要求提交，默认同意提交
- 较大的更改需要拆分逻辑提交
