# UI overlay 条目工厂文档

本文档提供 `ui-overlay-factory.js` 的概述。

## 概述

`ui-overlay-factory.js` 提供一组纯函数，负责创建兼容选择框 overlay 条目、归一化混合格式的条目、以及处理 summary-like 条目到屏幕矩形的坐标转换。不依赖任何类实例。

## 模块定位

`UiRenderer` 原有的坐标辅助方法和条目工厂方法（`getObjectWorldRect`、`getCompatSelectionPadding`、`getSummaryWorldRect`、`createCompatSelectionEntriesForSummaries`、`normalizeOverlayEntry` 等）已迁至此处，改为纯函数。调用方（object-chooser、object-modifier）直接 import 使用。

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

### 条目工厂

| 函数                                                                                 | 说明                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `createCompatSelectionEntriesForSummaries(summaries, role, viewport, drawRectEntry)` | 基于 summary-like 条目生成兼容选择框条目（含组合大矩形） |

### 条目归一化

| 函数                                                    | 说明                                              |
| ------------------------------------------------------- | ------------------------------------------------- |
| `normalizeOverlayEntry(entry, viewport, drawRectEntry)` | 规整混合格式的 overlay 条目，确保 `draw` 函数可用 |

## 与 UiRenderer 的关系

`UiRenderer` 不再直接提供这些方法。`UiRenderer.collectProviderOverlayEntries()` 内部调用 `normalizeOverlayEntry` 对所有 provider 返回的条目做归一化。`createCompatSelectionEntriesForSummaries` 由调用方直接 import 使用。

## 相关文档

- [ui-renderer-document.md](./ui-renderer-document.md)
- [object-chooser-document.md](../../../tools/chooser/docs/object-chooser-document.md)
- [object-modifier-document.md](../../../tools/modifier/docs/object-modifier-document.md)
