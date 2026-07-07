# Hound Whiteboard

Tauri 2 桌面白板应用。前端 Vanilla JS（无框架），通过 IPC 与 Rust 后端通信。

## 常用命令

```bash
# 开发
yarn dev                        # Tauri 开发模式（热更新）
yarn build                      # 生产构建

# 测试
yarn test                       # 运行全部测试
npx jest path/to/test.test.js   # 运行单个测试文件
npx jest -t "pattern"           # 按名称过滤

# 基准测试
yarn bench                      # 全部基准
yarn bench:io                   # I/O 桥接基准
yarn bench:io:direct            # I/O 直连基准
```

运行测试需要 `NODE_OPTIONS='--experimental-vm-modules --localstorage-file=/tmp/jest-localstorage'`（`package.json` 已配好）。

## 项目结构

```
src/
├── main.js                  # 渲染进程入口，日志初始化
├── preload.js / preload-io.js  # Tauri preload
├── io-bridge-*.js           # 渲染↔主进程 IPC 桥接
├── core/
│   ├── ui/                  # UI 线程（输入编排、工具、overlay）
│   │   ├── components/      #   Board / Viewport / UiRenderer
│   │   ├── devices-dag/     #   DAG 输入路由图 + 设备 + 工具 + 编排
│   │   │   ├── devices/     #     物理设备抽象（mouse/keyboard/touchscreen）
│   │   │   ├── tools/       #     交互工具
│   │   │   │   ├── creator/ #       创建工具（stroke/circle/polygon/obj）
│   │   │   │   ├── modifier/#       修改工具（手势位移）
│   │   │   │   ├── chooser/ #       选择工具
│   │   │   │   └── eraser/  #       擦除工具
│   │   │   └── prefixs/     #     handoff 控制权转移
│   │   └── frame/           #   Frame 合成层
│   ├── worker/              # Core Worker（对象、区块、渲染）
│   │   ├── components/
│   │   │   ├── orchestration/ #   BoardCore / ViewportCore
│   │   │   ├── chunk/         #   区块、加载器、静态图
│   │   │   └── renderer/      #   BaseRenderer / LiveRenderer
│   │   └── hit/               #   撤销树、操作历史
│   ├── shared/              # 跨线程共享纯逻辑
│   │   ├── components/      #   AOM、渲染器基类、脏区调度
│   │   ├── objects/         #   对象模型（BasicObj, Stroke, 几何图形）
│   │   └── range/           #   几何范围抽象
│   ├── bridges/             # Worker ↔ UI RPC 桥接
│   ├── utils/               # 通用工具（数学、图、事件总线等）
│   ├── docs/                # 核心架构文档
│   └── test-support/        # 测试 mock 支撑
├── utils/                   # 应用级工具（filesys, log, safe-io）
└── templates/               # 白板 HTML/CSS/JS 模板
src-tauri/                   # Rust 后端（Cargo workspace）
benchmarks/                  # 性能基准
```

核心模块下有 `docs/{name}-document.md` 和 `tests/` 目录。

## 架构关键概念

- **Tool** — 设备图末端消费型处理器，不转发信号。生命周期：`beginInteraction → handleSignal* → endInteraction → success`
- **信号类型** — `position`（绝对坐标，驱动手势状态机）、`displacement`（相对位移，无状态增量）、`end`、`success`
- **输入路由** — 设备 → DAG → 工具处理器。handoff 通过 `prefixs/` 转移控制权
- **对象模型** — `BasicObject` 基类，`Stroke`/`Container`/`two-dim`/`one-dim` 子类

## 代码规范

### 文件头（必须）

```javascript
/**
 * @file 简短描述，不加句号
 * @description 一句话职责说明，以句号结尾。
 * @module core/{path/to/module}
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
