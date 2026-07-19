/**
 * @file 设备图模块 - 统一导出入口
 * @module core/ui-thread/devices-dag/index
 * @author Zhou Chenyu
 */

export { DevicesDAG } from "./dag-core/dag.js";
export {
  isPlainObject,
  isSubDAGDefinition,
  normalizeHandlerResult,
} from "./dag-core/dag-utils.js";
export { DevicesDAGNode, DevicesDAGEdge } from "./dag-core/dag-node-edge.js";
export { DAGBuilder, DAGNodeBuilder, createSubDAG } from "./dag-core/dag-builder.js";
export {
  dagToString,
  dagToMermaid,
  traceToString,
  profileFromTrace,
} from "./dag-core/dag-debug.js";
export { SignalPacket } from "./dag-core/signal.js";
