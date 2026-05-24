/**
 * @file 对象擦除工具
 * @description 提供对象擦除与局部擦除的基础工具实现。
 * @module core/tools/eraser/obj-eraser
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

/**
 * 对象擦除工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象擦除工具负责根据输入轨迹或命中范围移除对象，或对对象执行局部擦除。
 */
class ObjectEraserTool extends Tool {
	/**
	 * 擦除命中的对象或对象片段。
	 * @param {Object} eraseContext - 擦除上下文
	 * @returns {*}
	 */
	erase(eraseContext) {
		throw new Error("Method not implemented.");
	}
}

export {
	ObjectEraserTool,
};