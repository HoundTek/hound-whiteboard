# Hound Whiteboard 绘制性能优化方案：避免整屏重绘（AI 生成）

## 背景

作为原生 Electron 白板 App，绘制时如果每次输入都触发整屏刷新，会导致：

- 高频 `mousemove/pointermove` 下帧率下降
- 画面抖动和输入延迟变明显
- CPU/GPU 占用不必要升高

目标是：**只更新变化区域（局部重绘），并把渲染频率限制在每帧一次。**

---

## 当前代码中可利用的基础

项目已经具备做局部重绘的关键条件：

- 对象有边界信息（可做脏区）
  - `src/core/objects/graph/polygon.js`
  - `src/core/objects/stroke/stroke.js`
- 工具层已经在高频更新对象（可接入调度器）
  - `src/core/tools/creator/polygon.js`
  - `src/core/tools/creator/stroke.js`
  - `src/core/tools/controller/controller.js`
- 页面结构已有多层容器（可扩展为多 canvas）
  - `src/templates/whiteboard/whiteboard.html`

---

## 核心方案

## 1. 分层渲染（至少双 Canvas）

把白板绘制拆为：

- `baseCanvas`：已完成内容（低频更新）
- `liveCanvas`：当前正在绘制/拖动的预览（高频更新）
- `uiCanvas`（可选）：选区、辅助线、控制点视觉层

原则：

- 拖动与绘制过程只更新 `liveCanvas`
- 落笔完成后把结果提交到 `baseCanvas`
- UI 交互效果单独走 `uiCanvas`，避免污染绘制层

收益：

- 避免每次 move 都重画全部历史内容
- 视觉反馈更稳定

---

## 2. 脏矩形（Dirty Rect）局部重绘

对每次对象变化计算：

- `oldRect`（变化前包围盒）
- `newRect`（变化后包围盒）
- `dirtyRect = union(oldRect, newRect).inflate(padding)`

然后只做：

- `clearRect(dirtyRect)`
- 重绘与 `dirtyRect` 相交的对象

备注：

- `padding` 需覆盖描边宽度、抗锯齿边缘、阴影等
- 对正在编辑的单对象场景，可只重绘该对象（更快）

---

## 3. 渲染调度统一为 requestAnimationFrame

不要在 `mousemove` 里直接重绘。改为：

- 输入事件只更新“最新状态 + 脏区”
- 若当前无待渲染帧，则 `requestAnimationFrame(flush)`
- 在 `flush` 中统一执行一次清理与重绘

伪代码：

```js
let framePending = false;
const dirtyQueue = [];

function invalidate(rect) {
  dirtyQueue.push(rect);
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(flush);
  }
}

function flush() {
  framePending = false;
  const dirty = mergeRects(dirtyQueue);
  dirtyQueue.length = 0;
  for (const r of dirty) {
    liveCtx.clearRect(r.x, r.y, r.w, r.h);
    renderIntersectingObjects(r, liveCtx);
  }
}
```

收益：

- 输入频率和绘制频率解耦
- 防止一秒触发几百次同步绘制

---

## 4. 笔迹工具增量绘制（避免全路径反复重画）

当前笔迹工具在 move 阶段不断扩点。优化建议：

- 数据层仍保留完整点集（用于保存、回放、撤销）
- 显示层每帧只画新增线段（上一个点 -> 当前点）
- 抬笔时将完整结果固化到 `baseCanvas`

---

## 5. 利用现有层关系减少重绘候选对象

项目里已有 `ActiveObjectManager` 与层结构，可在脏区重绘时：

- 优先扫描活动层及邻近层
- 再按 rectangle 相交判定是否参与重绘
- 避免全页对象遍历

---

## 最小可落地版本（建议先做）

第一阶段仅做两件事：

1. 新增 `liveCanvas`，将“绘制中对象”迁移到 live 层  
2. 引入 RAF 调度器，move 只触发 `invalidate`，不直接 render

这两步通常就能显著降低“整屏刷新的卡顿感”。

---

## 实施顺序建议

1. 改造 `whiteboard.html`，补齐多 canvas 层  
2. 在 whiteboard 入口新增 `RenderScheduler`（RAF + dirty queue）  
3. 接入 `polygon/stroke/controller` 的 move/drag 事件，只提交脏区  
4. 增加对象边界扩展（padding）策略，消除拖影  
5. 补充性能测试（大笔迹、快速拖动、多对象叠层）

---

## 验收标准（建议）

- 连续快速书写时帧率稳定，不出现明显整屏闪烁
- 拖动控制点时仅局部更新，无全画面重绘感
- CPU 占用较改造前明显下降
- 视觉结果与原逻辑一致（无漏绘、残影、错层）

---

## 风险与注意事项

- 脏区合并策略过粗会退化成接近全屏重绘
- 脏区过细会导致清理/绘制调用次数过多
- 对象阴影、线帽、抗锯齿可能导致边缘残留，需 `inflate`
- 多层 canvas 需要统一坐标系、缩放和 DPR 处理

---

## 后续可选增强

- 使用 `OffscreenCanvas` + Worker（复杂场景进一步降主线程负担）
- 对静态大图层做瓦片缓存（tile cache）
- 引入对象空间索引（R-Tree/网格）加速“脏区相交对象”查询
