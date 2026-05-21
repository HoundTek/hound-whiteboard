/**
 * 白板工具基类
 * @module core/tools/board/board-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

/**
 * 白板工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 白板工具直接作用于白板结构本身，如翻区块等。
 * 这类工具通常不直接编辑对象，而是通过 Monitor / Board 上下文改变全局状态。
 */
class BoardTool extends Tool {
	/**
	 * 应用白板变更
	 * @param {Object} boardContext - 白板上下文
	 * @param {Object} signalContext - 当前信号上下文
	 * @returns {*}
	 */
	applyBoardChange(boardContext, signalContext) {
		throw new Error("Method not implemented.");
	}
}

export {
	BoardTool,
};
