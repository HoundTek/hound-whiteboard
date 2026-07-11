# 视口渲染器文档

本文档提供 `ViewportRenderer` 的概述。

`ViewportRenderer` 在一个类内管理两个 OffscreenCanvas：`#cache`（静态层预渲染缓存）和 `#output`（最终输出 canvas）。它将静态图对象（不在 AOM 中的对象）绘制到 `#cache`，最终帧输出时将 `#cache` 拷贝到 `#output` 再叠画 AOM 中的对象，形成完整合成输出。

它统一了静态缓存与输出合成的职责，统一了调度器、脏区跟踪与时序同步，消除了双渲染器时代的时序竞态。

## 模块定位

`ViewportRenderer` 处于一条清晰的边界中：

- `ActiveObjectManager` 负责按对象是否在 AOM 中划分渲染职责：AOM 中的对象由输出层直接绘制，不在 AOM 中的对象先画到缓存再合成
- `ViewportCore` 负责回答"当前视口的缩放、原点和画布实例是什么"
- `RenderScheduler` 负责回答"何时真正执行一次 flush"
- `ViewportRenderer` 负责合成：缓存更新（静态图对象）→ 缓存拷贝到输出 → AOM 对象叠画

## 当前职责

### 缓存管理

- 维护一个内部的 `#cache` OffscreenCanvas，尺寸与输出 canvas 一致
- 当 `#cacheDirty = true` 时，在 `flush()` 前主动更新缓存：清空脏区 → 收集非 AOM 的静态图对象 → 按合并后的全局静态图拓扑序绘制
- 缓存尺寸跟随 `resize()` 同步调整

### 输出合成

- `flush()` 执行三步合成流水线：
  1. 若缓存脏 → `_updateCache(dirtyRects)`
  2. 清空输出 canvas 脏区
  3. 从缓存拷贝脏区内容到输出
  4. 按 AOM 层顺序绘制 AOM 对象
- 全量刷新时使用 `#copyCache()`，脏区刷新时使用 `#copyCacheRects()`

### 两种失效路径

| 方法 | 场景 | 效果 |
|------|------|------|
| `invalidateActiveObjects(objects)` | AOM 对象变更（create / modify / move） | 仅失效输出层，不动缓存 |
| `invalidateCachedObjects(objects, {previousWorldRects})` | 静态图变更（commit / delete） | 标记缓存脏 + 失效输出层 |
| `invalidateChunks(chunks, previousChunks, opts)` | 区块缓冲区变更（viewport 平移/缩放） | 标记缓存脏 + 失效输出层 |
| `invalidate(rect)` | 通用脏区失效 | 提交到统一调度器 |
| `invalidateViewport()` | 整视口失效 | 全量刷新 |

## 对象收集

### 缓存层（`#collectCacheDrawables()`）

- 从 `chunkLoader.getLoadedChunks()` 读取当前已加载区块
- 合并各区块的 `staticGraph` 为全局静态图，按拓扑序排列
- **过滤掉 AOM 管理的对象**（`aom.has(id)` 为 true 的都被剔除）
- 通过 AOM 回查静态对象实例，并按 id 去重

### 输出层（`collectActiveDrawables()`）

- 直接从 AOM 读取当前层状态：遍历 `layerOrder`，active layer 中先收集 `activeObjects` 再收集 `inactiveGraph`，inactive layer 中保留在 `activeObjects` 的对象按 inactive 语义绘制
- 回退路径：未落入 `layerOrder` 的活动对象从 `activeObjects` 补收

## 脏区策略

- 合并阈值使用静态层策略（`createBaseDirtyRectThresholdStrategy`），对缓存脏区更保守以减少不必要的缓存重绘
- canonical rect 塌缩沿用原静态层实现中的 chunk 级屏幕矩形解析
- 调度器统一管理：一次 `flush()` 同时处理缓存更新和输出合成，没有两个独立调度器的时序竞态

## 快照与旧帧追踪

`ViewportRenderer` 内部维护两类状态用于对象移动时清除旧像素：

- `#previousAomEntries`：上一帧 AOM drawable 的屏幕范围缓存
- `#objectSnapshotRects`：显式记录的几何变更前快照（由 `captureObjectSnapshot()` 写入）

`invalidateActiveObjects()` 同时失效：对象当前屏幕范围 + 快照范围 + 上一帧范围，确保拖拽 / 变形时旧像素被清除。

## 调试 API

- `getStaticCache()`：返回内部的静态缓存 `OffscreenCanvas`，供调试面板读取
- `renderStaticCacheToCanvas(targetCanvas, dirtyRects?)`：把缓存内容渲染到外部 canvas，传入 dirtyRects 则先确保缓存最新

## 构造参数

```javascript
const renderer = new ViewportRenderer(viewport, activeObjectManager, {
  canvas: outputCanvas,  // options.canvas 即为输出 canvas
});
```

- 第一参数：viewport（ViewportCore 或 Viewport 兼容实例）
- 第二参数：ActiveObjectManager（可选，可通过 `setActiveObjectManager()` 后续设置）
- 第三参数：选项对象，`canvas` 指定输出 canvas

## 当前实现状态

- 已实现：单渲染器合成、缓存更新、输出合成、AOM 对象收集、AOM 排除过滤、对象级脏区失效、区块级脏区失效、快照追踪、调试 API
- 已接入：`ViewportCore`、`core-worker.js` 渲染钩子、`board-render-hooks.js`、`object-modifier.js`

## 相关文档

- [viewport-core-document.md](../../orchestration/docs/viewport-core-document.md)
- [active-object-manager-document.md](../../orchestration/docs/active-object-manager-document.md)
- [ui-renderer-document.md](../../../../ui/components/renderer/docs/ui-renderer-document.md)
