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
  APPLY: "apply",
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
   * 规整本次修改涉及的对象集合。
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
   * 解析当前仍处于 AOM 动态图中的对象集合。
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

    modificationContext?.board?.activeObjectManager?.apply?.(
      new Set(normalizedObjects),
    );
    this.clearContextObjects(modificationContext);

    if (
      modificationContext.autoUmountOnApply !== false &&
      typeof modificationContext.tree?.unmount === "function" &&
      typeof modificationContext.path === "string"
    ) {
      modificationContext.tree.unmount(modificationContext.path);
    }

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
