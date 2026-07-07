# 组件文档（已迁移）

> **注意**：`src/core/components/` 已按运行边界拆分为 `core/shared/`、`core/ui/`、`core/worker/`。
> 本文件内容已过时，完整的模块分层与边界信息请参考 [core-runtime-boundaries.md](../core-runtime-boundaries.md)。

## 迁移后对应关系

| 旧路径                                              | 新路径                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `components/chunk/`                                 | `core/shared/components/chunk/`                                 |
| `components/orchestration/board-core.js`            | `core/worker/components/orchestration/board-core.js`            |
| `components/orchestration/viewport-core.js`         | `core/worker/components/orchestration/viewport-core.js`         |
| `components/orchestration/board.js`                 | `core/ui/components/orchestration/board.js`                     |
| `components/orchestration/viewport.js`              | `core/ui/components/orchestration/viewport.js`                  |
| `components/orchestration/active-object-manager.js` | `core/shared/components/orchestration/active-object-manager.js` |
| `components/renderer/base-renderer.js`              | `core/worker/components/renderer/base-renderer.js`              |
| `components/renderer/live-renderer.js`              | `core/worker/components/renderer/live-renderer.js`              |
| `components/renderer/ui-renderer.js`                | `core/ui/components/renderer/ui-renderer.js`                    |
| `components/renderer/renderer.js` 等共享渲染文件    | `core/shared/components/renderer/`                              |
| `components/index.js`                               | 已删除，直接引用对应模块                                        |

## 关键设计点

### `Board` / `BoardCore` 拆分

- `Board` 负责 UI 运行时
- `BoardCore` 负责对象、区块、AOM、UndoTree、持久化协调

### `Viewport` 家族拆分

- `Viewport`：UI 侧视口，接收 Worker 渲染帧
- `ViewportCore`：Worker 侧真实渲染核心

### AOM 渲染副作用抽离

`ActiveObjectManager` 通过 `renderHooks` 间接请求：

- live 层刷新
- base 层对象级 / 区块级刷新
- 视口范围刷新

AOM 自身不直接依赖 DOM canvas 或 viewport 列表。

## 当前状态

- Worker 架构已接通
- demo 默认启用 Worker mode
- Shared 组件层已形成稳定边界

## 相关文档

- [core-runtime-boundaries.md](../../docs/core-runtime-boundaries.md)
- [board-document.md](../orchestration/docs/board-document.md)
- [viewport-document.md](../orchestration/docs/viewport-document.md)
- [active-object-manager-document.md](../orchestration/docs/active-object-manager-document.md)
