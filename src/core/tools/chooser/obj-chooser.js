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
      deviceContext.defaultChild &&
      deviceContext.resolvedDefaultChildPath &&
      deviceContext.tree?.getNode?.(deviceContext.resolvedDefaultChildPath),
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
      return deviceContext.tree.getNode(deviceContext.resolvedDefaultChildPath);
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
      defaultChild: "tool",
    });
    const mountedNode = deviceContext.tree.mountTool(
      joinPath(deviceContext.path, "tool"),
      modifierTool,
      {
        board: deviceContext.board,
        monitor: deviceContext.monitor,
      },
    );
    this.syncModifierContext(deviceContext, objects);
    return mountedNode;
  }

  /**
   * 将当前选择结果同步到下游 modifier 节点状态。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {Iterable<*>|*} [objects] - 当前对象集合
   * @returns {Array<*>}
   */
  syncModifierContext(deviceContext = {}, objects) {
    if (!deviceContext.path) {
      return [];
    }

    const normalizedObjects =
      this.normalizeObjectCollection(objects).filter(Boolean);
    this.writeNodeState(
      deviceContext,
      normalizedObjects.length === 0
        ? {}
        : {
            object: normalizedObjects[0],
            objects: normalizedObjects,
          },
      joinPath(deviceContext.path, "tool"),
    );
    return normalizedObjects;
  }

  /**
   * 收集 chooser 当前声明的兼容 ui overlay。
   * @param {{ deviceContext?: Object, renderer?: Object }} [overlayContext={}]
   * @returns {Array<Object>}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const deviceContext = overlayContext.deviceContext ?? {};
    const renderer = overlayContext.renderer;
    const objects = this.resolveContextObjects(deviceContext).filter(Boolean);

    if (
      objects.length === 0 ||
      typeof renderer?.createCompatSelectionEntriesForObjects !== "function"
    ) {
      return [];
    }

    const defaultLeaf =
      typeof deviceContext.tree?.resolveDefaultLeaf === "function" &&
      typeof deviceContext.path === "string"
        ? deviceContext.tree.resolveDefaultLeaf(deviceContext.path)
        : null;

    const childObjects =
      defaultLeaf && defaultLeaf.path !== deviceContext.path
        ? this.normalizeObjectCollection(
            defaultLeaf.state?.objects ?? defaultLeaf.state?.object,
          ).filter(Boolean)
        : [];

    if (childObjects.length > 0) {
      return [];
    }

    return renderer.createCompatSelectionEntriesForObjects(objects, "chooser");
  }

  /**
   * 处理一个完整信号包。
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {*}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);

    if (this.hasModifierTool(deviceContext)) {
      const selectedObjects = this.resolveContextObjects(deviceContext);
      if (selectedObjects.length > 0) {
        this.setContextObjects(deviceContext, selectedObjects);
        this.syncModifierContext(deviceContext, selectedObjects);
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

export { ObjectChooserTool };
