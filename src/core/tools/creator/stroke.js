/**
 * 笔画创建工具
 * @module core/tools/creator/stroke
 * @author Zhou Chenyu
 */

const { StrokeObject } = require("../../objects/stroke/stroke");
const { ObjectCreatorTool } = require("./obj-creator");

class StrokeCreatorTool extends ObjectCreatorTool {
  /**
   * 当前正在创建的笔画对象
   * @type {StrokeObject}
   */
  obj;

  constructor() {
    super();
  }

  create(p, id, pageId) {
    this.obj = new StrokeObject(p, id, pageId);
  }

  start(point, option) {
    this.obj.setPoints(this.obj.points.concat([point]));
  }

  move(point, option) {
    this.obj.setPoints(this.obj.points.concat([point]));
  }

  end(point, option) {
    this.obj.setPoints(this.obj.points.concat([point]));
  }
}

module.exports = {
  StrokeCreatorTool,
};