/**
 * 对象修改工具
 * @module core/tools/modifier/obj-modifier
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

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
      if (modificationContext?.objects) {
        return Array.from(modificationContext.objects);
      }
      if (modificationContext?.object) {
        return [modificationContext.object];
      }
      return [];
    }

    if (
      typeof objects !== "string" &&
      typeof objects[Symbol.iterator] === "function"
    ) {
      return Array.from(objects);
    }

    return [objects];
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
   * 对对象应用变更。
   * @param {Object} modificationContext - 修改上下文
   * @returns {*}
   */
  modify(modificationContext) {
    throw new Error("Method not implemented.");
  }
}

export { ObjectModifierTool };
