/**
 * 笔画创建工具
 * @module core/tools/creator/stroke
 * @author Zhou Chenyu
 */

import { StrokeObject } from "../../objects/stroke/stroke.js";
import { ObjectCreatorTool } from "./obj-creator.js";

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

export {
  StrokeCreatorTool,
};