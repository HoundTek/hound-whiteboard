# Core 阶段性稳定接口

本文档列出 HoundWhiteboard Core 当前阶段建议冻结的接口边界。

这里的“冻结”不是永远不改，而是指：在继续增加设备、工具和业务链路前，这些接口默认应视为稳定前提。若要修改，应先显式更新相关文档、测试和样板链路。

## 建议冻结的接口

### 1. SignalPacket 最小结构

```javascript
{
  to: String,
  signals: Array<{ type: String, context: * }>,
}
```

约束：

- `to` 表示当前目标节点路径
- `signals` 是同一时刻需要一起处理的信号集合

### 2. DeviceDefinition 最小协议

```javascript
const deviceDefinition = {
  defineNodes() {
    return [{ path: "", processor }];
  },
};
```

约束：

- `DevicesTree` 当前只消费 `defineNodes()`
- 其它字段都应视为定义对象扩展信息

### 3. Monitor 是业务侧设备挂载入口

业务代码应优先调用：

```javascript
monitor.mountDevice(path, deviceDefinition);
```

而不是直接操作 `devicesTree.mountDevice()`。

### 4. DevicesTree 的终止语义

当前递归分发规则中，若节点处理结果包的 `to` 停在当前节点路径上，则路由在此终止。

这是设备节点和工具节点能稳定协作的基础语义。

### 5. Tool 的最小接口

工具最小接口为：

- `process(signalPacket, deviceContext)`
- `createProcessor(toolContext)`

其中 `createProcessor()` 把 Tool 包装成设备树节点处理器；Tool 默认消费信号，不承担继续改写路由的职责。

### 6. 多指输入区分方式

同一个 `signals` 数组里允许出现多条 `position` 等同类型信号；多触点输入应通过 `touchId`、`pointerId` 等字段区分来源。

## 当前不应依赖为稳定协议的部分

- `Board.signalsEventBus.emit("input")` 的返回值
- 设备定义对象上的 `name`、`meta`、生命周期钩子等扩展字段
- Core -> UI 输出信号的消费层实现
- 输入编码层中除最小包结构外的具体字段细节

## 变更要求

若需要修改上述稳定接口，建议至少同步更新以下内容：

- 对应实现代码
- 最小闭环样板
- 集成测试
- 相关说明文档

否则系统会很快回到“每加一个设备都重新解释一遍协议”的状态。