---
name: hound-whiteboard-git-convention
description: Hound Whiteboard 项目的 Git 提交信息规范。在准备提交时加载。
---

# Hound Whiteboard Git Commit Convention

## 格式

```
<type>(<scope>): <简短中文描述>

- 详细说明用减号分段（可选）
```

### 示例

```
refactor(creator): 去除 Creator 对本地 BasicObject 实例的依赖

fix(worker-mode): 修复叠帧渲染与框选后修改异常
- ViewportProxy.onRenderFrame 增加 clearRect
- UiRenderer 使用 RectangleRange.fromRectLike 解析 RPC 返回的 bbox
- core-worker 转发 viewport-change.force 标志位
- ViewportCore.flushRenderFrame 恢复 transfer 后的 OffscreenCanvas 内容
```

```
perf(rpc): 实现 UI 侧微任务级 RPC 批处理合并

- modifyObject / appendListItem 等高频调用入帧级缓冲
  - 同 id 同 key 自动合并
  - 微任务 Promise.resolve().then(...) 自动 flush
  - 遇到 #call 非批处理调用时先同步清空队列保序
- Worker 侧新增 rpc-batch 消息处理
```

## Type 类型

| 类型       | 何时使用               |
| ---------- | ---------------------- |
| `feat`     | 新功能、新特性         |
| `fix`      | Bug 修复               |
| `refactor` | 代码重构（行为不变）   |
| `perf`     | 性能优化               |
| `docs`     | 文档变更               |
| `test`     | 测试相关               |
| `chore`    | 构建、配置、依赖等杂项 |
| `agent`    | 新增 skill、AGENTS.md  |

## Scope

Scope 指明变更影响的主要模块/目录。从项目结构和 commit 历史归纳的常用 scope：

| Scope         | 对应目录                             |
| ------------- | ------------------------------------ |
| `kernel`      | `src/kernel/`（内核层）              |
| `render`      | `src/renderers/`（渲染插件）         |
| `host`        | `src/host/`（组合根与通道）          |
| `worker-mode` | Worker 模式相关（worker/proxy 切换） |
| `core-worker` | `src/host/core-worker.js`            |
| `board-api`   | `src/host/bridges/`                  |
| `creator`     | `src/ui/devices-dag/tools/creator/`  |
| `chooser`     | `src/ui/devices-dag/tools/chooser/`  |
| `modifier`    | `src/ui/devices-dag/tools/modifier/` |
| `tool`        | 工具整体或跨工具                     |
| `dag`         | `src/ui/devices-dag/`                |
| `ui-renderer` | `src/ui/components/renderer/`        |
| `object`      | `src/kernel/objects/`                |
| `demo`        | `src/demo/config/`                   |
| `test`        | 测试修改（不限目录）                 |
| `docs`        | 文档修改                             |
| `benchmarks`  | `benchmarks/`                        |

## 标题动词

标题回答的是「这个提交**做了什么**」，不是「这个提交**关于什么**」。所以标题必须以动作动词开头，后面才是动作的对象。

### 自查方法

在标题前补一个「我」，能读通才合规：

| 标题 | 补「我」之后 | 判定 |
| --- | --- | --- |
| 修复幽灵选择 | 我修复了幽灵选择 | ✅ 通顺，合规 |
| 区域重绘的裁剪范围与清除范围对齐 | 我区域重绘的裁剪范围与清除范围对齐 | ❌ 读不通，违规 |

### 常见陷阱：名词化

动作被写成了名词（名词化），标题里虽然有字面动词，但它只是**修复的对象**，不是提交的动作。

| ❌ 违规 | ✅ 合规 | 说明 |
| --- | --- | --- |
| 区域重绘的裁剪范围与清除范围**对齐** | **修复**区域重绘的裁剪范围超出清除范围 | 「对齐」是修复的对象，「修复」才是动作 |
| 清层退出对象**纳入**静态层失效 | **修复**清层退出对象未纳入静态层失效 | 同上 |
| 几何不可解析的条目在脏区下仍**参与绘制** | **修复**几何不可解析的条目被脏区剔除 | 同上 |
| 连续创建场景的像素回归与抗锯齿阈值 | **补充**连续创建场景的像素回归与抗锯齿阈值 | 纯名词短语，完全没有动作 |
| 渲染 flush 循环空闲时**休眠** | **让**渲染 flush 循环在空闲时休眠 | 缺施动者，补「让」 |
| 修复尺寸**归一化**与缓存重置后无法自愈 | 修复画布尺寸**未取整**与缓存重置后无法自愈 | 「归一化」是名物化，应写清修的是哪个缺陷 |

### 各 type 的常用动作动词

| type | 常用动词 |
| --- | --- |
| `feat` | 新增、引入、实现、支持、提供 |
| `fix` | 修复、修正、纠正、避免 |
| `refactor` | 重构、合并、拆分、移出、收敛 |
| `perf` | 优化、避免、消除、减少、省去、让 |
| `docs` | 重写、补充、同步、更新 |
| `test` | 补充、新增、迁移、修正 |
| `chore` | 升级、删除、移除、更新 |
| `agent` | 新增、更新、补充 |

### 修复类标题要说清「修的是什么缺陷」

`fix` 的标题写正向描述（「对齐」「纳入」）等于没说清问题。应当写清**修复前的错误状态**：

- ✅ `修复清层退出对象未纳入静态层失效`（错误状态：没纳入）
- ❌ `清层退出对象纳入静态层失效`（只说了结果，读者不知原来错在哪）

## 编写准则

1. **标题** 用**简短中文**描述变更的核心目的
2. **正文** 用 `-` 分段列出具体变更点
3. 中文描述**不加句号**
4. **标题与正文之间** 空一行（单行提交不需要）
5. 正文**可省略**（变更简单的单行提交不需要正文）
6. 正文中代码/函数名/类型名保留英文
7. 一次提交只做一件事，避免混合多种 type
8. 每条 `-` 描述**写在同一行**，不换行（正文中如有代码/术语需分行罗列，使用 `-` 子条目缩进）
9. **不用破折号**（——）：标题与正文都不用，需要补充说明时改用逗号或括号
10. **不用 `<file>: xxx` 前缀**：条目直接写变更内容，文件名放在句中自然出现或省略（如「更新操作文档的 WARNING」而非「operation-document.md：更新 WARNING」）
11. **标题带动词**：标题必须以**该提交对代码库做的动作**开头，详见上文「标题动词」
