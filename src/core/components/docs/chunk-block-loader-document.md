# 区块加载器文档

本文档提供 `ChunkBlockLoader` 的概述。

`ChunkBlockLoader` 是 `ChunkLoader` 的包装器，用于管理“连续矩形范围内已加载的区块网格”。它不直接持有区块对象的最终所有权，而是通过内部 `ChunkLoader` 持有区块实例，再负责维护加载窗口、当前区块位置与矩形边界。

## 区块加载器职责

- 持有一个内部 `ChunkLoader`
- 表达连续矩形范围的区块集合
- 维护当前缓冲区的二维边界
- 记录当前区块引用 `chunkNow`
- 限制缓冲区最大区块数 `chunksLoadedLimit`
- 提供 `init...` 风格的缓冲区初始化接口
- 提供上下左右移动当前区块位置的接口
- 提供向上下左右扩展与收缩缓冲区的接口
- 提供重置缓冲区的接口

## 设计边界

需要特别注意：

- `ChunkBlockLoader` 不是区块对象的最终持有者
- `ChunkBlockLoader` 不拥有白板级状态
- `ChunkBlockLoader` 不直接读取文件或调用区块加载逻辑
- 它只负责“提出应加载/应卸载哪些区块”的调度意图
- 区块对象的实际持有、按 id/坐标访问与卸载入口，都委托给内部 `ChunkLoader`
- 事件总线与请求方 id 也只作为内部 `ChunkLoader` 的上下文配置存在，不应再由 `ChunkBlockLoader` 自己持有一份运行时状态
- 真正的加载动作应由 `Board` 协调，再调用 `Chunk` 的加载方法
- 当前邻区块如何解析，也由 `Board` 决定；`ChunkBlockLoader` 只消费区块之间的空间邻接关系

因此它更接近“连续矩形区块缓冲区控制器”，而不是“区块内容加载器”或“区块对象持有者”。

## 与 `ChunkLoader` 的关系

两者关系可以概括为：

- `ChunkLoader` 持有区块对象
- `ChunkBlockLoader` 包装 `ChunkLoader`
- `ChunkBlockLoader` 用连续矩形边界来组织这批已持有区块

当前实现中，`ChunkBlockLoader` 内部会把以下能力委托给 `ChunkLoader`：

- `chunksLoaded` 的实际存储
- 按区块 id / 坐标创建或获取区块实例
- 从当前缓冲区持有集合中移除区块
- 当前持有集合内部的四向邻接同步

而 `ChunkBlockLoader` 自己额外负责：

- `chunkNow`
- `bufferBounds`
- 四向扩缩与移动
- 决定何时通过内部 `ChunkLoader` 间接发出加载/卸载与缓冲区更新事件

推荐约定：

- 若调用方需要“以某区块或某一区域为起点重建缓冲区”，优先通过 `ChunkBlockLoader.init...` 完成。
- `ChunkBlockLoader` 不适合作为通用区块查询服务，因此不再提供 `getChunkById(...)`、`getChunkByCoordinate(...)`、`getChunksAroundCoordinate(...)` 这类接口。
- `Board` 更适合作为单区块加载/卸载的执行端，而不是业务层的区块查询入口。

## 核心字段

| 名称                | 描述                             | 类型                                      |
| ------------------- | -------------------------------- | ----------------------------------------- |
| `chunkLoader`       | 被包装的通用区块加载器           | `ChunkLoader`                             |
| `chunksLoaded`      | 当前缓冲区中的区块 id 映射       | `Map<number, Chunk>`                      |
| `bufferBounds`      | 当前缓冲区二维边界               | `{ minX, maxX, minY, maxY } \| undefined` |
| `chunkNow`          | 当前区块引用                     | `Chunk`                                   |
| `chunksLoadedLimit` | 缓冲区区块数上限，`0` 表示不限制 | `number`                                  |

## 缓冲区模型

`ChunkBlockLoader` 维护一个连续矩形二维网格缓冲区。

缓冲区内部区块对象由 `ChunkLoader` 持有，再由 `ChunkBlockLoader` 用区块坐标计算矩形边界与邻接视图：

- 每个已加载区块都占据一个 `(x, y)` 格点
- `chunksLoaded` 对外暴露为区块 id 到区块实例的映射，但底层实际存储属于内部 `ChunkLoader`
- 缓冲区通过 `bufferBounds` 描述当前已加载区域的外包边界
- 向某一方向扩展时，会尝试把该边界整条边上的相邻区块加入缓冲区
- 向某一方向收缩时，会移除该边界整条边上的区块

这个缓冲区通常包含：

- 当前区块
- 当前区块周围若干行与若干列

缓冲区的用途是：

- 支持翻区块时更平滑地切换
- 支持跨区块对象操作时访问相邻区块
- 在内存占用和切换响应之间取得平衡

## 主要操作

### 移动当前区块

#### `moveCurrentRight()`

将当前区块在缓冲区中的位置向右移动一区块。

若右侧没有已在缓冲区中的区块，则不执行操作。

#### `moveCurrentLeft()`

将当前区块在缓冲区中的位置向左移动一区块。

若左侧没有已在缓冲区中的区块，则不执行操作。

#### `moveCurrentUp()` / `moveCurrentDown()`

将当前区块在缓冲区中的位置向上或向下移动一区块。

若目标方向没有已在缓冲区中的区块，则不执行操作。

### 扩展缓冲区

#### `expandBufferRightTempLoad()`

向右扩展缓冲区，并要求采用“临时加载”策略。

适用于：

- 活动对象跨区块拾取
- 需要区块层叠图但暂不需要对象完整内容的场景

#### `expandBufferRightFullLoad()`

向右扩展缓冲区，并要求采用“完整加载”策略。

适用于：

- 用户翻区块后即将编辑右区块
- 需要对象内容、而不只是层叠关系的场景

#### `expandBufferLeftTempLoad()`

向左扩展缓冲区，并要求采用“临时加载”策略。

#### `expandBufferLeftFullLoad()`

向左扩展缓冲区，并要求采用“完整加载”策略。

#### `expandBufferUpTempLoad()` / `expandBufferDownTempLoad()`

向上或向下扩展缓冲区，并要求采用“临时加载”策略。

#### `expandBufferUpFullLoad()` / `expandBufferDownFullLoad()`

向上或向下扩展缓冲区，并要求采用“完整加载”策略。

### 收缩缓冲区

#### `shrinkBufferRight()`

从右边界向左收缩缓冲区。

若右边界就是当前区块，则不执行操作。

#### `shrinkBufferLeft()`

从左边界向右收缩缓冲区。

若左边界就是当前区块，则不执行操作。

#### `shrinkBufferUp()` / `shrinkBufferDown()`

从上边界或下边界收缩缓冲区。

若该边界上包含当前区块，则不执行操作。

### 初始化接口

#### `initChunk(chunk)`

清空当前缓冲区，并以指定区块作为新的当前区块。

#### `initChunkById(chunkId)`

清空当前缓冲区，并以指定区块 id 对应的区块作为新的当前区块。

#### `initChunkByCoordinate(x, y)`

清空当前缓冲区，并以指定坐标对应的区块作为新的当前区块。

#### `initChunksAroundCoordinate(x, y, radius)`

清空当前缓冲区，以中心区块为当前区块，并用其周围的二维邻域重建新的初始缓冲范围。

### 重置接口

#### `resetBuffer()`

清空当前缓冲区状态，重新开始管理区块加载窗口。

## 事件协作

`ChunkBlockLoader` 自身不执行加载，也不直接往事件总线发请求；它会调用内部 `ChunkLoader` 的事件发射能力，把意图间接发送给 `Board`。

- 加载事件会携带请求来源 `requesterId`
- 卸载事件也会携带请求来源 `requesterId`
- 缓冲区更新事件同样由内部 `ChunkLoader` 发出
- 这样 `Board` 可以在多个 `ChunkBlockLoader` 同时存在时正确维护区块的引用计数
- `Board` 也会把“如何从当前区块解析上下左右邻区块”的逻辑注入给 `ChunkBlockLoader`

## API

| 名称                              | 描述                       | 类型                                  |
| --------------------------------- | -------------------------- | ------------------------------------- |
| `moveCurrentRight()`              | 当前区块在缓冲区中右移     | `() => void`                          |
| `moveCurrentLeft()`               | 当前区块在缓冲区中左移     | `() => void`                          |
| `moveCurrentUp()`                 | 当前区块在缓冲区中上移     | `() => void`                          |
| `moveCurrentDown()`               | 当前区块在缓冲区中下移     | `() => void`                          |
| `expandBufferRightTempLoad()`     | 向右扩展缓冲区并临时加载   | `() => void`                          |
| `expandBufferRightFullLoad()`     | 向右扩展缓冲区并完整加载   | `() => void`                          |
| `expandBufferLeftTempLoad()`      | 向左扩展缓冲区并临时加载   | `() => void`                          |
| `expandBufferLeftFullLoad()`      | 向左扩展缓冲区并完整加载   | `() => void`                          |
| `expandBufferUpTempLoad()`        | 向上扩展缓冲区并临时加载   | `() => void`                          |
| `expandBufferUpFullLoad()`        | 向上扩展缓冲区并完整加载   | `() => void`                          |
| `expandBufferDownTempLoad()`      | 向下扩展缓冲区并临时加载   | `() => void`                          |
| `expandBufferDownFullLoad()`      | 向下扩展缓冲区并完整加载   | `() => void`                          |
| `shrinkBufferRight()`             | 从右边界收缩缓冲区         | `() => boolean`                       |
| `shrinkBufferLeft()`              | 从左边界收缩缓冲区         | `() => boolean`                       |
| `shrinkBufferUp()`                | 从上边界收缩缓冲区         | `() => boolean`                       |
| `shrinkBufferDown()`              | 从下边界收缩缓冲区         | `() => boolean`                       |
| `initChunk(chunk)`                | 以指定区块初始化缓冲区     | `(Chunk) => void`                     |
| `resetBuffer()`                   | 重置缓冲区                 | `() => void`                          |
| `initChunkById(chunkId)`          | 以指定区块 id 初始化缓冲区 | `(number) => Chunk`                   |
| `initChunkByCoordinate(x, y)`     | 以指定坐标初始化缓冲区     | `(number, number) => Chunk`           |
| `initChunksAroundCoordinate(...)` | 以指定邻域初始化缓冲区     | `(number, number, number) => Chunk[]` |

## 与其它组件的关系

- 与 [chunk-loader-document.md](./chunk-loader-document.md)：`ChunkBlockLoader` 通过内部 `ChunkLoader` 持有区块对象。
- 与 [board-document.md](./board-document.md)：由白板类协调其策略结果落地。
- 与 [chunk-document.md](./chunk-document.md)：缓冲区中的元素是 `Chunk` 实例。
- 与 [active-object-document.md](./active-object-document.md)：活动对象跨区块访问会依赖区块缓冲区策略。

## 实现状态

- 已实现：内部组合 `ChunkLoader`、连续矩形缓冲区、`init...` 初始化接口、四向移动、四向扩缩、通过 `ChunkLoader` 间接发送事件、请求方标识，以及由 `Board` 注入的邻区块解析能力。
- 待完善：更高层交互状态联动，以及围绕当前区块自动维护更复杂的预取策略。
