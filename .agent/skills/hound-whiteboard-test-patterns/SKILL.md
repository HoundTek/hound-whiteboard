---
name: hound-whiteboard-test-patterns
description: Hound Whiteboard 项目的测试模式、目录结构和编写规范。在需要添加、迁移或审查测试时加载。
---

# Hound Whiteboard Test Patterns

## 目录结构

测试文件与源码保持同级 `tests/` 目录：

```
src/core/
├── components/
│   ├── board.js
│   ├── monitor.js
│   ├── tests/
│   │   ├── board-input-flow.test.js   ← Board 输入路由基础设施
│   │   ├── monitor.test.js
│   │   └── ...
├── tools/
│   ├── creator/
│   │   ├── stroke-creator.js
│   │   ├── tests/
│   │   │   ├── stroke-creator.test.js  ← StrokeCreatorTool 单元 + 集成测试
│   │   │   └── polygon-creator.test.js
│   ├── modifier/
│   │   ├── tests/
│   │   │   └── common-object-modifier.test.js
├── prefixs/
│   ├── tests/
│   │   ├── handoff-handler.test.js    ← handoff 机制 + 真实工具集成测试
│   │   └── ...
```

## 测试层次

项目测试分为三个层次，应放在各自合适的位置：

### 层次 1：单元测试（工具内部逻辑）

直接调用 `tool.process(signalPacket, deviceContext)`，**不经过 Board/Monitor**。

```js
// stroke-creator.test.js
test("工具应消费 position/end 信号并累计点列", () => {
  const tool = new StrokeCreatorTool();
  const deviceContext = { context: {}, objectId: 100, ownerChunkId: 2 };

  tool.process(
    { signals: [{ type: "position", context: { value: new Vector(1, 2) } }] },
    deviceContext,
  );

  expect(tool.obj.localPathRange.points.length).toBe(1);
});
```

**归属**：所属工具的 `tests/` 目录。

### 层次 2：集成测试（工具 + 真实 Board）

创建真实 `Board`、`Monitor`，但仍直接调用 `tool.process()`。

```js
// stroke-creator.test.js — "真实 Board 上" 系列
test("真实 Board 上创建完成后应经由 AOM.apply 落回归属区块", () => {
  const tool = new StrokeCreatorTool();
  const board = new Board();
  board.width = 10;
  board.height = 10;
  board.getChunkById(1).objectManager = new ChunkObjectManager(1);

  tool.process(
    { signals: [{ type: "position", context: { value: new Vector(1, 2) } }] },
    { context: { board }, objectId: 21, ownerChunkId: 1 },
  );

  tool.process(
    { signals: [{ type: "end", context: {} }] },
    { context: { board }, objectId: 21, ownerChunkId: 1 },
  );

  const ownerChunk = board.getChunkById(1);
  expect(ownerChunk.objectManager.getObject(21)).toBe(tool.obj);
});
```

**归属**：所属工具的 `tests/` 目录，放在单独的 describe 块中。

### 层次 3：端到端测试（通过 Board 输入链路）

通过 `board.signalsEventBus.emit("input", { to, signals })` 发送信号，走完整 Board → DAG → Monitor → 工具的输入管道。

```js
// stroke-creator.test.js — "端到端集成" describe 块
describe("端到端集成（通过 Board 输入链路）", () => {
  test("StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", () => {
    const board = new Board();
    const monitor = new Monitor(
      createNoopCanvas({ width: 800, height: 600 }),
      board,
      { width: 800, height: 600 },
      "main",
    );
    board.monitors.set("main", monitor);
    board.width = 800;       // ← 必须设置！
    board.height = 600;      // ← 必须设置！
    const tool = new StrokeCreatorTool();

    monitor.mountSubDAG("", createMouseDevice());
    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "primary-stroke",
      workflow: tool,
      edges: [{ from: "/mouse/primary", edge: "default" }],
    });

    board.signalsEventBus.emit("input", {
      to: "/main/mouse",
      signals: [{ type: "position", context: { value: new Vector(105, 60), buttons: 1, button: 0 } }],
    });
    // ...
  });
});
```

**归属**：所属工具的 `tests/` 目录，放在 `describe("端到端集成（通过 Board 输入链路）", ...)` 块中。

## 关键规则

### 1. Board input flow 只测路由基础设施

`board-input-flow.test.js` 只包含以下内容：

- input 事件经 Board → Monitor → DAG 路由到工具的验证（使用 `CollectingTool` 等通用 Mock）
- 错误路径（不存在的 monitor）
- mount/umount 生命周期
- edge.prefix 在 mount 时的注入

**禁止**在此文件中放置具体工具的端到端测试。

### 2. 工具测试要放置到对应工具的 tests/ 目录

| 测试内容 | 应该放在 |
|---------|---------|
| StrokeCreatorTool 的任何测试 | `src/core/tools/creator/tests/stroke-creator.test.js` |
| PolygonCreatorTool 的任何测试 | `src/core/tools/creator/tests/polygon-creator.test.js` |
| Handoff 机制 + 真实工具集成 | `src/core/prefixs/tests/handoff-handler.test.js` |
| CommonObjectModifierTool 的任何测试 | `src/core/tools/modifier/tests/common-object-modifier.test.js` |

### 3. 必须设置 board.width / board.height

当测试使用 `Monitor` 且涉及位置→区块解析时（`worldToChunk`），必须在 `board.monitors.set(...)` **之后**设置：

```js
board.monitors.set("main", monitor);
board.width = 800;    // ← 必须！否则 chunkWidth = 0
board.height = 600;   // ← 必须！否则 chunkHeight = 0
```

`Monitor.chunkWidth` 的 getter 是 `this.board?.width ?? 0`。如果不设置，`worldToChunk` 返回 null → `resolveOwnerChunkId` 返回 undefined → `ensureObject` 返回 false → 对象创建失败。

### 4. dispatch 时注意传递上下文

当直接通过 DAG dispatch（绕过 `board.signalsEventBus.emit("input", ...)`）时，**必须传递 `{ board, monitor }` 上下文**：

```js
const accumulatedContext = { board, monitor };

monitor.devicesDAG.dispatch({
  to: "/main/workflow",
  signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
}, accumulatedContext);   // ← 必须！
```

原因：通过 `.tool(tool)` 挂载的工具的 `toolContext = {}`，`board` 和 `monitor` 只能从 dispatch 的 accumulated context 获取。

而 `board.signalsEventBus.emit("input", ...)` 内部已经自动添加了 `{ board, monitor }` 上下文，所以不需要手动传递。

### 5. 手势驱动的 modifier 使用 position 信号

`GestureBasedObjectModifierTool`（包括 `CommonObjectModifierTool`）**不再接受 `displacement` 信号**。使用 `position` 信号（世界坐标）：

```js
// ✅ 正确
emit("input", {
  signals: [{ type: "position", context: { value: { x: 10, y: 10 } } }],
});

// ❌ 错误（被静默忽略）
emit("input", {
  signals: [{ type: "displacement", context: { value: { x: 3, y: 0 } } }],
});
```

手势生命周期：

| 信号 | 作用 |
|------|------|
| 首个 `position` | 记录锚点，启动手势（对象暂不动） |
| 后续 `position` | 以锚点为基准计算位移并更新对象位置 |
| `end` | 结束手势，对象保留在 AOM 动态图中 |
| `success` | 将修改提交到静态图 |

### 6. 断言要验证实际效果

不要只检查"对象非空"或"AOM 大小不变"这类间接指标。直接验证对象状态：

```js
// ✅ 强断言：验证位置确实变了
expect(creatorTool.obj.position.serialize()).toEqual({
  x: createdPosition.x + 3,
  y: createdPosition.y,
});

// ❌ 弱断言：无法发现 displacement 被静默忽略
expect(creatorTool.obj).not.toBeNull();
expect(board.activeObjectManager.activeObjects.size).toBe(1);
```

### 7. 工具实例互斥

同一工具实例不能同时参与多个 handoff 工作流。如果测试需要重复使用工具实例，先调用 `handoffSubDAG.resetHandoff()`。

## 常用测试辅助

| 辅助 | 来源 | 用途 |
|------|------|------|
| `createNoopCanvas()` | `src/core/test-support/noop-canvas.js` | 创建空实现 Canvas |
| `CollectingTool` | `src/core/test-support/mock-tools.js` | 收集接收到的信号的 Mock 工具 |
| `createMockCreator()` | `src/core/test-support/mock-tools.js` | 模拟 Creator 工具 |
| `createMockModifier()` | `src/core/test-support/mock-tools.js` | 模拟 Modifier 工具 |
| `createMockChooser()` | `src/core/test-support/mock-tools.js` | 模拟 Chooser 工具 |
