/**
 * @author Zhou Chenyu
 */

const { MolecularOperation } = require("./operation")

/**
 * 分子节点
 * @class
 * @author Zhou Chenyu
 */
class MolecularNode {
	/**
	 * 后继点
	 * @type {MolecularNode}
	 */
	nextNode;

	/**
	 * 操作
	 * @type {MolecularOperation}
	 */
	operation;

	/**
	 * 时间 (unix 纪元)
	 * @type {number}
	 */
	createTime;

	/**
	 * 该节点的深度
	 * @type {number}
	 */
	depth;

	/**
	 * 子节点
	 * @type {MolecularNode[]}
	 */
	children;

	/**
	 * 尝试节点
	 * @type {AttemptNode}
	 * @default null
	 */
	attemptChild = null;
}

/**
 * 尝试节点
 * @class
 * @author Zhou Chenyu
 */
class AttemptNode {
	/**
	 * 子节点
	 * @type {MolecularNode[]}
	 */
	children;
}

/**
 * @abstract
 * @author Zhou Chenyu
 */
class BlockBase {}

class TreeBlock extends BlockBase {}

class AttemptBlock extends BlockBase {}

/**
 * @author Zhou Chenyu
 */
class UndoTree {
	/**
	 * 该 undo tree 维护的子树的根节点们
	 * @type {MolecularNode}
	 */
	subroots;

	/**
	 * 当前点
	 * @type {MolecularNode}
	 */
	currentNode;
}
