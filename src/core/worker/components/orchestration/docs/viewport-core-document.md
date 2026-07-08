# 视口核心文档

本文档提供 `ViewportCore` 的概述。

## 概述

`ViewportCore` 承载 Worker 侧的视口状态、chunk buffer 与 base/live 渲染器。它不依赖 DOM，仅通过 `OffscreenCanvas` 渲染并产出可回传到 UI 的帧数据。

UI 侧的 `Viewport` 通过 `viewport-change` / `request-render-flush` 消息驱动 `ViewportCore` 更新与产出帧。

## 运行边界

| 类             | 线程   | 职责                                             |
| -------------- | ------ | ------------------------------------------------ |
| `ViewportCore` | Worker | 视口状态副本、chunk buffer、base/live 渲染       |
| `Viewport`     | UI     | 视口 facade、DOM canvas、ui overlay、Worker 同步 |
| `BoardCore`    | Worker | 对象与区块管理、AOM、UndoTree、持久化协调        |

## 核心字段

| 名称                         | 描述                           |
| ---------------------------- | ------------------------------ |
| `origin`                     | 视口原点（世界坐标）           |
| `zoom`                       | 缩放因子                       |
| `width` / `height`           | 视口尺寸（像素）               |
| `chunkWidth` / `chunkHeight` | 区块尺寸（委托到 BoardCore）   |
| `chunkLoader`                | 当前视口绑定的 ChunkLoader     |
| `baseRenderer`               | 静态层渲染器（BaseRenderer）   |
| `liveRenderer`               | 动态层渲染器（LiveRenderer）   |
| `#frameDirty`                | 当前是否存在待回传给 UI 的新帧 |
| `#frameId`                   | 已输出帧序号                   |

## Chunk Buffer

`syncChunkBufferWithViewport(origin, zoom)` 管理视口的区块缓冲区：

1. 计算视口对应世界矩形
2. 向四周各扩展 50%，形成 2x 加载区
3. 计算加载区覆盖的 chunkId 集合
4. 对不在缓冲区中的区块发起 FULL 加载请求
5. 对不在加载区中的已有区块发起卸载请求

返回当前视口可见区块列表。

## 渲染管线

```
viewport-change ──→ onViewportChange()
  │
  ├─ syncChunkBufferWithViewport()    ← 更新区块缓冲区
  ├─ baseRenderer.invalidateChunks()  ← 重绘静态层
  └─ liveRenderer.invalidateViewport() ← 重绘动态层

request-render-flush ──→ flushRenderFrame()
  │
  ├─ scheduler.flush()  ← 刷出待处理脏区
  ├─ liveCanvas.transferToImageBitmap()
  └─ postRenderFrame({ liveBitmap })  ← 回传 UI 线程
```

### BaseRenderer

渲染静态层（已提交到静态图的对象）。通过 `invalidateChunks` 按区块范围局部失效，避免整视口重绘。

### LiveRenderer

渲染动态层（AOM 中的活动对象）。通过 `invalidateViewport` 或 `invalidateObjects` 触发重绘。渲染帧通过 `OffscreenCanvas.transferToImageBitmap()` 回传到 UI 侧。

## 视口同步

UI 侧的 `Viewport` 通过 `viewport-change` 消息将原点与缩放同步到 Worker：

```json
{
  "type": "viewport-change",
  "viewportId": "main",
  "origin": { "x": 0, "y": 0 },
  "zoom": 1,
  "viewportSize": { "width": 800, "height": 600 },
  "force": false
}
```

`ViewportCore.onViewportChange()` 处理此消息，更新本地状态并触发 chunk buffer 同步与渲染失效。

## 渲染帧输出

`flushRenderFrame()` 在每帧 flush 时：

1. 刷出 base 和 live 渲染器的待处理脏区
2. 将 live canvas 转出为 `ImageBitmap`
3. 通过 `transferToImageBitmap()` 将帧数据回传到 UI

UI 侧的 `Viewport.onRenderFrame()` 将收到的 `liveBitmap` 绘制到 DOM canvas。

## 当前状态

- `ViewportCore` 作为 Worker 侧渲染核心运行
- 支持 2x 视口范围的 chunk 缓冲区管理
- 支持 FULL / TEMP 区块加载
- 渲染帧通过 `OffscreenCanvas.transferToImageBitmap` 回传

## 相关文档

- [viewport-document.md](../../../../ui/components/orchestration/docs/viewport-document.md)
- [board-core-document.md](./board-core-document.md)
- [active-object-manager-document.md](../../../../worker/components/orchestration/docs/active-object-manager-document.md)
