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
   * @param {Vector} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} ownerChunkId - 对象归属区块的 id
   * @constructor
   */
  constructor(p, id, ownerChunkId) {
    super(p, id, ownerChunkId);
  }
}

export { OneDimensionObject };
