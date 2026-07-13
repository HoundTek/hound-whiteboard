# UI overlay 条目工厂文档

本文档提供 `ui-overlay-factory.js` 的概述。

## 概述

`ui-overlay-factory.js` 提供一组纯函数，负责创建 overlay 条目、归一化混合格式的条目、以及处理世界坐标到屏幕坐标的转换。不依赖任何类实例。

## overlay 条目类型

当前支持三种条目类型：

| type      | 语义            | 坐标字段                                | 默认绘制         |
| --------- | --------------- | --------------------------------------- | ---------------- |
| `"rect"`  | 矩形            | `worldRect` / `screenRect`              | `drawRectEntry`  |
| `"point"` | 填充圆点        | `worldPoint` / `screenPoint` + `radius` | `drawPointEntry` |
| `"path"`  | 折线 / 闭合路径 | `worldPoints[]` / `screenPoints[]`      | `drawPathEntry`  |

归一化时自动转换 world→screen 坐标并注入默认 draw 函数。

## 导出函数

### 坐标辅助

| 函数                                                      | 说明                                   |
| --------------------------------------------------------- | -------------------------------------- |
| `getObjectWorldRect(objectInstance)`                      | 从 BasicObject 实例获取世界矩形        |
| `getCompatSelectionPadding(objectInstance, zoom)`         | 从对象实例推导选中框屏幕留白           |
| `getCompatSelectionPaddingForSummary(summaryEntry, zoom)` | 从 summary-like 条目推导选中框屏幕留白 |
| `getSummaryWorldRect(summaryEntry)`                       | 解析 summary-like 条目的世界矩形       |
| `getSummaryScreenRect(summaryEntry, viewport)`            | 获取 summary-like 条目的屏幕矩形       |
| `getObjectScreenRect(objectInstance, viewport)`           | 获取对象实例的屏幕矩形                 |
| `worldToScreenPoint(worldPoint, viewport)`                | 将世界坐标点转为屏幕坐标点             |
| `worldPointsToScreenPoints(worldPoints, viewport)`        | 批量将世界坐标点数组转为屏幕坐标点数组 |

### 条目工厂

| 函数                                                                                 | 说明                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `createCompatSelectionEntriesForSummaries(summaries, role, viewport, drawRectEntry)` | 基于 summary-like 条目生成兼容选择框条目（含组合大矩形） |
| `createPointOverlayEntry(worldPoint, style, viewport)`                               | 创建点类型 overlay 条目（circle 圆心等）                 |
| `createPathOverlayEntry(worldPoints, style, viewport)`                               | 创建路径类型 overlay 条目（线段、参考线等）              |

### 条目归一化

| 函数                                              | 说明                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| `normalizeOverlayEntry(entry, viewport, drawFns)` | 规整混合格式的 overlay 条目，补全 screen 坐标并注入 draw |

## normalizeOverlayEntry 签名变更

`normalizeOverlayEntry` 的第三个参数从 `drawRectEntry` 回调改为 `drawFns` 对象：

```javascript
// 旧（仅 rect）
normalizeOverlayEntry(entry, viewport, (ctx, rectEntry) =>
  renderer.drawRectEntry(ctx, rectEntry),
);

// 新（rect + point + path）
normalizeOverlayEntry(entry, viewport, {
  drawRectEntry: (ctx, entry) => renderer.drawRectEntry(ctx, entry),
  drawPointEntry: (ctx, entry) => renderer.drawPointEntry(ctx, entry),
  drawPathEntry: (ctx, entry) => renderer.drawPathEntry(ctx, entry),
});
```

## 覆盖率

- 所有已有 `type: "rect"` 的 overlay 条目 zero breakage
- 新工具在 `collectUiOverlayEntries` 中返回 `type: "point"` / `type: "path"` 即可自动获得绘制功能
- 应用示例见 `CircleCreatorTool.collectUiOverlayEntries`

## 与 UiRenderer 的关系

`UiRenderer` 不再直接提供坐标辅助方法。`UiRenderer.collectProviderOverlayEntries()` 内部调用 `normalizeOverlayEntry` 对所有 provider 返回的条目做归一化。`createCompatSelectionEntriesForSummaries` 等工厂函数由调用方直接 import 使用。

## 相关文档

- [ui-renderer-document.md](../../../../../src/core/ui/components/renderer/docs/ui-renderer-document.md)
- [object-chooser-document.md](../../../../../src/core/ui/devices-dag/tools/chooser/docs/object-chooser-document.md)
- [object-modifier-document.md](../../../../../src/core/ui/devices-dag/tools/modifier/docs/object-modifier-document.md)
