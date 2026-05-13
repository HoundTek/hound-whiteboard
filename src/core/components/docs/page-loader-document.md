# 页面加载器文档

本文档提供 `PageLoader` 的概述。

`PageLoader` 用于管理“当前缓冲区内已加载的页网格”，它不直接执行页加载，而是负责维护加载窗口、当前页位置与网格边界。

## 页面加载器职责

- 维护当前缓冲区中的页集合
- 维护当前缓冲区的二维边界
- 记录当前页引用 `pageNow`
- 限制缓冲区最大页数 `pagesLoadedLimit`
- 提供上下左右移动当前页位置的接口
- 提供向上下左右扩展与收缩缓冲区的接口
- 提供重置当前页和重置缓冲区的接口

## 设计边界

需要特别注意：

- `PageLoader` 不拥有白板级状态
- `PageLoader` 不直接读取文件或调用页加载逻辑
- 它只负责“提出应加载/应卸载哪些页”的调度意图
- 真正的加载动作应由 `Board` 协调，再调用 `Page` 的加载方法
- 当前邻页如何解析，也由 `Board` 决定；`PageLoader` 只消费页坐标关系

因此它更接近“页缓冲区控制器”，而不是“页内容加载器”。

## 核心字段

| 名称               | 描述                           | 类型                                      |
| ------------------ | ------------------------------ | ----------------------------------------- |
| `pagesLoaded`      | 当前缓冲区中的页坐标映射       | `Map<string, Page>`                       |
| `bufferBounds`     | 当前缓冲区二维边界             | `{ minX, maxX, minY, maxY } \| undefined` |
| `pageNow`          | 当前页引用                     | `Page`                                    |
| `pagesLoadedLimit` | 缓冲区页数上限，`0` 表示不限制 | `number`                                  |

## 缓冲区模型

`PageLoader` 维护一个二维网格缓冲区。

缓冲区以坐标为主，而不是以页 id 或线性顺序为主：

- 每个已加载页都占据一个 `(x, y)` 格点
- 缓冲区通过 `bufferBounds` 描述当前已加载区域的外包边界
- 向某一方向扩展时，会尝试把该边界整条边上的相邻页加入缓冲区
- 向某一方向收缩时，会移除该边界整条边上的页

这个缓冲区通常包含：

- 当前页
- 当前页周围若干行与若干列

缓冲区的用途是：

- 支持翻页时更平滑地切换
- 支持跨页对象操作时访问相邻页
- 在内存占用和切换响应之间取得平衡

## 主要操作

### 移动当前页

#### `moveCurrentRight()`

将当前页在缓冲区中的位置向右移动一页。

若右侧没有已在缓冲区中的页，则不执行操作。

#### `moveCurrentLeft()`

将当前页在缓冲区中的位置向左移动一页。

若左侧没有已在缓冲区中的页，则不执行操作。

#### `moveCurrentUp()` / `moveCurrentDown()`

将当前页在缓冲区中的位置向上或向下移动一页。

若目标方向没有已在缓冲区中的页，则不执行操作。

### 扩展缓冲区

#### `expandBufferRightTempLoad()`

向右扩展缓冲区，并要求采用“临时加载”策略。

适用于：

- 活动对象跨页拾取
- 需要页层叠图但暂不需要对象完整内容的场景

#### `expandBufferRightFullLoad()`

向右扩展缓冲区，并要求采用“完整加载”策略。

适用于：

- 用户翻页后即将编辑右页
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

若右边界就是当前页，则不执行操作。

#### `shrinkBufferLeft()`

从左边界向右收缩缓冲区。

若左边界就是当前页，则不执行操作。

#### `shrinkBufferUp()` / `shrinkBufferDown()`

从上边界或下边界收缩缓冲区。

若该边界上包含当前页，则不执行操作。

### 重置接口

#### `resetCurrentPage(page)`

将当前页重置为指定页。该操作通常意味着后续应重新构建缓冲区。

#### `resetBuffer()`

清空当前缓冲区状态，重新开始管理页加载窗口。

## 事件协作

`PageLoader` 自身不执行加载，而是通过事件总线把意图发送给 `Board`。

- 加载事件会携带请求来源 `requesterId`
- 卸载事件也会携带请求来源 `requesterId`
- 这样 `Board` 可以在多个 `PageLoader` 同时存在时正确维护页的引用计数
- `Board` 也会把“如何从当前页解析上下左右邻页”的逻辑注入给 `PageLoader`

## API

| 名称                          | 描述                     | 类型              |
| ----------------------------- | ------------------------ | ----------------- |
| `moveCurrentRight()`          | 当前页在缓冲区中右移     | `void -> void`    |
| `moveCurrentLeft()`           | 当前页在缓冲区中左移     | `void -> void`    |
| `moveCurrentUp()`             | 当前页在缓冲区中上移     | `void -> void`    |
| `moveCurrentDown()`           | 当前页在缓冲区中下移     | `void -> void`    |
| `expandBufferRightTempLoad()` | 向右扩展缓冲区并临时加载 | `void -> void`    |
| `expandBufferRightFullLoad()` | 向右扩展缓冲区并完整加载 | `void -> void`    |
| `expandBufferLeftTempLoad()`  | 向左扩展缓冲区并临时加载 | `void -> void`    |
| `expandBufferLeftFullLoad()`  | 向左扩展缓冲区并完整加载 | `void -> void`    |
| `expandBufferUpTempLoad()`    | 向上扩展缓冲区并临时加载 | `void -> void`    |
| `expandBufferUpFullLoad()`    | 向上扩展缓冲区并完整加载 | `void -> void`    |
| `expandBufferDownTempLoad()`  | 向下扩展缓冲区并临时加载 | `void -> void`    |
| `expandBufferDownFullLoad()`  | 向下扩展缓冲区并完整加载 | `void -> void`    |
| `shrinkBufferRight()`         | 从右边界收缩缓冲区       | `void -> boolean` |
| `shrinkBufferLeft()`          | 从左边界收缩缓冲区       | `void -> boolean` |
| `shrinkBufferUp()`            | 从上边界收缩缓冲区       | `void -> boolean` |
| `shrinkBufferDown()`          | 从下边界收缩缓冲区       | `void -> boolean` |
| `resetCurrentPage(page)`      | 重置当前页               | `Page -> void`    |
| `resetBuffer()`               | 重置缓冲区               | `void -> void`    |

## 与其它组件的关系

- 与 [board-document.md](./board-document.md)：由白板类协调其策略结果落地。
- 与 [page-document.md](./page-document.md)：缓冲区中的元素是 `Page` 实例。
- 与 [active-object-document.md](./active-object-document.md)：活动对象跨页访问会依赖页缓冲区策略。

## 实现状态

- 已实现：二维网格缓冲区、四向移动、四向扩缩、事件请求接口、请求方标识，以及由 `Board` 注入的邻页解析能力。
- 待完善：更高层交互状态联动，以及围绕当前页自动维护更复杂的预取策略。
