# 诊断探针

渲染问题的定位工具集。**与生产代码完全解耦**：这里的脚本不会被任何生产模块 import，
也不参与打包。只在需要排查渲染异常时手工运行。

这些探针来自实际排障过程，每个都对应一类具体的错误签名（见「错误签名对照表」）。

## 运行前置

探针直接 import `src/` 下的内核与渲染器模块，需要：

- `@napi-rs/canvas`（devDependencies 已含），用作 `OffscreenCanvas` 的真实光栅器替身
- Node 18+（用到顶层 await）

运行方式：`node dev/probes/<name>.mjs`，部分探针读取环境变量（下表标注）。

## 探针清单

| 脚本 | 测什么 | 用法 | 关键输出 |
| --- | --- | --- | --- |
| `tile-diff.mjs` | tiles 开与关的输出是否逐像素一致 | `node dev/probes/tile-diff.mjs` | 差异像素数、最大通道差。**期望全为 0** |
| `tile-pan-phase.mjs` | 平移帧的 tile 相位是否与全量渲染一致 | `node dev/probes/tile-pan-phase.mjs` | 同上。亚像素平移也应全为 0 |
| `tile-size-fine.mjs` | tile 边长对提交成本的影响 | `W=900 H=700 node dev/probes/tile-size-fine.mjs` | 各边长的 p95 耗时与块数 |
| `tile-commit-cost.mjs` | 提交成本：tile 模式 vs 经典全量 | `W=900 H=700 node dev/probes/tile-commit-cost.mjs` | 倍率（期望 ≤ 1.1） |
| `fill-double-composite.mjs` | 是否存在同一内容被合成两遍 | `node dev/probes/fill-double-composite.mjs` | 失败帧数。**期望 0** |
| `screenshot-mask.mjs` | 两张截图的差异是矩形块还是沿笔画形状 | `node dev/probes/screenshot-mask.mjs` | ink 掩码差集、包围盒填充率、字符画 |
| `screenshot-blend.mjs` | 截图的差异是否为全局混合（整体变暗/变亮） | `node dev/probes/screenshot-blend.mjs` | 逐通道回归斜率、R²、变暗/变亮像素数 |
| `screenshot-seam.mjs` | 截图里是否存在贯穿整片的直线分割（接缝） | `node dev/probes/screenshot-seam.mjs` | 列/行差异剖面的尖峰位置 |

截图类探针的图片路径写在脚本顶部的 `files` 数组里，用前改一下。

## 渲染帧指纹探针

`render-frame-probe.js` 是模块化的指纹采集器，不是独立脚本。它把每帧的
Worker 位图与合成画布各降采样成 33×33 指纹，可以检出：

- 位图跳变（`bitmapJump`）：Worker 产出层内容突变
- 画布跳变（`canvasJump`）：UI 合成层内容突变
- 瞬时跳变（`transient`）：A 到 B 又回到 A 的闪烁
- 两者是否一致（`bitmapLuma === canvasLuma` 即问题在 Worker 产出层）

`render-frame-probe.test.js` 会随 `yarn test` 一起跑，守着这个模块本身。

### 如何临时接线

按需手工加三处，用完删掉，不要提交：

1. `src/renderers/canvas/viewport-renderer.js`：每次 `flush()` 结束记录本帧决策
   （脏区数量、是否全清、本次走了 tile 还是经典路径），随 `render-frame` 消息发出
2. `src/kernel/types/message-types.js`：`render-frame` 消息增加该字段
3. `src/ui/components/orchestration/viewport.js`：收到帧后调用
   `probe.record({ bitmap, canvas })`，异常时打印

接线后复现问题，检查 `probe.getAnomalies()`。

## 错误签名对照表

| 症状 | 先跑哪个 | 判据 |
| --- | --- | --- |
| 整片内容闪一帧 | `fill-double-composite.mjs` | 失败帧 > 0 说明同一内容合成两遍 |
| 整片变暗/变亮一帧 | `screenshot-blend.mjs` | 均值 Δluma 大幅偏移、覆盖率不变 |
| 内容局部消失 | `screenshot-mask.mjs` | 差集包围盒填充率接近 1（矩形块）而非沿笔画 |
| 笔画一段粗一段细 | `tile-diff.mjs` | 存在非零差异且落在 tile 边界附近 |
| 平移时画面发虚 | `tile-pan-phase.mjs` | 亚像素平移出现非零差异 |
| 提交卡顿 | `tile-commit-cost.mjs` | 倍率 > 1.5 |

## 两个教训

**1. 测量工具本身可能错，先验证工具。** 排查 tile 提交成本时，profile 指向
`drawImage` 占 45%，但临时计数器算出「只有 2 次/帧」——两者矛盾。原因是计数器
钩在 `getContext()` 返回的包装对象上，没拦住内部调用。真正的定位靠的是
「改视口尺寸看曲线」：块数从 12 降到 6，耗时掉一半，才确认变量是块数而非面积。
**出现矛盾先怀疑工具。**

**2. 截图只能用来提假设，不能用来定结论。** 三张孤立截图曾让我们得出
「整幅变粗」的结论，实际是不同时刻的不同内容。截图分析必须配合：

- 同状态的**连续帧**（录制）而非孤立截图
- 覆盖率与强度分开测（`screenshot-mask` vs `screenshot-blend`）
- 逐通道回归，检查斜率是否一致（单层混合的全部通道斜率应相同且 < 1）

## 文件头约定

`dev/probes/` 下的脚本用简化文件头（`@file` / `@description` / `@author`），
不写 `@module`。`@module` 的合法前缀由 `scripts/ci/check-module-paths.mjs` 限定，
且该脚本只扫描 `src/` 下的生产目录，调试脚本不属于受检范围。
