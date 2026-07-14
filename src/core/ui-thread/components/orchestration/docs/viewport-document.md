# Viewport 文档

本文档提供 `Viewport`（UI 侧视口 facade）的概述。Worker 侧 `ViewportCore` 参见 [viewport-core-document.md](../../../../engine/orchestration/docs/viewport-core-document.md)。

## 概述

`Viewport` 是 UI 线程的视口 facade，负责连接 DOM 与 Worker 侧的 `ViewportCore`。

职责包括：

- 创建并持有 DOM `canvas`（接收 Worker 合成帧）与 `uiCanvas`（overlay 层）
- 持有 `UiRenderer`，管理 UI 覆盖层的注册与补绘
- 维护本地视口状态副本（`origin` / `zoom` / `width` / `height`）
- 发送 `viewport-change` 与 `request-render-flush` 到 Worker 侧 `ViewportCore`
- 接收 `render-frame` 后 `drawImage` 绘制 Worker 侧合成后的位图
- 持有 `inputScope`（`InputScope` 实例），供外部挂载设备子图与 workflow

## 渲染层分工

| 层           | 线程   | 渲染内容                | 来源                  |
| ------------ | ------ | ----------------------- | --------------------- |
| base/live    | Worker | 静态对象 + AOM 活动对象 | `liveBitmap` 合成分片 |
| ui (overlay) | UI     | 选择框、编辑手柄等      | `UiRenderer` 即时绘制 |

base/live 的合成像素内容来自 Worker（`liveBitmap` 已合成两层），overlay 始终留在 UI 线程。

## 视口控制接口

- `setViewportPosition(position)`
- `setViewportScale(scale, screenAnchor?)`
- `setViewportScaleAroundCenter(scale)`
- `setViewportState({ origin?, zoom? })`
- `flushViewportRender()`
- `resizeRenderLayers(width, height)`
- `requestViewportUiRender()`

## 设备图挂载

`Viewport` 持有 `inputScope`（`InputScope` 实例），外部通过它操作设备图路由：

- `inputScope.mountDevice(name, subDAG)` — 挂载设备子图
- `inputScope.mountWorkflow(name, workflow)` — 挂载工具 workflow
- `inputScope.addEdge({ from, to, name?, prefix? })` — 建立信号通路
- `inputScope.removeEdge({ from, edge? })` — 拆除信号通路
- `inputScope.unmountWorkflow(name, edgesToRemove?)` — 卸载 workflow

路径自动补全 `/{viewportId}/` 前缀，调用方只需传相对于视口根的路径。

接线入口统一通过 `viewport.inputScope`。

## Frame 协议

`Viewport` 通过 postMessage 与 Worker 侧的 `ViewportCore` 通信：

**UI → Worker**：

- `viewport-change`：视口状态变更（origin / zoom / size）
- `request-render-flush`：请求立即产出渲染帧

**Worker → UI**：

- `render-frame`：含 `liveBitmap`（已合成 base + live 层）

## 当前状态

- `Viewport` 作为 UI 视口 facade 运行
- demo 默认走 `Viewport` 路径
- base/live 合成由 Worker 完成，UI 侧通过 `liveBitmap` 接收合成帧
- overlay 始终在 UI 线程由 `UiRenderer` 绘制

## 相关文档

- [viewport-core-document.md](../../../../engine/orchestration/docs/viewport-core-document.md)
- [input-scope-document.md](./input-scope-document.md)
- [board-document.md](./board-document.md)
- [ui-renderer-document.md](../../renderer/docs/ui-renderer-document.md)
