/**
 * 白板管理模块
 * 
 * @author Zhou Chenyu
 */

const { DirectedGraph } = require("../utils/tier-graph");
const { UndoTree } = require("../utils/undo-tree-core");

/**
 * @class
 * @author Zhou Chenyu
 */
class BoardManager {
	/**
	 * 时间回溯树
	 * @type {UndoTree}
	 */
	undoTree;
}

module.exports = {
	BoardManager
}
