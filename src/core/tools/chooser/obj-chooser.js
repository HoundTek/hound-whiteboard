/**
 * @file 对象选择工具
 * @description 提供对象命中选择与选择结果输出的工具基类。
 * @module core/tools/chooser/obj-chooser
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

/**
 * 对象选择工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象选择工具负责根据命中规则挑选对象，并输出选择结果或选择范围。
 */
class ObjectChooserTool extends Tool {
	/**
	 * 根据输入上下文执行对象选择。
	 * @param {Object} selectionContext - 选择上下文
	 * @returns {*}
	 */
	choose(selectionContext) {
		throw new Error("Method not implemented.");
	}
}

export {
	ObjectChooserTool,
};