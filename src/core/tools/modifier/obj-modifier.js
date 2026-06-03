/**
 * @file 对象修改工具
 * @description 提供对象几何和属性修改的基础工具实现。
 * @module core/tools/modifier/obj-modifier
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

/**
 * 对象修改工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const OBJECT_MODIFIER_SIGNAL_TYPES = Object.freeze({
  /** 将修改提交到静态图 */
  SUCCESS: "success",
});

/**
 * 对象修改工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象修改工具负责改变已有对象的几何形态、样式或其它可编辑属性。
 */
class ObjectModifierTool extends Tool {
  /**
   * 收集 modifier 当前声明的兼容 ui overlay。
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

    return renderer.createCompatSelectionEntriesForObjects(objects, "modifier");
  }

  /**
   * 规整本次修改涉及的对象集合
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   * @returns {Array<*>}
   */
  resolveModifiedObjects(modificationContext, objects) {
    if (objects == null) {
      return this.resolveContextObjects(modificationContext);
    }

    return this.normalizeObjectCollection(objects);
  }

  /**
   * 解析当前仍处于 AOM 动态图中的对象集合
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   * @returns {Array<*>}
   */
  resolveActiveModifiedObjects(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );
    const activeObjectIndex =
      modificationContext?.board?.activeObjectManager?.activeObjectIndex;

    if (typeof activeObjectIndex?.has !== "function") {
      return normalizedObjects;
    }

    return normalizedObjects.filter(
      (objectEntry) => objectEntry && activeObjectIndex.has(objectEntry.id),
    );
  }

  /**
   * 在对象几何修改前记录旧快照。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   */
  beforeGeometryMutation(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) return;

    modificationContext?.monitor?.liveRenderer?.captureObjectSnapshot?.(
      normalizedObjects,
    );
  }

  /**
   * 在对象几何修改后请求活动层刷新。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   */
  afterGeometryMutation(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) return;

    modificationContext?.monitor?.liveRenderer?.invalidateObjects?.(
      normalizedObjects,
    );
    modificationContext?.monitor?.requestViewportUiRender?.();
  }

  /**
   * 以统一的快照协议包装一次几何修改。
   * @param {Object} modificationContext - 修改上下文
   * @param {Function} mutate - 实际执行修改的回调
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   * @returns {*}
   */
  withGeometryMutation(modificationContext, mutate, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    this.beforeGeometryMutation(modificationContext, normalizedObjects);
    const result = mutate?.();
    this.afterGeometryMutation(modificationContext, normalizedObjects);

    return result;
  }

  /**
   * 决定是否执行 apply。
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<*>} objects - 已解析的活动对象
   * @returns {boolean}
   * @protected
   */
  beforeApplyModifiedObjects(modificationContext, objects) {
    return true;
  }

  /**
   * 提交成功后的通知钩子。
   * handoff 通过 {@link Tool#on|on('afterApply', ...)} 订阅。
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<*>} objects - 已提交的对象
   * @param {boolean} result - 提交结果
   * @protected
   */
  afterApplyModifiedObjects(modificationContext, objects, result) {
    this._emit("afterApply", modificationContext, objects, result);
  }

  /**
   * 将当前修改对象提交回静态图。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
   * @returns {boolean}
   */
  applyModifiedObjects(modificationContext, objects) {
    const normalizedObjects = this.resolveActiveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(modificationContext);
      return false;
    }

    if (
      this.beforeApplyModifiedObjects(
        modificationContext,
        normalizedObjects,
      ) === false
    ) {
      return false;
    }

    modificationContext?.board?.activeObjectManager?.apply?.(
      new Set(normalizedObjects),
    );
    this.clearContextObjects(modificationContext);

    // autoUmountOnApply 支持两层读取：顶层直接传入或通过累积 context 传入
    const autoUmount =
      modificationContext.autoUmountOnApply !== false &&
      modificationContext.context?.autoUmountOnApply !== false;
    if (
      autoUmount &&
      typeof modificationContext.dag?.unmount === "function" &&
      typeof modificationContext.path === "string"
    ) {
      modificationContext.dag.unmount(modificationContext.path);
    }

    this.afterApplyModifiedObjects(
      modificationContext,
      normalizedObjects,
      true,
    );
    return true;
  }

  /**
   * 在修改工具被卸载时撤销未提交的活动对象引用。
   * @param {Object} [modificationContext={}] - 修改上下文
   * @returns {void}
   */
  umount(modificationContext = {}) {
    const normalizedObjects =
      this.resolveActiveModifiedObjects(modificationContext);

    if (normalizedObjects.length > 0) {
      modificationContext?.board?.activeObjectManager?.discard?.(
        new Set(normalizedObjects),
      );
    }

    this.clearContextObjects(modificationContext);
    super.umount(modificationContext);
  }

  /**
   * 对对象应用变更。
   * @param {Object} modificationContext - 修改上下文
   * @returns {*}
   */
  modify(modificationContext) {
    throw new Error("Method not implemented.");
  }
}

export { ObjectModifierTool };

export { OBJECT_MODIFIER_SIGNAL_TYPES };
