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
```

```
fix(worker-mode): 修复叠帧渲染与框选后修改异常
- MonitorProxy.onRenderFrame 增加 clearRect
- UiRenderer 使用 RectangleRange.fromRectLike 解析 RPC 返回的 bbox
- core-worker 转发 viewport-change.force 标志位
- MonitorCore.flushRenderFrame 恢复 transfer 后的 OffscreenCanvas 内容
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
| `core`        | `src/core/`（通用核心层）            |
| `worker-mode` | Worker 模式相关（worker/proxy 切换） |
| `core-worker` | `src/core-worker.js`                 |
| `board-api`   | `src/core/bridges/`                  |
| `creator`     | `src/core/tools/creator/`            |
| `chooser`     | `src/core/tools/chooser/`            |
| `modifier`    | `src/core/tools/modifier/`           |
| `tool`        | 工具整体或跨工具                     |
| `dag`         | `src/core/devices-dag/`              |
| `ui-renderer` | `src/core/components/renderer/`      |
| `object`      | `src/core/objects/`                  |
| `demo`        | `src/templates/demo/`                |
| `test`        | 测试修改（不限目录）                 |
| `docs`        | 文档修改                             |
| `render`      | 渲染相关                             |
| `benchmarks`  | `benchmarks/`                        |

## 编写准则

1. **标题** 用**简短中文**描述变更的核心目的
2. **正文** 用 `-` 分段列出具体变更点
3. 中文描述**不加句号**
4. 正文**可省略**（变更简单的单行提交不需要正文）
5. 正文中代码/函数名/类型名保留英文
6. 一次提交只做一件事，避免混合多种 type
7. 详细描述**不分行**
