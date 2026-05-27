/**
 * @file 修饰节点 — 统一导出入口
 * @module core/prefix/index
 * @author Zhou Chenyu
 */

export { PREFIX_NODE_SIGNAL_TYPES } from "./constants.js";
export { createPrefixNodeHandler } from "./handler.js";
export { createMultiToolPrefixHandler } from "./multi-tool-handler.js";
export { createRepeatorPrefixHandler } from "./repeator-handler.js";
export {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
} from "./handoff-handler.js";
export { createDragAnchorPrefixHandler } from "./drag-anchor-handler.js";
