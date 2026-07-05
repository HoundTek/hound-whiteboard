# 活动对象管理器文档

本文档提供 `ActiveObjectManager` 的概述。

## 概述

`ActiveObjectManager`（AOM）管理“当前处于交互态”的对象集合与临时层关系。

典型来源包括：

- creator 刚创建但尚未提交的对象
- chooser 选中的对象
- modifier 正在编辑的对象

AOM 本身不依赖 DOM，也不直接持有 monitor 列表。它通过 `renderHooks` 把渲染副作用注入到调用方，因此既能在测试环境使用，也能在 Worker 中作为真实语义核心运行。

## 运行边界

- **Shared 模块**：AOM 的数据结构与算法本身属于 Shared
- **Worker 主运行位点**：在 Worker mode 下，真实 AOM 位于 Worker 的 `BoardCore` 中
- **UI（测试/兼容）**：本地 `BoardCore` 可在测试路径中使用同一实现

## 核心数据结构

### `Layer`

每层包含：

- `id`
- `activeObjects: Set<number>`
- `inactiveGraph: DirectedGraph`
- `active: boolean`

这里的 `active` 是层级状态，不是对象级状态。

### `ActiveObjectManager`

核心字段：

- `layerOrder`
- `layerIndex`
- `onLayer`
- `activeObjects`
- `activeObjectIndex`
- `baseObjectSnapshotWorldRanges`
- `baseObjectSnapshotCoverChunks`
- `renderHooks`

## AOM 与静态图的边界

### 静态图

- 各区块的 `ChunkObjectManager.staticGraph`
- 稳定层叠关系
- 对象提交回白板后由 static graph 接管显示

### 动态图

- AOM 内部的 `layerOrder + activeObjects + inactiveGraph`
- 只在交互期间存在
- 对象位于 AOM 中时，应由 live 层负责绘制

这两者的切换由：

- `add(objects)`
- `choose(objects)`
- `discard(objects)`
- `apply(objects)`
- `remove(objects)`

共同完成。

## renderHooks

AOM 当前通过 `renderHooks` 发起渲染请求：

- `requestLiveRender(objectInstances)`
- `requestBaseRender(chunks)`
- `requestBaseRenderForObjects(objectInstances, fallbackChunks, previousWorldRects)`
- `flushViewportForObjects(objectInstances)`

### Worker mode

在 Worker mode 下：

- `BoardCore` 注入的 hooks 最终驱动 `MonitorCore` 的 base/live 渲染
- AOM 自身不关心 DOM canvas

### UI（测试/兼容）

在测试路径下：

- `Board` 注入的 `board-render-hooks` 直接驱动本地 `BoardCore` 渲染器

## 主要流程

### `add(objects)`

用于把**尚未进入白板静态图**的新对象加入 AOM。

典型场景：creator 开始创建对象。

执行效果：

1. 注册到 `activeObjects` / `activeObjectIndex`
2. 创建新的顶层活动层
3. 调用 `requestBaseRenderForObjects()`
4. 调用 `requestLiveRender()`

### `choose(startFrom)`

用于把静态图中的对象拾取到 AOM。

执行效果：

1. `pickup(startFrom)` 提取子图
2. 分析层顺序并插入新层
3. 注册活动对象实例
4. 调用 `requestLiveRender()`
5. 调用 `requestBaseRenderForObjects()`，使 base 层按对象范围把这些对象隐藏掉

当前实现中，`choose()` 已改为对象级静态失效，不再做整视口 flush。

### `discard(objects)`

用于取消活动态，但不把几何变化提交回静态图。

执行效果：

1. 从活动对象索引中移除对象
2. 必要时把层标记为 inactive
3. `tidyup()` 清理底部 inactive 前缀层与空层
4. 调用 `requestBaseRenderForObjects()`，使静态层重新显示这些对象
5. 调用 `requestLiveRender()`
6. 清理快照

### `apply(objects)`

用于把活动态变化提交回静态图。

执行效果：

1. 根据覆盖区块快照与当前几何重写对象所在区块
2. 重算受影响对象的静态图关系
3. 收集邻接对象，形成对象级 base 失效集合
4. 调用 `requestBaseRenderForObjects()`
5. 调用 `requestLiveRender()`
6. 清理快照并移出活动索引

### `remove(objects)`

用于从白板彻底删除对象，并同步移出 AOM。

## 快照模型

AOM 用两类快照支持对象级静态失效：

### `baseObjectSnapshotWorldRanges`

记录对象进入 AOM 前的世界范围。

### `baseObjectSnapshotCoverChunks`

记录对象进入 AOM 前覆盖到的区块集合。

这两类快照让 `apply` / `discard` / `remove` 能同时失效旧几何与新几何，避免静态层残影。

## 与 tools 的关系

### creator

- `add()` 让新对象先停留在 AOM 动态图中
- handoff 模式下对象可继续桥接给 modifier

### chooser

- `choose()` 把静态对象拾取进 AOM
- 选中的对象成为 modifier 的输入来源

### modifier

- 只编辑当前仍在 AOM 中的对象
- `success` 最终走 `apply()`
- `cancel` 走 `discard()`

## 当前状态

- AOM 已作为 Worker 侧真实语义核心运行
- `choose` / `discard` / `apply` / `remove` 全部支持对象级静态失效
- 渲染副作用已完全通过 hooks 抽离

## 相关文档

- [board-document.md](./board-document.md)
- [monitor-document.md](./monitor-document.md)
- [ui-renderer-document.md](../../renderer/docs/ui-renderer-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
