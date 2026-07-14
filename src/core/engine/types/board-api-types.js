/**
 * @file Board API 类型定义
 * @description 定义 BoardApi 的共享 JSDoc typedef，约束同线程实现与 RPC 实现的统一签名。
 * @module core/engine/types/board-api-types
 * @author Zhou Chenyu
 */

/**
 * 对象修改 patch
 * @typedef {Object} ObjectPatch
 * @property {import("./types.js").Point2D} [position] - 新的绝对位置
 * @property {import("./types.js").TransformMatrix2D} [transform] - 新的变换矩阵
 * @property {Record<string, any>} [property] - 样式属性合并块
 * @property {Record<string, any>} [data] - 对象专属数据合并块
 */

/**
 * 创建对象参数
 * @typedef {Object} CreateObjectProps
 * @property {number} [id] - 可选显式 objectId，供同步分配复用既有 id 分配逻辑
 * @property {import("./types.js").Point2D} position - 新对象位置
 * @property {Record<string, any>} [property] - 初始样式属性
 * @property {Record<string, any>} [data] - 初始对象专属数据
 */

/**
 * 批量对象修改条目
 * @typedef {Object} ObjectPatchEntry
 * @property {number} objectId - 对象 id
 * @property {ObjectPatch} patch - 该对象的 patch
 */

/**
 * 创建 ViewportCore 的参数
 * @typedef {Object} CreateViewportOptions
 * @property {string | number} viewportId - viewport 标识
 * @property {number} width - 视口宽度
 * @property {number} height - 视口高度
 */

/**
 * BoardApi 接口摘要
 * @typedef {Object} BoardApi
 * @property {(type: string, props: CreateObjectProps) => Promise<number>} createObject - 创建对象并返回 objectId
 * @property {(objectId: number, patch: ObjectPatch) => Promise<void>} modifyObject - 修改单个对象
 * @property {(patches: ObjectPatchEntry[]) => Promise<void>} modifyObjects - 批量修改多个对象
 * @property {(objectId: number, key: string, items: any[]) => Promise<void>} appendListItem - 追加列表属性元素
 * @property {(objectId: number, key: string, index: number, item: any) => Promise<void>} replaceListItem - 替换列表属性元素
 * @property {(objectId: number, key: string, index: number) => Promise<void>} removeListItem - 删除列表属性元素
 * @property {(objectIds: number[]) => Promise<void>} deleteObjects - 删除对象集合
 * @property {(objectIds: number[]) => Promise<void>} commitObjects - 提交活动对象集合
 * @property {(objectIds: number[]) => Promise<void>} addActiveObjects - 将对象加入 AOM
 * @property {(objectIds: number[]) => Promise<void>} discardActiveObjects - 将对象从 AOM 丢弃
 * @property {(ids: number[]) => Promise<import("./types.js").ObjectSummary[]>} queryObjects - 按 id 查询对象摘要
 * @property {(chunkIds: number[]) => Promise<number[]>} queryChunkObjects - 按区块查询对象 id
 * @property {(range: import("../range/range.js").Range | import("./types.js").Rect, mode?: string) => Promise<number[]>} hitTest - 执行命中查询
 * @property {(options: CreateViewportOptions) => Promise<void>} createViewport - 创建 ViewportCore
 * @property {(viewportId: string | number) => Promise<void>} destroyViewport - 销毁 ViewportCore
 * @property {() => Promise<void>} undo - 执行撤销
 * @property {() => Promise<void>} redo - 执行重做
 */

export {};
