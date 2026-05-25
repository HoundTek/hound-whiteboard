/**
 * @file 对象选择工具
 * @description 提供对象命中选择与选择结果输出的工具基类。
 * @module core/tools/chooser/obj-chooser
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices/signal.js";
import { joinPath } from "../../utils/path.js";

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
	 * @param {{ createModifierTool?: Function }} [options={}]
	 */
	constructor(options = {}) {
		super();
		this.createModifierTool =
			typeof options.createModifierTool === "function"
				? options.createModifierTool
				: null;
	}

	/**
	 * 从信号包构建选择上下文。
	 * @param {SignalPacket|Object} signalPacket - 输入信号包
	 * @param {Object} [deviceContext={}] - 设备上下文
	 * @returns {Object}
	 */
	buildSelectionContext(signalPacket, deviceContext = {}) {
		const packet = SignalPacket.from(signalPacket);
		return {
			signalPacket: packet,
			deviceContext,
			signals: packet.signals,
		};
	}

	/**
	 * 当前节点下是否已经存在 modifier 子工具。
	 * @param {Object} [deviceContext={}] - 设备上下文
	 * @returns {boolean}
	 */
	hasModifierTool(deviceContext = {}) {
		return Boolean(
			deviceContext.defaultPath &&
			deviceContext.resolvedDefaultPath &&
			deviceContext.tree?.getNode?.(deviceContext.resolvedDefaultPath),
		);
	}

	/**
	 * 在当前 chooser 节点下挂载对应的 modifier 子工具。
	 * @param {Object} selectionContext - 选择上下文
	 * @param {Array<*>} objects - 选中的对象集合
	 * @returns {*}
	 */
	mountModifier(selectionContext, objects) {
		const deviceContext = selectionContext?.deviceContext ?? {};
		if (
			typeof this.createModifierTool !== "function" ||
			!deviceContext.tree ||
			!deviceContext.path
		) {
			return undefined;
		}

		if (this.hasModifierTool(deviceContext)) {
			return deviceContext.tree.getNode(deviceContext.resolvedDefaultPath);
		}

		const modifierTool = this.createModifierTool({
			selectionContext,
			objects,
			chooserTool: this,
		});
		if (!modifierTool) {
			return undefined;
		}

		deviceContext.tree.configureNode(deviceContext.path, {
			defaultPath: "tool",
		});
		return deviceContext.tree.mountTool(
			joinPath(deviceContext.path, "tool"),
			modifierTool,
			{
				board: deviceContext.board,
				monitor: deviceContext.monitor,
			},
		);
	}

	/**
	 * 处理一个完整信号包。
	 * @param {SignalPacket|Object} signalPacket - 输入信号包
	 * @param {Object} [deviceContext={}] - 设备上下文
	 * @returns {*}
	 */
	process(signalPacket, deviceContext = {}) {
		const packet = SignalPacket.from(signalPacket);
		deviceContext.providedObjectsContext = deviceContext.nodeContext;

		if (this.hasModifierTool(deviceContext)) {
			const selectedObjects = this.resolveContextObjects(deviceContext);
			if (selectedObjects.length > 0) {
				this.setContextObjects(deviceContext, selectedObjects);
			}
			return this.continueToDefaultPath(packet, deviceContext);
		}

		const selectionContext = this.buildSelectionContext(packet, deviceContext);
		const selectedObjects = this.normalizeObjectCollection(
			this.choose(selectionContext),
		).filter(Boolean);
		if (selectedObjects.length === 0) {
			return undefined;
		}

		selectionContext.deviceContext.board?.activeObjectManager?.choose?.(
			new Set(selectedObjects),
		);
		this.setContextObjects(selectionContext.deviceContext, selectedObjects);
		this.mountModifier(selectionContext, selectedObjects);
		return undefined;
	}

	/**
	 * 根据输入上下文执行对象选择。
	 * @param {Object} selectionContext - 选择上下文
	 * @returns {*}
	 */
	choose(selectionContext) {
		throw new Error("Method not implemented.");
	}

	/**
	 * 工具节点被卸载时撤销当前选择。
	 * @param {Object} [deviceContext={}] - 卸载时的设备上下文
	 * @returns {void}
	 */
	umount(deviceContext = {}) {
		const selectedObjects = this.resolveContextObjects(deviceContext);
		if (selectedObjects.length > 0) {
			deviceContext?.board?.activeObjectManager?.discard?.(
				new Set(selectedObjects),
			);
		}
		this.clearContextObjects(deviceContext);
		super.umount(deviceContext);
	}
}

export {
	ObjectChooserTool,
};