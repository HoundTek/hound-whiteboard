# 画布生命周期管理器文档

本文档提供 `CanvasHost` 的概述。

## 概述

`CanvasHost` 是所有渲染器（`Renderer`、`UiRenderer`）的画布生命周期基类，封装画布引用持有、尺寸变更、失效请求与渲染调度器初始化的通用逻辑。不涉及具体绘制逻辑。

## 类层次

```
CanvasHost          — 画布生命周期 + 调度器（canvas-lifecycle.js）
  ├─ Renderer       — 对象渲染管线 + viewportContext
  │   ├─ BaseRenderer
  │   └─ LiveRenderer
  └─ UiRenderer     — overlay flush + provider 管理
```

## 职责

### 画布管理

- 存储 `_canvas` 引用
- 提供 `canvas` getter
- 暴露 `resize(width, height)` 方法，仅在宽高发生变化时修改画布尺寸

### 调度器初始化

```js
_initScheduler(mergeDirtyRects, flushHandler);
```

由子类在构造完成后调用，传入脏区合并函数和刷新回调。`CanvasHost` 负责创建 `RenderScheduler` 实例。

### 失效请求

- `invalidate(rect)`：提交脏区到调度器
- `invalidateViewport()`：提交整个视口

## 字段

| 字段         | 类型                        | 说明           |
| ------------ | --------------------------- | -------------- |
| `viewport`   | `Viewport`                  | 绑定的视口实例 |
| `_canvas`    | `HTMLCanvasElement \| null` | 目标画布引用   |
| `_scheduler` | `RenderScheduler \| null`   | 渲染调度器实例 |

## 与 Renderer 基类的关系

`Renderer` 原手写维护 `_canvas` / `_scheduler` / `viewport` 字段以及 `invalidate()` / `invalidateViewport()` / `resize()` / `_getContext()` 方法。这些已全部上提至 `CanvasHost`，`Renderer` 不再重复声明。

## 相关文档

- [base-renderer-document.md](./base-renderer-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
- [ui-renderer-document.md](./ui-renderer-document.md)
- [render-scheduler-document.md](./render-scheduler-document.md)
