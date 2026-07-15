/**
 * @file 一维对象基类
 * @description 定义一维白板对象的公共行为与容器关系。
 * @module core/engine/objects/one-dim/one-dim-obj
 * @author Zhou Chenyu
 */

import { Container } from "../container.js";

/**
 * 一维对象基类
 * @abstract
 * @class
 * @extends Container
 * @description 表示一维对象，对象自身只有长度没有宽度 (或只有长度没有宽度)
 * @author Zhou Chenyu
 */
class OneDimensionObject extends Container {
  /**
   * 一维对象的主轴长度
   * @type {number}
   */
  ihatLength = 0;

  /**
   * 一维对象的主轴相对 x-hat 的旋转角度
   * @type {number}
   */
  ihatRotate = 0;

  /**
   * 创建一个新的一维对象
   * @param {number} id - 对象 id
   * @param {Vector} position - 对象的初始位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
  }
}

export { OneDimensionObject };
