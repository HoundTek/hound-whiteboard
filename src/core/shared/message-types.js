/**
 * @file Worker 消息类型定义
 * @description 定义 Core Worker 迁移阶段的共享消息协议 JSDoc typedef。
 * @module core/shared/message-types
 * @author Zhou Chenyu
 */

/**
 * Worker ready 消息
 * @typedef {Object} WorkerReadyMessage
 * @property {"ready"} type - 消息类型
 */

/**
 * RPC 请求消息
 * @typedef {Object} RpcRequest
 * @property {"rpc"} type - 消息类型
 * @property {string} msgId - 请求消息 id
 * @property {string} method - RPC 方法名
 * @property {Record<string, any>} params - RPC 参数
 */

/**
 * RPC 错误对象
 * @typedef {Object} RpcError
 * @property {string} code - 错误码
 * @property {string} message - 错误信息
 */

/**
 * RPC 响应消息
 * @typedef {Object} RpcResponse
 * @property {"rpc-response"} type - 消息类型
 * @property {string} msgId - 对应请求消息 id
 * @property {any} [result] - 成功结果
 * @property {RpcError} [error] - 失败错误对象
 */

/**
 * 视口变更消息
 * @typedef {Object} ViewportChangeMessage
 * @property {"viewport-change"} type - 消息类型
 * @property {string | number} monitorId - 目标 monitor 标识
 * @property {import("./types.js").Point2D} origin - 视口原点
 * @property {number} zoom - 当前缩放因子
 * @property {import("./types.js").ViewportSize} [viewportSize] - 当前视口尺寸
 */

/**
 * 请求渲染 flush 消息
 * @typedef {Object} RequestRenderFlushMessage
 * @property {"request-render-flush"} type - 消息类型
 * @property {string | number} [monitorId] - 目标 monitor 标识；省略时由 Worker 自行决定作用范围
 */

/**
 * 渲染帧消息
 * @typedef {Object} RenderFrameMessage
 * @property {"render-frame"} type - 消息类型
 * @property {string | number} monitorId - 目标 monitor 标识
 * @property {ImageBitmap} [baseBitmap] - base 层位图
 * @property {ImageBitmap} [liveBitmap] - live 层位图
 * @property {import("./types.js").Rect[]} [baseDirtyRects] - base 层脏区集合
 * @property {import("./types.js").Rect[]} [liveDirtyRects] - live 层脏区集合
 * @property {number} [frameId] - 帧序号
 */

/**
 * Worker 日志消息
 * @typedef {Object} WorkerLogMessage
 * @property {"worker-log"} type - 消息类型
 * @property {string} level - 日志级别
 * @property {string} logger - 日志命名空间
 * @property {any[]} [args] - 原始日志参数
 * @property {object} [meta] - 日志元数据
 * @property {number} [timestamp] - 日志时间戳
 */

/**
 * 对象结构变更推送消息
 * @typedef {Object} ObjectChangedMessage
 * @property {"object-changed"} type - 消息类型
 * @property {number} objectId - 对象 id
 * @property {import("./types.js").ObjectSummary} summary - 变更后的对象摘要
 */

/**
 * 列表属性变更消息
 * @typedef {Object} MutateListPropertyMessage
 * @property {"mutate-list-property"} type - 消息类型
 * @property {number} objectId - 对象 id
 * @property {string} key - 列表属性名
 * @property {"append" | "replace" | "remove"} operation - 变更操作类型
 * @property {number} [index] - replace/remove 时的目标索引
 * @property {any[]} [items] - append/replace 时的元素集合
 */

export {};
