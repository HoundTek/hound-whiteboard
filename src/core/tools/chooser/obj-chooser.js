/**
 * @file 对象选择工具
 * @description 提供对象命中选择与选择结果输出的工具基类。
 * @module core/tools/chooser/obj-chooser
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices/signal.js";
import { intersectsRanges } from "../../range/index.js";

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
   * @param {{}} [options={}]
   */
  constructor(options = {}) {
    super();
  }

  /**
   * 从信号包构建选择上下文
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
   * 解析对象主判定范围在世界空间中的范围
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {*} objectEntry - 候选对象
   * @returns {import("../../range/index.js").Range | undefined}
   */
  resolveObjectSelectionWorldRange(deviceContext = {}, objectEntry) {
    if (!objectEntry || typeof objectEntry.getRange !== "function") {
      return undefined;
    }

    const position = objectEntry.position;
    if (!position) {
      return undefined;
    }

    try {
      const selectionRange = objectEntry.getRange();
      if (
        !selectionRange ||
        typeof selectionRange.withPosition !== "function"
      ) {
        return undefined;
      }

      return selectionRange.withPosition(position);
    } catch {
      return undefined;
    }
  }

  /**
   * 判断对象主判定范围是否与给定选择范围相交
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {*} objectEntry - 候选对象
   * @param {*} selectionWorldRange - 选择范围
   * @returns {boolean}
   */
  objectIntersectsSelectionRange(
    deviceContext = {},
    objectEntry,
    selectionWorldRange,
  ) {
    const objectWorldRange = this.resolveObjectSelectionWorldRange(
      deviceContext,
      objectEntry,
    );
    if (!objectWorldRange || !selectionWorldRange) {
      return false;
    }

    return intersectsRanges(objectWorldRange, selectionWorldRange);
  }

  /**
   * 收集 chooser 当前声明的兼容 ui overlay
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
   * 处理一个完整信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {*}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
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
    return undefined;
  }

  /**
   * 根据输入上下文执行对象选择
   * @param {Object} selectionContext - 选择上下文
   * @returns {*}
   */
  choose(selectionContext) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时撤销当前选择
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
