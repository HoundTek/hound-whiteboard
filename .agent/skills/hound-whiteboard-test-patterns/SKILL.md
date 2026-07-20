---
name: hound-whiteboard-test-patterns
description: Hound Whiteboard 项目的测试模式、目录结构和编写规范。在需要添加、迁移或审查测试时加载。
---

# Hound Whiteboard Test Patterns

## 文件头规则

测试文件（`.test.js`）**不应写 `@module`**。文件头只需要 `@file`、`@description`（可选）和 `@author`：

```javascript
/**
 * @file 区块加载器测试
 * @author Zhou Chenyu
 */
```

原因：测试不被其他模块导入，`@module` 对文档/模块图无贡献；`foo.test.js` 和 `foo.js` 天然配对，路径关系自明。

---

## 测试归属规则

测试文件与源码保持同级 `tests/` 目录：

```
src/core/
├── components/tests/
│   └── board-input-flow.test.js   ← 只测 Board 输入路由基础设施（Mock 工具）
├── tools/
│   ├── creator/tests/
│   │   ├── stroke-creator.test.js  ← StrokeCreatorTool 所有测试
│   │   ├── polygon-creator.test.js
│   │   └── circle-creator.test.js
│   ├── modifier/tests/
│   │   └── common-object-modifier.test.js
│   ├── chooser/tests/
│   │   ├── obj-chooser.test.js
│   │   └── rectangle-object-chooser.test.js
│   └── wrapper/tests/
│       ├── wrapper-tool.test.js      ← WrapperTool 基座
│       ├── handoff-wrapper.test.js   ← handoff 机制 + 真实工具集成
│       └── switcher-wrapper.test.js  ← tool-switcher 路由
└── prefixs/tests/
    └── prefix-node.test.js          ← prefix 基础设施
```

**规则**：

1. `board-input-flow.test.js` **禁止**放置具体工具的端到端测试 — 只放路由基础设施测试（使用 `CollectingTool` 等通用 Mock）
2. 每个工具的测试 **必须**放在该工具的 `tests/` 目录下，不得跨文件混放
3. 迁移测试后 **必须清理**被迁移文件的 import 语句

## 技术坑点

### 1. 必须设置 board.width / board.height

当测试创建 `Viewport` 且涉及位置→区块解析时（`worldToChunk`），必须在 `board.viewports.set(...)` **之后**设置：

```js
board.viewports.set("main", viewport);
board.width = 800; // ← 必须！否则 chunkWidth = 0
board.height = 600; // ← 必须！否则 chunkHeight = 0
```

`Viewport.chunkWidth` 的 getter 是 `this.board?.width ?? 0`。不设置则 `worldToChunk` 返回 null → `resolveOwnerChunkId` 返回 undefined → `ensureObject` 返回 false → **对象创建静默失败**。如果测试不涉及位置→区块解析（如纯 DAG 路由测试、Mock 测试），可以省略。

### 2. dispatch 时必须传递上下文

当直接通过 DAG dispatch（绕过 `board.signalsEventBus.emit("input", ...)`）时，**必须传递 `{ board, viewport }` 上下文**：

```js
const accumulatedContext = { board, viewport };

viewport.devicesDAG.dispatch(
  {
    to: "/main/workflow",
    signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
  },
  accumulatedContext,
); // ← 必须！
```

原因：通过 `builder.node().tool(tool)` 挂载的工具有 `toolContext = {}`，`board` 和 `viewport` 只能从 dispatch 的 accumulated context 获取。而 `board.signalsEventBus.emit("input", ...)` 内部已自动添加该上下文，不需要手动传递。

### 3. modifier 双通道：position + displacement

`GestureBasedObjectModifierTool`（包括 `CommonObjectModifierTool`）同时接受 `position`（绝对坐标）和 `displacement`（相对位移）两种信号：

| 信号           | 行为                                                 |
| -------------- | ---------------------------------------------------- |
| `position`     | 驱动手势状态机（begin → update → end/cancel）        |
| `displacement` | 无状态增量，直接累加到对象位置，不参与手势状态机     |
| 同一帧两者并存 | position 先算 → displacement 再叠 → 锚点跟随位移同步 |

```js
// ✅ position 信号（绝对世界坐标）
emit("input", {
  signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
});

// ✅ displacement 信号（相对位移增量）
emit("input", {
  signals: [{ type: "displacement", context: { value: { x: 3, y: 0 } } }],
});

// ✅ 两者并存
emit("input", {
  signals: [
    { type: "position", context: { value: { x: 10, y: 10 } } },
    { type: "displacement", context: { value: { x: 3, y: 0 } } },
  ],
});
```

手势生命周期（position 驱动）：

| 信号            | 作用                               |
| --------------- | ---------------------------------- |
| 首个 `position` | 记录锚点，启动手势（对象暂不动）   |
| 后续 `position` | 以锚点为基准计算位移并更新对象位置 |
| `end`           | 结束手势，对象保留在 AOM 动态图中  |
| `success`       | 将修改提交到静态图                 |

Displacement 特性：

- **无准入检测**：displacement 信号到达时跳过 `canBeginModifyGesture`
- **可与 position 叠加**：同帧内先执行 position 手势更新，再累加 displacement 增量
- **锚点同步**：`CommonObjectModifierTool.onAfterDisplacement` 自动平移锚点和基准位置，使后续 position 不产生跳跃
- **cancel 兼容**：如果手势未激活，`onBeforeDisplacement` 会在首次 displacement 时记录 `_initialPositions`，确保 cancel 能正确回退

### 4. 断言要验证实际效果

不要只检查"对象非空"或"AOM 大小不变"。直接验证对象状态：

```js
// ✅ 强断言：验证位置确实变了
expect(creatorTool.obj.position.serialize()).toEqual({
  x: createdPosition.x + 3,
  y: createdPosition.y,
});

// ✅ 强断言：验证对象已落到正确的区块
expect(ownerChunk.objectManager.getObject(obj.id)).toBe(obj);

// ❌ 弱断言：无法发现 displacement 被静默忽略
expect(obj).not.toBeNull();
expect(AOM.size).toBe(1);
```

`.not.toBeNull()` 仅应在结构验证（如检查 DAG 节点是否存在）时使用。
