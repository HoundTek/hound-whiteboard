/**
 * @file 二维对象基类
 * @description 定义二维白板对象的公共行为与容器关系。
 * @module core/objects/two-dim/two-dim-obj
 * @author Zhou Chenyu
 */

import { Container } from "../container.js";

/**
 * 二维对象基类
 * @abstract
 * @class
 * @extends Container
 * @description 表示二维对象，自身有长度和宽度
 * @author Zhou Chenyu
 */
class TwoDimensionObject extends Container {}

export { TwoDimensionObject };
