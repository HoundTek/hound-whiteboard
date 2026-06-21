# 层叠图文档

本文档提供层叠图（tier graph）的概述。

层叠图是活动对象管理器（AOM）用来管理对象间层级关系的工具。

## 符号约定

- 所有集合均用大写黑板体表示，如集合 $\mathbb{A}$
- 所有对象均用小写正粗体表示，如对象 $\mathbf{a}$，如未特殊说明，字母相同的对象与点被视为对应的，比如 $\mathbf{a}$ 在图上对应的点为 $A$
- 所有的图均用大写花体表示，如图 $\mathcal{G}$
- 所有图上的点均用大写斜体表示，如点 $A$
- 所有函数和自然数变量均用小写斜体表示，如 $f(x)$
- 函数 $V(\mathcal{G})$ 用以获取图 $\mathcal{G}$ 的点集
- 函数 $\operatorname{src}(\mathcal{G})$ 用以获取图 $\mathcal{G}$ 入度为 $0$ 的点的点集
- 函数 $\operatorname{sink}(\mathcal{G})$ 用以获取图 $\mathcal{G}$ 出度为 $0$ 的点的点集
- $P \to Q$ 表示 $P$ 与 $Q$ 间有一条从 $P$ 到 $Q$ 的边
- $P \xrightarrow{*} Q$ 表示存在从 $P$ 到 $Q$ 的路径（$\to$ 的传递闭包）

## 层叠图概述

对于一个区块上的对象，我们可以用有向无环图来表示对象间的层级关系（可以不连通）。

我们维护一张有向无环图：静态状态图 $\mathcal{S}$。还会维护一个由 $n$ 个三元组 $(s_i, \mathbb{A}_i, \mathcal{D}_i)$ 构成的有序序列，称为动态状态图 $\mathbf{D}$。其中 $s_i \in \{\text{active}, \text{inactive}\}$ 表示该层当前是否仍是活动层。它们并称层叠图。为方便起见，$P \in \mathbf{D}$ 表示点 $P$ 属于 $\mathbf{D}$ 中某一层的活动对象集或非活动子图。

静态状态图表示最后一次刷新时对象间的层级关系。若 $P, Q \in V(\mathcal{S})$ 且存在边 $P \to Q$，则表示 $P$、$Q$ 间有交集，且 $\mathbf{p}$ 在 $\mathbf{q}$ 之下。

动态状态图表示下次刷新时对象额外应遵循的层级关系，用于确定对象间谁应在谁之上。若 $P, Q \in \mathbf{D}$ 且 $P \xrightarrow{*} Q$，则在下次刷新时，若 $\mathbf{p}$、$\mathbf{q}$ 间有交集，则表示 $\mathbf{p}$ 应在 $\mathbf{q}$ 之下。

当某层 $s_i = \text{inactive}$ 时，$\mathbb{A}_i$ 中保留下来的点不再表示“当前活动对象”，而是按 $\mathcal{D}_i$ 的语义处理：它们仍保留在动态图结构里，但在 duplicate 判断、层级恢复等逻辑中视为非活动点。

## 层叠图基础操作

### 注册某层

动态状态图 $\mathbf{D}$ 由若干层 $(s_i, \mathbb{A}_i, \mathcal{D}_i)$ 按序构成，层与层之间存在上下顺序关系。

注册某层即向 $\mathbf{D}$ 中添加一个新层 $(s_{n+1}, \mathbb{A}_{n+1}, \mathcal{D}_{n+1})$，并给定其在顺序中的位置。新注册的层默认满足 $s_{n+1} = \text{active}$。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md)。

### 清理动态图

清理动态图是指从 $\mathbf{D}$ 中删去以下两类层：

- 位于最下面一个 active 层之下的所有 inactive 层
- 结构为空的层：$\mathbb{A}_i = \varnothing$ 且 $V(\mathcal{D}_i) = \varnothing$

若当前不存在任何 active 层，则整个 $\mathbf{D}$ 会被清空。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md)。

## 层叠图操作逻辑

### 在白板中添加对象

默认情况下，越新的对象越应在最上层。

在向白板中添加对象 $\mathbf{a}$ 时，先将其加入动态状态图 $\mathbf{D}$：$\mathbf{D} \leftarrow \mathbf{D} \cup \{A\}$，并连接所有出度为 $0$ 的点到 $A$：

$$
\forall T \in \operatorname{sink}(\mathcal{D}): T \to A
$$

在添加结束时，算出与 $\mathbf{a}$ 相交的对象集 $\mathbb{C}$，连接 $C \to A$（$\forall C \in \mathbb{C}$），在静态状态图 $\mathcal{S}$ 中添加对应的边，最后将 $A$ 从 $\mathbf{D}$ 中删去。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md) 的“加入白板外对象”与“提交并取消选择”两节。

### 在白板中删除对象

将指定对象 $\mathbf{a}$ 对应的点 $A$ 及所有关联边从 $\mathcal{S}$ 和 $\mathbf{D}$ 中同时移除，然后执行动态图清理。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md) 的“从白板删除并取消选择”一节。

### 在白板上选择对象

将被选择的对象集记为 $\mathbb{A}$（活动点集）。

#### 提取子图

提取 $\mathcal{S}$ 的最大子图 $\mathcal{G}$，满足：

1. $\operatorname{src}(\mathcal{G}) \subseteq \mathbb{A}$
2. $\forall P \in V(\mathcal{G}), \exists Q \in \mathbb{A}: Q \xrightarrow{*} P$
3. $\forall P \in V(\mathcal{S}) \setminus V(\mathcal{G}), \forall Q \in \mathbb{A}: \neg(Q \xrightarrow{*} P)$

#### 计算层数

对 $\mathcal{G}$ 中每个点 $P$，定义其层数为：

$$
\text{层数}(P) = \max_{\substack{S \in \operatorname{src}(\mathcal{G}) \\ \rho: S \xrightarrow{*} P}} \text{active\_count}(\rho)
$$

其中 $\text{active\_count}(\rho)$ 为路径 $\rho$ 中属于 $\mathbb{A}$ 的点的数量。层数为正整数。

该定义等价于：

- 活动点的后继 → 层数至少比前驱大 $1$
- 非活动点的后继 → 层数至少与前驱相同

因此，若某个活动点的后继本身不是被选中的活动点，那么它不会自动升到更高一层。示例二、示例五里的 $E \to F$ 就属于这种情况：$F$ 与 $E$ 同层，而不是与 $C$ 同层。

#### 构造新层

按层数将 $\mathcal{G}$ 中的点分配到新的层 $(\mathbb{A}_i, \mathcal{D}_i)$：

1. 活动对象加入第 $i$ 层的活动对象集 $\mathbb{A}_i$
2. 非活动对象加入第 $i$ 层的非活动子图 $\mathcal{D}_i$，仅保留同层非活动对象间的边（删去所有跨层边）

#### 合并入动态图

将新层按层数从小到大的顺序依次并入 $\mathbf{D}$，合并时需满足：

1. 若 $P \in \mathbb{A}$ 在 $\mathbf{D}$ 的旧层中已存在，则新层必须插入到该旧层**之下**
2. 同一活动对象不能在多个层中同时出现

选择单个对象（$|\mathbb{A}| = 1$）是此过程的特殊情况：子图 $\mathcal{G}$ 退化为以该对象为唯一源点的可达子图，层数退化为 $S \xrightarrow{*} P$ 中活动点的计数（其中 $S$ 为唯一源点）。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md) 的“选择对象”一节。

### 提交活动对象

提交活动对象是指将活动点集 $\mathbb{A}$ 从动态状态图 $\mathbf{D}$ 移回静态状态图 $\mathcal{S}$。

对每个 $\mathbf{a} \in \mathbb{A}$：

1. 算出与 $\mathbf{a}$ 相交的对象集 $\mathbb{C}$
2. 结合 $\mathbf{D}$ 中层与层的上下关系，确定 $\mathbf{a}$ 在 $\mathcal{S}$ 中应处于哪些对象之上、哪些对象之下
3. 将上述关系以边的形式写入 $\mathcal{S}$

所有对象提交完毕后，并不要求立即把对应层结构从 $\mathbf{D}$ 中删除，而是会先把相关层标记为 inactive，再对 $\mathbf{D}$ 执行清理。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md) 的“提交并取消选择”一节。

### 置顶选择的对象

将指定对象集 $\mathbb{A}$ 从 $\mathcal{S}$ 及 $\mathbf{D}$ 中所有现有活动层中移除，执行动态图清理，再为 $\mathbb{A}$ 中各对象按其原有层间关系在 $\mathbf{D}$ 中创建新层并置于顶部。

其实现见 [active-object-manager-document.md](./active-object-manager-document.md) 的“置顶”一节。
