# 视口渲染器文档

`ViewportRenderer` 在一个类内管理两个 OffscreenCanvas：`#cache`（静态层预渲染缓存）和 `#output`（最终输出 canvas）。它将静态图对象（不在 AOM 中的对象）绘制到 `#cache`，最终帧输出时将静态内容合成到 `#output`（非 tile 分支从 `#cache` 拷贝，tile 分支直接合成）再叠画 AOM 中的对象，形成完整合成输出。

它统一了静态缓存与输出合成的职责，内部分别由缓存层调度器和输出层调度器管理各自的脏区合并策略，消除了双渲染器时代的时序竞态。

## 模块定位

`ViewportRenderer` 处于一条清晰的边界中：

- `ActiveObjectManager` 负责按对象是否在 AOM 中划分渲染职责：AOM 中的对象由输出层直接绘制，不在 AOM 中的对象先画到缓存再合成
- `ViewportCore` 负责回答"当前视口的缩放、原点和画布实例是什么"
- `RenderScheduler` 负责回答"何时真正执行一次 flush"——现在有两个独立的调度器实例管理各自的 dirty rects
- `ViewportRenderer` 负责合成：缓存更新（静态图对象）→ 缓存拷贝到输出 → AOM 对象叠画

## 当前职责

### 缓存管理

- 静态内容的缓存更新分两条路径，由 `#useTiles()` 判定：为真时（`tiles` 开启、缩放档位 0、视口能提供世界矩形）静态内容由 `#drawTiles()` 直接合成到输出、缓存按脏 tile 局部重建；为假时全量重建 `#cache` 再拷贝到输出
- 维护一个内部的 `#cache` OffscreenCanvas，尺寸与输出 canvas 一致
- 由 `#cacheScheduler`（`RenderScheduler` 实例）管理缓存层脏区的积累和合并
- 当 `#cacheDirty = true` 时，在输出帧渲染前主动更新缓存：全量清空 → 收集非 AOM 的静态图对象 → 按合并后的全局静态图拓扑序绘制
- 非 tile 分支的缓存总是全量重建，不做局部重建（原因见下节「为什么不做局部重建」）
- 缓存尺寸跟随 `resize()` 同步调整

### 输出合成

- 由 `#outputScheduler`（`RenderScheduler` 实例）管理输出层脏区的积累和合并
- 每次输出 flush 时，`#outputFlush()` 先调用 `#flushCacheScheduler()` 确保缓存不落后于输出，再执行输出渲染
- 输出渲染流水线：
  1. 清空输出 canvas 脏区
  2. 从缓存拷贝脏区内容到输出
  3. 按 AOM 层顺序绘制 AOM 对象
  4. 保存状态供下一帧使用
- 全量刷新时使用 `#copyCache()`，脏区刷新时使用 `#copyCacheRects()`
- `flush()` 作为兼容入口仍保持完整的缓存+输出流水线

### 失效路径

| 方法                                                     | 场景                                   | 调度器                      | 效果                      |
| -------------------------------------------------------- | -------------------------------------- | --------------------------- | ------------------------- |
| `invalidateActiveObjects(objects)`                       | AOM 对象变更（create / modify / move） | `#outputScheduler` 仅输出层 | 仅失效输出层，不动缓存    |
| `invalidateCachedObjects(objects, {previousWorldRects})` | 静态图变更（commit / delete）          | 两者                        | 标记缓存脏 + 双调度器失效 |
| `invalidateChunks(chunks, previousChunks, opts)`         | 区块缓冲区变更（viewport 平移/缩放）   | 两者                        | 标记缓存脏 + 双调度器失效 |
| `invalidate(rect)`（覆写）                               | 通用脏区失效                           | 两者                        | 提交到两个调度器          |
| `invalidateViewport()`                                   | 整视口失效                             | 两者                        | 全量刷新                  |

### 调度协调

- `#outputScheduler` 通过 `this._scheduler` 公开，外部代码（如 `ViewportCore.flushRenderFrame()`）通过 `renderer._scheduler.framePending` / `renderer._scheduler.flush()` 直接访问输出调度器
- `#cacheFlush()` 仅在 `#cacheDirty` 为真时执行实际缓存更新
- `#flushCacheScheduler()` 在输出渲染前被调用：若有积压脏区则调用 `#cacheScheduler.flush()`，否则全量重建缓存
- 双调度器独立安排各自的 rAF，但输出帧总是先保证缓存最新

```mermaid
flowchart TD
  INV1["invalidateActiveObjects"] --> OS["#outputScheduler<br/>（仅输出层）"]
  INV2["invalidateCachedObjects"] --> CS["#cacheScheduler"]
  INV2 --> OS
  INV3["invalidateChunks"] --> CS
  INV3 --> OS

  CS -->|rAF| CF["#cacheFlush<br/>静态图对象绘制到 #cache"]
  OS -->|rAF| OF["#outputFlush"]
  OF --> FCS["#flushCacheScheduler<br/>先缓存后输出"]
  FCS --> CF
  FCS --> COPY["cache 拷贝<br/>#copyCache / #copyCacheRects"]
  COPY --> AOM["AOM 对象叠画到 #output"]
  AOM --> BMP["ViewportCore.flushRenderFrame<br/>transferToImageBitmap 回传 UI"]
```

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

- **缓存层调度器**使用 base 层策略（`createBaseDirtyRectThresholdStrategy`），仅用于控制刷新批次（重建范围见下文「为什么不做局部重建」）
- **输出层调度器**使用 live 层策略（`createLiveDirtyRectThresholdStrategy`），更激进的合并阈值（低 `viewportCoverageRatio`），适应逐帧变化的 AOM 输出
- 双调度器各自独立积累和合并脏区，输出帧渲染前通过 `#flushCacheScheduler()` 协调缓存 > 输出的时序保证

### 为什么不做局部重建

非 tile 分支的缓存只按整帧重建；tile 分支按脏 tile 局部重建。

局部重建要正确必须同时成立：

- 对象的实际绘制范围被失效矩形完整覆盖（描边外扩、miter 尖角、变换）
- 退出 AOM 的对象当帧被纳入静态失效
- 不在 AOM 中的对象不会被误纳入缓存

任何一条不成立，缓存就留下过期像素；这类残留叠加 AOM 当帧绘制后，半透明填充表现为整片变暗一帧

实测全量重建的代价与局部重建持平（100/300/600 笔画下倍率 ×0.96 至 ×1.00），收益实际来自输出层的脏区清除与拷贝

世界空间 tile 缓存（`#tileStore`）遵守同一不变式：对象进出 AOM 时整库标脏（`markAllDirty()`），不做局部标脏（见 `#invalidateTilesForCachedObjects`）。

### tile 边长随视口自适应

tile 合成的成本主要由 **tile 块数**决定（每块位图需要独立搬运一次），而不是光栅化面积。固定 512 边长在大视口下会切出过多块：900x700 视口实测 12 块，提交耗时是经典路径的 2.3 倍；改成 1024 边长只有 6 块，反而快于经典路径。

`resolveTileSize(width, height)` 取视口长边的 2 次幂（下限 `DEFAULT_TILE_SIZE` = 512，上限 `TILE_MAX_SIZE` = 2048），`resize()` 时重新推导，边长变化则重建 `TileStore`。

| 视口      | 边长 | 块数 | 提交相对经典路径 |
| --------- | ---- | ---- | ---------------- |
| 400x300   | 512  | 4    | ×0.92            |
| 900x700   | 1024 | 6    | ×0.98            |
| 1400x1100 | 2048 | 4    | ×1.10            |

`ViewportCore` 的 `tileSize` 选项可显式覆盖推导结果（测试与调优用）。

## 快照与旧帧追踪

`ViewportRenderer` 内部维护两类状态用于对象移动时清除旧像素：

- `#previousAomEntries`：上一帧 AOM drawable 条目缓存，除屏幕范围外还携带 `drawnRects`（该对象上一次实际绘制时使用的 clip 脏区；因不相交而跳过的帧从更早条目继承）
- `#objectSnapshotRects`：显式记录的几何变更前快照（由 `captureObjectSnapshot()` 写入）

`invalidateActiveObjects()` 同时失效：对象当前屏幕范围 + 快照范围 + 上一次实际绘制区域（`drawnRects`），确保拖拽 / 变形时旧像素被清除。

### 清除覆盖不变量

输出层保证：**任一帧实际绘制的像素区域 ⊆ 下一帧清除区域**。

该不变量由 `drawnRects` 从构造上保证——记录的是绘制时实际使用的 clip 区域，而非对象自身范围的近似。因此即使渲染留白（`getRenderPadding()`）不足以覆盖实际描边溢出（例如带 transform 缩放的对象），旧像素也会在下一帧被正确清除，不会产生拉丝残留。`invalidateCachedObjects()` 在对象离开 AOM（commit / delete）时同样并入其 `drawnRects`，关闭最后一帧活动绘制溢出静态提交清除集的窗口。

## 远程手势预览

`Renderer` 基类（`renderer.js`）维护一张预览坐标表（对象 id → 预览位置）：

- `setPreviewPosition(objectId, position)` — 写入预览坐标
- `clearPreviewPosition(objectId)` — 清除单个对象的预览（手势终点或记录归位后）
- `clearAllPreviewPositions()` — 清空全部预览（断线时对端手势状态不可信）

`ViewportRenderer` 重画静态缓存时按预览坐标临时覆盖对象的 `position`，画完还原——只影响渲染视图，不改对象数据。

预览由 amend volatile 通道的分子消息驱动（`core-worker.js` 的 `#applyMolMessages`）：

- `mol-begin` 按 before/create 快照的 `position` 起预览
- `mol-amend` 的 `patch.position` 以绝对坐标覆盖（不是增量）
- `mol-end` / `mol-abort` 清除该分子的全部预览
- 每个分子挂 3s 超时兜底，消息中断时预览不残留；断线时清空全部预览并全量重画

预览变化后触发全量缓存重画（`#requestStaticRender`），对象数据在分子记录到达时归位。

## 调试 API

- `getStaticCache()`：返回内部的静态缓存 `OffscreenCanvas`，供调试面板读取
- `renderStaticCacheToCanvas(targetCanvas, dirtyRects?)`：把缓存内容渲染到外部 canvas，传入 dirtyRects 则先确保缓存最新

## 构造参数

```javascript
const renderer = new ViewportRenderer(viewport, activeObjectManager, {
  canvas: outputCanvas, // options.canvas 即为输出 canvas
});
```

- 第一参数：viewport（ViewportCore 或 Viewport 兼容实例）
- 第二参数：ActiveObjectManager（可选，可通过 `setActiveObjectManager()` 后续设置）
- 第三参数：选项对象，`canvas` 指定输出 canvas

## 当前状态

- 已实现：单渲染器合成、双调度器（缓存层 + 输出层）、缓存更新、输出合成、AOM 对象收集、AOM 排除过滤、对象级脏区失效、区块级脏区失效、快照追踪、调试 API
- 已接入：`ViewportCore`、`core-worker.js` 渲染钩子、`kernel/board/aom-render-hooks.js`（kernel 侧钩子接口）、`object-modifier.js`

## 相关文档

- [viewport-core-document.md](./viewport-core-document.md)
- [active-object-manager-document.md](../../../kernel/board/docs/active-object-manager-document.md)
- [ui-renderer-document.md](../../../ui/components/renderer/docs/ui-renderer-document.md)
