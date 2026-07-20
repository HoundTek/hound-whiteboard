/**
 * @file 设备图公共类型定义
 * @description
 * 汇集设备图的公共类型词汇：handler 上下文、结果、子图定义等 typedef，
 * 以及引擎核心类的类型别名。引擎（dag-core/）与插件（devices/prefixes/tools）
 * 统一从这里引用类型，避免直接依赖引擎内部文件路径。
 * @module core/ui-thread/devices-dag/dag-type
 * @author Zhou Chenyu
 */

/**
 * 设备图静态服务上下文
 * @description
 * 沿 DAG 路径由节点声明的 `services` 静态累积而成，用于暴露 Board、Viewport、BoardApi RPC 等基础设施依赖。
 * 这部分上下文由节点配置显式声明，不通过 handler 返回值注入。
 * @typedef {Object} DevicesDAGServiceContext
 * @property {Object} [board] - Board 实例（含 allocateObjectId 等方法）
 * @property {Object} [viewport] - Viewport 实例（含 registerUiOverlayProvider / requestViewportUiRender 等）
 * @property {Object} [boardApi] - Board API RPC 代理（含 createObject / commitObjects / discardActiveObjects / modifyObject / queryObjects 等）
 * @property {Function} [allocateObjectId] - 分配对象 id 的便捷函数（优先于 board.allocateObjectId）
 */

/**
 * 设备图处理器上下文
 * @description
 * 处理器上下文包含当前节点元数据、静态服务以及节点状态访问接口，
 * 供节点处理器在处理信号包时使用。
 *
 * `services` 是沿 DAG 路径静态声明并累积的基础设施依赖。
 *
 * @typedef {Object} DevicesDAGHandlerContext
 * @property {DevicesDAGNode} node - 当前正在处理的节点
 * @property {DevicesDAG} dag - 所属设备图
 * @property {string} path - 当前节点路径（分发所用路径；同一节点可能有多条路径）
 * @property {Object} semantics - 当前节点语义元数据快照
 * @property {string} defaultRoute - 当前节点声明的默认出边名
 * @property {string} resolvedDefaultRoutePath - 当前默认出边对应的绝对路径
 * @property {number} depth - 当前分发深度
 * @property {SignalPacket|undefined} signalPacket - 当前已规整的输入信号包
 * @property {DevicesDAGServiceContext} services - 静态服务上下文
 * @property {Object} state - 当前节点状态的只读快照
 * @property {() => any} getState - 重读节点最新状态
 * @property {(nextState: Object) => Object} setState - 全量写入节点状态
 * @property {(partial: Object) => Object} patchState - 浅合并写入节点状态
 * @property {(to: string, signals?: Array<SignalPacket>) => DevicesDAGHandlerResult} routeToChild - 路由到子节点
 * @property {() => DevicesDAGHandlerResult} stop - 终止当前链路
 * @property {(type: string, value: any, extra?: Object) => SignalPacket} signal - 构造标准信号 { type, context: { value, ...extra } }
 * @property {(pathOrId?: string|number) => any} getNodeState - 读取任意节点状态
 * @property {(pathOrId: string|number, state: any) => any} setNodeState - 写入任意节点状态
 */

/**
 * 设备图处理器输出
 * @typedef {Object} DevicesDAGHandlerResult
 * @property {SignalPacket[]} packets - 继续路由到后继节点的信号包列表
 * @property {string} [redirect] - 覆盖 dispatcher 原本要走的下一段出边名
 * @property {boolean} [stop] - 强制终止当前链路路由
 */

/**
 * 设备图节点处理器
 * @description 处理节点收到的信号包，返回结果、上下文变更或路由指令。
 * @callback DevicesDAGHandler
 * @param {SignalPacket} signalPacket - 已规整的输入信号包
 * @param {DevicesDAGHandlerContext} context - 当前处理上下文
 * @returns {DevicesDAGHandlerResult|SignalPacket|Object|Array|undefined|null}
 */

/**
 * 设备图节点卸载钩子
 * @description 节点卸载时触发，用于清理工具或释放资源。
 * @callback DevicesDAGNodeUmountHandler
 * @param {DevicesDAGHandlerContext} context - 卸载上下文
 * @returns {*}
 */

/**
 * 结构化子图节点定义
 * @typedef {Object} SubDAGNodeDefinition
 * @property {DevicesDAGHandler|null} [handler] - 节点处理器
 * @property {Object} [semantics] - 节点语义元数据
 * @property {DevicesDAGServiceContext} [services] - 节点声明的静态服务集合
 * @property {string} [defaultRoute] - 默认出边名
 * @property {Tool} [tool] - 工具实例
 * @property {DevicesDAGNodeUmountHandler|null} [umount] - 卸载钩子
 */

/**
 * 结构化子图边定义
 * @typedef {Object} SubDAGEdgeDefinition
 * @property {string} name - 边名
 * @property {number} fromNodeId - 源节点（子图内局部 id）
 * @property {number} toNodeId - 目标节点（子图内局部 id）
 */

/**
 * 结构化子图定义
 * @typedef {Object} SubDAGDefinition
 * @property {string} rootPath - 子图根路径前缀
 * @property {number} rootNodeId - 子图根节点（局部 id）
 * @property {Map<number, SubDAGNodeDefinition>} nodes - 节点定义（局部 id → 定义）
 * @property {SubDAGEdgeDefinition[]} edges - 边定义列表
 * @property {() => void} [resetState] - 重置子图内部状态
 * @property {() => any} [getState] - 读取子图内部状态
 */

/**
 * 设备图（引擎核心类）
 * @typedef {import("./dag-core/dag-type.js").DevicesDAG} DevicesDAG
 */

/**
 * 设备图节点（引擎核心类）
 * @typedef {import("./dag-core/dag-type.js").DevicesDAGNode} DevicesDAGNode
 */

/**
 * 设备图有向边（引擎核心类）
 * @typedef {import("./dag-core/dag-type.js").DevicesDAGEdge} DevicesDAGEdge
 */

/**
 * 信号包（引擎核心类）
 * @typedef {import("./dag-core/signal.js").SignalPacket} SignalPacket
 */

/**
 * 工具基类
 * @typedef {import("./tools/tool.js").Tool} Tool
 */

export {};
