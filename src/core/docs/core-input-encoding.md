# Core 输入编码标准

本文档约束 HoundWhiteboard 当前阶段如何把 DOM / Pointer / Touch 等现实输入编码成 Core 可消费的 `SignalPacket`。

## 目标

这层标准只解决一件事：把外部输入规整成统一的包结构，再送进 `board.signalsEventBus.emit("input", packet)`。

它不负责：

- 推断工具语义
- 决定设备树内部路由
- 直接修改 `Board` 状态

这些职责分别属于 Device、DevicesTree 和 Tool。

## 最小输出格式

所有输入都应先规整成：

```javascript
{
  to: "/monitor-id/device-path",
  signals: [
    {
      type: "position",
      context: {
        value: { x: 10, y: 20 },
      },
    },
  ],
}
```

约束如下：

- `to` 必须已经包含目标 `monitorId`
- `signals` 必须是数组
- 每个信号至少包含 `type`
- 信号载荷统一放在 `context`

## 单点输入约定

对于鼠标、单笔、单触点这类单点输入，推荐约定如下：

- `position`
  - `context.value`: `{ x, y }` 或 `Vector` 等坐标值
- `pressure`
  - `context.value`: `number`
- `tilt`
  - `context.value`: `number`
- `rotate`
  - `context.value`: `number`
- `end`
  - `context`: 结束当前交互所需的附加信息
- `cancel`
  - `context`: 取消当前交互所需的附加信息

## 多点输入约定

对于触摸屏这类多点输入，同一个 `signals` 数组里允许出现多条同类型信号。

例如：

```javascript
{
  to: "/monitor/touchscreen",
  signals: [
    {
      type: "position",
      context: {
        touchId: "finger-1",
        value: { x: 10, y: 20 },
      },
    },
    {
      type: "position",
      context: {
        touchId: "finger-2",
        value: { x: 30, y: 40 },
      },
    },
  ],
}
```

推荐字段如下：

- `touchId`: 触点 id
- `pointerId`: 若来自 PointerEvent，可直接沿用
- `value`: 当前坐标

约束重点只有一个：同一包里的多个触点必须能被稳定区分。

## DOM 事件到信号的映射建议

当前建议的映射方向如下：

- `pointermove` / `touchmove` -> `position`
- `pointerdown` / `touchstart` -> 首个 `position`，必要时附加 `pressure`
- `pointerup` / `touchend` -> `end`
- `pointercancel` / `touchcancel` -> `cancel`

是否要把一次 DOM 事件编码成一个信号，还是多个信号，应按“同一时刻应被一起处理的信息”来决定。

例如：

- 一个 PointerEvent 同时有位置与压力，就可以编码成同一个包内的两条信号
- 一次 TouchEvent 含多个 changedTouches，就可以编码成同一个包内的多条 `position` / `end` / `cancel`

## Monitor 归属

输入编码层必须在进入 Core 前决定目标 Monitor。

也就是说，编码层需要先知道：

- 当前事件属于哪个 Monitor
- 当前 Monitor 下应该走哪个设备路径

因为 `Board` 当前只负责按 `to` 中的 `monitorId` 把包分发到对应 Monitor，而不会替你补全目标路径。

## 当前不冻结的部分

下面这些目前仍保留实现自由度：

- `context` 里除 `value` / `touchId` / `pointerId` 外的扩展字段
- DOM 事件与设备路径之间的具体映射表
- 是否在编码层先做坐标转换
- 是否在编码层附加调试字段

但无论如何变化，都不应破坏上面的最小输出格式。
