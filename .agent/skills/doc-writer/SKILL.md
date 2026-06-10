---
name: doc-writer
description: Write module documentation, technical overviews, and API docs following the project's established style. Use when creating or updating .md files in docs/ directories.
---

# Doc Writer

按项目既有风格撰写模块文档、技术概述和 API 文档。

## 参考基线

写作前先读取目标附近最邻近的现有文档：

1. 同目录或同模块下的现有 `.md` 文档
2. 同目录或相邻模块下的现有文档
3. 同一层级中最接近目标职责的说明文本

如果目标附近样本不足，再向上一级目录或相邻模块补充抽样。

## 文档存放位置

- 文档放在每个模块的 `docs/` 目录下
- 命名格式：`{module-name}-document.md`
- 例如 `board-document.md`、`monitor-document.md`、`device-document.md`

## `@module` 路径

JSDoc 中的 `@module` 路径与源码路径对应，前缀为 `core/`：

| 源文件路径 | `@module` |
|-----------|-----------|
| `src/core/components/board.js` | `core/components/board` |
| `src/core/devices-dag/dag.js` | `core/devices-dag/dag` |
| `src/core/tools/creator/stroke-creator.js` | `core/tools/creator/stroke-creator` |

## 文档文风

默认采用目标附近文档已经稳定使用的风格。如果附近风格不稳定，则优先采用工作区内较成熟模块常见的技术综述体：

- 使用中文技术综述体，先总览，再分节展开
- 先交代"本文档提供什么概述"，再说明模块职责与边界
- 句子偏短，语气偏工程化，少修辞，少宣传式表达
- 优先写职责、关系、流程、约束、状态，不写空泛背景
- 术语需要稳定，命名尽量与代码中的类名、字段名、方法名保持一致

### 文档结构（参考）

```
概述            → 模块定位、解决的问题
术语约定        → 关键术语定义
职责/列表       → 类、函数、常量的职责概述
关系图          → 模块间协作关系（可选用 Mermaid）
关键设计点      → 架构决策说明
流程            → 核心流程描述
API             → 对外接口说明
设计约束        → 限制条件、未完成事项
实现状态        → [todo] 标记未完成功能
相关文档        → 关联模块文档链接
```

### Mermaid 图

可以使用 Mermaid 图提升可读性，但只有确实需要时才使用：

- 流程图（flowchart）描述流程
- 类图（classDiagram）描述类型关系
- 时序图（sequenceDiagram）描述交互流程

图中使用的术语必须与代码中的类名、方法名一致。

### 文档诚实性

- 文档内容必须从当前实现出发，不要把未实现的设计写成已实现能力
- 未完成内容要显式标为 `[todo]`、`待完善` 或 `后续计划`
- 若模块存在已知限制或 bug，应在"设计约束"中说明

### 文风一致性

- 若目标文件已有明显不同的局部文风，优先跟随该文件及其相邻文件
- 不强行统一成另一套模板
- 不要引入和周边文件明显不一致的文风
- 不要为了"完整"而补写未经代码证实的设计意图

## 工作方式

1. 先找最近的现有文档样本，归纳目标风格
2. 只在目标范围内写文档，不顺手重写无关内容
3. 如果现有代码和文档存在偏差，以当前实现为准
4. 如果信息不足以写出准确说明，保留最小化、可验证的描述，不要编造行为
5. 优先产出可直接提交的结果，而不是泛泛建议
