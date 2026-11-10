# 画布生命周期管理器文档

## 概述

`CanvasHost` 是所有渲染器（`Renderer`、`UiRenderer`）的画布生命周期基类，封装画布引用持有、尺寸变更、失效请求与渲染调度器初始化的通用逻辑。不涉及具体绘制逻辑。

## 类层次

```
CanvasHost          — 画布生命周期 + 调度器（canvas-lifecycle.js）
  ├─ Renderer       — 对象渲染管线 + viewportContext
  │   └─ ViewportRenderer
  └─ UiRenderer     — overlay flush + provider 管理
```

## 职责

### 画布管理

- 提供 `canvas` getter 与 `_getContext()`；后者取 2D 上下文，`canvas` 为空时返回 `null`
- 暴露 `resize(width, height)` 方法，入参经归一化取整后与当前尺寸比较，返回是否发生变化

### 调度器初始化

```js
_initScheduler(mergeDirtyRects, flushHandler);
```

由子类在构造完成后调用，传入脏区合并函数和刷新回调。`CanvasHost` 负责创建 `RenderScheduler` 实例。

### 失效请求

- `invalidate(rect)`：提交脏区到调度器。需在 `_initScheduler()` 之后调用：调度器未初始化时直接返回 `false`，不排队；返回 `true` 表示本次新排了一帧，已有帧在排队时同样返回 `false`
- `invalidateViewport()`：提交整个视口。仅当视口屏幕矩形宽高均大于 0 时提交，否则不发请求

## 字段

| 字段         | 类型                        | 说明           |
| ------------ | --------------------------- | -------------- |
| `viewport`   | `Viewport`                  | 绑定的视口实例 |
| `_canvas`    | `HTMLCanvasElement \| null` | 目标画布引用   |
| `_scheduler` | `RenderScheduler \| null`   | 渲染调度器实例 |

## 相关文档

- [viewport-renderer-document.md](./viewport-renderer-document.md)
- [ui-renderer-document.md](../../../ui/components/renderer/docs/ui-renderer-document.md)
- [render-scheduler-document.md](./render-scheduler-document.md)
