# 组件文档

本文档提供 `src/core/components/` 当前结构的总览。

## 概述

`components/` 承载白板运行时中的三类能力：

1. **区块与对象组织**：`chunk/`
2. **渲染执行链**：`renderer/`
3. **白板编排层**：`orchestration/`

当前组件层的一个关键特点是：**UI façade 与 Worker core 已拆分**。

- UI 线程持有 `Board`、`MonitorProxy`
- Worker 线程持有 `BoardCore`、`MonitorCore`
- `ActiveObjectManager`、chunk、base/live renderer 等位于共享层

## 目录结构

```
src/core/components/
├── chunk/
├── renderer/
├── orchestration/
├── index.js
├── docs/
└── tests/
```

## 组件分层

### `chunk/`

区块系统，属于 Shared。

- `Chunk`：单区块实体
- `ChunkLoader`：区块加载器与持有策略
- `ChunkObjectManager`：区块静态图与对象覆盖区块索引

### `renderer/`

渲染执行链。

| 文件                      | 运行边界 | 说明                    |
| ------------------------- | -------- | ----------------------- |
| `renderer.js`             | Shared   | 渲染器基类              |
| `base-renderer.js`        | Shared   | base 层静态渲染         |
| `live-renderer.js`        | Shared   | live 层动态图渲染       |
| `ui-renderer.js`          | UI       | overlay 渲染            |
| `render-scheduler.js`     | Shared   | invalidate / flush 调度 |
| `dirty-rect-strategy*.js` | Shared   | 脏区策略                |

### `orchestration/`

编排层。

| 文件                       | 运行边界 | 说明                                               |
| -------------------------- | -------- | -------------------------------------------------- |
| `board.js`                 | UI       | UI façade，持有 DAG、signalsEventBus、monitor 集合 |
| `board-core.js`            | Worker   | 真实白板核心                                       |

| `monitor-proxy.js`         | UI       | Worker 模式下的 monitor 代理                       |
| `monitor-core.js`          | Worker   | Worker 侧视口与渲染核心                            |
| `active-object-manager.js` | Shared   | 交互态动态图与层关系                               |
| `aom-render-hooks.js`      | Shared   | AOM 渲染钩子接口                                   |
| `board-render-hooks.js`    | UI       | AOM → monitor 渲染桥接                             |

## 当前导出入口

`src/core/components/index.js` 当前只导出 UI 侧宿主入口：

- `Board`
- `MonitorProxy`

Worker 侧 `BoardCore` / `MonitorCore` 不经由该 barrel 导出，而是由 `src/core-worker.js` 直接引用。

## 关键设计点

### `Board` / `BoardCore` 拆分

- `Board` 负责 UI 运行时
- `BoardCore` 负责对象、区块、AOM、UndoTree、持久化协调

### `Monitor` 家族拆分

- `MonitorProxy`：Worker 模式下的 UI 视口代理
- `MonitorCore`：Worker 侧真实渲染核心

### AOM 渲染副作用抽离

`ActiveObjectManager` 通过 `renderHooks` 间接请求：

- live 层刷新
- base 层对象级 / 区块级刷新
- 视口范围刷新

AOM 自身不直接依赖 DOM canvas 或 monitor 列表。

## 当前状态

- Worker 架构已接通
- demo 默认启用 Worker mode
- Shared 组件层已形成稳定边界

## 相关文档

- [core-runtime-boundaries.md](../../docs/core-runtime-boundaries.md)
- [board-document.md](../orchestration/docs/board-document.md)
- [monitor-document.md](../orchestration/docs/monitor-document.md)
- [active-object-manager-document.md](../orchestration/docs/active-object-manager-document.md)
