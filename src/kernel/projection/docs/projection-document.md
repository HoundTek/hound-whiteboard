# 白板投影内核文档

本文档说明 `src/kernel/projection/` 的应然投影、物化摘要与局部自愈语义。

## 职责

投影模块把当前活动记录转换为可比较、可局部修复的派生状态。它与同步传输解耦：同步仍先补齐操作日志并维护 UndoTree，投影模块再回答“当前应有状态是什么”和“实际物化状态在哪里不同”。

- `DerivedBoardProjection` 以纯序列化数据正放、逆放活动记录，不构造 BoardCore、AOM 或 BasicObject。
- `DerivedLayerProjection` 以快照几何维护覆盖索引、静态图和层序哈希。
- `MaterializedBoardProjection` 从 BoardCore 捕获实际对象、trash 与静态图摘要，合法未驻留内容保留逻辑叶子。
- `BoardProjection` 连接两条投影线，提供局部分歧定位与定点重捕。
- 对象与 trash 的叶子按完整对象 id 写入 `HashTrie`，静态图叶子按区块 id 写入，根查询不遍历对象或图集合。
- 对象几何由 `kernel/objects/object-geometry` 从快照直接计算，与真实对象共用各类型的范围构造函数。

## 与 UndoTree 的关系

操作日志是权威，UndoTree 决定活动链，DerivedProjection 再计算活动链的对象效果：

```text
OperationLog -> UndoTree / active records -> DerivedBoardProjection
```

Undo、Redo 和 close-supra 的效果已经体现在活动记录序列中，因此对象状态修复不需要重新执行这些树级操作。过渡输入为 `removed` 与 `added`：投影先逆序逆放 removed，再顺序正放 added，与 BoardApi 的效果过渡方向一致。

## 对象与 trash 口径

- `objects` 保存当前存活对象的序列化快照，不区分对象是否驻留内存。
- `trash` 保存删除记录携带的对象快照与层位边；trash 中的 modify 只更新 trash 快照。
- choose 不直接改对象数据或 trash；discard 型 unchoose 凭 `restore` 快照还原对象。
- 投影采用远程记录应用口径，不模拟本地 AOM pickup，远程 choice 标签不进入对象状态哈希。

## 快照几何

`getSerializedObjectWorldRect(snapshot)` 经对象类型注册表调用 `rangeFromSerialized`，再叠加 position 并转为 `RectangleRange`。Stroke、Circle、Ellipse、Polygon 的实例路径与快照路径共用同一类型几何实现。空点列返回零尺寸矩形。

## 增量摘要

`HashTrie` 使用固定八层十六进制路径，叶子保存完整 key 和 valueHash。更新只重算路径上的节点，两个索引的 `diffKeys` 只沿哈希不同的分支下降，因此局部分歧定位不依赖全量扫描。

哈希沿用项目的非加密 FNV-1a 摘要，不用于安全认证。发生碰撞路径时，完整 key 仍保证不同对象不会被视为同一叶子。

## 层序口径

层序投影复用 BoardApi 的记录边覆盖、记录外相交缝合与删除恢复规则。AOM 的本地 pickup 不属于该投影：与既有 `__repair__` 沙盘一致，choose/unchoose 按远程活动口径处理，choose 本身不改静态图，unchoose 按提交边写回。

`layerHash` / `derivedLayerHash` 的叶子包含排序后的静态图节点与有向边；空图不形成叶子。层序分歧独立于对象 `stateHash` 发现，可以只修一条错误边而不重写任何对象数据。

## 局部修复边界

普通物化分歧只需比较应然与物化哈希索引，再修复不同叶子；不得为此重放全量日志。应然索引本身失效时才从当前活动记录重建 DerivedProjection；UndoTree 自身分歧仍由 `repairChainFromLog` 处理。

绕过内核写路径直接修改对象字段不会被增量物化摘要自动观察，调用方必须显式重捕对应对象或全量物化摘要。合法驻留驱逐不是对象消失，不能删除其状态叶子。需要驻留或区块元数据才能落地的修复先登记 pending，在对应 LOAD_COMPLETE 后应用。`BoardCore.isObjectLegallyUnloaded(id)` 只读取该对象覆盖区块，不把全量驻留计算带入局部修复。

## 基准与 chainHash 后续评估

`yarn bench:sync` 的代表性本地运行（5 轮均值）如下，数值用于比较规模趋势，不作为跨机器绝对指标：

| 记录数 | 单对象修复 | 单区块层序修复 | `repairChainFromLog` | 迟到 undo 前插入 |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 0.0414ms | 0.0314ms | 9.0345ms | 10.08ms |
| 10,000 | 0.0528ms | 0.0365ms | 1463.8431ms | 1370.43ms |

六个根哈希查询均低于该轮计时器的有效显示精度，未观察到随 N 增长。单对象与单区块修复也未呈现全链线性成本。

结论是：**局部物化自愈已经达标；持久化/版本化 UndoTree 值得单独立项。** 当前 `ActiveChainIndex` 只解决活动序列摘要，不等于完整持久化 UndoTree。后续方案必须同时覆盖全分支、HEAD、undoRegistry、迟到插入后的检查点有效性，以及 undo/redo/close-supra 的上下文重估，不能直接复用局部对象修复替代链修复。

本轮未测量 RSS，不能据此宣称 DerivedProjection 的内存开销已经优于现有全量驻留或 scratch 修复。
