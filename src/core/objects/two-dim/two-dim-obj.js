const { Container } = require("../container");

/**
 * 二维对象基类
 * @abstract
 * @class
 * @extends Container
 * @description 表示二维对象，自身有长度和宽度
 * @author Zhou Chenyu
 */
class TwoDimensionObject extends Container {}

module.exports = {
  TwoDimensionObject,
};
